from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.nowplayings.YesPlanet import YesPlanet
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


class YesPlanetRequestsTests(TestCase):
    def setUp(self):
        self.scraper = YesPlanet.__new__(YesPlanet)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.today_date = datetime(2026, 11, 2, 12)
        self.scraper.run_id = 1
        self.original_languages = ['en']
        self.event = {'id': '1', 'filmId': 'film', 'cinemaId': '1025', 'businessDay': '2026-11-02',
                      'eventDateTime': '2026-11-02T18:30:00', 'bookingLink': 'https://tickets.example/api/order/1?lang=en',
                      'attributeIds': ['2d'], 'languages': {'dubbed': [], 'subtitles': []}}

    def response(self, url, **kwargs):
        response = Mock()
        if url == 'https://www.planetcinema.co.il/':
            response.text = 'apiSitesList = [{"externalCode":"1025","name":"Planet Ayalon"}], '
        elif '/feed/' in url:
            posters = [{'code': 'film', 'featureTitle': 'Film'}, {'code': 'variant', 'featureTitle': 'Film'}] if 'now-playing' in url else [{'code': 'soon', 'featureTitle': 'Soon'}]
            response.json.return_value = {'body': {'posters': posters}}
        elif '/films/byDistributorCode/' in url:
            fid = url.rsplit('/', 1)[-1]
            he = kwargs.get('params', {}).get('lang') == 'he_IL'
            data = {'id': fid, 'name': ('Russian variant' if fid == 'variant' else 'סרט') if he else ('Soon' if fid == 'soon' else 'Film'),
                    'releaseYear': '2026', 'directors': 'Director', 'languages': {'original': [] if fid == 'variant' else self.original_languages},
                    'ageRestrictionName': '12-plus', 'length': 95}
            response.json.return_value = {'body': {'filmDetails': data}}
        elif '/dates/in-cinema/' in url:
            response.json.return_value = {'body': {'dates': ['2026-11-02']}}
        elif '/film-events/' in url:
            russian = dict(self.event, id='2', languages={'dubbed': ['ru']})
            event_title = 'Soon' if self.event['filmId'] == 'soon' else 'Film'
            response.json.return_value = {'body': {'films': [{'id': self.event['filmId'], 'name': event_title}], 'events': [self.event, russian]}}
        else:
            raise AssertionError(url)
        return response

    def run_collector(self):
        session = Mock()
        session.get.side_effect = self.response
        with patch('backend.scraping.utils.YesPlanetRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()

    def test_last_duplicate_title_supplies_metadata_and_russian_dub_is_excluded(self):
        self.run_collector()
        data = self.scraper.gathering_info
        self.assertEqual(data['hebrew_title'], ['Russian variant'])
        self.assertEqual(data['original_language'], ['Hebrew'])
        self.assertEqual(data['screening_city'], ['Ayalon'])
        self.assertEqual(data['english_href'], ['https://tickets.example/order/1?lang=en'])
        self.assertEqual(self.scraper._coverage['russian_screenings_skipped'], 1)

    def test_preserves_every_language_when_hebrew_is_one_of_multiple_original_languages(self):
        self.original_languages = ['am', 'he']
        self.event['filmId'] = 'soon'
        self.run_collector()
        self.assertEqual(self.scraper.gathering_info['original_language'], ['Amharic, Hebrew'])

    def test_unrecognized_screening_format_fails_closed(self):
        self.event['attributeIds'] = ['unknown-format']
        with self.assertRaisesRegex(ValueError, 'format is missing'):
            self.run_collector()

    def test_infinity_vision_combinations_preserve_browser_display_labels(self):
        cases = (
            (['2d', 'infinity-vision'], '2D Infinity Vision'),
            (['2d', 'infinity-vision', 'screenx'], '2D ScreenX Infinity Vision'),
            (['2d', 'infinity-vision', '4dx'], '2D 4DX Infinity Vision'),
        )
        for attributes, label in cases:
            with self.subTest(attributes=attributes):
                self.event['attributeIds'] = attributes
                self.run_collector()
                self.assertEqual(self.scraper.gathering_info['screening_type'], ['Regular'])
                self.assertEqual(self.scraper.gathering_info['screening_tech'], [label])
                InitializeBaseCinema.__init__(self.scraper)

    def test_unknown_infinity_vision_combo_fails_closed(self):
        self.event['attributeIds'] = ['2d', 'infinity-vision', 'vip']
        with self.assertRaisesRegex(ValueError, 'unhandled Infinity Vision'):
            self.run_collector()
