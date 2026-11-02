from datetime import date, datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.nowplayings.MovieLand import MovieLand
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema
from backend.scraping.utils.MovieLandRequests import _business_date


class MovieLandBusinessDateTests(TestCase):
    def test_after_midnight_retains_displayed_business_day(self):
        self.assertEqual(_business_date({'Date': '2027-01-01T00:30:00', 'Day': 'יום חמישי 31.12'}), date(2026, 12, 31))

    def test_regular_event_uses_displayed_day(self):
        self.assertEqual(_business_date({'Date': '2026-11-02T18:30:00', 'Day': 'יום שני 02.11'}), date(2026, 11, 2))

    def test_unrelated_or_invalid_business_day_fails(self):
        for event in ({'Date': '2026-11-02T18:30:00', 'Day': '12.11'}, {'Date': '2026-11-02T18:30:00', 'Day': 'unknown'}, {'Date': 'invalid', 'Day': '02.11'}):
            with self.subTest(event=event), self.assertRaises(ValueError):
                _business_date(event)

    def test_fetches_each_discovered_date_and_preserves_screenings(self):
        scraper = MovieLand.__new__(MovieLand)
        InitializeBaseCinema.__init__(scraper)
        scraper.today_date = datetime(2026, 12, 31, 12)
        scraper.run_id = 1
        fields = ['סרט', 'Film'] + [''] * 7 + ['12+'] + [''] * 4 + ['2026', 'דובר: אנגלית']
        home = '<div id="change-bg"><div class="movies-page"><a poster-summary href="/movie/1"></a></div></div><div class="newnav-upper-menu"><a class="dropdown-item" href="/theater/1296/test">בת ים</a></div>'
        film = '<div id="change-bg"><div class="bg-more-b">' + ''.join('<span>' + value + '</span>' for value in fields) + '</div></div>'
        theater = '<div id="change-bg"><div class="container-fluid inner-page-header"><h1>בת ים</h1></div></div><script>eventsList.dates = [{"date":"2027-01-01T00:00:00"}];</script>'
        event = {'Date': '2027-01-02T00:30:00', 'Day': 'יום שישי 01.01', 'EventId': '7', 'TheaterId': 1296, 'Hour': '00:30', 'IsVip': True}
        session = Mock()
        session.get.side_effect = [Mock(text=home), Mock(text=film), Mock(text=theater), Mock(**{'json.return_value': [{'Name': 'סרט', 'Dates': [event]}]})]
        with patch('backend.scraping.utils.MovieLandRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper.gathering_info['date_of_showing'], ['2027-01-01'])
        self.assertEqual(scraper.gathering_info['screening_type'], ['Upgrade'])
        self.assertEqual(session.get.call_args.kwargs['params']['Date'], '2027-01-01T00:00:00')
