import unittest
from datetime import date
from unittest.mock import Mock, patch

from bs4 import BeautifulSoup

from backend.config.registry import REGISTRY
from backend.scraping.cinematheques.HOLONtheque import HOLONtheque
from backend.scraping.cinematheques.SSCtheque import MissingScreeningSchedule, SSCtheque, parse_card, parse_titles
from backend.scraping.utils.ScrapeRequests import validate_scrape_coverage


class SamSpiegelTests(unittest.TestCase):
    def test_title_order_and_extra_segments(self):
        self.assertEqual(parse_titles('מבוא | כותרת | English Title'), ('מבוא', 'English Title'))
        self.assertEqual(parse_titles('English Title | כותרת'), ('כותרת', 'English Title'))
        self.assertEqual(parse_titles('כותרת בלבד'), ('כותרת בלבד', None))
        self.assertEqual(parse_titles('English only'), (None, 'English only'))

    def test_current_layout_and_ticket(self):
        row = parse_card(['בחירות או לא להיות | Election', 'חמישי', '29/10', '20:00'],
                         ['אלכסנדר פיין | ארה״ב | 1999 | 103 דקות'],
                         [('https://example.com/ticket', 'לכרטיסים')], date(2026, 10, 1))
        self.assertEqual((row['hebrew_title'], row['english_title']), ('בחירות או לא להיות', 'Election'))
        self.assertEqual((row['date_of_showing'], row['showtime']), ('2026-10-29', '20:00'))
        self.assertEqual((row['release_year'], row['runtime'], row['ticket']), ('1999', 103, 'https://example.com/ticket'))

    def test_year_boundary_and_missing_metadata(self):
        row = parse_card(['Title | סרט', '01/01', '9:05'], [], [], date(2026, 12, 1))
        self.assertEqual(row['date_of_showing'], '2027-01-01')
        self.assertEqual(row['showtime'], '09:05')
        self.assertIsNone(row['runtime'])
        self.assertIsNone(row['ticket'])

    def test_parser_reports_missing_schedule_fields(self):
        for headings, missing in [(['31/12'], 'showtime'), (['20:30'], 'date'), ([], 'date and showtime')]:
            with self.subTest(headings=headings), self.assertRaisesRegex(MissingScreeningSchedule, f'Movie.*missing {missing}$'):
                parse_card(['סרט | Movie', *headings], [], [], date(2026, 11, 1))

    @staticmethod
    def _scraper():
        scraper = SSCtheque.__new__(SSCtheque)
        scraper.current_year = 2026
        scraper.current_month = 11
        scraper._append_row = Mock()
        return scraper

    def test_requests_keeps_valid_cards_and_records_skips_in_run_diagnostics(self):
        scraper = self._scraper()
        with patch('backend.scraping.cinematheques.SSCtheque.requests.Session') as session:
            response = session.return_value.__enter__.return_value.get.return_value
            response.headers = {'Content-Type': 'text/html'}
            response.text = '''
                <title>לוח הקרנות</title>
                <div class="elementor-widget-loop-grid">
                  <div data-elementor-type="loop-item"><h2>The Wizard of Oz</h2><h4>31/12</h4></div>
                  <div data-elementor-type="loop-item"><h2>Movie</h2><h4>03/11</h4><h4>20:30</h4></div>
                </div>
            '''
            scraper.requests_logic()
        scraper._append_row.assert_called_once()
        self.assertEqual(scraper._append_row.call_args.args[0]['showtime'], '20:30')
        validate_scrape_coverage(scraper._coverage)
        self.assertEqual(scraper._coverage['skipped_cards'], ["'The Wizard of Oz' missing showtime"])

    def test_requests_fails_for_missing_or_empty_grid(self):
        scraper = self._scraper()
        with patch('backend.scraping.cinematheques.SSCtheque.requests.Session') as session:
            response = session.return_value.__enter__.return_value.get.return_value
            response.headers = {'Content-Type': 'text/html'}
            for grid, message in [('', 'expected schedule page'),
                                  ('<div class="elementor-widget-loop-grid"></div>', 'contains no cards')]:
                with self.subTest(grid=grid), self.assertRaisesRegex(ValueError, message):
                    response.text = f'<title>לוח הקרנות</title>{grid}'
                    scraper.requests_logic()
        scraper._append_row.assert_not_called()

    def test_selenium_keeps_valid_cards_and_fails_when_none_are_usable(self):
        scraper = self._scraper()
        scraper.waitForElement = Mock()
        scraper.driver = Mock()
        incomplete = Mock()
        incomplete.find_elements.side_effect = [[Mock(text='Missing date'), Mock(text='20:30')], [], []]
        complete = Mock()
        complete.find_elements.side_effect = [[Mock(text='Movie'), Mock(text='03/11'), Mock(text='20:30')], [], []]
        scraper.driver.find_elements.return_value = [incomplete, complete]
        scraper.logic()
        scraper._append_row.assert_called_once()
        self.assertEqual(scraper._coverage['skipped_cards'], ["'Missing date' missing date"])

        scraper._append_row.reset_mock()
        incomplete.find_elements.side_effect = [[Mock(text='Missing date')], [], []]
        scraper.driver.find_elements.return_value = [incomplete]
        with self.assertRaisesRegex(ValueError, 'no cards with both a date and showtime'):
            scraper.logic()
        scraper._append_row.assert_not_called()

    def test_requests_card_parser_matches_the_live_loop_card_structure(self):
        card = BeautifulSoup('''
            <div data-elementor-type="loop-item">
              <h2>בחירות או לא להיות | Election</h2>
              <h4>03/11</h4><h4>20:30</h4>
              <p>אלכסנדר פיין | ארה״ב | 1999 | 103 דקות</p>
              <a href="https://tickets.example/123">לכרטיסים</a>
            </div>
        ''', 'html.parser').select_one('[data-elementor-type="loop-item"]')
        row = SSCtheque._parse_html_card(card, date(2026, 11, 1))
        self.assertEqual(row, {
            'hebrew_title': 'בחירות או לא להיות',
            'english_title': 'Election',
            'date_of_showing': '2026-11-03',
            'showtime': '20:30',
            'release_year': '1999',
            'runtime': 103,
            'ticket': 'https://tickets.example/123',
        })

    def test_sam_is_enabled_and_holon_is_temporarily_disabled(self):
        self.assertIn(SSCtheque, REGISTRY['allTheques'])
        self.assertNotIn(HOLONtheque, REGISTRY['allTheques'])
        self.assertEqual(SSCtheque.DEFAULT_SCRAPE_MODE, 'auto')
