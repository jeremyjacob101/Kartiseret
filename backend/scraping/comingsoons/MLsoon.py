from backend.scraping.BaseCinema import BaseCinema
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC

from datetime import datetime
import re


class MLsoon(BaseCinema):
    CINEMA_NAME = "MovieLand"
    URL = "https://www.movieland.co.il/soon"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.waitForVisible("#soonContainer a[poster-summary]")
        self.tryExceptPass(lambda: self.click("#sbuzz-confirm"))
        self.tryExceptPass(lambda: self.click("#gdpr-module-message .gdpr-accept > a"))
        theater_modals = self.elements("#chooseTheaterModalCenter")
        if theater_modals and theater_modals[0].is_displayed():
            self.clickWhenReady("#chooseTheaterModalCenter a[data-dismiss='modal']")
            self.waitUntil(EC.invisibility_of_element_located((By.ID, "chooseTheaterModalCenter")))

        for film_card in self.elements("#soonContainer a[poster-summary]"):
            self.english_hrefs.append(film_card.get_attribute("href"))
        for href in self.english_hrefs:
            self.driver.get(href)
            self.waitForVisible("#change-bg .bg-more-b")
            self.runtime, self.release_year, self.original_language = None, None, None

            if "IsLtr" in self.element("#change-bg .bg-synops").get_attribute("className"):
                continue

            self.hebrew_title = self.element("#change-bg .bg-more-b > span:nth-of-type(1)").text.strip()
            if "(מדובב)" in self.hebrew_title:
                continue
            if "3D" in self.hebrew_title:
                self.hebrew_title = self.hebrew_title.replace("3D", "").strip()
            if "HFR" in self.hebrew_title:
                self.hebrew_title = self.hebrew_title.replace("HFR", "").strip()
            if "תלת מימד" in self.hebrew_title:
                self.hebrew_title = self.hebrew_title.replace("תלת מימד", "").strip()

            self.english_title = self.element("#change-bg .bg-more-b > span:nth-of-type(2)").text.strip()
            if "3D" in self.english_title:
                self.english_title = self.english_title.replace("3D", "").strip()
            if "HFR" in self.english_title:
                self.english_title = self.english_title.replace("HFR", "").strip()
            if not self.english_title:
                self.english_title = self.hebrew_title

            release_date = self.element("#change-bg .bg-more-b > span:nth-of-type(4)").text.strip()
            self.release_date = datetime.strptime(release_date, "%d/%m/%Y").date().isoformat()

            self.rating = self.element("#change-bg .bg-more-b > span:nth-of-type(10)").text.strip()
            runtime = self.element("#change-bg .bg-more-b > span:nth-of-type(13)").text.strip()
            runtime = re.sub(r"\D", "", runtime)
            if runtime and runtime.isdigit():
                self.runtime = runtime

            release_year = self.element("#change-bg .bg-more-b > span:nth-of-type(15)").text.strip()
            if release_year and release_year.isdigit():
                self.release_year = release_year
            original_language = self.element("#change-bg .bg-more-b > span:nth-of-type(16)").text.strip()
            if original_language != "יעודכן בקרוב":
                self.original_language = original_language.split(":", 1)[1].strip()

            self.appendToGatheringInfo()
