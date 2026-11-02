from datetime import date, datetime
import re
from urllib.parse import urlparse

from selenium.webdriver.common.by import By

from backend.scraping.BaseCinema import BaseCinema


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
