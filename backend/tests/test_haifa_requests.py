from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.cinematheques.HAIFtheque import HAIFtheque
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema


def card(identifier):
    return f'<div class="eventContX portfolio" data-id="{identifier}"><a class="ethos-more" href="/event/{identifier}">Film</a></div>'


HOME = '''<script>var _lang = "heb"; window.category = "trom";</script>
<div class="slide active" data-date="01.11.2026"></div><div id="portfoliolist">''' + card('1') + '</div>'
DETAIL = '''<div class="slide_info_event"><h1 class="slide_title">סרט</h1><div class="slide_content">Film</div></div>
<section class="event-info"><a class="ticketsPopup" href="/tickets/1">Ticket</a></section>
<div class="event-details-time">18:30</div><div class="event-details-date">ראשון, 01.11.26</div>
<div class="event-details-content"><strong>2026</strong></div>'''


class HaifaRequestsTests(TestCase):
    def test_browser_initial_date_works_when_today_has_no_active_slide(self):
        home = HOME.replace('slide active', 'slide') + "<script>Events.init({startDate: '07.11.2026'});</script>"
        session = Mock()
        session.get.side_effect = [Mock(text=x) for x in (home, '', DETAIL)]
        with patch('backend.scraping.utils.HaifaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper = self.make_scraper()
            scraper.requests_logic()
        self.assertEqual(session.get.call_args_list[1].kwargs['params']['date'], '07.11.2026')
        self.assertEqual(len(scraper.gathering_info['english_title']), 1)

    def test_missing_calendar_date_is_not_replaced_with_a_guessed_date(self):
        session = Mock()
        session.get.return_value = Mock(text=HOME.replace('slide active', 'slide'))
        with patch('backend.scraping.utils.HaifaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'configuration'):
                self.make_scraper().requests_logic()

    def make_scraper(self):
        scraper = HAIFtheque.__new__(HAIFtheque)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 1
        return scraper

    def test_paginates_to_explicit_end_then_fetches_each_detail(self):
        session = Mock()
        session.get.side_effect = [Mock(text=x) for x in (HOME, card('2'), '', DETAIL, DETAIL)]
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.HaifaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper.gathering_info['hebrew_title'], ['סרט', 'סרט'])
        self.assertEqual(scraper.gathering_info['date_of_showing'], ['2026-11-01'] * 2)
        self.assertEqual(session.get.call_args_list[1].kwargs['params']['start'], 0)
        self.assertEqual(session.get.call_args_list[2].kwargs['params']['start'], 2)
        self.assertEqual(scraper._coverage['pagination_requests'], 2)

    def test_unrecognized_nonempty_pagination_fails_closed(self):
        session = Mock()
        session.get.side_effect = [Mock(text=HOME), Mock(text='<html>challenge</html>')]
        with patch('backend.scraping.utils.HaifaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            with self.assertRaisesRegex(ValueError, 'unrecognized'):
                self.make_scraper().requests_logic()

    def test_missing_release_year_is_counted_as_processed_source_card_but_not_a_row(self):
        session = Mock()
        detail = DETAIL.replace('<div class="event-details-content"><strong>2026</strong></div>', '')
        session.get.side_effect = [Mock(text=HOME), Mock(text=''), Mock(text=detail)]
        scraper = self.make_scraper()
        with patch('backend.scraping.utils.HaifaRequests.requests.Session') as factory:
            factory.return_value.__enter__.return_value = session
            scraper.requests_logic()
        self.assertEqual(scraper._coverage['cards_expected'], 1)
        self.assertEqual(scraper._coverage['cards_completed'], 1)
        self.assertEqual(scraper._coverage['rows_emitted'], 0)
