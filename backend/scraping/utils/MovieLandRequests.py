"""MovieLand showtimes from its public events API and film pages."""

from datetime import date, datetime
import json
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return ' '.join(element.get_text(' ', strip=True).split()) if element else ''


def _business_date(event):
    timestamp = event.get('Date')
    label = event.get('Day')
    if not isinstance(timestamp, str) or not isinstance(label, str):
        raise ValueError('MovieLand event has no timestamp or business-day label')
    actual = datetime.fromisoformat(timestamp).date()
    match = re.search(r'(\d{1,2})\.(\d{1,2})', label)
    if not match:
        raise ValueError('MovieLand event has an invalid business-day label')
    day, month = map(int, match.groups())
    candidates = []
    for year in (actual.year - 1, actual.year, actual.year + 1):
        try:
            candidates.append(date(year, month, day))
        except ValueError:
            continue
    if not candidates:
        raise ValueError('MovieLand event has an invalid business date')
    business_day = min(candidates, key=lambda value: abs((value - actual).days))
    if abs((business_day - actual).days) > 1:
        raise ValueError('MovieLand event timestamp and business day disagree')
    return business_day


def collect_movieland(scraper):
    scraper._coverage = {'films_completed': 0, 'cinemas_completed': 0, 'dates_completed': 0, 'unlisted_films_skipped': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def get(url, params=None):
            response = session.get(url, params=params, timeout=(10, 30))
            response.raise_for_status()
            return response

        home = BeautifulSoup(get(scraper.URL).text, 'html.parser')
        cards = home.select('#change-bg .movies-page a[poster-summary]')
        if not cards or any(not card.get('href') for card in cards):
            raise ValueError('MovieLand listing is missing film links')
        scraper._coverage['films_expected'] = len(cards)
        metadata = {}
        for card in cards:
            href = urljoin(scraper.URL, card['href'])
            page = BeautifulSoup(get(href).text, 'html.parser')
            block = page.select_one('#change-bg .bg-more-b')
            spans = block.find_all('span', recursive=False) if block else []
            if len(spans) < 16:
                raise ValueError(f'MovieLand film details are incomplete: {href}')
            hebrew = _text(spans[0])
            if not hebrew:
                raise ValueError(f'MovieLand film title is missing: {href}')
            english = _text(spans[1]) or hebrew
            language = _text(spans[15]).split(':', 1)[-1].strip()
            match = re.search(r'\b\d{4}\b', _text(spans[14]))
            year = int(match.group()) if match else None
            metadata[hebrew] = (english, language, year, _text(spans[9]))
            scraper._coverage['films_completed'] += 1

        cinemas = home.select(".newnav-upper-menu a.dropdown-item[href^='/theater/']")
        if not cinemas or any(not c.get('href') for c in cinemas):
            raise ValueError('MovieLand theater list is missing')
        scraper._coverage['cinemas_expected'] = len(cinemas)
        current = scraper.today_date.date()
        months = {(current.year, current.month), (current.year + (current.month == 12), current.month % 12 + 1)}
        for cinema in cinemas:
            match = re.search(r'/theater/(\d+)', cinema['href'])
            if not match:
                raise ValueError('MovieLand theater is missing its ID')
            cinema_id = match.group(1)
            theater_html = get(urljoin(scraper.URL, cinema['href'])).text
            theater_page = BeautifulSoup(theater_html, 'html.parser')
            heading = theater_page.select_one('#change-bg > div.container-fluid.inner-page-header h1')
            if heading is None:
                raise ValueError('MovieLand theater page is missing its name')
            city = _text(heading)
            dates_match = re.search(r'eventsList\.dates\s*=\s*(\[.*?\])\s*;', theater_html, re.S)
            if not dates_match:
                raise ValueError('MovieLand theater dates are missing')
            dates = json.loads(dates_match.group(1))
            if not isinstance(dates, list):
                raise ValueError('MovieLand theater dates are invalid')
            films = []
            visited_dates = set()
            for entry in dates:
                timestamp = entry.get('date') if isinstance(entry, dict) else None
                if not isinstance(timestamp, str):
                    raise ValueError('MovieLand theater date is invalid')
                selected_day = datetime.fromisoformat(timestamp).date()
                if selected_day < current or (selected_day.year, selected_day.month) not in months or selected_day in visited_dates:
                    continue
                visited_dates.add(selected_day)
                params = {'TheatreId': cinema_id, 'MovieId': '', 'Date': timestamp, 'HebrewSubs': '', 'Dubbed': 'false', 'ThreeD': 'false', 'isVenueUpgrated': 'false', 'isHFR3D': 'false', 'isHideVODRent': 'true'}
                daily_films = get('https://movieland.co.il/api/Events', params).json()
                if not isinstance(daily_films, list):
                    raise ValueError('MovieLand events response is not a list')
                films.extend((film, selected_day) for film in daily_films)
                scraper._coverage['dates_completed'] += 1
            for film, selected_day in films:
                name = film.get('Name')
                if not isinstance(name, str):
                    raise ValueError('MovieLand event film has no name')
                # Selenium reads the displayed title, which collapses HTML whitespace.
                name = ' '.join(name.split())
                if name not in metadata:
                    scraper._coverage['unlisted_films_skipped'] += 1
                    continue
                if not isinstance(film.get('Dates'), list):
                    raise ValueError('MovieLand film has no event list')
                for event in film['Dates']:
                    business_day = _business_date(event)
                    if business_day != selected_day:
                        raise ValueError('MovieLand event belongs to a different selected business day')
                    if not event.get('EventId') or not event.get('Hour') or str(event.get('TheaterId')) != cinema_id:
                        raise ValueError('MovieLand event is missing its ID, time, or theater')
                    scraper.english_title, scraper.original_language, scraper.release_year, scraper.rating = metadata[name]
                    scraper.hebrew_title = name
                    scraper.dub_language = None
                    if '(מדובב)' in scraper.hebrew_title:
                        scraper.hebrew_title = scraper.hebrew_title.replace('(מדובב)', '').strip()
                        scraper.dub_language = 'Hebrew'
                    if '3D תלת מימד HFR' in scraper.hebrew_title:
                        scraper.screening_tech = '3D HFR'
                        scraper.hebrew_title = scraper.hebrew_title.replace('3D תלת מימד HFR', '').strip()
                    elif 'תלת מימד HFR' in scraper.hebrew_title:
                        scraper.screening_tech = '3D HFR'
                        scraper.hebrew_title = scraper.hebrew_title.replace('תלת מימד HFR', '').strip()
                    elif 'תלת מימד' in scraper.hebrew_title:
                        scraper.screening_tech = '3D'
                        scraper.hebrew_title = scraper.hebrew_title.replace('תלת מימד', '').strip()
                    elif '3D' in scraper.hebrew_title:
                        scraper.screening_tech = '3D'
                        scraper.hebrew_title = scraper.hebrew_title.replace('3D', '').strip()
                    elif 'HFR' in scraper.hebrew_title:
                        scraper.screening_tech = '2D HFR'
                        scraper.hebrew_title = scraper.hebrew_title.replace('HFR', '').strip()
                    else:
                        scraper.screening_tech = '2D'
                    scraper.english_title = scraper.english_title.replace('3D', '').strip()
                    scraper.date_of_showing = business_day.isoformat()
                    scraper.showtime = event['Hour']
                    ticket = f'https://movieland.co.il/order/?eventID={event["EventId"]}&theaterId={cinema_id}'
                    scraper.english_href = ticket
                    scraper.hebrew_href = ticket
                    scraper.screening_type = 'Upgrade' if event.get('IsVip') else 'Regular'
                    scraper.screening_city = city
                    scraper.appendToGatheringInfo()
            scraper._coverage['cinemas_completed'] += 1
    if scraper._coverage['unlisted_films_skipped']:
        raise ValueError(
            f"MovieLand schedule referenced {scraper._coverage['unlisted_films_skipped']} films absent from the discovered catalog"
        )
