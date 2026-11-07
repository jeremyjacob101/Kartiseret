"""Every enabled source must obey the same transport/publication contract."""

from unittest import TestCase
from unittest.mock import Mock, patch

from requests import HTTPError, Response

from backend.config.registry import REGISTRY
from backend.config.runners import cinemaDictionary
from backend.scraping.nowplayings.MovieLand import MovieLand


class ScraperFleetTransportTests(TestCase):
    def test_movieland_denial_closes_http_session_before_browser_fallback(self):
        events = []
        response = Response()
        response.status_code = 403
        response.url = MovieLand.URL
        response._content = b'<html><title>Just a moment...</title></html>'
        session = Mock()
        session.get.return_value = response
        driver = Mock()
        def start_browser(*args):
            events.append('browser')
            return driver
        with patch('backend.scraping.BaseCinema.setUpSupabase'), \
             patch('backend.scraping.BaseCinema.build_chrome', side_effect=start_browser), \
             patch('backend.scraping.BaseCinema.navigate'), \
             patch('backend.scraping.BaseCinema.logSuccessfulRun'), \
             patch('backend.utils.log.run_storage.RunArtifactStore'), \
             patch('backend.scraping.utils.MovieLandRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            factory.return_value.__exit__.side_effect = lambda *args: events.append('http closed')
            scraper = MovieLand('allShowtimes', 'allShowtimes', 1)
            scraper.supabase = Mock()
            scraper.selenium_logic = Mock(side_effect=lambda: self.append(scraper, 'Browser film'))
            try:
                scraper.scrape()
            finally:
                cinemaDictionary['cleanup'](scraper)
        self.assertEqual(events, ['http closed', 'browser'])
        self.assertEqual([row['english_title'] for row in scraper._uploaded_scrape_rows], ['Browser film'])
        driver.quit.assert_called_once()

    @staticmethod
    def append(scraper, title):
        scraper.english_title = title
        scraper.release_date = '2026-12-01'
        scraper.date_of_showing = '2026-11-07'
        scraper.showtime = '20:00'
        scraper.screening_city = 'Test City'
        scraper.english_href = 'https://example.test/ticket/1'
        scraper.appendToGatheringInfo()

    def check_source(self, cls, table, denied):
        with patch('backend.scraping.BaseCinema.setUpSupabase'), \
             patch('backend.scraping.BaseCinema.build_chrome') as chrome, \
             patch('backend.scraping.BaseCinema.navigate'), \
             patch('backend.scraping.BaseCinema.logSuccessfulRun'), \
             patch('backend.utils.log.run_storage.RunArtifactStore'):
            scraper = cls(table, table, 1)
            scraper.supabase = Mock()
            self.assertEqual(scraper.scrape_mode, 'auto')
            chrome.assert_not_called()

            def http():
                scraper._coverage = {'pages_expected': 1, 'pages_completed': 1}
                self.append(scraper, 'HTTP film')
                if denied:
                    scraper._attempt_cache = {'partial': True}
                    scraper.confirmEmptySnapshot('stale evidence must not survive fallback')
                    raise HTTPError('403 source denied')

            def browser():
                self.assertEqual(scraper.gathering_info['english_title'], [])
                self.assertFalse(hasattr(scraper, '_attempt_cache'))
                self.assertIsNone(scraper._empty_snapshot_evidence)
                self.append(scraper, 'Browser film')

            scraper.requests_logic = Mock(side_effect=http)
            scraper.selenium_logic = Mock(side_effect=browser)
            try:
                scraper.scrape()
                scraper.requests_logic.assert_called_once()
                if denied:
                    chrome.assert_called_once()
                    scraper.selenium_logic.assert_called_once()
                else:
                    chrome.assert_not_called()
                    scraper.selenium_logic.assert_not_called()
                self.assertEqual(
                    [row['english_title'] for row in scraper._uploaded_scrape_rows],
                    ['Browser film' if denied else 'HTTP film'],
                )
            finally:
                cinemaDictionary['cleanup'](scraper)
            if denied:
                chrome.return_value.quit.assert_called_once()

    def test_all_enabled_sources_use_http_without_starting_a_browser(self):
        for table, classes in REGISTRY.items():
            for cls in classes:
                with self.subTest(scraper=cls.__name__):
                    self.check_source(cls, table, denied=False)

    def test_all_enabled_sources_discard_partial_http_output_on_denial(self):
        for table, classes in REGISTRY.items():
            for cls in classes:
                with self.subTest(scraper=cls.__name__):
                    self.check_source(cls, table, denied=True)
