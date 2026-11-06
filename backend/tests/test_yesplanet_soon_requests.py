from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.comingsoons.YPsoon import YPsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class YesPlanetSoonRequestsTests(TestCase):
    def setUp(self):
        self.scraper = YPsoon.__new__(YPsoon)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.run_id = 1
        self.film = {'id': '123s2r', 'name': 'Film', 'releaseYear': '2026',
                     'directors': 'Director', 'languages': {'original': ['en']},
                     'ageRestrictionName': '12-plus', 'length': 95,
                     'dateStarted': '2026-12-31T00:00:00'}

    def response(self, url, **kwargs):
        response = Mock()
        if '/feed/' in url:
            response.json.return_value = {'body': {'posters': [{'code': '123s2r'}, {'code': 'ignoreds2r2'}]}}
        else:
            data = dict(self.film)
            if kwargs.get('params', {}).get('lang') == 'he_IL':
                data['name'] = 'סרט'
            response.json.return_value = {'body': {'filmDetails': data}}
        return response

    def run_collector(self):
        session = Mock()
        session.get.side_effect = self.response
        with patch('backend.scraping.utils.YesPlanetSoonRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()
        return session

    def test_bilingual_film_metadata_and_excluded_variant(self):
        session = self.run_collector()
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(self.scraper.gathering_info['hebrew_title'], ['סרט'])
        self.assertEqual(self.scraper.gathering_info['english_title'], ['Film'])
        self.assertEqual(self.scraper.gathering_info['release_date'], ['2026-12-31'])
        self.assertEqual(self.scraper.gathering_info['rating'], ['12+'])

    def test_unknown_language_fails_closed(self):
        self.film['languages'] = {'original': ['unknown']}
        with self.assertRaisesRegex(ValueError, 'Unknown Yes Planet language'):
            self.run_collector()

    def test_invalid_release_date_fails_closed(self):
        self.film['dateStarted'] = '2026-02-30T00:00:00'
        with self.assertRaises(ValueError):
            self.run_collector()
