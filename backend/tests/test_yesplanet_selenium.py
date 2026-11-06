from unittest import TestCase

from backend.scraping.nowplayings.YesPlanet import YesPlanet, _is_non_screening_card


class YesPlanetSeleniumCardTests(TestCase):
    def test_verified_requests_collector_is_preferred_with_browser_fallback(self):
        self.assertEqual(YesPlanet.DEFAULT_SCRAPE_MODE, "auto")

    def test_titled_schedule_card_is_processed(self):
        self.assertFalse(_is_non_screening_card("Film", has_ticket_links=True))

    def test_untitled_card_without_ticket_links_is_skipped(self):
        self.assertTrue(_is_non_screening_card("  ", has_ticket_links=False))

    def test_untitled_card_with_ticket_links_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "ticket links but no film title"):
            _is_non_screening_card("", has_ticket_links=True)
