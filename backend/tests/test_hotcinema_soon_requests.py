from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.comingsoons.HCsoon import HCsoon
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema
from backend.tests.test_hotcinema_requests import FILM


HOME = '''<div class="soonInTheaters-page"><div class="container"><div class="row"><div class="movie-box-wrapper">
<div><h4>Film</h4><div><a href="/movie/1">Film</a></div></div>
<div><h4>Last</h4><div><a href="/movie/2">Last</a></div></div>
</div></div></div></div>'''


class HotCinemaSoonRequestsTests(TestCase):
    def scraper(self):
        obj = HCsoon.__new__(HCsoon)
        InitializeBaseCinema.__init__(obj)
        obj.run_id = 1
        return obj

    def test_extracts_film_and_validates_release_date(self):
        session = Mock()
        detail = FILM.replace('>Release<', '>בכורה: 05.11.2026<')
        session.get.side_effect = [Mock(text=HOME), Mock(text=detail)]
        scraper = self.scraper()
        with patch('backend.scraping.utils.HotCinemaSoonRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper.gathering_info['release_date'], ['2026-11-05'])
        self.assertEqual(scraper.gathering_info['rating'], ['All'])
        self.assertEqual(session.get.call_count, 2)

    def test_incomplete_group_fails_closed(self):
        session = Mock()
        session.get.return_value = Mock(text=HOME.replace('href="/movie/1"', ''))
        with patch('backend.scraping.utils.HotCinemaSoonRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(ValueError):
                self.scraper().requests_logic()
