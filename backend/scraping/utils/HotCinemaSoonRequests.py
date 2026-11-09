"""Hot Cinema coming-soon listing and film-page collector."""

from datetime import datetime
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return ' '.join(element.get_text(' ', strip=True).split()) if element else ''


def collect_hot_soon(scraper):
    scraper._coverage = {'groups_completed': 0, 'film_pages_completed': 0}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def page(url):
            response = session.get(url, timeout=(10, 30))
            response.raise_for_status()
            return BeautifulSoup(response.text, 'html.parser')

        home = page(scraper.URL)
        groups = home.select('.soonInTheaters-page > .container > .row > .movie-box-wrapper')
        if not groups:
            raise ValueError('Hot Cinema coming-soon groups are missing')
        scraper._coverage['groups_expected'] = len(groups)
        for group in groups:
            anchors = group.select(':scope > div > div > a')
            count = len(group.select(':scope > div > h4'))
            if not count or len(anchors) < count - 1 or any(not item.get('href') for item in anchors[:count - 1]):
                raise ValueError('Hot Cinema coming-soon group is incomplete')
            # The existing collector intentionally traverses range(1, count).
            for anchor in anchors[:count - 1]:
                href = urljoin(scraper.URL, anchor['href'])
                block = page(href).select_one('.movie-page > .d-none.d-md-block .movie-details .left-side')
                if block is None or block.select_one('h1') is None or block.select_one('h2') is None or block.select_one('.desc2') is None:
                    raise ValueError(f'Hot Cinema coming-soon film details are missing: {href}')
                scraper._coverage['film_pages_completed'] += 1
                scraper.english_title = _text(block.select_one('h2'))
                scraper.hebrew_title = _text(block.select_one('h1'))
                excluded = ('סטנדאפ', 'מדובב לרוסית', 'מדובב לעברית', 'מדובב לצרפתית', 'סינימה אישי', 'קומדי בר', 'HFR', 'תלת-ממד')
                if 'סטנדאפ' in scraper.english_title or any(value in scraper.hebrew_title for value in excluded):
                    continue
                scraper.hebrew_title = re.sub(r'^\s*סינמה נוסטלגי(?:ה)?\s*[-–—]\s*', '', scraper.hebrew_title).strip()
                scraper.hebrew_title = re.sub(r'\s*אנגלית\s*$', '', scraper.hebrew_title).strip()
                raw = _text(block.select_one('.desc2'))
                last = raw.split()[-1] if raw else ''
                scraper.release_year = int(last) if last.isdigit() and len(last) == 4 else None
                rows = block.select('.desc3 .row')
                if len(rows) < 2:
                    raise ValueError(f'Hot Cinema coming-soon metadata is incomplete: {href}')
                first, second = rows[0].select('.desc-text'), rows[1].select('.desc-text')
                if len(second) < 2:
                    raise ValueError(f'Hot Cinema coming-soon release date or rating is missing: {href}')
                scraper.rating = _text(second[1])
                digits = re.sub(r'\D', '', _text(first[1])) if len(first) > 1 else ''
                scraper.runtime = int(digits) if digits else None
                try:
                    release = _text(second[0]).split(':', 1)[1].strip().replace('.', '/')
                    scraper.release_date = datetime.strptime(release, '%d/%m/%Y').date().isoformat()
                except (IndexError, ValueError) as error:
                    raise ValueError(f'Hot Cinema coming-soon release date is invalid: {href}') from error
                scraper.appendToGatheringInfo()
            scraper._coverage['groups_completed'] += 1
