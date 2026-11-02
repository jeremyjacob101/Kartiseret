from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.cinematheques.HERZtheque import HERZtheque
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


CARD = '''<div data-post-id="1"><a class="jet-listing-dynamic-link__link" href="/movie/1">Movie</a>
<div class="jet-listing-dynamic-field__content">01/11/2026 18:30</div></div>'''
DETAIL = '''<div data-elementor-type="single-post"><div><div><div><div></div><div><h3>Film</h3></div></div></div></div>
<h1 class="elementor-heading-title">סרט (שלישי זהב)</h1><p>2026 95 דק׳</p>
<a href="https://hcinema.smarticket.co.il/show/1">Ticket</a></div>'''


class HerzliyaRequestsTests(TestCase):
    def setUp(self):
        self.scraper = HERZtheque.__new__(HERZtheque)
        InitializeBaseCinema.__init__(self.scraper)
        self.scraper.run_id = 1

    def test_repeated_screenings_reuse_film_page_but_preserve_rows(self):
        session = Mock()
        session.get.side_effect = [Mock(text='<div id="movie-screenings">' + CARD + CARD + '</div>'), Mock(text=DETAIL)]
        with patch('backend.scraping.utils.HerzliyaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            self.scraper.requests_logic()
        self.assertEqual(session.get.call_count, 2)
        self.assertEqual(self.scraper.gathering_info['hebrew_title'], ['סרט', 'סרט'])
        self.assertEqual(self.scraper.gathering_info['english_title'], ['Film', 'Film'])
        self.assertEqual(self.scraper.gathering_info['runtime'], [95, 95])
        self.assertEqual(self.scraper.gathering_info['date_of_showing'], ['2026-11-01'] * 2)

    def test_missing_card_link_fails_closed(self):
        session = Mock()
        session.get.return_value = Mock(text='<div id="movie-screenings"><div data-post-id="1"></div></div>')
        with patch('backend.scraping.utils.HerzliyaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaises(ValueError):
                self.scraper.requests_logic()
