import unittest
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from backend.scraping.utils.HolonRequests import parse_event_page, parse_schedule_week


JERUSALEM = ZoneInfo('Asia/Jerusalem')


def _day(timestamp_date):
    stamp = int(datetime.combine(timestamp_date, time.min, JERUSALEM).timestamp())
    return f'<div class="entry-result" data-daytime="{stamp}">'


def _week(start, *, activity_days=None, explicit_empty_days=None):
    activity_days = activity_days or {}
    explicit_empty_days = set(explicit_empty_days or ())
    blocks = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        activities = activity_days.get(day, [])
        if activities:
            content = ''.join(
                f'<div class="entry-activity"><div class="entry-content"><a href="{href}">{title}</a></div>'
                f'<span>{day:%d.%m} / יום, {showtime}</span></div>'
                for href, title, showtime in activities
            )
            body = f'<div class="entry-body">{content}</div>'
        elif day in explicit_empty_days:
            body = '<p>אין אירועים להצגה במועד זה.</p>'
        else:
            body = '<div class="entry-body"></div>'
        blocks.append(_day(day) + body + '</div>')
    return '<section class="events-results">' + ''.join(blocks) + '</section>'


def _event_page(*, form=None, title='שם הסרט'):
    form_html = form or ''
    return f'''
        <html><head><title>{title}</title></head><body>
          <div class="header-image"><h1 class="entry-title">{title}</h1></div>
          <section class="event-details">
            <ul class="entry-details"><li><span class="text">103 דקות</span></li>
              <li><span class="text">2025</span></li></ul>
            {form_html}
          </section>
        </body></html>
    '''


class HolonRequestsTests(unittest.TestCase):
    def test_week_requires_seven_consecutive_days_and_preserves_duplicate_events(self):
        start = date(2026, 11, 30)
        href = 'https://www.cinemaholon.org.il/events/sample/'
        source = _week(start, activity_days={
            start: [(href, 'Sample', '19:30')],
            start + timedelta(days=1): [(href, 'Sample', '19:30')],
        }, explicit_empty_days={start + timedelta(days=offset) for offset in range(2, 7)})

        events, activity_count = parse_schedule_week(source, start)

        self.assertEqual(activity_count, 2)
        self.assertEqual(events[href], [
            datetime(2026, 11, 30, 19, 30),
            datetime(2026, 12, 1, 19, 30),
        ])

    def test_week_rejects_missing_empty_evidence_and_day_gaps(self):
        start = date(2026, 11, 2)
        with self.assertRaisesRegex(ValueError, 'explicit empty evidence'):
            parse_schedule_week(_week(start), start)
        with self.assertRaisesRegex(ValueError, 'calendar day mismatch'):
            parse_schedule_week(_week(start + timedelta(days=1)), start)

    def test_event_page_preserves_multiple_showings_and_ticket_url(self):
        event_url = 'https://www.cinemaholon.org.il/events/sample/'
        form = '''<div class="hide-mobile"><form class="single-buy-now-form"
            data-dates='{"20261103":"2026-11-03GMT18:00","20261119":"2026-11-19GMT20:30"}'>
            <a class="single-buy-btn" href="https://tickets.example/event/45">לרכישה</a>
          </form></div>'''

        rows = parse_event_page(_event_page(form=form), event_url, [], datetime(2026, 11, 2, 12))

        self.assertEqual([(row['date_of_showing'], row['showtime']) for row in rows], [
            ('2026-11-03', '18:00'),
            ('2026-11-19', '20:30'),
        ])
        self.assertTrue(all(row['ticket'] == 'https://tickets.example/event/45' for row in rows))
        self.assertTrue(all(row['runtime'] == 103 and row['release_year'] == '2025' for row in rows))

    def test_disabled_ticket_matches_browser_href_behavior(self):
        event_url = 'https://www.cinemaholon.org.il/events/sample/'
        form = '''<div class="hide-mobile"><form class="single-buy-now-form"
            data-dates='{"20261103":"2026-11-03GMT18:00"}'>
            <a class="single-buy-btn disabled" href="https://tickets.example/event/45">לרכישה</a>
          </form></div>'''

        row = parse_event_page(_event_page(form=form), event_url, [], datetime(2026, 11, 2, 12))[0]

        self.assertEqual(row['ticket'], event_url)

    def test_missing_form_only_skips_source_confirmed_expired_events(self):
        page = _event_page()
        expired = [datetime(2026, 11, 2, 18, 0)]
        future = [datetime(2026, 11, 3, 18, 0)]

        self.assertEqual(parse_event_page(page, 'https://www.cinemaholon.org.il/events/sample/', expired, datetime(2026, 11, 2, 20, 0)), [])
        with self.assertRaisesRegex(ValueError, 'future screening has no ticket'):
            parse_event_page(page, 'https://www.cinemaholon.org.il/events/sample/', future, datetime(2026, 11, 2, 20, 0))

    def test_malformed_source_dates_fail_closed(self):
        form = '''<div class="hide-mobile"><form class="single-buy-now-form" data-dates="{}">
            <a class="single-buy-btn" href="https://tickets.example/event/45">לרכישה</a>
          </form></div>'''
        with self.assertRaisesRegex(ValueError, 'no valid screening dates'):
            parse_event_page(_event_page(form=form), 'https://www.cinemaholon.org.il/events/sample/', [], datetime(2026, 11, 2, 12))


if __name__ == '__main__':
    unittest.main()
