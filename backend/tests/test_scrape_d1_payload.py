from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.utils.FormatAndAppend import formatAndUpload, formatAndWriteCsv


class ScrapeD1PayloadTests(TestCase):
    def test_d1_persists_the_exact_supabase_payload_with_snapshot_identity(self):
        scraper = SimpleNamespace(
            run_id=678,
            snapshot_id="snapshot-678-cinema-city",
            supabase_table_name="allShowtimes",
            gathering_info={
                "english_title": ["  Shrek  "],
                "showtime": ["20:00"],
                "run_id": [678],
            },
            supabase=Mock(),
        )
        scraper.supabase.table.return_value.insert.return_value.execute.return_value = Mock(data=[])

        formatAndUpload(scraper)
        uploaded_rows = scraper.supabase.table.return_value.insert.call_args.args[0]

        # The saved scrape log must stay identical even if in-memory data later changes.
        scraper.gathering_info["english_title"][0] = "changed after upload"
        scraper.gathering_info["english_title"].append("not part of the upload")

        with patch("backend.utils.log.run_storage.RunArtifactStore") as store:
            count = formatAndWriteCsv(scraper, successful=True)

        self.assertEqual(count, 1)
        saved_rows = store.return_value.save_scraped_rows.call_args.kwargs["rows"]
        self.assertEqual(saved_rows, uploaded_rows)
        self.assertEqual(saved_rows[0]["english_title"], "Shrek")
        self.assertEqual(saved_rows[0]["snapshot_id"], "snapshot-678-cinema-city")
        self.assertEqual(scraper._snapshot_row_count, count)


if __name__ == "__main__":
    import unittest

    unittest.main()
