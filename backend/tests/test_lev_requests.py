from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.comingsoons.LCsoon import LCsoon
from backend.scraping.nowplayings.LevCinema import LevCinema
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def film(title):
    return f'''<div id="content"><div class="movie_title"><h1>{title}</h1></div>
      <div class="allwithline"><div>2026</div><div>English</div><div>95</div></div>
      <div class="movie_age">Rating: 12+</div>
      <div class="movie_shows"><div class="forloc"><h3>Lev Daniel</h3>
        <div class="showlist"><span>01/01</span><div class="showitem"><a href="/ticket/1">18:30</a></div></div>
      </div></div></div>'''


class LevRequestsTests(TestCase):
    def collector(self, cls):
        scraper = cls.__new__(cls)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 1
        scraper.current_year = '2026'
        scraper.current_month = '12'
        return scraper

    def run_pages(self, scraper, pages):
        session = Mock()
        session.get.side_effect = [Mock(text=page) for page in pages]
        with patch('backend.scraping.utils.LevRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        return session

    def test_showtimes_preserve_duplicates_and_roll_over_year(self):
        listing = '<div id="tab-1"><div class="feat"><a href="/en/film/1"></a></div></div><div id="tab-2"><div class="feat"><a href="/en/film/1"></a></div></div>'
        scraper = self.collector(LevCinema)
        self.run_pages(scraper, [listing, film('סרט'), film('Film'), film('סרט'), film('Film')])
        info = scraper.gathering_info
        self.assertEqual(info['english_title'], ['Film', 'Film'])
        self.assertEqual(info['date_of_showing'], ['2027-01-01', '2027-01-01'])
        self.assertEqual(info['screening_city'], ['Herziliya', 'Herziliya'])
        self.assertEqual(info['english_href'], ['https://www.lev.co.il/ticket/1?lang=en'] * 2)
        self.assertEqual(info['runtime'], ['95', '95'])

    def test_coming_soon_requires_valid_release_date(self):
        listing = '<div id="tab-2"><li class="featureItems"><div><a href="/en/film/1"><div class="datestarted">Release: 05/11/2026</div></a></div></li></div>'
        scraper = self.collector(LCsoon)
        self.run_pages(scraper, [listing, film('סרט'), film('Film')])
        self.assertEqual(scraper.gathering_info['release_date'], ['2026-11-05'])
        bad = listing.replace('05/11/2026', 'unknown')
        with self.assertRaises(ValueError):
            self.run_pages(self.collector(LCsoon), [bad, film('סרט'), film('Film')])

    def test_current_film_with_verified_empty_booking_form_has_no_screenings(self):
        listing = '<div id="tab-1"><div class="feat"><a href="/en/film/1"></a></div></div><div id="tab-2"><div class="feat"><a href="/en/film/1"></a></div></div>'
        # Wildwood's live English page on 2026-11-09 has this booking form
        # and no movie_shows container; independently confirmed in Chrome.
        empty = film('Wildwood').split('<div class="movie_shows">')[0] + '<div class="bookform"><div class="bookform_innner"><div>Purchase tickets for Wildwood&nbsp;:</div></div></div></div>'
        scraper = self.collector(LevCinema)
        self.run_pages(scraper, [listing, film('סרט'), empty, film('סרט'), film('Film')])
        self.assertEqual(scraper._coverage['explicit_empty_film_schedules'], 1)
        self.assertEqual(len(scraper.gathering_info['showtime']), 1)
        for invalid in (empty.replace('Purchase tickets for Wildwood', 'Unavailable'), empty.replace('</div></div></div></div>', '<a href="/ticket/1">18:30</a></div></div></div></div>')):
            with self.subTest(page=invalid), self.assertRaises(ValueError):
                self.run_pages(self.collector(LevCinema), [listing, film('סרט'), invalid])

    def test_missing_listing_and_film_structure_fail(self):
        with self.assertRaises(ValueError):
            self.run_pages(self.collector(LevCinema), ['<html>access denied</html>'])
        listing = '<div id="tab-2"><li class="featureItems"><div><a href="/en/film/1"></a></div></li></div>'
        with self.assertRaises(ValueError):
            self.run_pages(self.collector(LCsoon), [listing, '<html>denied</html>', film('Film')])

    def test_verified_lev_scrapers_default_to_requests_without_chrome(self):
        for cls, table in ((LevCinema, 'allShowtimes'), (LCsoon, 'allSoons')):
            with self.subTest(scraper=cls.__name__), patch('backend.scraping.BaseCinema.setUpSupabase'):
                scraper = cls(table, table, 1)
                self.assertEqual(scraper.scrape_mode, 'auto')
                scraper.startScrapeSnapshot = Mock()
                scraper.finishScrapeSnapshot = Mock()

                def collect():
                    scraper._coverage = {'pages_expected': 1, 'pages_completed': 1}
                    scraper.english_title = 'Film'
                    scraper.release_date = '2026-11-05'
                    scraper.date_of_showing = '2026-11-07'
                    scraper.showtime = '18:30'
                    scraper.screening_city = 'Tel Aviv'
                    scraper.english_href = 'https://example.test/ticket/1'
                    scraper.appendToGatheringInfo()

                scraper.requests_logic = Mock(side_effect=collect)
                with patch('backend.scraping.BaseCinema.build_chrome') as chrome, patch('backend.scraping.BaseCinema.formatAndUpload'), patch('backend.scraping.BaseCinema.logSuccessfulRun'), patch('backend.scraping.BaseCinema.formatAndWriteCsv'):
                    scraper.scrape()
                chrome.assert_not_called()
