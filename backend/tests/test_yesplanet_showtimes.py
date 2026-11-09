import unittest
from unittest.mock import Mock

from backend.scraping.nowplayings.YesPlanet import YesPlanet
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def screening(title="DUNE 1", time="18:00", tech="2D", language="ENGLISH", event_id=1):
    return {"title": title, "time": time, "tech": tech, "language": language,
            "href": f"https://tickets5.planetcinema.co.il/api/order/{event_id}?lang=en"}


class YesPlanetShowtimeTests(unittest.TestCase):
    def scraper(self, *screenings):
        scraper = YesPlanet.__new__(YesPlanet)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 1
        scraper.screening_city = "Haifa"
        scraper.date_of_showing = "2026-12-08"
        scraper.english_titles = ["Dune 1", "Dune 2"]
        scraper.hebrew_titles = ["חולית 1", "חולית 2"]
        scraper.original_languages = ["English", "English"]
        scraper.release_years = [2021, 2024]
        scraper.directed_bys = ["Denis Villeneuve"] * 2
        scraper.ratings = ["12", "14"]
        scraper.runtimes = [155, 166]
        scraper.driver = Mock()
        scraper.driver.execute_script.return_value = list(screenings)
        return scraper

    def test_preserves_films_formats_times_and_checkout_links(self):
        scraper = self.scraper(
            screening(" DUNE 1 ", "17:30", "4DX2D", event_id=1),
            screening("DUNE 1", "18:00", event_id=2),
            screening("DUNE 2", "18:30", "ScreenX2D", event_id=3),
            screening("DUNE 2", "20:45", "4DX2D", event_id=4),
            screening("DUNE 2", "21:15", event_id=5),
        )
        scraper.scrapeQuickbookShowtimes({"dune 1": 0, "dune 2": 1})
        rows = scraper.gathering_info
        self.assertEqual(rows["english_title"], ["Dune 1"] * 2 + ["Dune 2"] * 3)
        self.assertEqual(rows["showtime"], ["17:30", "18:00", "18:30", "20:45", "21:15"])
        self.assertEqual(rows["screening_type"], ["Regular"] * 5)
        self.assertEqual(rows["screening_tech"], ["2D 4DX", "2D", "2D ScreenX", "2D 4DX", "2D"])
        self.assertEqual(rows["runtime"], [155, 155, 166, 166, 166])
        self.assertEqual(rows["english_href"], [f"https://tickets5.planetcinema.co.il/order/{i}?lang=en" for i in range(1, 6)])
        self.assertEqual(rows["hebrew_href"], [f"https://tickets5.planetcinema.co.il/order/{i}?lang=he" for i in range(1, 6)])

    def test_date_is_read_once_before_appending_any_screenings(self):
        scraper = self.scraper(screening(time="18:00"), screening(time="20:00"))
        append = scraper.appendToGatheringInfo

        def append_after_page_rerenders():
            # Once extraction returns, Vue may replace every node. No further
            # driver reads may be needed to finish this date or duplicate rows.
            scraper.driver.execute_script.side_effect = AssertionError("Page already rerendered")
            append()

        scraper.appendToGatheringInfo = append_after_page_rerenders
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        scraper.driver.execute_script.assert_called_once()
        self.assertEqual(scraper.gathering_info["showtime"], ["18:00", "20:00"])

    def test_unknown_film_does_not_hide_valid_screenings(self):
        scraper = self.scraper(screening("Unknown"), screening())
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["showtime"], ["18:00"])

    def test_preserves_russian_exclusion_and_resets_dubbing_between_formats(self):
        scraper = self.scraper(screening(language="ru"), screening(language="dub"), screening())
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["dub_language"], ["Hebrew", None])

    def test_ticket_row_without_a_title_is_fatal(self):
        scraper = self.scraper(screening(title=""))
        with self.assertRaisesRegex(ValueError, "missing its movie title"):
            scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["showtime"], [])


if __name__ == "__main__":
    unittest.main()
