from backend.scraping.BaseCinema import BaseCinema

from selenium.webdriver.common.by import By
from datetime import datetime
import json, re


class HOLONtheque(BaseCinema):
    CINEMA_NAME = "Holon Cinematheque"
    SCREENING_CITY = "Holon"
    URL = "https://www.cinemaholon.org.il/screening-and-events/"

    def logic(self):
        self.sleep(3)

        for _ in range(1, 6):
            for film_block in self.elements("//section[contains(@class, 'events-results')]//div[contains(@class, 'entry-result')]"):
                try:
                    film_block.find_element(By.XPATH, ".//div[contains(@class, 'entry-body')]")
                except:
                    continue
                for film_card in film_block.find_elements(By.XPATH, ".//div[contains(@class, 'entry-activity')]"):
                    self.hebrew_hrefs.append(film_card.find_element(By.XPATH, ".//div[contains(@class, 'entry-content')]/a[1]").get_attribute("href"))
            self.click("//section[contains(@class, 'events-calendar')]//button[contains(@class, 'next')]", 2)
        self.hebrew_hrefs = list(dict.fromkeys(self.hebrew_hrefs))

        for href in self.hebrew_hrefs:
            self.driver.get(href)
            self.zoomOut(50)

            self.hebrew_title = self.element("//div[contains(@class, 'header-image')]//h1[contains(@class, 'entry-title')]").text.strip()
            if self.lenElements("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]") == 3:
                try:
                    self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')][3]/b").text.strip()
                except:
                    self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')][3]/strong").text.strip()
            elif self.lenElements("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]") == 2:
                try:
                    self.english_title = self.element("//section[contains(@class, 'event-details')]//p[1]/strong").text.strip()
                except:
                    try:
                        self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')][2]/b").text.strip()
                    except:
                        self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')][2]").text.strip()
            elif self.lenElements("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]") == 1:
                if self.lenElements("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]/b") == 6 or self.lenElements("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]/b") == 5:
                    self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]/b[5]").text.strip()
                else:
                    try:
                        self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]/b[4]").text.strip()
                    except:
                        self.english_title = self.element("//section[contains(@class, 'event-details')]//h2[contains(@class, 'english-title')]/strong[3]").text.strip()
            else:
                self.english_title = self.hebrew_title

            self.runtime = self.tryExceptNone(lambda: int(re.findall(r"\d+", self.element("//section[contains(@class, 'event-details')]//ul[contains(@class, 'entry-details')]/li[1]/span[contains(@class, 'text')]").text)[-1]))
            self.release_year = self.tryExceptNone(lambda: re.search(r"\b\d{4}\b", self.element("//section[contains(@class, 'event-details')]//ul[contains(@class, 'entry-details')]/li[2]/span[contains(@class, 'text')]").text.strip()).group(0))

            form = self.element("//section[contains(@class, 'event-details')]//div[contains(@class, 'hide-mobile')]//form[contains(@class, 'single-buy-now-form')]")
            showings = json.loads(form.get_attribute("data-dates"))
            for showing in showings.values():
                date_of_showing, self.showtime = showing.split("GMT")
                self.date_of_showing = datetime.strptime(date_of_showing, "%Y-%m-%d").date().isoformat()
                self.hebrew_href = self.element("//section[contains(@class, 'event-details')]//div[contains(@class, 'hide-mobile')]//form[contains(@class, 'single-buy-now-form')]//a[contains(@class, 'single-buy-btn')]").get_attribute("href")
                self.english_href = self.hebrew_href
                self.screening_city = self.SCREENING_CITY
                self.screening_type = "Regular"
                self.screening_tech = "2D"

                self.appendToGatheringInfo()
