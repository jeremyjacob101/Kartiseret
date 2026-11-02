"""Requests and source parsing helpers for Holon's public screening calendar."""

from collections import defaultdict
from datetime import date, datetime, time, timedelta
import json
import re
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


JERUSALEM = ZoneInfo('Asia/Jerusalem')
AJAX_URL_RE = re.compile(r'var\s+siteObject\s*=\s*(\{.*?\})\s*;', re.S)
SCREENING_TIME = re.compile(r'(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)')


def _text(element):
    return element.get_text(' ', strip=True) if element else ''


def _html_page(session, url):
    response = session.get(url, timeout=(10, 30))
    response.raise_for_status()
    content_type = response.headers.get('Content-Type', '').lower()
    if 'html' not in content_type:
        raise ValueError(f'Holon page returned unexpected content type: {content_type!r}')
    page = BeautifulSoup(response.text, 'html.parser')
    page_text = _text(page.title).lower() + ' ' + _text(page.body).lower()
    if any(marker in page_text for marker in ('403 forbidden', 'access denied', 'checking your browser')):
        raise ValueError('Holon returned an access-denied or challenge page')
    return response, page


def _day_from_row(row):
    timestamp = row.get('data-daytime')
    if not timestamp:
        raise ValueError('Holon calendar day is missing its source timestamp')
    try:
        return datetime.fromtimestamp(int(timestamp), JERUSALEM).date()
    except (OverflowError, OSError, ValueError) as error:
        raise ValueError(f'Holon calendar has an invalid source timestamp: {timestamp!r}') from error


def parse_schedule_week(html, expected_start: date):
    """Return event URL occurrences after validating every date in one source week."""
    page = BeautifulSoup(html, 'html.parser')
    rows = page.select('.events-results .entry-result') or page.select('.entry-result')
    if len(rows) != 7:
        raise ValueError(f'Holon calendar week should contain seven days, got {len(rows)}')

    occurrences = defaultdict(list)
    activity_count = 0
    for offset, row in enumerate(rows):
        actual_day = _day_from_row(row)
        expected_day = expected_start + timedelta(days=offset)
        if actual_day != expected_day:
            raise ValueError(f'Holon calendar day mismatch: expected {expected_day}, got {actual_day}')

        activities = row.select('.entry-activity')
        if not activities:
            body = row.select_one('.entry-body')
            empty_text = _text(body) if body is not None else _text(row)
            if not any(marker in empty_text for marker in ('אין אירועים', 'אין הקרנות')):
                raise ValueError(f'Holon calendar has no activities or explicit empty evidence for {actual_day}')
            continue

        for activity in activities:
            content = activity.select_one('.entry-content')
            link = content.select_one('a[href]') if content else None
            href = urljoin('https://www.cinemaholon.org.il/', link.get('href', '')) if link else ''
            if not href or urlparse(href).netloc != 'www.cinemaholon.org.il' or '/events/' not in urlparse(href).path:
                raise ValueError(f'Holon activity is missing a valid event page link for {actual_day}')
            times = SCREENING_TIME.findall(_text(activity))
            if len(times) != 1:
                raise ValueError(f'Holon activity must expose one screening time for {actual_day}: {_text(activity)!r}')
            hour, minute = map(int, times[0])
            occurrences[href].append(datetime.combine(actual_day, time(hour, minute)))
            activity_count += 1

    return dict(occurrences), activity_count


def _english_title(section, hebrew_title):
    headings = section.select('h2.english-title')
    if len(headings) == 3:
        target = headings[2]
        title = target.select_one('b') or target.select_one('strong')
        if title is None:
            raise ValueError('Holon English title is missing in the third title heading')
        return _text(title)
    if len(headings) == 2:
        first_paragraph = section.select_one('p:first-of-type > strong')
        if first_paragraph is not None:
            return _text(first_paragraph)
        second_heading = headings[1]
        title = second_heading.select_one('b')
        return _text(title) if title else _text(second_heading)
    if len(headings) == 1:
        bold_titles = headings[0].select('b')
        if len(bold_titles) in (5, 6):
            if len(bold_titles) < 5:
                raise ValueError('Holon English title heading is incomplete')
            return _text(bold_titles[4])
        if len(bold_titles) >= 4:
            return _text(bold_titles[3])
        strong_titles = headings[0].select('strong')
        if len(strong_titles) >= 3:
            return _text(strong_titles[2])
        raise ValueError('Holon English title heading is incomplete')
    return hebrew_title


def parse_event_page(html, event_url, occurrences, now: datetime):
    """Parse one event page; an expired event with no ticket form is explicit empty data."""
    page = BeautifulSoup(html, 'html.parser')
    page_title = _text(page.title).lower()
    if any(marker in page_title for marker in ('403 forbidden', 'access denied')):
        raise ValueError(f'Holon event page was denied: {event_url}')
    title_element = page.select_one('.header-image h1.entry-title')
    section = page.select_one('section.event-details')
    if title_element is None or section is None:
        raise ValueError(f'Holon event page is missing required detail structure: {event_url}')

    hebrew_title = _text(title_element)
    english_title = _english_title(section, hebrew_title)
    details = section.select('ul.entry-details > li')
    runtime = None
    release_year = None
    if details:
        runtime_text = _text(details[0].select_one('span.text'))
        runtime_values = re.findall(r'\d+', runtime_text)
        if runtime_values:
            runtime = int(runtime_values[-1])
    if len(details) > 1:
        year_match = re.search(r'\b\d{4}\b', _text(details[1].select_one('span.text')))
        release_year = year_match.group(0) if year_match else None

    form = section.select_one('div.hide-mobile form.single-buy-now-form')
    if form is None:
        if not occurrences:
            raise ValueError(f'Holon event has no schedule evidence: {event_url}')
        if all(occurrence < now for occurrence in occurrences):
            return []
        raise ValueError(f'Holon future screening has no ticket/schedule data: {event_url}')

    date_payload = form.get('data-dates')
    try:
        showings = json.loads(date_payload) if date_payload else None
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError(f'Holon event has malformed screening dates: {event_url}') from error
    if not isinstance(showings, dict) or not showings:
        raise ValueError(f'Holon event has no valid screening dates: {event_url}')
    ticket_link = form.select_one('a.single-buy-btn[href]')
    if ticket_link is None:
        ticket = None
    elif 'disabled' in (ticket_link.get('class') or []):
        # The page's client script removes href from unavailable tickets.
        # Selenium's get_attribute('href') then resolves to the current event URL.
        ticket = event_url
    else:
        ticket = urljoin(event_url, ticket_link.get('href', ''))
    if not ticket:
        raise ValueError(f'Holon event has no ticket link: {event_url}')

    rows = []
    for showing in showings.values():
        if not isinstance(showing, str) or 'GMT' not in showing:
            raise ValueError(f'Holon event has an unrecognized screening date: {showing!r}')
        date_text, showtime = showing.split('GMT', 1)
        try:
            showing_date = date.fromisoformat(date_text)
        except ValueError as error:
            raise ValueError(f'Holon event has an invalid screening date: {showing!r}') from error
        if not SCREENING_TIME.fullmatch(showtime):
            raise ValueError(f'Holon event has an invalid screening time: {showing!r}')
        rows.append({
            'hebrew_title': hebrew_title,
            'english_title': english_title,
            'date_of_showing': showing_date.isoformat(),
            'showtime': showtime,
            'release_year': release_year,
            'runtime': runtime,
            'ticket': ticket,
        })
    return rows


def _calendar_ajax_url(html):
    match = AJAX_URL_RE.search(html)
    if not match:
        raise ValueError('Holon schedule page did not expose its calendar endpoint')
    try:
        site_object = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        raise ValueError('Holon schedule page exposed malformed calendar configuration') from error
    ajax_url = site_object.get('ajaxurl')
    parsed = urlparse(ajax_url or '')
    if parsed.scheme != 'https' or parsed.netloc != 'www.cinemaholon.org.il' or not parsed.path.endswith('/wp-admin/admin-ajax.php'):
        raise ValueError('Holon schedule page exposed an unexpected calendar endpoint')
    return ajax_url


def _append_holon_row(scraper, row):
    scraper.hebrew_title = row['hebrew_title']
    scraper.english_title = row['english_title']
    scraper.date_of_showing = row['date_of_showing']
    scraper.showtime = row['showtime']
    scraper.release_year = row['release_year']
    scraper.runtime = row['runtime']
    scraper.english_href = scraper.hebrew_href = row['ticket']
    scraper.screening_city = scraper.SCREENING_CITY
    scraper.screening_type = 'Regular'
    scraper.screening_tech = '2D'
    scraper.appendToGatheringInfo()


def _collect_event_details(scraper, session, event_urls, occurrences, now):
    scraper._coverage.update(event_pages_expected=len(event_urls), event_pages_completed=0, expired_events_skipped=0)
    for event_url in event_urls:
        _, page = _html_page(session, event_url)
        rows = parse_event_page(str(page), event_url, occurrences[event_url], now)
        scraper._coverage['event_pages_completed'] += 1
        if not rows:
            scraper._coverage['expired_events_skipped'] += 1
            continue
        for row in rows:
            _append_holon_row(scraper, row)
    if scraper._coverage['event_pages_completed'] != scraper._coverage['event_pages_expected']:
        raise ValueError('Holon event page coverage is incomplete')


def collect_holon(scraper):
    scraper._coverage = {
        'weeks_expected': 5,
        'weeks_completed': 0,
        'calendar_days_expected': 35,
        'calendar_days_completed': 0,
        'calendar_activities': 0,
    }
    now = scraper.today_date
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None), retry_methods=('GET', 'POST'))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})
        response, first_page = _html_page(session, scraper.URL)
        if 'לוח הקרנות ואירועים' not in _text(first_page.title):
            raise ValueError('Holon response is not the expected schedule page')
        day_nodes = first_page.select('.days-wrap li')
        if len(day_nodes) != 7:
            raise ValueError(f'Holon schedule header should provide seven day values, got {len(day_nodes)}')
        try:
            first_monday = date.fromisoformat(day_nodes[0].get('data-moment_date') or '')
        except ValueError as error:
            raise ValueError('Holon schedule has an invalid initial week date') from error
        if [node.get('data-moment_date') for node in day_nodes] != [
            (first_monday + timedelta(days=offset)).isoformat() for offset in range(7)
        ]:
            raise ValueError('Holon schedule header contains an incomplete initial week')
        ajax_url = _calendar_ajax_url(response.text)

        event_occurrences = defaultdict(list)
        for week_index in range(5):
            week_start = first_monday + timedelta(days=7 * week_index)
            week_end = week_start + timedelta(days=6)
            if week_index == 0:
                week_html = str(first_page)
            else:
                result = session.post(
                    ajax_url,
                    data={
                        'action': 'get_events',
                        'start_week': week_start.isoformat(),
                        'end_week': week_end.isoformat(),
                        'day': str(week_start.day),
                        'moment_date': week_start.isoformat(),
                    },
                    headers={'Referer': response.url, 'X-Requested-With': 'XMLHttpRequest'},
                    timeout=(10, 30),
                )
                result.raise_for_status()
                if 'json' not in result.headers.get('Content-Type', '').lower():
                    raise ValueError(f'Holon calendar endpoint returned unexpected content type: {result.headers.get("Content-Type")!r}')
                try:
                    payload = result.json()
                except ValueError as error:
                    raise ValueError(f'Holon calendar endpoint returned malformed JSON for {week_start}') from error
                if not isinstance(payload, dict) or payload.get('ok') is not True or not isinstance(payload.get('html'), str) or not payload['html']:
                    raise ValueError(f'Holon calendar endpoint did not confirm week {week_start}')
                week_html = payload['html']

            week_occurrences, activity_count = parse_schedule_week(week_html, week_start)
            for href, showing_slots in week_occurrences.items():
                event_occurrences[href].extend(showing_slots)
            scraper._coverage['weeks_completed'] += 1
            scraper._coverage['calendar_days_completed'] += 7
            scraper._coverage['calendar_activities'] += activity_count

        if scraper._coverage['weeks_completed'] != scraper._coverage['weeks_expected'] or scraper._coverage['calendar_days_completed'] != scraper._coverage['calendar_days_expected']:
            raise ValueError('Holon schedule week coverage is incomplete')
        event_urls = list(event_occurrences)
        if not event_urls:
            raise ValueError('Holon schedule returned no event links')
        _collect_event_details(scraper, session, event_urls, event_occurrences, now)
