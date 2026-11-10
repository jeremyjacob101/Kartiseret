from datetime import date
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup
import requests
from selenium.webdriver.common.by import By

from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


HEBREW = re.compile(r"[\u0590-\u05ff]")
LATIN = re.compile(r"[A-Za-z]")
DATE = re.compile(r"(?<!\d)(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?(?!\d)")
TIME = re.compile(r"(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)")


def parse_titles(title):
    parts = [p.strip() for p in re.split(r"\s*[|｜]\s*", title) if p.strip()]
    hebrew = next ( (p for p in parts if HEBREW.search(p) and not LATIN.search(p)), None)
    english = next ( (p for p in reversed(parts) if LATIN.search(p) and not HEBREW.search(p)), None)
    if not hebrew:
        hebrew = next((p for p in parts if HEBREW.search(p)), None)
    if not english:
        english = next((p for p in reversed(parts) if LATIN.search(p)), None)
    return hebrew, english


def parse_card(headings, paragraphs, links, today):
    title = next((s for s in headings if ('|' in s or '｜' in s) and (HEBREW.search(s) or LATIN.search(s))), None)
    if not title:
        title = next((s for s in headings if (HEBREW.search(s) or LATIN.search(s)) and not DATE.search(s) and not TIME.search(s)), '')
    # Series cards put the actual film name in a short paragraph before metadata.
    if '|' not in title and '｜' not in title:
        candidates = [p.strip() for p in paragraphs if len(p.strip()) < 120 and '|' in p and not re.search(r'\b(?:19|20)\d{2}\b|דקות', p)]
        if candidates:
            title = candidates[0]
    hebrew, english = parse_titles(title)
    dates = [DATE.fullmatch(s.strip()) for s in headings]
    times = [TIME.fullmatch(s.strip()) for s in headings]
    dm = next((m for m in dates if m), None)
    tm = next((m for m in times if m), None)
    if not (hebrew or english) or not dm or not tm:
        raise ValueError(f"Incomplete Sam Spiegel card: {title!r}")
    day, month = int(dm[1]), int(dm[2])
    year = int(dm[3]) if dm[3] else today.year
    if not dm[3] and today.month == 12 and month == 1:
        year += 1
    elif not dm[3] and today.month == 1 and month == 12:
        year -= 1
    showing = date(year, month, day).isoformat()
    info = next((p for p in paragraphs if '|' in p), '')
    # A program of multiple shorts has no single film runtime or release year.
    metadata_blocks = [p for p in paragraphs if re.search(r'(?:19|20)\d{2}', p) and re.search(r'\d+\s*דקות', p)]
    if len(set(metadata_blocks)) > 2:
        info = ''
    year_match = re.search(r'(?<!\d)(?:18|19|20)\d{2}(?!\d)', info)
    runtime_match = re.search(r'(\d{1,3})\s*(?:דקות|דק[׳\'״"]?|min(?:utes?)?)', info, re.I)
    ticket = next((url for url, label in links if urlparse(url).scheme in ('http', 'https') and ('כרטיס' in label or 'ticket' in label.lower())), None)
    return dict(hebrew_title=hebrew, english_title=english, date_of_showing=showing,
                showtime=f'{int(tm[1]):02d}:{tm[2]}', release_year=year_match.group() if year_match else None,
                runtime=int(runtime_match[1]) if runtime_match else None, ticket=ticket)


class SSCtheque(BaseCinema):
    CINEMA_NAME = 'Sam Spiegel Cinema'
    SCREENING_CITY = 'Jerusalem'
    URL = 'https://cinema.jsfs.co.il/%d7%9c%d7%95%d7%97-%d7%94%d7%a7%d7%a8%d7%a0%d7%95%d7%aa/'
    CARD_SELECTOR = "//div[contains(@class, 'elementor-widget-loop-grid')]//div[@data-elementor-type='loop-item']"
    DEFAULT_SCRAPE_MODE = 'auto'

    @staticmethod
    def _text(element):
        return element.get_text(' ', strip=True) if element else ''

    @classmethod
    def _parse_html_card(cls, card, today):
        headings = [cls._text(element) for element in card.select('h1, h2, h3, h4') if cls._text(element)]
        paragraphs = [cls._text(element) for element in card.select('p') if cls._text(element)]
        links = [(element.get('href') or '', cls._text(element)) for element in card.select('a[href]')]
        return parse_card(headings, paragraphs, links, today)

    def _append_row(self, row):
        self.hebrew_title = row['hebrew_title']
        self.english_title = row['english_title']
        self.date_of_showing = row['date_of_showing']
        self.showtime = row['showtime']
        self.release_year = row['release_year']
        self.runtime = row['runtime']
        self.english_href = self.hebrew_href = row['ticket'] or self.URL
        self.screening_city = self.SCREENING_CITY
        self.screening_type = 'Regular'
        self.screening_tech = '2D'
        self.appendToGatheringInfo()

    def logic(self):
        self.waitForElement(self.CARD_SELECTOR)
        cards = self.driver.find_elements(By.XPATH, self.CARD_SELECTOR)
        if not cards:
            raise ValueError('Sam Spiegel schedule contains no cards')
        for card in cards:
            headings = [e.text.strip() for e in card.find_elements(By.XPATH, './/h1|.//h2|.//h3|.//h4') if e.text.strip()]
            paragraphs = [e.get_attribute('textContent').strip() for e in card.find_elements(By.XPATH, './/p') if e.get_attribute('textContent')]
            links = [(e.get_attribute('href') or '', e.text or e.get_attribute('textContent') or '') for e in card.find_elements(By.XPATH, './/a[@href]')]
            row = parse_card(headings, paragraphs, links, date(int(self.current_year), int(self.current_month), 1))
            self._append_row(row)

    def requests_logic(self):
        self._coverage = {'pages_expected': 1, 'pages_completed': 0, 'cards_expected': 0, 'cards_parsed': 0}
        with requests.Session() as session:
            configure_scrape_session(session, stats=getattr(self, '_http_stats', None))
            session.headers.update({'User-Agent': CHROME_USER_AGENT})
            response = session.get(self.URL, timeout=(10, 30))
            response.raise_for_status()
            content_type = response.headers.get('Content-Type', '').lower()
            if 'html' not in content_type:
                raise ValueError(f'Sam Spiegel schedule returned unexpected content type: {content_type!r}')
            page = BeautifulSoup(response.text, 'html.parser')
            title = self._text(page.title)
            grid = page.select_one('.elementor-widget-loop-grid')
            if grid is None or 'לוח הקרנות' not in title:
                raise ValueError('Sam Spiegel response is not the expected schedule page')
            cards = grid.select("[data-elementor-type='loop-item']")
            if not cards:
                raise ValueError('Sam Spiegel schedule has no film cards')
            self._coverage.update(cards_expected=len(cards))
            today = date(int(self.current_year), int(self.current_month), 1)
            for card in cards:
                row = self._parse_html_card(card, today)
                self._append_row(row)
                self._coverage['cards_parsed'] += 1
            if self._coverage['cards_parsed'] != self._coverage['cards_expected']:
                raise ValueError('Sam Spiegel schedule card coverage is incomplete')
            self._coverage['pages_completed'] = 1
