from backend.scraping.BaseCinema import BaseCinema

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import WebDriverException
from datetime import datetime, timedelta


class JLEMtheque(BaseCinema):
    CINEMA_NAME = "Jerusalem Cinematheque"
    SCREENING_CITY = "Jerusalem"
    URL = "https://jer-cin.org.il/en/article/4284"
    DAYS = 45
    date_selector = "//div[contains(@class, 'calenders-filter-date')]/p"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        date_selector = self.date_selector
        self.waitForVisible(date_selector)

        date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
        self.waitUntil(EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading")), 10)
        previous_date = self.element(date_selector)
        self.clickWhenReady("//ul[contains(@class, 'language-switcher-locale-url')]/li/a")
        self.waitForStale(previous_date)
        self.waitUntil(lambda driver: date_of_showing in driver.find_element(By.XPATH, date_selector).text and EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading"))(driver), 10)

        self.hebrew_titles = {}
        for day in range(self.DAYS):
            if day:
                selected_date = (self.today_date + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
                self.selectCalendarDate(selected_date)

            date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
            self.date_of_showing = datetime.strptime(date_of_showing, "%d.%m.%y").date().isoformat()

            for hebrew_film_block in range(2, self.lenElements("//div[contains(@class, 'calendar-full-container')]/div", "lobby-container") + 2):
                title_elements = self.elements(f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]")
                if title_elements and "אין הקרנות" in title_elements[0].text:
                    continue
                title_link = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]/a")
                hebrew_title = title_link[0].text.strip() if title_link else title_elements[0].text.strip() if title_elements else None
                purchase_button = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//button[contains(@class, 'toptix-purchase')]")
                event_id = purchase_button[0].get_attribute("data-event-id") if purchase_button else None
                self.hebrew_titles[(self.date_of_showing, event_id)] = hebrew_title

        self.waitUntil(EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading")), 10)
        previous_date = self.element(date_selector)
        self.clickWhenReady("//ul[contains(@class, 'language-switcher-locale-url')]/li/a")
        self.waitForStale(previous_date)
        self.waitUntil(lambda driver: date_of_showing in driver.find_element(By.XPATH, date_selector).text and EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading"))(driver), 10)

        self._confirmed_empty_dates = set()
        for day in range(self.DAYS):
            selected_date = (self.today_date + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
            self.selectCalendarDate(selected_date)

            date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
            self.date_of_showing = datetime.strptime(date_of_showing, "%d.%m.%y").date().isoformat()
            calendar_text = self.element("//div[contains(@class, 'calendar-full-container')]").text
            if "No Screenings" in calendar_text or "אין הקרנות" in calendar_text:
                self._confirmed_empty_dates.add(self.date_of_showing)

            for film_block in range(2, self.lenElements("//div[contains(@class, 'calendar-full-container')]/div", "lobby-container") + 2):
                title_elements = self.elements(f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]")
                if not title_elements or "No Screenings" in title_elements[0].text:
                    continue
                try:
                    title_link = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]/a")
                    self.english_title = title_link[0].text.strip() if title_link else title_elements[0].text.strip()
                    purchase_button = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//button[contains(@class, 'toptix-purchase')]")
                    event_id = purchase_button[0].get_attribute("data-event-id") if purchase_button else None
                    self.hebrew_title = self.hebrew_titles.get((self.date_of_showing, event_id))
                    self.showtime = self.element(f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'ticket-details')]//div[contains(@class, 'time')]").text.strip()
                    hall = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//span[contains(@class, 'cal-hall')]")
                    length = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//span[contains(@class, 'cal-length')]")
                    if not hall or not length:
                        continue
                    self.directed_by = hall[0].text.strip().split(":")[1].strip()
                    self.runtime = length[0].text.strip().split(" ")[0].strip()
                    if purchase_button:
                        self.english_href = purchase_button[0].get_attribute("data-url")
                    else:
                        image_link = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//a[contains(@class, 'link-image')]")
                        if not image_link:
                            continue
                        self.english_href = image_link[0].get_attribute("href")
                    self.hebrew_href = self.english_href.replace("lang=en", "lang=he")
                    self.screening_city = self.SCREENING_CITY
                    self.screening_type = "Regular"
                    self.screening_tech = "2D"
                except:
                    continue

                self.appendToGatheringInfo()

        if not any(self.gathering_info.values()) and len(getattr(self, "_confirmed_empty_dates", set())) == self.DAYS:
            self.confirmEmptySnapshot(f"Explicit no-screenings state confirmed for all {self.DAYS} calendar dates")

    def selectCalendarDate(self, selected_date):
        expected_date = selected_date.strftime("%d.%m.%y")
        if expected_date in self.element(self.date_selector).text:
            self.waitUntil(EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading")), 10)
            return
        selected_date_timestamp = str(int(selected_date.timestamp()))
        calendar_url = self.driver.current_url

        for _ in range(3):
            try:
                previous_date = self.waitForElement(self.date_selector)
                self.jsClick(f"//*[@id='calender-filter']/p/span[contains(@class, 'filter-date') and text()='{selected_date_timestamp}']/..", 0)
                self.waitForStale(previous_date)
                self.waitUntil(lambda driver: expected_date in driver.find_element(By.XPATH, self.date_selector).text and EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading"))(driver), 10)
                return
            except WebDriverException:
                self.driver.get(calendar_url)
                self.waitForVisible(self.date_selector)
        raise TimeoutError(f"Could not load Jerusalem Cinematheque date {selected_date.date().isoformat()}")
