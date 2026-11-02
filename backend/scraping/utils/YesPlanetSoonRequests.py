"""Independent requests collector for Yes Planet's coming-soon feed."""

from datetime import datetime

import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def collect_yes_planet_soon(scraper):
    base = 'https://www.planetcinema.co.il/il/data-api-service/v1'
    scraper._coverage = {'posters_expected': 0, 'posters_completed': 0}
    languages = {'en': 'English', 'he': 'Hebrew', 'fr': 'French', 'de': 'German', 'ja': 'Japanese', 'it': 'Italian', 'es': 'Spanish', 'am': 'Amharic', 'zh': 'Chinese', 'cs': 'Czech', 'ko': 'Korean', 'da': 'Danish', 'ru': 'Russian', 'hi': 'Hindi'}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def body(path, **params):
            response = session.get(base + path, params=params, timeout=(10, 30))
            response.raise_for_status()
            value = response.json()
            if not isinstance(value, dict) or not isinstance(value.get('body'), dict):
                raise ValueError(f'Unexpected Yes Planet response: {path}')
            return value['body']

        posters = body('/feed/10100/byName/coming-soon', lang='en_GB').get('posters')
        if not isinstance(posters, list) or not posters:
            raise ValueError('Yes Planet coming-soon feed is empty or missing')
        scraper._coverage['posters_expected'] = len(posters)
        for poster in posters:
            fid = poster.get('code')
            if not fid:
                raise ValueError('Yes Planet poster has no film ID')
            if fid.endswith('s2r2'):
                scraper._coverage['posters_completed'] += 1
                continue
            details = {}
            for language in ('he_IL', 'en_GB'):
                film = body('/10100/films/byDistributorCode/' + fid, lang=language).get('filmDetails')
                if not isinstance(film, dict) or not film.get('name') or film.get('id') != fid:
                    raise ValueError(f'Yes Planet film details are missing or inconsistent: {fid}')
                details[language] = film
            he, en = details['he_IL'], details['en_GB']
            if 'gaming live' in he['name'].lower():
                scraper._coverage['posters_completed'] += 1
                continue
            original = en.get('languages', {}).get('original') or ['he']
            if any(value not in languages for value in original):
                raise ValueError(f'Unknown Yes Planet language for {fid}')
            restriction = en.get('ageRestrictionName')
            if restriction not in (None, 'other', 'all', '9-plus', '12-plus', '14-plus', '16-plus', '18-plus'):
                raise ValueError(f'Unknown Yes Planet age restriction for {fid}')
            release = en.get('dateStarted')
            if not isinstance(release, str):
                raise ValueError(f'Yes Planet release date is missing for {fid}')
            scraper.release_date = datetime.fromisoformat(release).date().isoformat()
            scraper.english_title = en['name']
            scraper.hebrew_title = he['name']
            year = en.get('releaseYear')
            scraper.release_year = int(year) if year and str(year).isdigit() else None
            scraper.directed_by = en.get('directors') or None
            scraper.original_language = 'Hebrew' if 'he' in original else ', '.join(languages[value] for value in original)
            scraper.rating = 'All' if restriction == 'all' else restriction.replace('-plus', '+') if restriction and restriction.endswith('-plus') else None
            runtime = en.get('length')
            scraper.runtime = int(runtime) if runtime else None
            scraper.appendToGatheringInfo()
            scraper._coverage['posters_completed'] += 1
