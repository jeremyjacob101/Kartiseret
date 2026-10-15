from datetime import date
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import Mock, patch

from backend.scraping.comingsoons.CCsoon import CCsoon
from backend.scraping.utils.FormatAndAppend import formatAndUpload
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class ComingSoonDateTests(TestCase):
    def build_scraper(self, dates):
        scraper = CCsoon.__new__(CCsoon)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 1
        scraper.supabase_table_name = "allSoons"
        scraper.supabase = Mock()
        scraper.supabase_tables = {}
        scraper.supabase.table.side_effect = lambda name: scraper.supabase_tables.setdefault(name, Mock())
        scraper.driver = Mock()
        scraper.driver.page_source, scraper.driver.title = "", "Cinema City"
        scraper.driver.get.side_effect = lambda url: setattr(scraper.driver, "current_url", url)
        scraper.zoomOut = Mock()
        scraper.lenElements = Mock(return_value=0)
        scraper.elements = Mock(return_value=[SimpleNamespace(get_attribute=lambda name, index=index: f"comp-mrjafvop__{index}") for index in range(len(dates))])

        def element(selector):
            index = int(scraper.driver.current_url.rsplit("/", 1)[-1]) if "/movie/" in scraper.driver.current_url else 0
            values = {"main h1": f"סרט {index}", "#comp-mkb98jrw": f"Movie {index}", "#comp-mkbdaczu": "134", "#comp-mkbdcdtv": "טרם נקבע", "#comp-mkbdbb73": f"תאריך בכורה:{dates[index]}"}
            return SimpleNamespace(get_attribute=lambda name: values.get(selector, ""))

        scraper.waitForElement = element
        return scraper

    def test_hebrew_months_and_calendar_validation(self):
        scraper = CCsoon.__new__(CCsoon)
        months = ("ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר")
        for month_number, month in enumerate(months, 1):
            for prefix in ("", "ב"):
                with self.subTest(month=month, prefix=prefix):
                    self.assertEqual(scraper.parseReleaseDate(f"3 {prefix}{month} 2026"), date(2026, month_number, 3).isoformat())
        self.assertEqual(scraper.parseReleaseDate("29 בפברואר 2028"), "2028-02-29")
        for value in (None, "", "טרם נקבע", "3 בחודשלאקיים 2026", "31 באפריל 2026", "29 בפברואר 2026", "03/12", "03/12/2026 junk"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                scraper.parseReleaseDate(value)

    def test_numeric_dates_and_invisible_direction_characters(self):
        scraper = CCsoon.__new__(CCsoon)
        for value in ("03/12/26", "3/12/2026", "03.12.2026", "\u200f3\u200e\u00a0בדצמבר\u00a0\u202a2026\u202c", " 3   בדצמבר  2026 "):
            with self.subTest(value=value):
                self.assertEqual(scraper.parseReleaseDate(value), "2026-12-03")

    def test_scraper_uploads_parsed_local_dates(self):
        scraper = self.build_scraper(["3 בדצמבר 2026", "22/10/26"])
        with patch("backend.scraping.BaseCinema.logSuccessfulRun"), patch("backend.scraping.BaseCinema.formatAndWriteCsv"):
            scraper.scrape()
        scraper.supabase.table.assert_any_call("allSoons")
        scraper.supabase.table.assert_any_call("pipeline_scrape_snapshots")
        rows = scraper.supabase_tables["allSoons"].insert.call_args.args[0]
        self.assertEqual([row["release_date"] for row in rows], ["2026-12-03", "2026-10-22"])
        self.assertEqual([row["english_title"] for row in rows], ["Movie 0", "Movie 1"])

    def test_invalid_required_date_aborts_before_any_upload_even_after_valid_rows(self):
        for value in ("", "טרם נקבע", "31 בפברואר 2026"):
            with self.subTest(value=value):
                scraper = self.build_scraper(["3 בדצמבר 2026", value])
                with patch("backend.scraping.BaseCinema.logSuccessfulRun") as successful, patch("backend.scraping.BaseCinema.formatAndWriteCsv") as artifact:
                    with self.assertRaises(ValueError):
                        scraper.scrape()
                calls = [call.args[0] for call in scraper.supabase.table.call_args_list]
                self.assertNotIn("allSoons", calls)
                self.assertIn("pipeline_scrape_snapshots", calls)
                successful.assert_not_called()
                artifact.assert_called_once_with(scraper, successful=False)
                self.assertEqual(scraper.gathering_info["release_date"], ["2026-12-03"])

    def test_any_coming_soon_upload_requires_valid_dates_for_every_row(self):
        for value in (None, "", "null", "unknown", "2026-02-30"):
            with self.subTest(value=value):
                scraper = self.build_scraper([])
                scraper.gathering_info = {"english_title": ["Valid", "Invalid"], "release_date": ["2026-12-03", value]}
                with self.assertRaises(ValueError):
                    formatAndUpload(scraper)
                scraper.supabase.table.assert_not_called()

    def test_showtime_upload_does_not_require_a_release_date(self):
        scraper = self.build_scraper([])
        scraper.supabase_table_name = "allShowtimes"
        scraper.gathering_info = {"english_title": ["Film"], "date_of_showing": ["2026-12-03"]}
        formatAndUpload(scraper)
        scraper.supabase.table.assert_called_once_with("allShowtimes")


if __name__ == "__main__":
    main()
