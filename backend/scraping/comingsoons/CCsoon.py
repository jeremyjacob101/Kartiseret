from backend.scraping.BaseCinema import BaseCinema
from selenium.webdriver.common.by import By

from datetime import datetime
import re


class CCsoon(BaseCinema):
    CINEMA_NAME = "Cinema City"
    URL = "https://www.cinema-city.co.il/movie-categories/coming-soon"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.zoomOut(50, 0)
        self.waitForElement("[id^='comp-mrjafvop__']")

        while self.lenElements("//button[normalize-space()='תראו לי עוד סרטים']"):
            more_button = self.element("//button[normalize-space()='תראו לי עוד סרטים']")
            if not more_button.is_displayed():
                break
            film_count = self.lenElements("[id^='comp-mrjafvop__']")
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", more_button)
            self.clickWhenReady("//button[normalize-space()='תראו לי עוד סרטים']")
            self.waitUntil(lambda driver: len(driver.find_elements(By.CSS_SELECTOR, "[id^='comp-mrjafvop__']")) > film_count)

        for film_card in self.elements("[id^='comp-mrjafvop__']"):
            movie_id = film_card.get_attribute("id").split("__")[-1]
            self.hebrew_hrefs.append(f"https://www.cinema-city.co.il/movie/{movie_id}")

        for href in self.hebrew_hrefs:
            self.driver.get(href)
            if "/movie/" not in self.driver.current_url:
                continue
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

            release_date = self.waitForElement("#comp-mkbdbb73").get_attribute("textContent").split(":", 1)[-1].strip().replace(".", "/")
            self.release_date = self.tryExceptNone(lambda: datetime.strptime(release_date, "%d/%m/%y" if len(release_date.split("/")[-1]) == 2 else "%d/%m/%Y").date().isoformat())

            self.appendToGatheringInfo()
