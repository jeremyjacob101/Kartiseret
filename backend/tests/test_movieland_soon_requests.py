from unittest import TestCase
from unittest.mock import Mock, patch

import requests

from backend.scraping.comingsoons.MLsoon import MLsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def detail(title='סרט 3D', english='Film HFR', date='05/11/2026', runtime='118 דקות', year='2026', language='דובר: אנגלית', synopsis_class='bg-synops'):
    fields = [title, english, 'תאריך', date, 'בימוי', '', 'שחקנים', '', 'דירוג', 'אחר', 'זאנר', '', runtime, '', year, language]
    return '<div id="change-bg"><div class="' + synopsis_class + '"></div><div class="bg-more-b">' + ''.join('<span>' + value + '</span>' for value in fields) + '</div></div>'


class MovieLandSoonRequestsTests(TestCase):
    def setUp(self):
        self.scraper = MLsoon.__new__(MLsoon)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.run_id = 1

    def run_pages(self, *pages):
        session = Mock()
        responses = [Mock(text=html) for html in pages]
        session.get.side_effect = responses
        with patch('backend.scraping.comingsoons.MLsoon.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.logic()
        return session, responses

    def test_extracts_details_and_resets_optional_fields(self):
        listing = '<div id="soonContainer"><a poster-summary href="/movie/1"></a><a poster-summary href="/movie/2"></a></div>'
        session, responses = self.run_pages(listing, detail(), detail(title='סרט שני', english='', runtime='', year='', language='יעודכן בקרוב'))
        info = self.scraper.gathering_info
        self.assertEqual(info['hebrew_title'], ['סרט', 'סרט שני'])
        self.assertEqual(info['english_title'], ['Film', 'סרט שני'])
        self.assertEqual(info['release_date'], ['2026-11-05', '2026-11-05'])
        self.assertEqual(info['runtime'], ['118', None])
        self.assertEqual(info['release_year'], ['2026', None])
        self.assertEqual(info['original_language'], ['English', None])
        self.assertEqual(session.get.call_args_list[1].args[0], 'https://www.movieland.co.il/movie/1')
        self.assertEqual(session.get.call_args_list[1].kwargs['timeout'], (10, 30))
        for response in responses:
            response.raise_for_status.assert_called_once()

    def test_skips_dubbed_and_english_pages(self):
        listing = '<div id="soonContainer"><a poster-summary href="/1"></a><a poster-summary href="/2"></a></div>'
        self.run_pages(listing, detail(title='סרט (מדובב)'), detail(synopsis_class='bg-synops IsLtr'))
        self.assertEqual(self.scraper.gathering_info['hebrew_title'], [])

    def test_missing_listing_or_details_raise(self):
        for pages in [('<html>denied</html>',), ('<div id="soonContainer"><a poster-summary></a></div>',), ('<div id="soonContainer"><a poster-summary href="/1"></a></div>', '<html>incomplete</html>')]:
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                self.run_pages(*pages)

    def test_http_error_propagates(self):
        session = Mock()
        session.get.return_value.raise_for_status.side_effect = requests.HTTPError('403')
        with patch('backend.scraping.comingsoons.MLsoon.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(requests.HTTPError):
                self.scraper.logic()

    def test_invalid_later_detail_does_not_upload_partial_snapshot(self):
        listing = '<div id="soonContainer"><a poster-summary href="/1"></a><a poster-summary href="/2"></a></div>'
        session = Mock()
        session.get.side_effect = [Mock(text=x) for x in (listing, detail(), detail(date='invalid'))]
        self.scraper.driver = None
        self.scraper.startScrapeSnapshot = Mock()
        self.scraper.failScrapeSnapshot = Mock()
        with patch('backend.scraping.comingsoons.MLsoon.requests.Session') as factory, patch('backend.scraping.BaseCinema.formatAndUpload') as upload, patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(ValueError):
                self.scraper.scrape()
        upload.assert_not_called()
        self.scraper.failScrapeSnapshot.assert_called_once()

    def test_browser_is_not_created(self):
        with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = MLsoon('allSoons', 'allSoons', 1)
        self.assertIsNone(scraper.driver)
        chrome.assert_not_called()

    def test_invalid_release_date_falls_back_before_upload(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            scraper = MLsoon('allSoons', 'allSoons', 1)
        scraper.startScrapeSnapshot = Mock()
        scraper.finishScrapeSnapshot = Mock()
        scraper.failScrapeSnapshot = Mock()

        def invalid_http():
            scraper.english_title = 'Bad date'
            scraper.release_date = 'not-a-date'
            scraper.appendToGatheringInfo()

        def browser_result():
            self.assertEqual(scraper.gathering_info['english_title'], [])
            scraper.english_title = 'Valid date'
            scraper.release_date = '2026-11-05'
            scraper.appendToGatheringInfo()

        scraper.logic = Mock(side_effect=invalid_http)
        scraper.selenium_logic = Mock(side_effect=browser_result)
        with patch('backend.scraping.BaseCinema.build_chrome'), patch('backend.scraping.BaseCinema.navigate'), patch('backend.scraping.BaseCinema.formatAndUpload') as upload, patch('backend.scraping.BaseCinema.logSuccessfulRun'), patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
            scraper.scrape()
        scraper.failScrapeSnapshot.assert_called_once()
        upload.assert_called_once()
        self.assertEqual(scraper.gathering_info['english_title'], ['Valid date'])
