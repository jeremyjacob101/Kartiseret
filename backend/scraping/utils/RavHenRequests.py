"""Independent Rav-Hen catalog and schedule collector."""

from datetime import date, timedelta
import json
import re

import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def collect_rav_hen(scraper):
    base = 'https://www.rav-hen.co.il/rh/data-api-service/v1'
    scraper._coverage = {'cinemas_completed': 0, 'dates_completed': 0, 'film_details_completed': 0}
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
                raise ValueError(f'Unexpected Rav-Hen API response: {path}')
            return value['body']

        home = get(scraper.URL).text
        match = re.search(r'apiSitesList\s*=\s*(\[.*?\])\s*,\s*', home, re.S)
        if not match:
            raise ValueError('Rav-Hen cinema list is missing')
        cinemas = json.loads(match.group(1))
        if not isinstance(cinemas, list) or not cinemas:
            raise ValueError('Rav-Hen cinema list is empty')
        scraper._coverage['cinemas_expected'] = len(cinemas)

        catalog = {}
        for feed in ('now-playing', 'coming-soon'):
            posters = body(f'/feed/10104/byName/{feed}', lang='he_IL').get('posters')
            if not isinstance(posters, list) or not posters:
                raise ValueError(f'Rav-Hen {feed} catalog is empty or missing')
            for poster in posters:
                fid = poster.get('code')
                if not fid:
                    raise ValueError('Rav-Hen catalog film has no ID')
                catalog[fid] = poster

        current = scraper.today_date.date()
        months = {(current.year, current.month), (current.year + (current.month == 12), current.month % 12 + 1)}
        deadline = current + timedelta(days=366)
        events = []
        for cinema in cinemas:
            cid, name = cinema.get('externalCode'), cinema.get('name')
            if not cid or not name:
                raise ValueError('Rav-Hen cinema is missing its ID or name')
            city = 'לוח הקרנות ב ' + name
            if city not in ('לוח הקרנות ב רב חן גבעתיים', 'לוח הקרנות ב רב חן דיזינגוף', 'לוח הקרנות ב רב חן קרית אונו'):
                raise ValueError(f'Unknown Rav-Hen cinema label: {name}')
            dates = body(f'/quickbook/10104/dates/in-cinema/{cid}/until/{deadline}', attr='', lang='he_IL').get('dates')
            if not isinstance(dates, list):
                raise ValueError('Rav-Hen available dates are missing')
            for day in dates:
                parsed = date.fromisoformat(day)
                if (parsed.year, parsed.month) not in months:
                    continue
                result = body(f'/quickbook/10104/film-events/in-cinema/{cid}/at-date/{day}', attr='', lang='he_IL')
                if not isinstance(result.get('events'), list):
                    raise ValueError('Rav-Hen date response has no events list')
                if not result['events']:
                    raise ValueError('Rav-Hen advertised a date but returned no events for it')
                for event in result['events']:
                    if event.get('cinemaId') != cid or event.get('businessDay') != day:
                        raise ValueError('Rav-Hen event does not belong to the requested cinema/date')
                    if event.get('filmId') not in catalog:
                        raise ValueError('Rav-Hen event film is absent from the catalog')
                    events.append((event, city))
                scraper._coverage['dates_completed'] += 1
            scraper._coverage['cinemas_completed'] += 1

        if not events:
            raise ValueError('Rav-Hen returned no screenings without explicit empty evidence')
        metadata = {}
        for fid in {event['filmId'] for event, _ in events}:
            details = body(f'/10104/films/byDistributorCode/{fid}', lang='he_IL').get('filmDetails')
            if not isinstance(details, dict) or details.get('id') != fid or not details.get('name'):
                raise ValueError(f'Rav-Hen film details are missing: {fid}')
            metadata[fid] = details
            scraper._coverage['film_details_completed'] += 1

        names = {}
        for fid, details in metadata.items():
            title = details['name']
            if title in names and names[title] != fid:
                raise ValueError(f'Rav-Hen has multiple film IDs for one title: {title}')
            names[title] = fid

        languages = {'en': 'English', 'he': 'Hebrew', 'cs': 'צ׳כית', 'fr': 'French'}
        for event, city in events:
            details = metadata[event['filmId']]
            attrs = event.get('attributeIds')
            if not isinstance(attrs, list) or not ({'2d', '3d'} & set(attrs)):
                raise ValueError('Rav-Hen screening format is missing')
            if set(attrs) & {'vip', 'vip-light', 'imax', '4dx', 'screenx'}:
                raise ValueError('Rav-Hen screening has an unhandled premium format')
            dubbed = event.get('languages', {}).get('dubbed', [])
            if dubbed and dubbed != ['he']:
                raise ValueError('Rav-Hen screening has an unhandled dub language')
            original = details.get('languages', {}).get('original') or ['he']
            if any(language not in languages for language in original):
                raise ValueError('Rav-Hen film has an unhandled original language')
            restriction = details.get('ageRestrictionName')
            if restriction not in (None, 'other', 'all', '9-plus', '12-plus', '14-plus', '16-plus', '18-plus'):
                raise ValueError('Rav-Hen film has an unhandled age restriction')
            year = details.get('releaseYear')
            scraper.english_title = details['name']
            scraper.hebrew_title = details['name']
            scraper.release_year = int(year) if year and str(year).isdigit() else None
            scraper.runtime = details.get('length')
            scraper.original_language = ', '.join(languages[language] for language in original)
            scraper.rating = 'All' if restriction == 'all' else restriction.replace('-plus', '+') if restriction and restriction.endswith('-plus') else None
            scraper.screening_type = 'Regular'
            scraper.screening_tech = '3D' if '3d' in attrs else '2D'
            scraper.dub_language = 'Hebrew' if 'dubbed' in attrs else None
            timestamp, ticket = event.get('eventDateTime'), event.get('bookingLink')
            if not isinstance(timestamp, str) or len(timestamp) < 16 or not ticket or not event.get('id'):
                raise ValueError('Rav-Hen event is missing a time or ticket')
            scraper.showtime = timestamp[11:16]
            scraper.date_of_showing = event['businessDay']
            scraper.english_href = ticket.replace('/api', '')
            scraper.hebrew_href = scraper.english_href.replace('lang=en', 'lang=he')
            scraper.screening_city = city
            scraper.appendToGatheringInfo()
