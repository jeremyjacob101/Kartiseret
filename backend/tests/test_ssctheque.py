import unittest
from datetime import date

from backend.scraping.cinematheques.SSCtheque import parse_card, parse_titles


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

    def test_incomplete_card_fails(self):
        with self.assertRaises(ValueError):
            parse_card(['סרט | Movie', 'חמישי'], [], [], date(2026, 11, 1))
