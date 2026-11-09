from unittest import TestCase
from unittest.mock import Mock

from backend.scraping.nowplayings.YesPlanet import YesPlanet
from backend.scraping.utils.QuickbookHelpers import _is_non_screening_card


class YesPlanetSeleniumCardTests(TestCase):
    def test_movie_filter_is_cleared_before_atomic_ticket_read(self):
        scraper = YesPlanet.__new__(YesPlanet)
        events = []
        scraper.clearQuickbookMovieFilter = Mock(side_effect=lambda: events.append('clear_movie_filter'))
        scraper.driver = Mock()
        scraper.driver.execute_script.side_effect = lambda script: events.append('read_tickets') or []
        scraper.scrapeQuickbookShowtimes({})
        self.assertEqual(events, ['clear_movie_filter', 'read_tickets'])

    def test_changed_movie_filter_waits_for_route_and_tickets(self):
        scraper = YesPlanet.__new__(YesPlanet)
        scraper.driver = Mock()
        scraper.driver.execute_script.side_effect = [True, False, True]
        scraper.waitForQuickbook = Mock()

        def wait(condition):
            self.assertFalse(condition(scraper.driver))
            self.assertTrue(condition(scraper.driver))

        scraper.waitUntil = wait
        scraper.clearQuickbookMovieFilter()
        scraper.waitForQuickbook.assert_called_once()

    def test_unfiltered_or_single_movie_needs_no_route_change(self):
        scraper = YesPlanet.__new__(YesPlanet)
        scraper.driver = Mock()
        scraper.driver.execute_script.return_value = False
        scraper.waitUntil = Mock()
        scraper.waitForQuickbook = Mock()
        scraper.clearQuickbookMovieFilter()
        scraper.waitUntil.assert_not_called()
        scraper.waitForQuickbook.assert_not_called()

    def test_date_change_waits_for_its_response_before_reading_tickets(self):
        scraper = YesPlanet.__new__(YesPlanet)
        scraper.current_year = '2026'
        scraper.current_month = '11'
        button = Mock(text='16')
        scraper.waitForVisible = Mock(return_value=button)
        scraper.element = Mock(return_value=Mock(text='Tuesday 15/12/2026'))
        scraper.elements = Mock(return_value=[Mock()])
        scraper.driver = Mock()
        scraper.driver.find_element.return_value.text = 'Wednesday 16/12/2026'
        events = []
        responses = iter((False, True))

        def execute(script, *args):
            if script == 'performance.clearResourceTimings(); return performance.now()':
                return 1234
            self.assertEqual(args, ('2026-12-16', 1234))
            events.append('response_checked')
            return next(responses)

        scraper.driver.execute_script.side_effect = execute
        button.click.side_effect = lambda: events.append('clicked')
        scraper.waitForStale = Mock(side_effect=lambda ticket: events.append('old_ticket_removed'))
        scraper.waitForQuickbook = Mock(side_effect=lambda: events.append('read_tickets'))

        def wait(condition):
            for _ in range(3):
                if condition(scraper.driver):
                    return
            self.fail('Response readiness did not complete')

        scraper.waitUntil = wait
        scraper.selectQuickbookDate('#date', 2)
        self.assertEqual(events, ['clicked', 'old_ticket_removed', 'response_checked', 'response_checked', 'read_tickets'])

    def test_selecting_current_date_does_not_require_a_new_request(self):
        scraper = YesPlanet.__new__(YesPlanet)
        scraper.current_year = '2026'
        scraper.current_month = '11'
        scraper.waitForVisible = Mock(return_value=Mock(text='16'))
        scraper.element = Mock(return_value=Mock(text='Wednesday 16/12/2026'))
        scraper.elements = Mock(return_value=[Mock()])
        scraper.driver = Mock()
        scraper.waitUntil = Mock()
        scraper.waitForStale = Mock()
        scraper.waitForQuickbook = Mock()
        scraper.selectQuickbookDate('#date', 2)
        scraper.waitForStale.assert_not_called()
        self.assertEqual(scraper.driver.execute_script.call_count, 1)
        scraper.waitForQuickbook.assert_called_once()

    def test_verified_requests_collector_is_preferred_with_browser_fallback(self):
        self.assertEqual(YesPlanet.DEFAULT_SCRAPE_MODE, "auto")

    def test_titled_schedule_card_is_processed(self):
        self.assertFalse(_is_non_screening_card("Film", has_ticket_links=True))

    def test_untitled_card_without_ticket_links_is_skipped(self):
        self.assertTrue(_is_non_screening_card("  ", has_ticket_links=False))

    def test_untitled_card_with_ticket_links_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "ticket links but no film title"):
            _is_non_screening_card("", has_ticket_links=True)
