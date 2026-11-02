"""Herzliya Cinematheque listing and event-page collector."""

from datetime import datetime
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return element.get_text(' ', strip=True) if element else ''


def collect_herzliya(scraper):
    scraper._coverage = {'cards_expected': 0, 'cards_completed': 0, 'distinct_pages': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def page(url):
            response = session.get(url, timeout=(10, 30))
            response.raise_for_status()
            return BeautifulSoup(response.text, 'html.parser')

        home = page(scraper.URL)
        cards = home.select('#movie-screenings div[data-post-id]')
        if not cards:
            raise ValueError('Herzliya screening listing is missing')
        # The initial HTML normally has no Swiper indices; if present, select
        # one complete carousel cycle, as the browser collector does.
        if any(card.has_attr('data-swiper-slide-index') for card in cards):
            selected, seen = [], False
            for card in cards:
                if card.get('data-swiper-slide-index') == '0':
                    if seen:
                        break
                    seen = True
                if seen:
                    selected.append(card)
            if not selected:
                raise ValueError('Herzliya carousel has no first card')
            cards = selected
        scraper._coverage['cards_expected'] = len(cards)
        cache = {}
        for card in cards:
            link = card.select_one('a.jet-listing-dynamic-link__link')
            fields = card.select('div.jet-listing-dynamic-field__content')
            info = next((_text(field) for field in fields if not field.find() and '/' in _text(field) and ':' in _text(field)), None)
            if link is None or not link.get('href') or not info:
                raise ValueError('Herzliya screening card is missing its link or date')
            href = urljoin(scraper.URL, link['href'])
            if href not in cache:
                cache[href] = page(href)
                scraper._coverage['distinct_pages'] += 1
            post = cache[href].select_one('[data-elementor-type="single-post"]')
            if post is None:
                raise ValueError(f'Herzliya event page is missing its content: {href}')
            headings = post.select('div > div > div:nth-of-type(1) > div:nth-of-type(2) h3')
            if not headings:
                scraper._coverage['cards_completed'] += 1
                continue
            heading = post.select_one('h1.elementor-heading-title')
            ticket = post.select_one('a[href*="smarticket"]')
            if heading is None or ticket is None or not ticket.get('href'):
                raise ValueError(f'Herzliya event is missing its title or ticket: {href}')
            scraper.english_title = _text(headings[0])
            scraper.hebrew_title = _text(heading)
            if not re.search(r'[A-Za-z]', scraper.english_title):
                scraper.english_title = scraper.hebrew_title
            for suffix in ('(שלישי זהב)', '(ללא תשלום למנויים)', '(ללא תוספת למנויים)'):
                scraper.hebrew_title = scraper.hebrew_title.replace(suffix, '').strip()
            for marker in ('+ הרצאה', '+ שיחה'):
                if marker in scraper.hebrew_title:
                    scraper.hebrew_title = scraper.hebrew_title.split(marker)[0].strip()
            full_text = _text(post)
            scraper.dub_language = 'Hebrew' if 'דיבוב עברי' in full_text or 'דיבוב' in scraper.hebrew_title else None
            for marker in ('– דיבוב', '– אנגלית'):
                pos = scraper.hebrew_title.rfind(marker)
                if pos != -1:
                    scraper.hebrew_title = scraper.hebrew_title[:pos].strip()
            year = re.search(r'\b(\d{4})\b', full_text)
            runtime = re.search(r'(\d+)\s*דק׳', full_text)
            scraper.release_year = year.group(1) if year else None
            scraper.runtime = int(runtime.group(1)) if runtime else None
            try:
                date_text, scraper.showtime = info.split(' ', 1)
                scraper.date_of_showing = datetime.strptime(date_text, '%d/%m/%Y').date().isoformat()
            except ValueError as error:
                raise ValueError(f'Herzliya screening date is invalid: {href}') from error
            scraper.hebrew_href = urljoin(href, ticket['href'])
            scraper.english_href = scraper.hebrew_href
            scraper.screening_city = scraper.SCREENING_CITY
            scraper.screening_type = 'Regular'
            scraper.screening_tech = '2D'
            scraper.appendToGatheringInfo()
            scraper._coverage['cards_completed'] += 1
