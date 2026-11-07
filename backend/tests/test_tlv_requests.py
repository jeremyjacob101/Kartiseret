from datetime import datetime
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.cinematheques.TLVtheque import TLVtheque
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


EVENT = '''<div id="nav-date"><div class="fest-box-parent-wrapper"><div class="festival-grid-box">
 <div class="text-content"><div class="title"><h3><a>Film   Title</a></h3><p>2026 Length: 95</p></div>
 <div class="paragraph"><p>Film details</p></div><div class="content-detail"><div class="text-badge">
 <a href="https://tickets.example/order/1?lang=en"><span>18:30</span></a>
 </div></div></div></div></div></div>'''


class TelAvivRequestsTests(TestCase):
    def test_missing_english_translation_preserves_legacy_null_title(self):
        page = EVENT.replace('Film   Title', 'סרט בעברית').replace('Film details', 'תיאור בעברית')
        session = Mock()
        session.get.side_effect = [Mock(text=page)] + [Mock(text='<div id="nav-date"><p>אין אירועים בתאריך זה</p></div>') for _ in range(59)]
        scraper = self.make_scraper()
        scraper.supabase_table_name = 'allTheques'
        scraper._empty_snapshot_evidence = None
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper.gathering_info['english_title'], [None])
        self.assertEqual(scraper.gathering_info['hebrew_title'], [None])
        scraper._validate_requests_collection()

    def make_scraper(self):
        scraper = TLVtheque.__new__(TLVtheque)
        InitializeBaseCinema.__init__(scraper)
        scraper.today_date = datetime(2026, 12, 31, 12)
        scraper.run_id = 1
        return scraper

    def test_checks_all_60_dates_and_preserves_fields(self):
        session = Mock()
        session.get.side_effect = [Mock(text=EVENT)] + [Mock(text='<div id="nav-date"><p>אין אירועים בתאריך זה</p></div>') for _ in range(59)]
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(session.get.call_count, 60)
        self.assertIn('date=2027-01-01', session.get.call_args_list[1].args[0])
        self.assertEqual(scraper.gathering_info['english_title'], ['Film Title'])
        self.assertEqual(scraper.gathering_info['runtime'], ['95'])
        self.assertEqual(scraper.gathering_info['hebrew_href'], ['https://tickets.example/order/1?lang=he'])

    def test_missing_later_calendar_fails_after_valid_rows(self):
        session = Mock()
        session.get.side_effect = [Mock(text=EVENT), Mock(text='<html>access denied</html>')]
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'calendar is missing'):
                scraper.requests_logic()

    def test_unconfirmed_empty_day_fails(self):
        session = Mock()
        session.get.return_value = Mock(text='<div id="nav-date"></div>')
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'no confirmed empty state'):
                self.make_scraper().requests_logic()

    def test_all_dates_explicitly_empty_are_confirmed(self):
        session = Mock()
        session.get.return_value = Mock(text='<div id="nav-date"><p>אין אירועים בתאריך זה</p></div>')
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertIn('60', scraper._empty_snapshot_evidence)

    def test_hebrew_title_is_preserved_when_fallback_paragraph_is_empty(self):
        event = EVENT.replace('Film   Title', 'סרט בעברית').replace('Film details', '')
        session = Mock()
        session.get.side_effect = [Mock(text=event)] + [Mock(text='<div id="nav-date"><p>אין אירועים בתאריך זה</p></div>') for _ in range(59)]
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.TLVRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper.gathering_info['english_title'], ['סרט בעברית'])
