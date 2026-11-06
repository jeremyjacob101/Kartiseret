from datetime import datetime
import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.InitializeBaseCinema import CHROME_USER_AGENT
from backend.scraping.utils.ScrapeRequests import configure_scrape_session


class MLsoon(BaseCinema):
    CINEMA_NAME = "MovieLand"
    URL = "https://www.movieland.co.il/soon"
    USES_BROWSER = False
    DEFAULT_SCRAPE_MODE = "auto"

    def selenium_logic(self):
        from backend.scraping.legacy.movieland_soon import MLsoon as LegacyMovieLandSoon
        return LegacyMovieLandSoon.logic(self)

    @staticmethod
    def _get_page(session, url):
        response = session.get(url, timeout=(10, 30))
        response.raise_for_status()
        return BeautifulSoup(response.text, "html.parser")

    def logic(self):
        self._coverage = {'film_pages_expected': 0, 'film_pages_completed': 0}
        with requests.Session() as session:
            configure_scrape_session(session, stats=getattr(self, '_http_stats', None))
            session.headers.update({"User-Agent": CHROME_USER_AGENT})
            listing = self._get_page(session, self.URL)
            cards = listing.select("#soonContainer a[poster-summary]")
            if not cards or any(not card.get("href") for card in cards):
                raise ValueError("MovieLand coming-soon listing has missing film links")
            self._coverage['film_pages_expected'] = len(cards)

            for card in cards:
                page = self._get_page(session, urljoin(self.URL, card["href"]))
                block = page.select_one("#change-bg .bg-more-b")
                synopsis = page.select_one("#change-bg .bg-synops")
                spans = block.find_all("span", recursive=False) if block else []
                if not synopsis or len(spans) < 16:
                    raise ValueError("MovieLand film page is missing required details")
                self._coverage['film_pages_completed'] += 1
                if "IsLtr" in synopsis.get("class", []):
                    continue

                def text(index):
                    return spans[index - 1].get_text(" ", strip=True)

                self.runtime, self.release_year, self.original_language = None, None, None
                self.hebrew_title = text(1)
                if "(מדובב)" in self.hebrew_title:
                    continue
                for marker in ("3D", "HFR", "תלת מימד"):
                    self.hebrew_title = self.hebrew_title.replace(marker, "").strip()
                self.english_title = text(2)
                for marker in ("3D", "HFR"):
                    self.english_title = self.english_title.replace(marker, "").strip()
                self.english_title = self.english_title or self.hebrew_title

                self.release_date = datetime.strptime(text(4), "%d/%m/%Y").date().isoformat()
                self.rating = text(10)
                runtime = re.sub(r"\D", "", text(13))
                if runtime and runtime.isdigit():
                    self.runtime = runtime
                release_year = text(15)
                if release_year and release_year.isdigit():
                    self.release_year = release_year
                language = text(16)
                if language != "יעודכן בקרוב":
                    self.original_language = language.split(":", 1)[1].strip()
                self.appendToGatheringInfo()
