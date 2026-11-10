"""Requests collector for Tel Aviv Cinematheque's date pages."""

from datetime import timedelta
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return re.sub(r'[ \t\f\v]+', ' ', element.get_text(' ', strip=True)) if element else ''


def collect_tel_aviv(scraper):
    scraper._coverage = {'dates_expected': 60, 'dates_completed': 0, 'explicit_empty_dates': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})
        for day in range(60):
            date_string = (scraper.today_date + timedelta(days=day)).strftime('%Y-%m-%d')
            url = scraper.URL + '?date=' + date_string
            response = session.get(url, timeout=(10, 30))
            response.raise_for_status()
            page = BeautifulSoup(response.text, 'html.parser')
            calendar = page.select_one('#nav-date')
            if calendar is None:
                raise ValueError(f'Tel Aviv calendar is missing for {date_string}')
            cards = calendar.select(':scope > div.fest-box-parent-wrapper > div.festival-grid-box')
            if not cards and 'אין אירועים בתאריך זה' not in _text(calendar):
                raise ValueError(f'Tel Aviv calendar has no confirmed empty state for {date_string}')
            if not cards:
                scraper._coverage['explicit_empty_dates'] += 1
            for card in cards:
                title = card.select_one('.text-content > .title > p')
                paragraph = card.select_one('.text-content > .paragraph > p')
                title_text = title.get_text() if title else None
                paragraph_text = ' '.join(paragraph.get_text().split()[:50]) if paragraph else None
                heading = card.select_one('.text-content > .title > h3 > a')
                ticket = card.select_one('.text-content > .content-detail > .text-badge > a')
                if heading is None or ticket is None or not ticket.get('href') or ticket.select_one('span') is None:
                    raise ValueError(f'Tel Aviv screening is missing a title or ticket on {date_string}')
                scraper.english_title = _text(heading)
                if not re.search(r'[A-Za-z]', scraper.english_title) and paragraph_text:
                    english_words = []
                    for word in (paragraph_text or '').split():
                        if re.search(r'[A-Za-z]', word):
                            english_words.append(word)
                        elif english_words and re.fullmatch(r'[\u2010\u2011\u2012\u2013\u2014\u2212-]+', word):
                            english_words.append(word)
                        elif english_words:
                            break
                    scraper.english_title = ' '.join(english_words) if english_words else None
                scraper.release_year = None
                scraper.runtime = None
                for candidate in (title_text, paragraph_text):
                    match = re.search(r'\b\d{4}\b', candidate or '')
                    if match:
                        scraper.release_year = match.group()
                        break
                if title_text and 'Length:' in title_text:
                    match = re.search(r'Length:\s*(\d+)', title_text)
                    if match:
                        scraper.runtime = match.group(1)
                if not scraper.runtime and paragraph_text and 'דקות' in paragraph_text:
                    match = re.search(r'(\d+)\s+דקות', paragraph_text)
                    if match:
                        scraper.runtime = match.group(1)
                scraper.date_of_showing = date_string
                scraper.english_href = urljoin(url, ticket['href'])
                scraper.hebrew_href = scraper.english_href.replace('lang=en', 'lang=he')
                scraper.showtime = _text(ticket.select_one('span'))
                scraper.screening_city = scraper.SCREENING_CITY
                scraper.screening_type = 'Regular'
                scraper.screening_tech = '2D'
                scraper.appendToGatheringInfo()
            scraper._coverage['dates_completed'] += 1
        if not scraper.gathering_info['showtime']:
            scraper.confirmEmptySnapshot('All 60 Tel Aviv calendar dates explicitly reported no events')
