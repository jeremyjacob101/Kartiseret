"""Yes Planet showtimes from public catalog and Quickbook APIs."""

from datetime import date, timedelta
import json
import re

import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def collect_yes_planet(scraper):
    base = 'https://www.planetcinema.co.il/il/data-api-service/v1'
    scraper._coverage = {'catalog_films_completed': 0, 'cinemas_completed': 0, 'dates_completed': 0, 'unlisted_films_skipped': 0, 'russian_screenings_skipped': 0}
    languages = {'en': 'English', 'he': 'Hebrew', 'fr': 'French', 'de': 'German', 'ja': 'Japanese', 'it': 'Italian', 'es': 'Spanish', 'am': 'Amharic', 'zh': 'Chinese', 'cs': 'Czech', 'ko': 'Korean', 'da': 'Danish', 'ru': 'Russian', 'hi': 'Hindi'}
    valid_cities = {'SCREENINGS FOR PLANET AYALON', 'SCREENINGS FOR PLANET BEER SHEVA', 'SCREENINGS FOR PLANET HAIFA', 'SCREENINGS FOR PLANET JERUSALEM', 'SCREENINGS FOR PLANET RISHON LETZIYON', 'SCREENINGS FOR PLANET ZICHRON YAAKOV'}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def get(url, **params):
            response = session.get(url, params=params, timeout=(10, 30))
            response.raise_for_status()
            return response

        def body(path, **params):
            value = get(base + path, **params).json()
            if not isinstance(value, dict) or not isinstance(value.get('body'), dict):
                raise ValueError(f'Unexpected Yes Planet API response: {path}')
            return value['body']

        home = get('https://www.planetcinema.co.il/', lang='en_gb').text
        match = re.search(r'apiSitesList\s*=\s*(\[.*?\])\s*,\s*', home, re.S)
        if not match:
            raise ValueError('Yes Planet cinema list is missing')
        cinemas = json.loads(match.group(1))
        if not isinstance(cinemas, list) or not cinemas:
            raise ValueError('Yes Planet cinema list is empty')
        scraper._coverage['cinemas_expected'] = len(cinemas)

        # The Selenium collector keys film metadata by the displayed English
        # card title; later duplicate titles replace earlier entries.
        catalog = {}
        for feed in ('now-playing', 'coming-soon'):
            posters = body(f'/feed/10100/byName/{feed}', lang='en_GB').get('posters')
            if not isinstance(posters, list) or not posters:
                raise ValueError(f'Yes Planet {feed} catalog is empty or missing')
            for poster in posters:
                fid, title = poster.get('code'), poster.get('featureTitle')
                if not fid or not isinstance(title, str) or not title:
                    raise ValueError('Yes Planet catalog film is missing its ID or title')
                if fid.endswith(('s2r2', 'd2r1')):
                    continue
                metadata = {}
                for language in ('he_IL', 'en_GB'):
                    value = body('/10100/films/byDistributorCode/' + fid, lang=language).get('filmDetails')
                    if not isinstance(value, dict) or value.get('id') != fid or not value.get('name'):
                        raise ValueError(f'Yes Planet film details are missing or inconsistent: {fid}')
                    metadata[language] = value
                catalog[title.lower()] = (title, metadata)
                scraper._coverage['catalog_films_completed'] += 1

        current = scraper.today_date.date()
        months = {(current.year, current.month), (current.year + (current.month == 12), current.month % 12 + 1)}
        deadline = current + timedelta(days=366)
        for cinema in cinemas:
            cid, name = cinema.get('externalCode'), cinema.get('name')
            city = 'SCREENINGS FOR ' + name.upper() if isinstance(name, str) else ''
            if not cid or city not in valid_cities:
                raise ValueError(f'Unknown Yes Planet cinema: {name}')
            dates = body(f'/quickbook/10100/dates/in-cinema/{cid}/until/{deadline}', attr='', lang='en_GB').get('dates')
            if not isinstance(dates, list):
                raise ValueError('Yes Planet available dates are missing')
            for day in dates:
                parsed = date.fromisoformat(day)
                if (parsed.year, parsed.month) not in months:
                    continue
                result = body(f'/quickbook/10100/film-events/in-cinema/{cid}/at-date/{day}', attr='', lang='en_GB')
                films, events = result.get('films'), result.get('events')
                if not isinstance(films, list) or not isinstance(events, list):
                    raise ValueError('Yes Planet date response is missing films or events')
                names = {}
                for film in films:
                    if not film.get('id') or not isinstance(film.get('name'), str):
                        raise ValueError('Yes Planet date film is missing its ID or name')
                    names[film['id']] = film['name']
                for event in events:
                    if event.get('cinemaId') != cid or event.get('businessDay') != day or event.get('filmId') not in names:
                        raise ValueError('Yes Planet event does not belong to the requested cinema/date/film')
                    found = catalog.get(names[event['filmId']].lower())
                    if not found:
                        scraper._coverage['unlisted_films_skipped'] += 1
                        continue
                    attr = event.get('attributeIds')
                    if not isinstance(attr, list) or not ({'2d', '3d'} & set(attr)):
                        raise ValueError('Yes Planet screening format is missing')
                    event_languages = event.get('languages') or {}
                    if any('ru' in (event_languages.get(key) or []) for key in ('dubbed', 'voiceover', 'subtitles')):
                        scraper._coverage['russian_screenings_skipped'] += 1
                        continue
                    supported_special = {'vip', 'vip-light', 'imax', '4dx', 'screenx', 'infinity-vision'}
                    present = set(attr) & supported_special
                    infinity_formats = {
                        frozenset({'infinity-vision'}): 'INFINITY VISION',
                        frozenset({'infinity-vision', 'screenx'}): 'INFINITY VISIONSCREENX',
                        frozenset({'infinity-vision', '4dx'}): '4DXINFINITY VISION',
                    }
                    infinity_label = infinity_formats.get(frozenset(present)) if 'infinity-vision' in present else None
                    if 'infinity-vision' in present and infinity_label is None:
                        raise ValueError('Yes Planet has an unhandled Infinity Vision combination')
                    if 'infinity-vision' not in present and len(present) > 1:
                        raise ValueError('Yes Planet screening has combined unhandled formats')
                    dub = event_languages.get('dubbed') or []
                    if dub and dub != ['he']:
                        raise ValueError('Yes Planet screening has an unhandled dub language')
                    title, metadata = found
                    he, en = metadata['he_IL'], metadata['en_GB']
                    original = en.get('languages', {}).get('original') or ['he']
                    if any(language not in languages for language in original):
                        raise ValueError('Yes Planet film has an unknown original language')
                    restriction = en.get('ageRestrictionName')
                    if restriction not in (None, 'other', 'all', '9-plus', '12-plus', '14-plus', '16-plus', '18-plus'):
                        raise ValueError('Yes Planet film has an unknown age restriction')
                    year = en.get('releaseYear')
                    scraper.english_title = title
                    scraper.hebrew_title = he['name']
                    scraper.release_year = int(year) if year and str(year).isdigit() else None
                    scraper.directed_by = en.get('directors') or ''
                    scraper.original_language = 'Hebrew' if original == ['he'] else ', '.join(languages[language] for language in original)
                    scraper.rating = 'All' if restriction == 'all' else restriction.replace('-plus', '+') if restriction and restriction.endswith('-plus') else None
                    scraper.runtime = int(en['length']) if en.get('length') else None
                    scraper.dub_language = 'Hebrew' if 'dubbed' in attr else None
                    tech = '3D' if '3d' in attr else '2D'
                    infinity_display = infinity_label + tech if infinity_label else None
                    scraper.screening_type = infinity_display or ('VIP Light' if 'vip-light' in attr else 'VIP' if 'vip' in attr else 'Regular')
                    scraper.screening_tech = infinity_display or tech + (' IMAX' if 'imax' in attr else ' 4DX' if '4dx' in attr else ' ScreenX' if 'screenx' in attr else '')
                    timestamp, ticket = event.get('eventDateTime'), event.get('bookingLink')
                    if not event.get('id') or not isinstance(timestamp, str) or len(timestamp) < 16 or not ticket:
                        raise ValueError('Yes Planet screening is missing a time or ticket')
                    scraper.showtime = timestamp[11:16]
                    scraper.date_of_showing = day
                    scraper.english_href = ticket.replace('/api', '')
                    scraper.hebrew_href = scraper.english_href.replace('lang=en', 'lang=he')
                    scraper.screening_city = city
                    scraper.appendToGatheringInfo()
                scraper._coverage['dates_completed'] += 1
            scraper._coverage['cinemas_completed'] += 1
