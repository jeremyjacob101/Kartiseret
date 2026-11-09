from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.CinemaCityListing import COMING_SOON_CARD_SELECTOR, load_movie_listing

from datetime import datetime
from urllib.parse import urlsplit
import re


class CCsoon(BaseCinema):
    CINEMA_NAME = "Cinema City"
    URL = "https://www.cinema-city.co.il/movie-categories/coming-soon"
    DEFAULT_SCRAPE_MODE = "auto"

    def requests_logic(self):
        from backend.scraping.utils.CinemaCityRequests import collect_cinema_city_coming_soon
        return collect_cinema_city_coming_soon(self)

    def parseReleaseDate(self, value):
        release_date = re.sub(r"[\u200b-\u200f\u202a-\u202e\u2066-\u2069]", "", value or "").strip().replace(".", "/")
        if match := re.fullmatch(r"(\d{1,2})\s+ב?([א-ת]+)\s+(\d{4})", release_date):
            day, month, year = match.groups()
            months = ("ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר")
            release_date = f"{day}/{months.index(month) + 1}/{year}"
        return datetime.strptime(release_date, "%d/%m/%y" if len(release_date.split("/")[-1]) == 2 else "%d/%m/%Y").date().isoformat()

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.zoomOut(50, 0)
        load_movie_listing(self, COMING_SOON_CARD_SELECTOR)

        for film_card in self.elements(COMING_SOON_CARD_SELECTOR):
            movie_id = film_card.get_attribute("id").split("__")[-1]
            self.hebrew_hrefs.append(f"https://www.cinema-city.co.il/movie/{movie_id}")

        for href in self.hebrew_hrefs:
            self.driver.get(href)
            if urlsplit(self.driver.current_url).path.rstrip('/') != urlsplit(href).path:
                raise ValueError(f'Cinema City redirected away from a discovered movie: {href}')
            self.hebrew_title = self.waitForElement("main h1").get_attribute("textContent").strip()
            if "מדובב לרוסית" in self.hebrew_title or "בתרגום לרוסית" in self.hebrew_title or "מדובב לצרפתית" in self.hebrew_title or "בתרגום לצרפתית" in self.hebrew_title or "מתורגם לצרפתית" in self.hebrew_title or "מתורגם לרוסית" in self.hebrew_title or "סינמה קידס" in self.hebrew_title or "cook" in self.hebrew_title.lower() or "מדובב" in self.hebrew_title or "hfr" in self.hebrew_title.lower():
                continue
            elif "תלת מימד" in self.hebrew_title:
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*תלת מימד\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            elif "אנגלית" in self.hebrew_title:
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*אנגלית\s*[-–—־]?\s*", "", self.hebrew_title).strip()

            self.english_title = self.waitForElement("#comp-mkb98jrw").get_attribute("textContent").replace("\u200b", "").strip() or self.hebrew_title
            self.runtime = self.tryExceptNone(lambda: int(re.sub(r"\D", "", self.waitForElement("#comp-mkbdaczu").get_attribute("textContent"))))
            self.rating = self.waitForElement("#comp-mkbdcdtv").get_attribute("textContent").split(":", 1)[-1].strip()

            release_date = self.waitForElement("#comp-mkbdbb73").get_attribute("textContent").split(":", 1)[-1].strip()
            self.release_date = self.parseReleaseDate(release_date)

            self.appendToGatheringInfo()
