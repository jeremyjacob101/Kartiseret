import unittest
from unittest.mock import Mock

from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.common.by import By

from backend.scraping.nowplayings.YesPlanet import YesPlanet
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def text_element(text, **attributes):
    element = Mock(text=text)
    element.get_attribute.side_effect = lambda name: attributes.get(name, text if name == "innerText" else None)
    return element


def showtype(language="ENGLISH", formats=("2D",), times=("18:00",)):
    tickets = [text_element(time, **{"data-url": f"https://tickets5.planetcinema.co.il/api/order/{index}?lang=en"}) for index, time in enumerate(times, 1)]
    element = Mock()
    element.find_elements.side_effect = lambda by, selector: {
        ":scope > a[data-url]": tickets,
        ":scope > .qb-screening-attributes > .lang-attributes": [text_element(language)],
        ":scope > .qb-screening-attributes > li:not(.lang-attributes)": [text_element(value) for value in formats],
    }[selector]
    return element, tickets


def film(title, *formats):
    element = Mock()
    tickets = [ticket for _, group in formats for ticket in group]
    element.find_elements.side_effect = lambda by, selector: {
        ".events a[data-url]": tickets,
        ".events .type-row .qb-movie-info-column": [group for group, _ in formats],
    }[selector]
    element.find_element.return_value = text_element(title)
    return element


class YesPlanetShowtimeTests(unittest.TestCase):
    def scraper(self, *films):
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
        scraper.elements = Mock(return_value=list(films))
        return scraper

    def test_preserves_films_formats_times_and_checkout_links(self):
        scraper = self.scraper(
            film(" DUNE 1 ", showtype(formats=("4DX", "2D"), times=("17:30",)), showtype(times=("18:00",))),
            film("DUNE 2", showtype(formats=("ScreenX", "2D"), times=("18:30",)), showtype(formats=("4DX", "2D"), times=("20:45",)), showtype(times=("21:15",))),
        )
        scraper.scrapeQuickbookShowtimes({"dune 1": 0, "dune 2": 1})
        rows = scraper.gathering_info
        self.assertEqual(rows["english_title"], ["Dune 1"] * 2 + ["Dune 2"] * 3)
        self.assertEqual(rows["showtime"], ["17:30", "18:00", "18:30", "20:45", "21:15"])
        self.assertEqual(rows["screening_type"], ["Regular"] * 5)
        self.assertEqual(rows["screening_tech"], ["2D 4DX", "2D", "2D ScreenX", "2D 4DX", "2D"])
        self.assertEqual(rows["runtime"], [155, 155, 166, 166, 166])
        self.assertTrue(all(href.endswith("?lang=en") and "/api/" not in href for href in rows["english_href"]))
        self.assertTrue(all(href.endswith("?lang=he") for href in rows["hebrew_href"]))
        scraper.elements.assert_called_once_with("section.npm-quickbook .movie-row")

    def test_preorder_and_non_ticket_rows_need_no_title(self):
        preorder = film("No checkout links")
        scraper = self.scraper(preorder, film("DUNE 1", showtype()))
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        preorder.find_element.assert_not_called()
        self.assertEqual(scraper.gathering_info["showtime"], ["18:00"])

    def test_empty_format_and_unknown_film_do_not_hide_valid_screenings(self):
        scraper = self.scraper(film("Unknown", showtype()), film("DUNE 1", showtype(times=()), showtype(times=("18:00", "20:00"))))
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["showtime"], ["18:00", "20:00"])

    def test_preserves_russian_exclusion_and_resets_dubbing_between_formats(self):
        scraper = self.scraper(film("DUNE 1", showtype(language="ru"), showtype(language="dub"), showtype()))
        scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["dub_language"], ["Hebrew", None])

    def test_ticket_row_without_a_title_is_fatal(self):
        broken = film("Missing title", showtype())
        broken.find_element.side_effect = NoSuchElementException("Missing movie name")
        scraper = self.scraper(broken)
        with self.assertRaises(NoSuchElementException):
            scraper.scrapeQuickbookShowtimes({"dune 1": 0})
        self.assertEqual(scraper.gathering_info["showtime"], [])
        broken.find_element.assert_called_once_with(By.CSS_SELECTOR, ".qb-movie-name")


if __name__ == "__main__":
    unittest.main()
