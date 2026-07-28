from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime
import re


class HAIFtheque(BaseCinema):
    CINEMA_NAME = "Haifa Cinematheque"
    SCREENING_CITY = "Haifa"
    URL = "https://www.haifacin.co.il/Events/trom/%D7%AA%D7%95%D7%9B%D7%A0%D7%99%D7%AA_%D7%94%D7%97%D7%95%D7%93%D7%A9"

    def logic(self):
        self.sleep(4)

        for _ in range(10):
            film_count = len(self.driver.find_elements("xpath", "//*[@id='portfoliolist']/div"))
            self.driver.execute_script("window.scrollTo(0, 0);")
            self.sleep(0.25)
            ajax_fetcher = self.driver.find_element("id", "ajaxFetcher")
            self.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", ajax_fetcher)
            self.sleep(2.5)
            if len(self.driver.find_elements("xpath", "//*[@id='portfoliolist']/div")) == film_count:
                break

        for film_card in range(1, self.lenElements("//*[@id='portfoliolist']/div") + 1):
            self.hebrew_hrefs.append(self.element(f"//*[@id='portfoliolist']/div[{film_card}]//a[contains(@class, 'ethos-more')]").get_attribute("href"))
        for href in self.hebrew_hrefs:
            self.driver.get(href)
            self.sleep(0.25)
            self.english_title = self.element("//div[contains(@class, 'slide_info_event')]//div[contains(@class, 'slide_content')]").text.strip()
            self.hebrew_title = self.element("//div[contains(@class, 'slide_info_event')]//h1[contains(@class, 'slide_title')]").text.strip()
            self.english_href = self.element("//section[contains(@class, 'event-info')]//a[contains(@class, 'ticketsPopup')]").get_attribute("href")
            self.hebrew_href = self.english_href
            self.showtime = self.element("//div[contains(@class, 'event-details-time')]").text.strip()
            date_of_showing = self.element("//div[contains(@class, 'event-details-date')]").text.strip().split(",")[1].strip()
            self.date_of_showing = datetime.strptime(date_of_showing, "%d.%m.%y").date().isoformat()
            
            self.screening_city = self.SCREENING_CITY
            self.screening_type = "Regular"
            self.screening_tech = "2D"

            try:
                release_year = self.element("//div[contains(@class, 'event-details-content')]/strong[1]").text.strip()
            except:
                continue
            self.release_year = self.tryExceptNone(lambda: int(re.search(r"\b(\d{4})\b", release_year).group(1)))

            self.appendToGatheringInfo()
