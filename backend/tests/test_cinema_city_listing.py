import unittest
from unittest.mock import Mock, patch
from pathlib import Path

from bs4 import BeautifulSoup

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By

from backend.scraping.utils.CinemaCityListing import COMING_SOON_CARD_SELECTOR, MORE_BUTTON, SHOWTIME_CARD_SELECTOR, load_movie_listing
from backend.scraping.nowplayings.CinemaCity import CinemaCity
from backend.scraping.comingsoons.CCsoon import CCsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class CinemaCityListingTests(unittest.TestCase):
    def test_discovered_movie_redirect_is_fatal(self):
        for cls in (CinemaCity, CCsoon):
            with self.subTest(scraper=cls.__name__):
                scraper = self.movie_page_scraper(cls)
                scraper.driver.current_url = 'https://www.cinema-city.co.il/'
                with patch(cls.__module__ + '.load_movie_listing'):
                    with self.assertRaisesRegex(ValueError, 'redirected away'):
                        scraper.logic()
                self.assertEqual(scraper.gathering_info['showtime'], [])

    def test_disabled_loading_control_is_not_empty_screening_evidence(self):
        scraper = self.movie_page_scraper()
        scraper.driver.find_element.return_value.is_enabled.return_value = False
        scraper.driver.find_elements.return_value = []

        def wait(condition):
            self.assertFalse(condition(scraper.driver))
            raise TimeoutException('Cinema choices have not initialized')

        scraper.waitUntil = wait
        with patch('backend.scraping.nowplayings.CinemaCity.load_movie_listing'):
            with self.assertRaisesRegex(TimeoutException, 'not initialized'):
                scraper.logic()
        self.assertEqual(scraper.gathering_info['showtime'], [])

    def movie_page_scraper(self, cls=CinemaCity):
        scraper = cls.__new__(cls)
        InitializeBaseCinema.__init__(scraper)
        scraper.sleep = Mock()
        scraper.zoomOut = Mock()
        scraper.driver = Mock()
        scraper.driver.current_url = 'https://www.cinema-city.co.il/movie/6467'
        scraper.elements = Mock(return_value=[Mock(**{'get_attribute.return_value': 'comp-mkmrxabz__6467'})])
        scraper.waitForElement = Mock(return_value=Mock(**{'get_attribute.return_value': '95'}))
        return scraper

    def test_listing_discovery_preserves_poster_and_details_cards(self):
        html = (Path(__file__).parent / 'fixtures' / 'cinema_city_homepage_states.html').read_text()
        for cls, selector, fixture in (
            (CinemaCity, SHOWTIME_CARD_SELECTOR, html),
            (CCsoon, COMING_SOON_CARD_SELECTOR, html.replace('comp-mkmrxabz__', 'comp-mrjafvoi1__').replace('comp-mpkxxq0h__', 'comp-mrjafvop__')),
        ):
            for markup in (fixture, fixture.replace('comp-mpkxxq0h__6467', 'comp-mkmrxacs3__6467').replace('comp-mrjafvop__6467', 'details__6467')):
                with self.subTest(scraper=cls.__name__, markup=markup):
                    page = BeautifulSoup(markup, 'html.parser')
                    scraper = cls.__new__(cls)
                    InitializeBaseCinema.__init__(scraper)
                    scraper.sleep = Mock()
                    scraper.zoomOut = Mock()
                    scraper.driver = Mock()
                    # Stop immediately after discovery, before movie metadata.
                    scraper.driver.get.side_effect = RuntimeError('discovery complete')
                    scraper.elements = lambda selector: [Mock(**{'get_attribute.return_value': node['id']}) for node in page.select(selector)]
                    with patch(cls.__module__ + '.load_movie_listing') as listing:
                        with self.assertRaisesRegex(RuntimeError, 'discovery complete'):
                            scraper.logic()
                    listing.assert_called_once_with(scraper, selector)
                    self.assertEqual(scraper.hebrew_hrefs, [
                        'https://www.cinema-city.co.il/movie/6467',
                        'https://www.cinema-city.co.il/movie/6675',
                    ])

    def scraper(self, batches, ignored_clicks=0):
        scraper = Mock()
        state = {"count": 12, "batches": list(batches), "clicks": 0}
        button = Mock()
        button.is_displayed.side_effect = lambda: bool(state["batches"])
        scraper.elements.side_effect = lambda selector: [button]
        scraper.lenElements.side_effect = lambda selector: state["count"]
        scraper.driver.find_elements.side_effect = lambda by, selector: [None] * state["count"]

        def click(selector):
            state["clicks"] += 1
            if state["clicks"] > ignored_clicks and state["batches"]:
                state["count"] += state["batches"].pop(0)

        def wait(condition):
            if not condition(scraper.driver):
                raise TimeoutException("No new cards")

        scraper.clickWhenReady.side_effect = click
        scraper.waitUntil.side_effect = wait
        return scraper, state

    def test_loads_all_pages_for_both_cinema_city_listings(self):
        for selector in (COMING_SOON_CARD_SELECTOR, SHOWTIME_CARD_SELECTOR):
            with self.subTest(selector=selector):
                scraper, state = self.scraper([12, 12, 12, 12, 4])
                load_movie_listing(scraper, selector)
                self.assertEqual(state["count"], 64)
                self.assertEqual(state["clicks"], 5)
                scraper.driver.find_elements.assert_called_with(By.CSS_SELECTOR, selector)

    def test_retries_click_ignored_before_hydration(self):
        scraper, state = self.scraper([12, 5], ignored_clicks=1)
        load_movie_listing(scraper, ".cards")
        self.assertEqual(state["count"], 29)
        self.assertEqual(state["clicks"], 3)

    def test_recovers_when_first_two_clicks_are_ignored(self):
        scraper, state = self.scraper([5], ignored_clicks=2)
        load_movie_listing(scraper, ".cards")
        self.assertEqual(state["count"], 17)
        self.assertEqual(state["clicks"], 3)

    def test_stalled_listing_is_fatal_and_retries_are_bounded(self):
        scraper, state = self.scraper([12], ignored_clicks=10)
        with self.assertRaisesRegex(TimeoutException, "pagination stalled after 12 films"):
            load_movie_listing(scraper, ".cards")
        self.assertEqual(state["clicks"], 3)

    def test_no_button_or_hidden_button_finishes_without_clicking(self):
        for hidden in (False, True):
            with self.subTest(hidden=hidden):
                scraper, state = self.scraper([])
                if not hidden:
                    scraper.elements.return_value = []
                    scraper.elements.side_effect = None
                load_movie_listing(scraper, ".cards")
                self.assertEqual(state["clicks"], 0)
                scraper.waitForElement.assert_called_once_with(".cards")

    def test_other_errors_are_not_retried(self):
        scraper, state = self.scraper([12])
        scraper.clickWhenReady.side_effect = RuntimeError("driver disconnected")
        with self.assertRaisesRegex(RuntimeError, "driver disconnected"):
            load_movie_listing(scraper, ".cards")
        scraper.clickWhenReady.assert_called_once_with(MORE_BUTTON)

    def test_final_button_disappears_while_waiting_to_click(self):
        scraper, state = self.scraper([5])

        def finish_page(selector):
            state["count"] += state["batches"].pop(0)
            raise TimeoutException("Button disappeared before click")

        scraper.clickWhenReady.side_effect = finish_page
        load_movie_listing(scraper, ".cards")
        self.assertEqual(state["count"], 17)
        scraper.clickWhenReady.assert_called_once()

    def test_terminal_button_without_extra_cards_finishes(self):
        scraper, state = self.scraper([0])
        load_movie_listing(scraper, ".cards")
        self.assertEqual(state["count"], 12)
        self.assertEqual(state["clicks"], 1)


if __name__ == "__main__":
    unittest.main()
