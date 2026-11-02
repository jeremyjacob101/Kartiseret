"""Bilingual Jerusalem Cinematheque calendar collector over its public AJAX route."""

from datetime import datetime, timedelta
import re
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


JERUSALEM_TZ = ZoneInfo("Asia/Jerusalem")
CALENDAR_ENDPOINT = "https://jer-cin.org.il/ajax_complex_calender_full_width"
LANGUAGE_PAGES = {
    "he": "https://jer-cin.org.il/he/article/4285",
    "en": "https://jer-cin.org.il/en/article/4284",
}


def _calendar_page(session, url, required_days=45):
    response = session.get(url, timeout=(10, 30))
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    if not soup.select_one("#calender-filter") or not soup.select_one(".calenders-filter-date p"):
        raise ValueError(f"Jerusalem calendar page is missing its date controls: {url}")
    tokens = {}
    for element in soup.select("#calender-filter span.filter-date"):
        value = element.get_text(strip=True)
        if not re.fullmatch(r"\d{9,}", value):
            raise ValueError("Jerusalem calendar contains a malformed date token")
        day = datetime.fromtimestamp(int(value), JERUSALEM_TZ).date()
        if day in tokens:
            raise ValueError(f"Jerusalem calendar repeats date token {day}")
        tokens[day] = value
    if len(tokens) < required_days:
        raise ValueError(f"Jerusalem calendar exposes only {len(tokens)} selectable dates; {required_days} required")
    return tokens


def _calendar_for_date(session, page_url, tokens, day):
    token = tokens.get(day)
    if token is None:
        raise ValueError(f"Jerusalem calendar does not advertise {day.isoformat()}")
    response = session.post(
        CALENDAR_ENDPOINT,
        data={"filterdate": token},
        headers={
            "Referer": page_url,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
        },
        timeout=(10, 30),
    )
    response.raise_for_status()
    payload = response.json()
    html = payload.get("output") if isinstance(payload, dict) else None
    if not isinstance(html, str) or not html:
        raise ValueError(f"Jerusalem AJAX response for {day.isoformat()} has no calendar HTML")
    soup = BeautifulSoup(html, "html.parser")
    calendar = soup.select_one(".calendar-full-container")
    displayed = soup.select_one(".calenders-filter-date p")
    if not calendar or not displayed:
        raise ValueError(f"Jerusalem AJAX response for {day.isoformat()} has unexpected structure")
    displayed_match = re.search(r"\b(\d{2}\.\d{2}\.\d{2})\b", displayed.get_text(" ", strip=True))
    if not displayed_match or datetime.strptime(displayed_match.group(1), "%d.%m.%y").date() != day:
        raise ValueError(f"Jerusalem AJAX response is for the wrong date (expected {day})")
    return calendar


def _title(block):
    element = block.select_one(".lobby-title.second")
    if not element:
        return None
    link = element.select_one("a")
    return _visible_text(link or element)


def _visible_text(element):
    return " ".join(element.get_text(" ", strip=True).split()) if element else ""


def _event_id(block):
    button = block.select_one("button.toptix-purchase[data-event-id]")
    return button.get("data-event-id") if button else None


def collect_jerusalem(scraper):
    start = scraper.today_date.date()
    days = [start + timedelta(days=offset) for offset in range(scraper.DAYS)]
    scraper._coverage = {
        "calendar_pages_expected": 2,
        "calendar_pages_completed": 0,
        "date_responses_expected": 2 * scraper.DAYS,
        "date_responses_completed": 0,
        "date_tokens_expected": scraper.DAYS,
        "date_tokens_found": 0,
        "hebrew_titles_found": 0,
        "english_events_seen": 0,
        "english_events_skipped_missing_title": 0,
        "english_events_skipped_missing_details": 0,
        "english_events_skipped_missing_link": 0,
        "explicit_empty_dates": 0,
    }
    title_by_event = {}
    empty_dates = set()

    with requests.Session() as session:
        # This POST is a read-only calendar query, so retries cannot create data.
        configure_scrape_session(session, stats=getattr(scraper, "_http_stats", None), retry_methods=("GET", "POST"))
        session.headers.update({"User-Agent": CHROME_USER_AGENT})
        tokens_by_language = {}
        for language in ("he", "en"):
            page_url = LANGUAGE_PAGES[language]
            tokens = _calendar_page(session, page_url, len(days))
            missing = [day.isoformat() for day in days if day not in tokens]
            if missing:
                raise ValueError(f"Jerusalem {language} calendar is missing dates: {missing[:3]}")
            tokens_by_language[language] = tokens
            scraper._coverage["calendar_pages_completed"] += 1
        scraper._coverage["date_tokens_found"] = len(days)

        for day in days:
            calendar = _calendar_for_date(session, LANGUAGE_PAGES["he"], tokens_by_language["he"], day)
            for block in calendar.select(".lobby-container"):
                title = _title(block)
                if title is None:
                    raise ValueError(f"Jerusalem Hebrew event on {day} is missing its title")
                title_by_event[(day.isoformat(), _event_id(block))] = title
                scraper._coverage["hebrew_titles_found"] += 1
            scraper._coverage["date_responses_completed"] += 1

        for day in days:
            calendar = _calendar_for_date(session, LANGUAGE_PAGES["en"], tokens_by_language["en"], day)
            blocks = calendar.select(".lobby-container")
            if not blocks:
                # A valid, correctly dated calendar response with an empty event
                # container is the site's machine-readable empty-list evidence.
                empty_dates.add(day.isoformat())
            for block in blocks:
                title = _title(block)
                if not title or "No Screenings" in title:
                    scraper._coverage["english_events_skipped_missing_title"] += 1
                    continue
                scraper._coverage["english_events_seen"] += 1
                event_id = _event_id(block)
                scraper.english_title = title
                scraper.hebrew_title = title_by_event.get((day.isoformat(), event_id))

                time_element = block.select_one(".ticket-details .time")
                hall = block.select_one("span.cal-hall")
                length = block.select_one("span.cal-length")
                if not time_element or not hall or not length or ":" not in hall.get_text(strip=True):
                    # The legacy browser collector also skips these source blocks.
                    # Count the source-level omission explicitly so it is visible
                    # in parity diagnostics rather than treating it as empty data.
                    scraper._coverage["english_events_skipped_missing_details"] += 1
                    continue
                scraper.showtime = _visible_text(time_element)
                scraper.directed_by = _visible_text(hall).split(":")[1].strip()
                scraper.runtime = _visible_text(length).split(" ")[0].strip()

                button = block.select_one("button.toptix-purchase[data-url]")
                if button:
                    href = button.get("data-url")
                else:
                    image_link = block.select_one("a.link-image[href]")
                    href = image_link.get("href") if image_link else None
                if not href:
                    scraper._coverage["english_events_skipped_missing_link"] += 1
                    continue
                scraper.english_href = href
                scraper.hebrew_href = href.replace("lang=en", "lang=he")
                scraper.date_of_showing = day.isoformat()
                scraper.screening_city = scraper.SCREENING_CITY
                scraper.screening_type = "Regular"
                scraper.screening_tech = "2D"
                scraper.appendToGatheringInfo()
            scraper._coverage["date_responses_completed"] += 1

    scraper._confirmed_empty_dates = empty_dates
    scraper._coverage["explicit_empty_dates"] = len(empty_dates)
    if not any(scraper.gathering_info.values()) and len(empty_dates) == scraper.DAYS:
        scraper.confirmEmptySnapshot(f"Explicit no-screenings state confirmed for all {scraper.DAYS} calendar dates")
