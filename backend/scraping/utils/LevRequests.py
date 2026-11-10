"""Requests collectors for Lev's showtimes and coming-soon listings."""

from datetime import datetime
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return element.get_text(' ', strip=True) if element else ''


def _page(session, url):
    response = session.get(url, timeout=(10, 30))
    response.raise_for_status()
    return BeautifulSoup(response.text, 'html.parser')


def _details(scraper, session, href):
    he_url = re.sub(r'(/)en(/)', r'\1', href)
    he, en = _page(session, he_url), _page(session, href)
    he_title = he.select_one('#content .movie_title h1')
    en_title = en.select_one('#content .movie_title h1')
    fields = en.select('#content .allwithline > div')
    rating = en.select_one('#content .movie_age')
    if not he_title or not en_title or len(fields) < 3 or rating is None:
        raise ValueError(f'Lev film page missing required structure: {href}')
    scraper.hebrew_title = _text(he_title)
    scraper.english_title = _text(en_title) or scraper.hebrew_title
    match = re.search(r'\b(19|20)\d{2}\b', _text(fields[0]))
    scraper.release_year = int(match.group()) if match else None
    match = re.search(r'^\s*([A-Za-z]+)', _text(fields[1]))
    scraper.original_language = match.group(1) if match else 'Hebrew'
    rating_text = _text(rating)
    scraper.rating = rating_text.split(':', 1)[1].strip() if rating_text else 'All'
    runtime = _text(fields[2])
    scraper.runtime = runtime if runtime.isdigit() else None
    return en


def collect_lev(scraper, *, coming_soon):
    scraper._coverage = {'tabs_expected': 1 if coming_soon else 2, 'tabs_completed': 0, 'film_pages_completed': 0, 'explicit_empty_film_schedules': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})
        home = _page(session, scraper.URL)
        tabs = (2,) if coming_soon else (1, 2)
        for tab in tabs:
            container = home.select_one(f'#tab-{tab}')
            if container is None:
                raise ValueError(f'Lev listing is missing tab {tab}')
            selector = 'li.featureItems > div > a:first-child' if coming_soon else '.feat > a:first-child'
            cards = container.select(selector)
            if not cards or any(not card.get('href') for card in cards):
                raise ValueError(f'Lev tab {tab} has no valid film links')
            for card in cards:
                href = urljoin(scraper.URL, card['href'])
                en = _details(scraper, session, href)
                scraper._coverage['film_pages_completed'] += 1
                if coming_soon:
                    if scraper.hebrew_title.endswith('אנגלית'):
                        scraper.hebrew_title = scraper.hebrew_title[:-len('אנגלית')].rstrip()
                    if 'dubbed' in scraper.english_title.lower() or 'dubbded' in scraper.english_title.lower():
                        continue
                    release_text = _text(card.select_one('.datestarted'))
                    try:
                        scraper.release_date = datetime.strptime(release_text.split(':', 1)[1].strip(), '%d/%m/%Y').date().isoformat()
                    except (IndexError, ValueError) as error:
                        raise ValueError(f'Lev coming-soon film has an invalid release date: {href}') from error
                    scraper.appendToGatheringInfo()
                    continue

                scraper.dub_language = None
                if re.search(r'\b(?:dubbed|dubbded)\b', scraper.english_title, re.I):
                    scraper.english_title = re.sub(r'\b(?:dubbed|dubbded)\b', '', scraper.english_title, flags=re.I).strip()
                    scraper.hebrew_title = scraper.hebrew_title.replace('מדובב', '').strip()
                    scraper.dub_language = 'Hebrew'
                if scraper.hebrew_title.endswith(' אנגלית'):
                    scraper.hebrew_title = scraper.hebrew_title[:-len(' אנגלית')].strip()

                if tab == 1 and en.select_one('#content .movie_shows') is None:
                    # Lev also lists films before tickets go on sale. The real
                    # page renders a named, empty booking form in both HTML and
                    # Chrome, without a movie_shows container. A title-less
                    # festival/grouping page can render the same form without a
                    # film name; it has no schedules, so it is also empty.
                    # Missing markup alone is still a failure, rather than
                    # empty evidence.
                    booking = en.select_one('#content .bookform .bookform_innner')
                    expected = f'Purchase tickets for {_text(en.select_one("#content .movie_title h1"))}'.rstrip(' :')
                    if booking is None or _text(booking).replace('\xa0', ' ').rstrip(' :') != expected or booking.select('a, input, select, button') or en.select('#content .showitem'):
                        raise ValueError(f'Lev current film is missing its schedule container: {href}')
                    scraper._coverage['explicit_empty_film_schedules'] += 1
                for city in en.select('#content .movie_shows > .forloc'):
                    if city.select('.showitem') and not city.select('div div.showitem'):
                        raise ValueError(f'Lev screening structure is incomplete: {href}')
                    if not city.select('div div.showitem'):
                        continue
                    heading = city.select_one('h3')
                    if heading is None:
                        raise ValueError(f'Lev screening location has no name: {href}')
                    scraper.screening_city = _text(heading)
                    year = scraper.current_year
                    crossed_year = False
                    for day in city.select(':scope > div.showlist'):
                        match = re.search(r'(\d{1,2})/(\d{1,2})', _text(day.select_one('span')))
                        if not match:
                            raise ValueError(f'Lev screening date is missing: {href}')
                        dd, mm = match.groups()
                        if scraper.current_month == '12' and not crossed_year and int(mm) in (1, 2, 3, 4):
                            crossed_year = True
                            year = str(int(year) + 1)
                        scraper.date_of_showing = datetime.strptime(f'{year}/{dd}/{mm}', '%Y/%d/%m').date().isoformat()
                        items = day.select('div.showitem')
                        for item in items:
                            link = item.select_one('a')
                            if link is None or not link.get('href'):
                                raise ValueError(f'Lev screening ticket link is missing: {href}')
                            scraper.showtime = _text(link)
                            ticket = urljoin(href, link['href'])
                            scraper.english_href = ticket + '?lang=en'
                            scraper.hebrew_href = ticket + '?lang=he'
                            scraper.screening_type = 'Regular'
                            scraper.screening_tech = '2D'
                            scraper.appendToGatheringInfo()
            scraper._coverage['tabs_completed'] += 1
