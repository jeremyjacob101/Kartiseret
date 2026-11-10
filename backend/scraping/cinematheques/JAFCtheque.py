from datetime import datetime
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


class JAFCtheque(BaseCinema):
    CINEMA_NAME = "Jaffa Cinema"
    SCREENING_CITY = "Tel Aviv"
    URL = "https://www.jaffacinema.com/"
    USES_BROWSER = False
    DEFAULT_SCRAPE_MODE = "auto"
    ENGLISH_URL = "https://www.jaffacinema.com/en/main/"

    def selenium_logic(self):
        from backend.scraping.legacy.jaffa import JAFCtheque as LegacyJaffa
        return LegacyJaffa.logic(self)

    @staticmethod
    def _title(card):
        title = card.select_one("h2.jaffa-movie-card__title")
        if not title:
            raise ValueError("Jaffa movie card is missing its title")
        return re.sub(r"[\s\-\u2013\u2014]*(?:(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles)|(?:eng(?:lish)?|heb(?:rew)?)\s*(?:\+|&|/|and)\s*(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles))[\s\-\u2013\u2014]*$", "", title.get_text(" ", strip=True), flags=re.I)

    @staticmethod
    def _cards(html):
        cards = BeautifulSoup(html, "html.parser").select(".jaffa-movies > article.jaffa-movie-card")
        if not cards:
            raise ValueError("Jaffa page contains no movie cards")
        return cards

    def logic(self):
        self._coverage = {'listing_pages_expected': 2, 'listing_pages_completed': 0}
        with requests.Session() as session:
            configure_scrape_session(session, stats=getattr(self, '_http_stats', None))
            session.headers.update({"User-Agent": CHROME_USER_AGENT})
            pages = []
            for url in (self.URL, self.ENGLISH_URL):
                response = session.get(url, timeout=(10, 30))
                response.raise_for_status()
                pages.append(self._cards(response.text))
                self._coverage['listing_pages_completed'] += 1

        hebrew_titles, hebrew_hrefs = {}, {}
        for card in pages[0]:
            movie_id = card.get("data-movie-id")
            if movie_id:
                hebrew_titles[movie_id] = self._title(card)
            for screening in card.select("a.jaffa-movie-card__screening"):
                date_and_time = re.search(r"(\d{1,2})/(\d{1,2}).*?(\d{1,2}:\d{2})", screening.get_text(" ", strip=True))
                if movie_id and date_and_time and screening.get("href"):
                    dd, mm, showtime = date_and_time.groups()
                    hebrew_hrefs[(movie_id, int(dd), int(mm), showtime.zfill(5))] = urljoin(self.URL, screening["href"])

        for card in pages[1]:
            self.english_title = self._title(card)
            movie_id = card.get("data-movie-id")
            self.hebrew_title = hebrew_titles.get(movie_id)
            metadata = {}
            for item in card.select(".jaffa-movie-card__meta-item"):
                spans = item.find_all("span", recursive=False)
                if len(spans) >= 2:
                    metadata[spans[0].get_text(" ", strip=True)] = spans[-1].get_text(" ", strip=True)
            runtime = metadata.get("Running time:", "")
            hours, minutes = re.search(r"(\d+)\s*h", runtime), re.search(r"(\d+)\s*m", runtime)
            self.runtime = (int(hours.group(1)) if hours else 0) * 60 + (int(minutes.group(1)) if minutes else 0) if hours or minutes else None
            self.directed_by = metadata.get("Director:", "").split(",")[0].strip()
            description = card.select_one(".jaffa-movie-card__desc-inner")
            year = re.search(r"\b(\d{4})\b", description.get_text() if description else "")
            self.release_year = int(year.group(1)) if year else None

            screenings = card.select_one(".jaffa-movie-card__screenings")
            if not screenings or screenings.find("p") or (screenings.get_text(strip=True) and not screenings.select("a.jaffa-movie-card__screening")):
                raise ValueError("Jaffa movie card has an unexpected screenings section")
            crossed_year = False
            trying_year = self.current_year
            for screening in screenings.select("a.jaffa-movie-card__screening"):
                date_link = screening.select_one(".jaffa-movie-card__date-link")
                match = re.search(r"(\d{1,2})/(\d{1,2}).*?(\d{1,2}:\d{2})", date_link.get_text(" ", strip=True) if date_link else "")
                if not match or not screening.get("href"):
                    raise ValueError("Jaffa screening is missing its date, time or link")
                dd, mm, self.showtime = match.groups()
                if self.current_month == "12" and not crossed_year and int(mm) == 1:
                    crossed_year = True
                    trying_year = str(int(trying_year) + 1)
                self.date_of_showing = datetime.strptime(f"{dd}/{mm}/{trying_year}", "%d/%m/%Y").date().isoformat()
                self.english_href = urljoin(self.ENGLISH_URL, screening["href"])
                self.hebrew_href = hebrew_hrefs.get((movie_id, int(dd), int(mm), self.showtime.zfill(5)), self.english_href)
                self.screening_city = self.SCREENING_CITY
                self.screening_type = "Regular"
                self.screening_tech = "2D"
                self.appendToGatheringInfo()
