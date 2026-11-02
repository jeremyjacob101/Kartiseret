"""Hot Cinema theater/date API collector, retaining browser output conventions."""

from datetime import datetime
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup
import requests

from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


def _text(element):
    return ' '.join(element.get_text(' ', strip=True).split()) if element else ''


def collect_hot_cinema(scraper):
    scraper._coverage = {'films_completed': 0, 'cinemas_completed': 0, 'dates_completed': 0, 'explicit_empty_dates': 0, 'unlisted_films_skipped': 0}
    ticket_sites = {'16': 1197, '14': 1194, '1': 1183, '17': 1191, '9': 1195, '2': 1184, '15': 1192, '6': 1181, '8': 1193, '5': 1182, '3': 1196, '22': 1198}
    with requests.Session() as session:
        configure_scrape_session(session, stats=getattr(scraper, '_http_stats', None))
        session.headers.update({'User-Agent': CHROME_USER_AGENT})

        def get(url, params=None):
            response = session.get(url, params=params, timeout=(10, 30))
            response.raise_for_status()
            return response

        home = BeautifulSoup(get(scraper.URL).text, 'html.parser')
        cards = home.select('.nowInTheaters-page > .container > .row > .movie-box-wrapper > div > div > a')
        if not cards or any(not card.get('href') for card in cards):
            raise ValueError('Hot Cinema film listing is missing or incomplete')
        scraper._coverage['films_expected'] = len(cards)
        metadata = {}
        for card in cards:
            url = urljoin(scraper.URL, card['href'])
            page = BeautifulSoup(get(url).text, 'html.parser')
            block = page.select_one('.movie-page > .d-none.d-md-block .movie-details .left-side')
            if block is None or block.select_one('h1') is None or block.select_one('h2') is None or block.select_one('.desc2') is None:
                raise ValueError(f'Hot Cinema film details are missing: {url}')
            he, en = _text(block.select_one('h1')), _text(block.select_one('h2'))
            if not he:
                raise ValueError(f'Hot Cinema film title is empty: {url}')
            desc = _text(block.select_one('.desc2'))
            last = desc.split()[-1] if desc else ''
            year = int(last) if last.isdigit() and len(last) == 4 else None
            rows = block.select('.desc3 .row')
            runtime = rating = None
            if rows:
                values = rows[0].select('.desc-text')
                digits = re.sub(r'\D', '', _text(values[1])) if len(values) > 1 else ''
                runtime = int(digits) if digits else None
            if len(rows) > 1:
                values = rows[1].select('.desc-text')
                rating = _text(values[1]) if len(values) > 1 else None
            metadata[he] = (en, year, rating, runtime)
            scraper._coverage['films_completed'] += 1

        cinemas = {}
        for link in home.select('a[href^="/theater/"]'):
            match = re.search(r'/theater/(\d+)', link.get('href', ''))
            if match:
                cinemas.setdefault(match.group(1), _text(link))
        if not cinemas:
            raise ValueError('Hot Cinema theater list is missing')
        scraper._coverage['cinemas_expected'] = len(cinemas)
        current = scraper.today_date.date()
        months = {(current.year, current.month), (current.year + (current.month == 12), current.month % 12 + 1)}
        for cinema, city in cinemas.items():
            if cinema not in ticket_sites or not city:
                raise ValueError(f'Hot Cinema theater has no known booking site: {cinema}')
            theater = BeautifulSoup(get(urljoin(scraper.URL, f'/theater/{cinema}')).text, 'html.parser')
            heading = theater.select_one('h1')
            if heading is None or not _text(heading):
                raise ValueError(f'Hot Cinema theater page has no heading: {cinema}')
            city = _text(heading)
            query = {'movieid': '', 'date': '', 'theatreid': cinema, 'time': '', 'type': '', 'lang': ''}
            dates = get('https://hotcinema.co.il/MovieEventsDaysFilter', query).json()
            if not isinstance(dates, list):
                raise ValueError('Hot Cinema date filter returned an invalid response')
            for day in dates:
                parsed = datetime.strptime(day, '%d/%m/%Y').date()
                if parsed < current or (parsed.year, parsed.month) not in months:
                    continue
                params = {'movieid': '', 'date': day, 'theatreid': cinema, 'site': '', 'time': '', 'type': '', 'lang': '', 'kinorai': '', 'genreId': 0, 'screentype': '', 'subdub': '', 'isnew': 'false'}
                result = get('https://hotcinema.co.il/tickets/TheaterEvents2', params).json()
                if not isinstance(result, dict) or not isinstance(result.get('TheaterEvents'), list):
                    raise ValueError('Hot Cinema theater/date response is invalid')
                if not result['TheaterEvents']:
                    scraper._coverage['explicit_empty_dates'] += 1
                for movie in result['TheaterEvents']:
                    raw_name = movie.get('MovieName')
                    if not isinstance(raw_name, str):
                        raise ValueError('Hot Cinema event has no film name')
                    name = raw_name.strip()
                    if name not in metadata:
                        scraper._coverage['unlisted_films_skipped'] += 1
                        continue
                    scraper.english_title, scraper.release_year, scraper.rating, scraper.runtime = metadata[name]
                    scraper.hebrew_title = name
                    if scraper.english_title == 'Comedy Bar' or scraper.hebrew_title == 'קומדי בר' or 'comedy bar' in scraper.english_title or 'Comedy Bar' in scraper.english_title:
                        continue
                    scraper.dub_language = None
                    if 'מדובב לעברית' in scraper.hebrew_title:
                        scraper.dub_language = 'Hebrew'
                        scraper.hebrew_title = scraper.hebrew_title.split('מדובב לעברית', 1)[0].strip()
                    if 'מדובב לצרפתית' in scraper.hebrew_title:
                        scraper.dub_language = 'French'
                        scraper.hebrew_title = scraper.hebrew_title.split('מדובב לצרפתית', 1)[0].strip()
                    if 'מדובב לרוסית' in scraper.hebrew_title or 'מדובב לערבית' in scraper.hebrew_title:
                        continue
                    if scraper.hebrew_title.endswith(' אנגלית'):
                        scraper.hebrew_title = scraper.hebrew_title.removesuffix(' אנגלית').strip()
                    if 'תלת-ממד HFR' in scraper.hebrew_title:
                        tech = '3D HFR'
                        scraper.hebrew_title = scraper.hebrew_title.split('תלת-ממד HFR', 1)[0].strip()
                    elif 'HFR' in scraper.hebrew_title:
                        tech = '2D HFR'
                        scraper.hebrew_title = scraper.hebrew_title.split('HFR', 1)[0].strip()
                    elif 'תלת-ממד' in scraper.hebrew_title:
                        tech = '3D'
                        scraper.hebrew_title = scraper.hebrew_title.split('תלת-ממד', 1)[0].strip()
                    else:
                        tech = '2D'
                    if not isinstance(movie.get('Dates'), list):
                        raise ValueError('Hot Cinema film has no screening list')
                    for event in movie['Dates']:
                        if not event.get('EventId') or not event.get('Hour'):
                            raise ValueError('Hot Cinema screening has no event ID or time')
                        is_performance = event.get('IsPerformance') or event.get('IsPreformance') or movie.get('IsPerformance') or movie.get('IsPreformance') or movie.get('ScreeningType') == 'לא רק קולנוע'
                        scraper.screening_type = 'Not Just Cinema' if is_performance else 'Premium' if event.get('IsVIP') else 'Regular'
                        scraper.screening_tech = tech + (' Atmos' if event.get('IsAtmos') else '')
                        scraper.showtime = event['Hour']
                        site = ticket_sites[cinema]
                        ticket = f'https://tickets.hotcinema.co.il/site/{site}/tickets?code={site}-{event["EventId"]}'
                        scraper.english_href = ticket + '&languageid=en_gb'
                        scraper.hebrew_href = ticket + '&languageid=he_IL'
                        scraper.screening_city = city
                        scraper.date_of_showing = parsed.isoformat()
                        scraper.appendToGatheringInfo()
                scraper._coverage['dates_completed'] += 1
            scraper._coverage['cinemas_completed'] += 1
