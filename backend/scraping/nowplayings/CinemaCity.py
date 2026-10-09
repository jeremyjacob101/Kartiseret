from backend.scraping.BaseCinema import BaseCinema
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

from datetime import datetime
import json, re


class CinemaCity(BaseCinema):
    CINEMA_NAME = "Cinema City"
    URL = "https://www.cinema-city.co.il/"

    def logic(self):
        self.sleep(3)
        self.zoomOut(50)
        self.element("[id^='comp-mpkxxq0h__']")

        while self.lenElements("//button[normalize-space()='תראו לי עוד סרטים']"):
            more_button = self.element("//button[normalize-space()='תראו לי עוד סרטים']")
            if not more_button.is_displayed():
                break
            film_count = self.lenElements("[id^='comp-mpkxxq0h__']")
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", more_button)
            self.sleep(0.5)
            self.click("//button[normalize-space()='תראו לי עוד סרטים']", 0.5)
            WebDriverWait(self.driver, 15).until(lambda driver: self.lenElements("[id^='comp-mpkxxq0h__']") > film_count)

        for film_card in self.elements("[id^='comp-mpkxxq0h__']"):
            movie_id = film_card.get_attribute("id").split("__")[-1]
            self.hebrew_hrefs.append(f"https://www.cinema-city.co.il/movie/{movie_id}")

        cinema_selector = "#collection_comp-mpo0742y"
        showtype_selector = "#collection_comp-mpo07eyp7"
        date_selector = "#collection_comp-mpo07wn0"
        time_selector = "#collection_comp-mpo08j2i"

        for href in self.hebrew_hrefs:
            self.driver.get(href)
            self.sleep(0.5)
            if "/movie/" not in self.driver.current_url:
                continue
            self.zoomOut(50)

            self.hebrew_title = self.element("main h1").get_attribute("textContent").strip()
            self.english_title = self.element("#comp-mkb98jrw").get_attribute("textContent").replace("\u200b", "").strip() or self.hebrew_title
            self.runtime = self.tryExceptNone(lambda: int(re.sub(r"\D", "", self.element("#comp-mkbdaczu").get_attribute("textContent"))))
            self.rating = self.element("#comp-mkbdcdtv").get_attribute("textContent").split(":", 1)[-1].strip()

            self.dub_language = None
            if "מדובב לרוסית" in self.hebrew_title or "בתרגום לצרפתית" in self.hebrew_title or "בתרגום לרוסית" in self.hebrew_title or "מתורגם לצרפתית" in self.hebrew_title or "מתורגם לרוסית" in self.hebrew_title:
                continue
            elif "מדובב לצרפתית" in self.hebrew_title:
                self.dub_language = "French"
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*מדובב לצרפתית\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            elif "מדובב" in self.hebrew_title:
                self.dub_language = "Hebrew"
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*מדובב\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            elif "אנגלית" in self.hebrew_title:
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*אנגלית\s*[-–—־]?\s*", "", self.hebrew_title).strip()

            if "HFR תלת מימד" in self.hebrew_title:
                tech_prefix = "3D HFR"
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*HFR תלת מימד\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            elif "HFR" in self.hebrew_title:
                tech_prefix = "2D HFR"
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*HFR\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            elif "תלת מימד" in self.hebrew_title:
                tech_prefix = "3D"
                self.hebrew_title = re.sub(r"\s*[-–—־]?\s*תלת מימד\s*[-–—־]?\s*", "", self.hebrew_title).strip()
            else:
                tech_prefix = "2D"

            self.click(cinema_selector, 0.5)
            WebDriverWait(self.driver, 15).until(lambda driver: self.lenElements(cinema_selector + ' option:not([value=""])') or not self.element(cinema_selector).is_enabled())
            if not self.element(cinema_selector).is_enabled():
                continue
            self.element(cinema_selector).send_keys(Keys.ESCAPE)
            seen_event_ids = set()

            for cinema in range(self.lenElements(cinema_selector + ' option:not([value=""])')):
                self.element(cinema_selector).send_keys(Keys.ENTER)
                self.screening_city = self.element(f"#menuitem-{cinema}").get_attribute("textContent").strip()
                self.jsClick(f"#menuitem-{cinema}", 0.3)
                WebDriverWait(self.driver, 15).until(lambda driver: self.element(showtype_selector).is_enabled() and self.element(showtype_selector).get_attribute("value") == "" and self.lenElements(showtype_selector + ' option:not([value=""])'))

                # Regular also includes ONYX screenings; keep the specific format first.
                for showtype in range(self.lenElements(showtype_selector + ' option:not([value=""])'), 0, -1):
                    self.element(showtype_selector).send_keys(Keys.ENTER)
                    base_showtech = self.element(f"#menuitem-{showtype}").get_attribute("textContent").strip()
                    if base_showtech == "לא מוגדר":
                        base_showtech = ""
                    self.screening_type = base_showtech or None
                    self.screening_tech = f"{tech_prefix} {base_showtech}".strip()
                    self.jsClick(f"#menuitem-{showtype}", 0.3)
                    WebDriverWait(self.driver, 15).until(lambda driver: self.element(date_selector).is_enabled() and self.element(date_selector).get_attribute("value") == "" and self.lenElements(date_selector + ' option:not([value=""])'))

                    for day in range(1, self.lenElements(date_selector + ' option:not([value=""])') + 1):
                        previous_times = [option.get_attribute("value") for option in self.elements(time_selector + ' option:not([value=""])')]
                        self.element(date_selector).send_keys(Keys.ENTER)
                        date_text = self.element(f"#menuitem-{day}").get_attribute("textContent")
                        date_text = re.search(r"\d{1,2}/\d{1,2}/\d{2,4}", date_text).group()
                        self.date_of_showing = datetime.strptime(date_text, "%d/%m/%y" if len(date_text.split("/")[-1]) == 2 else "%d/%m/%Y").date().isoformat()
                        self.jsClick(f"#menuitem-{day}", 0.3)
                        WebDriverWait(self.driver, 15).until(lambda driver: self.element(time_selector).is_enabled() and self.lenElements(time_selector + ' option:not([value=""])') and [option.get_attribute("value") for option in self.elements(time_selector + ' option:not([value=""])')] != previous_times)

                        # Choosing a time opens checkout; its option already contains the event ID.
                        for time_option in self.elements(time_selector + ' option:not([value=""])'):
                            event = json.loads(time_option.get_attribute("value"))
                            self.showtime = event["time"]
                            event_id = event["externalId"]
                            if event_id in seen_event_ids:
                                continue
                            seen_event_ids.add(event_id)
                            self.english_href = f"https://tickets.cinema-city.co.il/order/{event_id}?lang=en"
                            self.hebrew_href = f"https://tickets.cinema-city.co.il/order/{event_id}?lang=he"

                            self.appendToGatheringInfo()
