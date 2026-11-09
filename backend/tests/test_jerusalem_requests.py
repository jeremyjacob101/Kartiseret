from datetime import date, datetime
import json
from unittest import TestCase
from unittest.mock import MagicMock, Mock, patch
from zoneinfo import ZoneInfo

from backend.scraping.cinematheques.JLEMtheque import JLEMtheque
from backend.scraping.utils.InitializeBaseCinema import InitializeBaseCinema
from backend.scraping.utils.JerusalemRequests import collect_jerusalem


TZ = ZoneInfo("Asia/Jerusalem")


def token(day):
    return str(int(datetime(day.year, day.month, day.day, tzinfo=TZ).timestamp()))


def page(tokens):
    dates = "".join(f'<span class="filter-date">{value}</span>' for value in tokens)
    return f'<div id="calender-filter">{dates}</div><div class="calenders-filter-date"><p>Monday | 02.11.26</p></div>'


def event(title, event_id="42", showtime="18:30", link="https://jer-cin.org.il/order/42?lang=en", director="Director"):
    return f'''<div class="lobby-container"><div class="ticket-details"><div class="time">{showtime}</div>
    <span class="cal-hall">Dir.: {director}</span><span class="cal-length">90 minutes</span></div>
    <div class="lobby-title second"><a>{title}</a></div>
    <button class="toptix-purchase" data-event-id="{event_id}" data-url="{link}">Tickets</button></div>'''


def response(text=None, payload=None):
    value = Mock()
    value.text = text
    value.json.return_value = payload
    value.raise_for_status.return_value = None
    return value


class JerusalemRequestsTests(TestCase):
    def test_verified_requests_collector_is_preferred_with_browser_fallback(self):
        self.assertEqual(JLEMtheque.DEFAULT_SCRAPE_MODE, "auto")

    def make_scraper(self):
        scraper = JLEMtheque.__new__(JLEMtheque)
        InitializeBaseCinema.__init__(scraper)
        scraper.run_id = 1
        scraper.today_date = datetime(2026, 11, 2)
        scraper.DAYS = 2
        return scraper

    def configure_session(self, hebrew, english):
        days = [date(2026, 11, 2), date(2026, 11, 3)]
        sessions = MagicMock()
        sessions.__enter__.return_value = sessions
        sessions.get.side_effect = [response(text=page([token(day) for day in days])) for _ in range(2)]
        response_html = []
        for language_content in (hebrew, english):
            for day, content in zip(days, language_content):
                date_text = day.strftime("%d.%m.%y")
                response_html.append(
                    f'<div class="ajax-inner"><div class="calenders-filter-date"><p>Weekday | {date_text}</p></div>'
                    f'<div class="calendar-full-container">{content}</div></div>'
                )
        sessions.post.side_effect = [
            response(payload={"output": html}) for html in response_html
        ]
        return sessions

    @patch("backend.scraping.utils.JerusalemRequests.requests.Session")
    def test_bilingual_date_and_event_join_preserves_duplicate_screenings(self, session_factory):
        sessions = self.configure_session(
            [event("עברית", "42", link="/en/event/42", director="Director    Name") * 2, "<div>אין הקרנות</div>"],
            [event("English", "42", link="/en/event/42", director="Director    Name") * 2, "<div>No Screenings</div>"],
        )
        session_factory.return_value = sessions
        scraper = self.make_scraper()

        collect_jerusalem(scraper)

        self.assertEqual(scraper.gathering_info["english_title"], ["English", "English"])
        self.assertEqual(scraper.gathering_info["hebrew_title"], ["עברית", "עברית"])
        self.assertEqual(scraper.gathering_info["date_of_showing"], ["2026-11-02"] * 2)
        self.assertEqual(scraper.gathering_info["directed_by"], ["Director Name"] * 2)
        self.assertEqual(scraper.gathering_info["english_href"], ["https://jer-cin.org.il/en/event/42"] * 2)
        self.assertEqual(scraper.gathering_info["hebrew_href"], ["https://jer-cin.org.il/en/event/42"] * 2)
        self.assertEqual(scraper._coverage["date_responses_completed"], 4)
        self.assertEqual(scraper._coverage["explicit_empty_dates"], 1)
        self.assertEqual(sessions.post.call_count, 4)
        first_post = sessions.post.call_args_list[0]
        self.assertEqual(first_post.kwargs["data"]["filterdate"], token(date(2026, 11, 2)))

    @patch("backend.scraping.utils.JerusalemRequests.requests.Session")
    def test_missing_advertised_date_fails_before_collecting(self, session_factory):
        sessions = self.configure_session(
            [event("עברית")], [event("English")]
        )
        sessions.get.side_effect = [
            response(text=page([token(date(2026, 11, 3)), token(date(2026, 11, 4))])),
            response(text=page([token(date(2026, 11, 3)), token(date(2026, 11, 4))])),
        ]
        session_factory.return_value = sessions

        with self.assertRaisesRegex(ValueError, "missing dates"):
            collect_jerusalem(self.make_scraper())

        sessions.post.assert_not_called()

    @patch("backend.scraping.utils.JerusalemRequests.requests.Session")
    def test_valid_empty_calendar_responses_are_explicit_empty_evidence(self, session_factory):
        sessions = self.configure_session(["", ""], ["", ""])
        session_factory.return_value = sessions
        scraper = self.make_scraper()

        collect_jerusalem(scraper)

        self.assertEqual(scraper.gathering_info["english_title"], [])
        self.assertEqual(scraper._coverage["explicit_empty_dates"], 2)
        self.assertIn("all 2 calendar dates", scraper._empty_snapshot_evidence)
