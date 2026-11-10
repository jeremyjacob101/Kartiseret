"""Paginated Haifa Cinematheque event and detail-page collector."""

from datetime import datetime
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return element.get_text(' ', strip=True) if element else ''


def collect_haifa(scraper):
    scraper._coverage = {'pagination_requests': 0, 'cards_completed': 0, 'rows_emitted': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def get(url, params=None):
            response = session.get(url, params=params, timeout=(10, 30))
            response.raise_for_status()
            return response

        response = get(scraper.URL)
        home = BeautifulSoup(response.text, 'html.parser')
        cards = list(home.select('#portfoliolist > div'))
        active_date = home.select_one('.slide.active[data-date]')
        initial_date = re.search(r'\bstartDate\s*:\s*["\']([^"\']+)["\']', response.text)
        # Events.init sets selectedDate from startDate. Late in the day the
        # server can omit today's active slide while still listing future films.
        selected_date = initial_date.group(1) if initial_date else active_date.get('data-date') if active_date else None
        category = re.search(r'window\.category\s*=\s*["\']([^"\']+)["\']', response.text)
        language = re.search(r'\bvar\s+_lang\s*=\s*["\']([^"\']+)["\']', response.text)
        if not cards or not selected_date or not category or not language:
            raise ValueError('Haifa listing, date, or pagination configuration is missing')
        datetime.strptime(selected_date, '%d.%m.%Y')
        shown = []
        for card in cards:
            identifier = card.get('data-id')
            if not identifier:
                raise ValueError('Haifa listing card has no event ID')
            if identifier not in shown:
                shown.append(identifier)
        terminated = False
        # The first browser request uses start=0, then its page counter is 2.
        for offset in (0, 2, 3, 4, 5, 6, 7, 8, 9, 10):
            params = {'ajax': '1', 'lang': language.group(1), 'date': selected_date, 'category': category.group(1), 'start': offset, 'limit': 7, 'shownEvents': ','.join(shown)}
            response = get('https://www.haifacin.co.il/includes/events.php', params)
            scraper._coverage['pagination_requests'] += 1
            if not response.text.strip():
                terminated = True
                break
            fragment = BeautifulSoup(response.text, 'html.parser')
            new_cards = fragment.select('div.eventContX')
            if not new_cards:
                raise ValueError('Haifa pagination returned unrecognized nonempty content')
            for card in new_cards:
                identifier = card.get('data-id')
                if not identifier or identifier in shown:
                    raise ValueError('Haifa pagination repeated or omitted an event ID')
                shown.append(identifier)
                cards.append(card)
        if not terminated:
            raise ValueError('Haifa pagination did not reach an explicit end within the browser limit')
        scraper._coverage['cards_expected'] = len(cards)
        for card in cards:
            link = card.select_one('a.ethos-more')
            if link is None or not link.get('href'):
                raise ValueError('Haifa event card is missing its detail link')
            href = urljoin(scraper.URL, link['href'])
            page = BeautifulSoup(get(href).text, 'html.parser')
            title = page.select_one('.slide_info_event h1.slide_title')
            english = page.select_one('.slide_info_event .slide_content')
            ticket = page.select_one('section.event-info a.ticketsPopup')
            time = page.select_one('.event-details-time')
            date = page.select_one('.event-details-date')
            if any(value is None for value in (title, english, ticket, time, date)) or not ticket.get('href'):
                raise ValueError(f'Haifa event page is missing required fields: {href}')
            scraper._coverage['cards_completed'] += 1
            scraper.english_title = _text(english)
            scraper.hebrew_title = _text(title)
            scraper.english_href = urljoin(href, ticket['href'])
            scraper.hebrew_href = scraper.english_href
            scraper.showtime = _text(time)
            try:
                scraper.date_of_showing = datetime.strptime(_text(date).split(',')[1].strip(), '%d.%m.%y').date().isoformat()
            except (IndexError, ValueError) as error:
                raise ValueError(f'Haifa event date is invalid: {href}') from error
            scraper.screening_city = scraper.SCREENING_CITY
            scraper.screening_type = 'Regular'
            scraper.screening_tech = '2D'
            release = page.select_one('.event-details-content > strong:first-of-type')
            if release is not None:
                match = re.search(r'\b(\d{4})\b', _text(release))
                scraper.release_year = int(match.group(1)) if match else None
                scraper.appendToGatheringInfo()
                scraper._coverage['rows_emitted'] += 1
