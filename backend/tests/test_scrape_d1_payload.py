from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.utils.FormatAndAppend import formatAndUpload, formatAndWriteCsv
from backend.scraping.comingsoons.HCsoon import HCsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class ScrapeD1PayloadTests(TestCase):
    def test_hotcinema_infinity_vision_coming_soon_upload_excludes_session_fields(self):
        scraper = HCsoon.__new__(HCsoon)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 681
        scraper.snapshot_id = "hot-cinema-coming-soon"
        scraper.supabase_table_name = "allSoons"
        scraper.supabase = Mock()
        scraper.english_title = "Future Film Infinity Vision"
        scraper.hebrew_title = "סרט חדש"
        scraper.release_date = "2026-12-03"
        scraper.appendToGatheringInfo()
        self.assertEqual(scraper.gathering_info["screening_tech"], ["2D Infinity Vision"])

        formatAndUpload(scraper)

        rows = scraper.supabase.table.return_value.insert.call_args.args[0]
        self.assertEqual(rows, [{
            "english_title": "Future Film Infinity Vision",
            "hebrew_title": "סרט חדש",
            "release_date": "2026-12-03",
            "cinema": "Hot Cinema",
            "run_id": 681,
            "snapshot_id": "hot-cinema-coming-soon",
        }])
        with patch("backend.utils.log.run_storage.RunArtifactStore") as store:
            formatAndWriteCsv(scraper, successful=True)
        self.assertEqual(store.return_value.save_scraped_rows.call_args.kwargs["rows"], rows)

    def test_coming_soon_projection_keeps_metadata_and_other_catalogs_keep_sessions(self):
        session = {
            "showtime": "20:00", "english_href": "https://example.com/ticket",
            "hebrew_href": "https://example.com/he/ticket", "screening_type": "Regular",
            "screening_tech": "2D Infinity Vision", "dub_language": "Hebrew",
            "date_of_showing": "2026-12-03", "screening_city": "Haifa",
        }
        metadata = {
            "english_title": "Future Film", "hebrew_title": "סרט חדש",
            "release_date": "2026-12-03", "release_year": 2026,
            "original_language": "English", "rating": "PG", "runtime": 100,
            "directed_by": "A Director", "cinema": "Hot Cinema", "run_id": 681,
        }
        for table in ("allSoons", "allShowtimes", "allTheques"):
            with self.subTest(table=table):
                scraper = SimpleNamespace(
                    supabase_table_name=table, snapshot_id="snapshot-681", supabase=Mock(),
                    gathering_info={key: [value] for key, value in {**metadata, **session}.items()},
                )
                formatAndUpload(scraper)
                rows = scraper.supabase.table.return_value.insert.call_args.args[0]
                expected = metadata if table == "allSoons" else {**metadata, **session}
                self.assertEqual(rows, [{**expected, "snapshot_id": "snapshot-681"}])

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
