import unittest
from unittest.mock import Mock

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By

from backend.scraping.utils.CinemaCityListing import MORE_BUTTON, load_movie_listing


class CinemaCityListingTests(unittest.TestCase):
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
        for selector in ("[id^='comp-mrjafvop__']", "[id^='comp-mpkxxq0h__']"):
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
