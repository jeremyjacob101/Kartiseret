from unittest import TestCase
from unittest.mock import Mock, patch

import requests

from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.cinematheques.JAFCtheque import JAFCtheque
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def page(title, href, date='01/01, Thursday 9:05', movie_id='42'):
    return f'''<div class="jaffa-movies"><article class="jaffa-movie-card" data-movie-id="{movie_id}">
        <h2 class="jaffa-movie-card__title">{title}</h2>
        <span class="jaffa-movie-card__meta-item"><span>Director:</span><span>A Director, Another</span></span>
        <span class="jaffa-movie-card__meta-item"><span>Running time:</span><span>1h 35m</span></span>
        <div class="jaffa-movie-card__desc-inner"><p>France / 2024</p></div>
        <div class="jaffa-movie-card__screenings"><a class="jaffa-movie-card__screening" href="{href}"><span class="jaffa-movie-card__date-link">{date}</span></a></div>
        </article></div>'''


class JaffaRequestsTests(TestCase):
    def setUp(self):
        self.scraper = JAFCtheque.__new__(JAFCtheque)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.run_id = 1
        self.scraper.current_year = '2026'
        self.scraper.current_month = '12'

    def run_pages(self, *pages):
        responses = []
        for html in pages:
            response = Mock(text=html)
            responses.append(response)
        session = Mock()
        session.get.side_effect = responses
        with patch('backend.scraping.cinematheques.JAFCtheque.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.logic()
        return session, responses

    def test_extracts_bilingual_rows_and_crosses_year(self):
        session, responses = self.run_pages(page('סרט - Eng subs', '/he-ticket'), page('Film - Heb subs', '/en-ticket'))
        info = self.scraper.gathering_info
        self.assertEqual(info['english_title'], ['Film'])
        self.assertEqual(info['hebrew_title'], ['סרט'])
        self.assertEqual(info['date_of_showing'], ['2027-01-01'])
        self.assertEqual(info['showtime'], ['9:05'])
        self.assertEqual(info['hebrew_href'], ['https://www.jaffacinema.com/he-ticket'])
        self.assertEqual(info['english_href'], ['https://www.jaffacinema.com/en-ticket'])
        self.assertEqual(info['runtime'], [95])
        self.assertEqual(info['directed_by'], ['A Director'])
        self.assertEqual(info['release_year'], [2024])
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(session.get.call_args.kwargs['timeout'], (10, 30))
        for response in responses:
            response.raise_for_status.assert_called_once()

    def test_missing_structure_and_malformed_screening_fail(self):
        for hebrew, english in [('<html>access denied</html>', page('Film', '/en')), (page('סרט', '/he'), page('Film', '/en', date='unknown'))]:
            with self.subTest(english=english), self.assertRaises(ValueError):
                self.run_pages(hebrew, english)

    def test_http_error_propagates(self):
        session = Mock()
        session.get.return_value.raise_for_status.side_effect = requests.HTTPError('403')
        with patch('backend.scraping.cinematheques.JAFCtheque.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(requests.HTTPError):
                self.scraper.logic()

    def test_malformed_later_card_does_not_upload_partial_snapshot(self):
        hebrew = page('סרט', '/he')
        english = page('Film', '/en') + page('Broken', '/bad', date='unknown', movie_id='43')
        responses = [Mock(text=hebrew), Mock(text=english)]
        session = Mock()
        session.get.side_effect = responses
        self.scraper.driver = None
        self.scraper.supabase_table_name = 'allTheques'
        self.scraper.supabase = Mock()
        self.scraper.startScrapeSnapshot = Mock()
        self.scraper.failScrapeSnapshot = Mock()
        with patch('backend.scraping.cinematheques.JAFCtheque.requests.Session') as factory, patch('backend.scraping.BaseCinema.formatAndUpload') as upload, patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(ValueError):
                self.scraper.scrape()
        upload.assert_not_called()
        self.scraper.failScrapeSnapshot.assert_called_once()

    def test_browser_is_created_only_when_scraping(self):
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = BaseCinema('allTheques', 'allTheques', 1)
            self.assertIsNone(scraper.driver)
            chrome.assert_not_called()
            scraper.startScrapeSnapshot = Mock()
            scraper.finishScrapeSnapshot = Mock()
            scraper.logic = Mock()
            with patch('backend.scraping.BaseCinema.navigate') as navigate, patch('backend.scraping.BaseCinema.formatAndUpload'), patch('backend.scraping.BaseCinema.logSuccessfulRun'), patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
                scraper.scrape()
            chrome.assert_called_once()
            self.assertIs(scraper.driver, chrome.return_value)
        navigate.assert_called_once_with(scraper)

    def test_browser_is_not_created_or_navigated(self):
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = JAFCtheque('allTheques', 'allTheques', 1)
        self.assertIsNone(scraper.driver)
        chrome.assert_not_called()
        scraper.startScrapeSnapshot = Mock()
        scraper.finishScrapeSnapshot = Mock()
        scraper.logic = Mock(side_effect=lambda: scraper.confirmEmptySnapshot("Source explicitly has no screenings"))
        with patch('backend.scraping.BaseCinema.navigate') as navigate, patch('backend.scraping.BaseCinema.formatAndUpload'), patch('backend.scraping.BaseCinema.logSuccessfulRun'), patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
            scraper.scrape()
        navigate.assert_not_called()
        scraper.logic.assert_called_once()

    def test_auto_fallback_discards_partial_rows_before_browser(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = JAFCtheque('allTheques', 'allTheques', 1)
        scraper.startScrapeSnapshot = Mock()
        scraper.finishScrapeSnapshot = Mock()
        scraper.failScrapeSnapshot = Mock()

        def fail_after_row():
            scraper.english_title = 'partial HTTP'
            scraper.appendToGatheringInfo()
            raise ValueError('incomplete response')

        def browser_rows():
            self.assertEqual(scraper.gathering_info['english_title'], [])
            scraper.english_title = 'complete browser'
            scraper.appendToGatheringInfo()

        scraper.logic = Mock(side_effect=fail_after_row)
        scraper.selenium_logic = Mock(side_effect=browser_rows)
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.navigate'), patch('backend.scraping.BaseCinema.formatAndUpload') as upload, patch('backend.scraping.BaseCinema.logSuccessfulRun'), patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
            scraper.scrape()
        self.assertEqual(scraper.gathering_info['english_title'], ['complete browser'])
        self.assertEqual(scraper.startScrapeSnapshot.call_count, 2)
        scraper.failScrapeSnapshot.assert_called_once()
        chrome.assert_called_once()
        upload.assert_called_once()

    def test_forced_requests_failure_does_not_start_browser(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = JAFCtheque('allTheques', 'allTheques', 1, scrape_mode='requests')
        scraper.startScrapeSnapshot = Mock()
        scraper.failScrapeSnapshot = Mock()
        scraper.logic = Mock(side_effect=ValueError('bad response'))
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.formatAndWriteCsv'), self.assertRaises(ValueError):
            scraper.scrape()
        chrome.assert_not_called()

    def test_upload_failure_does_not_trigger_fallback(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = JAFCtheque('allTheques', 'allTheques', 1)
        scraper.startScrapeSnapshot = Mock()
        scraper.failScrapeSnapshot = Mock()
        scraper.logic = Mock(side_effect=lambda: scraper.confirmEmptySnapshot('source confirms empty'))
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.formatAndUpload', side_effect=RuntimeError('upload failed')), patch('backend.scraping.BaseCinema.formatAndWriteCsv'), self.assertRaises(RuntimeError):
            scraper.scrape()
        chrome.assert_not_called()
        scraper.failScrapeSnapshot.assert_called_once()

    def test_failure_of_both_collectors_does_not_upload(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = JAFCtheque('allTheques', 'allTheques', 1)
        scraper.startScrapeSnapshot = Mock()
        scraper.failScrapeSnapshot = Mock()
        scraper.logic = Mock(side_effect=ValueError('bad response'))
        scraper.selenium_logic = Mock(side_effect=RuntimeError('browser failed'))
        with patch('backend.scraping.BaseCinema.build_chrome'), patch('backend.scraping.BaseCinema.navigate'), patch('backend.scraping.BaseCinema.formatAndUpload') as upload, patch('backend.scraping.BaseCinema.formatAndWriteCsv'), self.assertRaises(RuntimeError):
            scraper.scrape()
        self.assertEqual(scraper.failScrapeSnapshot.call_count, 2)
        upload.assert_not_called()
