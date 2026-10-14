from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime
import re


class LCsoon(BaseCinema):
    CINEMA_NAME = "Lev Cinema"
    URL = "https://www.lev.co.il/en/"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.clickWhenReady("li[data-tab='tab-2']")
        self.waitForVisible("#tab-2 .movieLink")
        for film_card in range(1, self.lenElements("//*[@id='tab-2']//li[contains(@class, 'featureItems')]") + 1):
            self.english_hrefs.append(self.element(f"//*[@id='tab-2']//li[contains(@class, 'featureItems')][{film_card}]/div/a[1]").get_attribute("href"))

            release_date_elements = self.elements(f"//*[@id='tab-2']//li[contains(@class, 'featureItems')][{film_card}]/div/a[1]//div[contains(@class, 'datestarted')]")
            release_date = release_date_elements[0].text if release_date_elements else ""
            self.release_dates.append(self.tryExceptNone(lambda: datetime.strptime(release_date.split(":", 1)[1].strip(), "%d/%m/%Y").date().isoformat()))

        for idx, href in enumerate(self.english_hrefs):
            hebrew_href = str(href).replace("/en", "")
            self.driver.get(hebrew_href)
            self.waitForElement("#content .movie_title h1")

            self.hebrew_title = self.element("#content .movie_title h1").text.strip()
            if self.hebrew_title.endswith("אנגלית"):
                self.hebrew_title = self.hebrew_title[: -len("אנגלית")].rstrip()

            self.driver.get(href)
            self.waitForElement("#content .movie_title h1")

            self.release_date = self.release_dates[idx]

            self.english_title = str(self.element("#content .movie_title h1").text).strip() or self.hebrew_title
            if "dubbed" in self.english_title.lower() or "dubbded" in self.english_title.lower():
                continue

            self.release_year = self.element("#content .allwithline > div:nth-of-type(1)").text
            self.release_year = int(m.group(0)) if (m := re.search(r"\b(19|20)\d{2}\b", self.release_year)) else None

            self.original_language = self.element("#content .allwithline > div:nth-of-type(2)").text
            self.original_language = str(m.group(1)) if (m := re.search(r"^\s*([A-Za-z]+)", self.original_language)) else "Hebrew"

            self.rating = self.element("#content .movie_age").text
            self.rating = str(self.rating.split(":", 1)[1].strip()) if self.rating else "All"

            runtime = self.element("#content .allwithline > div:nth-of-type(3)").text
            self.runtime = runtime if runtime and runtime.isdigit() else None

            self.appendToGatheringInfo()
