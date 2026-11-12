import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.utils.FormatAndAppend import (
    SCRAPE_INSERT_MAX_BYTES, SCRAPE_INSERT_MAX_ROWS, _upload_batches,
    formatAndUpload, formatAndWriteCsv,
)


class BoundedScrapeUploadTests(TestCase):
    def scraper(self, count):
        return SimpleNamespace(
            gathering_info={"english_title": [f"Film {i}" for i in range(count)],
                            "cinema": ["Diagnostic"] * count},
            snapshot_id="one-attempt", supabase_table_name="allShowtimes",
            supabase=Mock(), run_id=698,
        )

    def test_incident_sized_scrapes_have_bounded_minimal_responses(self):
        for count in (1412, 3587, 4481, 3904):
            with self.subTest(count=count):
                scraper = self.scraper(count)
                formatAndUpload(scraper)
                calls = scraper.supabase.table.return_value.insert.call_args_list
                batches = [call.args[0] for call in calls]
                self.assertEqual(sum(map(len, batches)), count)
                self.assertEqual(len(batches), (count+199)//200)
                self.assertTrue(all(0 < len(batch) <= SCRAPE_INSERT_MAX_ROWS for batch in batches))
                self.assertTrue(all(call.kwargs == {"returning": "minimal"} for call in calls))
                self.assertTrue(all(row["snapshot_id"] == "one-attempt" for batch in batches for row in batch))
                self.assertEqual(scraper._snapshot_row_count, count)
                self.assertEqual(scraper._uploaded_scrape_rows, [row for batch in batches for row in batch])

    def test_multibyte_and_variable_size_rows_obey_the_byte_bound(self):
        rows = [{"english_title": "סרט" * size, "english_href": "https://example.invalid/"+str(i)}
                for i, size in enumerate([6000, 4000, 13000, 2000, 17000, 1000] * 10)]
        batches = list(_upload_batches(rows))
        self.assertEqual([row for batch in batches for row in batch], rows)
        self.assertGreater(len(batches), 1)
        for batch in batches:
            actual = len(json.dumps(batch, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())
            self.assertLessEqual(actual, SCRAPE_INSERT_MAX_BYTES)

    def test_oversized_single_row_is_refused(self):
        with self.assertRaisesRegex(ValueError, "exceeds the upload"):
            list(_upload_batches([{"english_title": "x" * SCRAPE_INSERT_MAX_BYTES}]))

    def test_failed_later_batch_never_reports_a_complete_snapshot(self):
        scraper = self.scraper(450)
        scraper.supabase.table.return_value.insert.return_value.execute.side_effect = [Mock(), TimeoutError("57014")]
        with self.assertRaisesRegex(TimeoutError, "57014"):
            formatAndUpload(scraper)
        self.assertEqual(scraper._snapshot_row_count, 0)
        self.assertEqual(len(scraper._uploaded_scrape_rows), 450)
        self.assertEqual(scraper.supabase.table.return_value.insert.call_count, 2)
        with patch("backend.utils.log.run_storage.RunArtifactStore") as store:
            formatAndWriteCsv(scraper, successful=False)
        self.assertEqual(len(store.return_value.save_scraped_rows.call_args.kwargs["rows"]), 450)
        self.assertFalse(store.return_value.save_scraped_rows.call_args.kwargs["successful"])

    def test_empty_confirmed_scrape_makes_no_insert(self):
        scraper = self.scraper(0)
        scraper._empty_snapshot_evidence = "Source explicitly empty"
        formatAndUpload(scraper)
        scraper.supabase.table.assert_not_called()
        self.assertEqual(scraper._snapshot_row_count, 0)
