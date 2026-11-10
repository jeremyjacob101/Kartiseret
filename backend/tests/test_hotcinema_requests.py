from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.nowplayings.HotCinema import HotCinema
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


HOME = '''<div class="nowInTheaters-page"><div class="container"><div class="row"><div class="movie-box-wrapper"><div><div><a href="/movie/1">Film</a></div></div></div></div></div></div><a href="/theater/16">HOT CINEMA כפר סבא</a>'''
FILM = '''<div class="movie-page"><div class="d-none d-md-block"><div class="movie-details"><div class="left-side">
<h1>סרט</h1><h2>Film</h2><div class="desc2">Director 2026</div><div class="desc3">
<div class="row"><span class="desc-text">Genre</span><span class="desc-text">95 דקות</span></div>
<div class="row"><span class="desc-text">Release</span><span class="desc-text">הגבלת גיל: הותר לכל הגילאים</span></div>
</div></div></div></div></div>'''


class HotCinemaRequestsTests(TestCase):
    def test_verified_requests_collector_is_preferred_with_browser_fallback(self):
        self.assertEqual(HotCinema.DEFAULT_SCRAPE_MODE, 'auto')

    def setUp(self):
        self.scraper = HotCinema.__new__(HotCinema)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.today_date = datetime(2026, 12, 31, 12)
        self.scraper.run_id = 1
        self.event = {
            'EventId': '7',
            'Hour': '18:30',
            'Date': '2027-01-01T18:30:00',
            'IsVIP': True,
            'IsAtmos': True,
        }
        self.events_by_date = {
            '01/01/2027': [
                {
                    'MovieName': 'סרט ',
                    'Dates': [self.event, self.event.copy()],
                }
            ]
        }

    def response(self, url, **kwargs):
        response = Mock()
        if url.endswith('/ShowingNow'):
            response.text = HOME
        elif '/movie/' in url:
            response.text = FILM
        elif '/theater/' in url:
            response.text = '<h1>HOT CINEMA כפר סבא</h1>'
        elif url.endswith('/MovieEventsDaysFilter'):
            response.json.return_value = ['01/01/2027']
        elif url.endswith('/tickets/TheaterEvents2'):
            date = kwargs['params']['date']
            response.json.return_value = {
                'TheaterEvents': self.events_by_date.get(date, [])
            }
        else:
            raise AssertionError(url)
        return response

    def run_collector(self):
        session = Mock()
        session.get.side_effect = self.response
        with patch('backend.scraping.utils.HotCinemaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()

    def test_full_date_discovery_preserves_duplicates_and_format(self):
        self.run_collector()
        data = self.scraper.gathering_info
        self.assertEqual(data['date_of_showing'], ['2027-01-01'] * 2)
        self.assertEqual(data['screening_city'], ['Kfar Saba'] * 2)
        self.assertEqual(data['screening_type'], ['Premium'] * 2)
        self.assertEqual(data['screening_tech'], ['2D Atmos'] * 2)
        self.assertEqual(data['rating'], ['All'] * 2)
        self.assertIn('1197-7', data['english_href'][0])
        self.assertEqual(self.scraper._coverage['calendar_dates_expected'], 32)
        self.assertEqual(self.scraper._coverage['dates_completed'], 32)
        self.assertEqual(self.scraper._coverage['explicit_empty_dates'], 31)

    def test_finds_scheduled_day_omitted_by_the_date_filter(self):
        self.events_by_date['02/01/2027'] = [
            {
                'MovieName': 'סרט ',
                'Dates': [
                    {
                        'EventId': '8',
                        'Hour': '19:00',
                        'Date': '2027-01-02T19:00:00',
                    }
                ],
            }
        ]

        self.run_collector()

        self.assertEqual(
            self.scraper.gathering_info['date_of_showing'],
            ['2027-01-01', '2027-01-01', '2027-01-02'],
        )
        self.assertEqual(self.scraper._coverage['date_filter_dates_discovered'], 1)
        self.assertEqual(
            self.scraper._coverage['dates_with_events_missing_from_filter'], 1
        )

    def test_preserves_selected_business_date_for_after_midnight_event(self):
        self.event['Date'] = '2027-01-02T00:15:00'

        self.run_collector()

        self.assertEqual(
            self.scraper.gathering_info['date_of_showing'],
            ['2027-01-01', '2027-01-01'],
        )

    def test_missing_event_id_fails_closed(self):
        self.event['EventId'] = None
        with self.assertRaisesRegex(ValueError, 'event ID'):
            self.run_collector()

    def test_empty_date_response_is_recorded_as_explicit_empty(self):
        original = self.response

        def respond(url, **kwargs):
            response = original(url, **kwargs)
            if url.endswith('/tickets/TheaterEvents2'):
                response.json.return_value = {'TheaterEvents': []}
            return response

        self.response = respond
        self.run_collector()
        self.assertEqual(self.scraper._coverage['dates_completed'], 32)
        self.assertEqual(self.scraper._coverage['explicit_empty_dates'], 32)
