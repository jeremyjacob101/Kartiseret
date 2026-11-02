from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.nowplayings.RavHen import RavHen
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class RavHenRequestsTests(TestCase):
    def setUp(self):
        self.scraper = RavHen.__new__(RavHen)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.today_date = datetime(2026, 12, 31, 12)
        self.scraper.current_year = '2026'
        self.scraper.current_month = '12'
        self.scraper.run_id = 1
        self.event = {
            'id': '123', 'filmId': 'film', 'cinemaId': '1058',
            'businessDay': '2027-01-01', 'eventDateTime': '2027-01-01T18:30:00',
            'bookingLink': 'https://tickets.example/api/order/123?lang=en',
            'attributeIds': ['2d', 'subbed'], 'languages': {'dubbed': []},
        }

    def response(self, url, **kwargs):
        response = Mock()
        if url.startswith('https://www.rav-hen.co.il/#/'):
            response.text = 'apiSitesList = [{"externalCode":"1058","name":"רב חן גבעתיים"}], '
            return response
        if '/feed/' in url:
            response.json.return_value = {'body': {'posters': [{'code': 'film'}]}}
        elif '/dates/in-cinema/' in url:
            response.json.return_value = {'body': {'dates': ['2027-01-01']}}
        elif '/film-events/' in url:
            response.json.return_value = {'body': {'events': [self.event, self.event.copy()]}}
        elif '/films/byDistributorCode/' in url:
            response.json.return_value = {'body': {'filmDetails': {
                'name': 'סרט', 'releaseYear': '2026', 'length': 90,
                'languages': {'original': ['en']}, 'ageRestrictionName': '12-plus',
            }}}
        else:
            raise AssertionError(url)
        return response

    def run_collector(self):
        session = Mock()
        session.get.side_effect = self.response
        with patch('backend.scraping.utils.RavHenRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()
        return session

    def test_discovers_cinema_and_catalog_preserving_duplicate_events(self):
        self.run_collector()
        data = self.scraper.gathering_info
        self.assertEqual(data['hebrew_title'], ['סרט', 'סרט'])
        self.assertEqual(data['date_of_showing'], ['2027-01-01', '2027-01-01'])
        self.assertEqual(data['screening_city'], ['Givatayim', 'Givatayim'])
        self.assertEqual(data['original_language'], ['English', 'English'])
        self.assertEqual(data['rating'], ['12+', '12+'])
        self.assertEqual(data['english_href'], ['https://tickets.example/order/123?lang=en'] * 2)

    def test_unknown_screening_format_fails_instead_of_dropping_information(self):
        self.event['attributeIds'].append('vip')
        with self.assertRaisesRegex(ValueError, 'premium format'):
            self.run_collector()

    def test_unlisted_film_fails_instead_of_publishing_partial_data(self):
        self.event['filmId'] = 'not-in-catalog'
        with self.assertRaisesRegex(ValueError, 'absent from the catalog'):
            self.run_collector()
