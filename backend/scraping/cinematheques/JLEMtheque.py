from backend.scraping.BaseCinema import BaseCinema

from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from datetime import datetime, timedelta


class JLEMtheque(BaseCinema):
    CINEMA_NAME = "Jerusalem Cinematheque"
    SCREENING_CITY = "Jerusalem"
    URL = "https://jer-cin.org.il/en/article/4284"
    DAYS = 45

    def logic(self):
        self.sleep(3)
        date_selector = "//div[contains(@class, 'calenders-filter-date')]/p"

        date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
        WebDriverWait(self.driver, 10).until(EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading")))
        self.click("//ul[contains(@class, 'language-switcher-locale-url')]/li/a")
        WebDriverWait(self.driver, 10).until(lambda driver: date_of_showing in driver.find_element(By.XPATH, date_selector).text)

        self.hebrew_titles = {}
        for day in range(self.DAYS):
            if day:
                selected_date = (self.today_date + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
                selected_date_timestamp = str(int(selected_date.timestamp()))
                calendar_url = self.driver.current_url

                for _ in range(3):
                    try:
                        self.jsClick(f"//*[@id='calender-filter']/p/span[contains(@class, 'filter-date') and text()='{selected_date_timestamp}']/..")
                        WebDriverWait(self.driver, 10).until(lambda driver: selected_date.strftime("%d.%m.%y") in driver.find_element(By.XPATH, date_selector).text)
                        break
                    except:
                        self.tryExceptPass(lambda: self.driver.get(calendar_url))
                        self.sleep(3)
                else:
                    raise TimeoutError(f"Could not load Jerusalem Cinematheque date {selected_date.date().isoformat()}")

            date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
            self.date_of_showing = datetime.strptime(date_of_showing, "%d.%m.%y").date().isoformat()

            for hebrew_film_block in range(2, self.lenElements("//div[contains(@class, 'calendar-full-container')]/div", "lobby-container") + 2):
                try:
                    no_screenings_check = self.element(f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]").text.strip()
                    if "אין הקרנות" in no_screenings_check:
                        continue
                except:
                    pass
                title_link = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]/a")
                hebrew_title = title_link[0].text.strip() if title_link else self.tryExceptNone(lambda: self.element(f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]").text.strip())
                purchase_button = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{hebrew_film_block}]//button[contains(@class, 'toptix-purchase')]")
                event_id = purchase_button[0].get_attribute("data-event-id") if purchase_button else None
                self.hebrew_titles[(self.date_of_showing, event_id)] = hebrew_title

        WebDriverWait(self.driver, 10).until(EC.invisibility_of_element_located((By.CSS_SELECTOR, ".load-inner.loading")))
        self.click("//ul[contains(@class, 'language-switcher-locale-url')]/li/a")
        WebDriverWait(self.driver, 10).until(lambda driver: date_of_showing in driver.find_element(By.XPATH, date_selector).text)

        for day in range(self.DAYS):
            selected_date = (self.today_date + timedelta(days=day)).replace(hour=0, minute=0, second=0, microsecond=0)
            selected_date_timestamp = str(int(selected_date.timestamp()))
            calendar_url = self.driver.current_url

            for _ in range(3):
                try:
                    self.jsClick(f"//*[@id='calender-filter']/p/span[contains(@class, 'filter-date') and text()='{selected_date_timestamp}']/..")
                    WebDriverWait(self.driver, 10).until(lambda driver: selected_date.strftime("%d.%m.%y") in driver.find_element(By.XPATH, date_selector).text)
                    break
                except:
                    self.tryExceptPass(lambda: self.driver.get(calendar_url))
                    self.sleep(3)
            else:
                raise TimeoutError(f"Could not load Jerusalem Cinematheque date {selected_date.date().isoformat()}")

            date_of_showing = self.element(date_selector).text.strip().split("|")[1].strip()
            self.date_of_showing = datetime.strptime(date_of_showing, "%d.%m.%y").date().isoformat()

            for film_block in range(2, self.lenElements("//div[contains(@class, 'calendar-full-container')]/div", "lobby-container") + 2):
                try:
                    no_screenings_check = self.element(f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]").text.strip()
                    if "No Screenings" in no_screenings_check:
                        continue
                except:
                    pass
                try:
                    title_link = self.driver.find_elements("xpath", f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]/a")
                    self.english_title = title_link[0].text.strip() if title_link else self.element(f"//div[contains(@class, 'calendar-full-container')]/div[{film_block}]//div[contains(@class, 'lobby-title') and contains(@class, 'second')]").text.strip()
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
