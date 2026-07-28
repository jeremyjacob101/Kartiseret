from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime
import re


class HERZtheque(BaseCinema):
    CINEMA_NAME = "Herziliya Cinematheque"
    SCREENING_CITY = "Herziliya"
    URL = "https://www.hcinema.org.il/"

    def logic(self):
        self.sleep(2)

        seen_first_zero = False
        film_cards = self.elements("//*[@id='movie-screenings']//div[@data-post-id]")
        for idx, film_card in enumerate(film_cards):
            slick_index = film_card.get_attribute("data-swiper-slide-index")
            if slick_index == "0":
                if seen_first_zero:
                    break
                seen_first_zero = True
            if not seen_first_zero:
                continue

            self.hebrew_hrefs.append(self.element(f"//*[@id='movie-screenings']//div[@data-post-id][{idx + 1}]//a[contains(@class, 'jet-listing-dynamic-link__link')]").get_attribute("href"))
            full_info = self.element(f"//*[@id='movie-screenings']//div[@data-post-id][{idx + 1}]//div[contains(@class, 'jet-listing-dynamic-field__content') and not(*) and contains(., '/') and contains(., ':')]").get_attribute("innerText").strip()
            date_part, time_part = full_info.split(" ", 1)
            self.date_of_showings.append(date_part)
            self.showtimes.append(time_part)

        for idx, href in enumerate(self.hebrew_hrefs):
            self.driver.get(href)
            self.sleep(0.2)

            try:
                self.english_title = self.element("//*[@data-elementor-type='single-post']/div/div/div[1]/div[2]//h3").text.strip()
            except:
                continue
            self.hebrew_title = self.element("//*[@data-elementor-type='single-post']//h1[contains(@class, 'elementor-heading-title')]").text.strip()
            if not re.search(r"[A-Za-z]", self.english_title):
                self.english_title = self.hebrew_title
            if "(שלישי זהב)" in self.hebrew_title:
                self.hebrew_title = str(self.hebrew_title.replace("(שלישי זהב)", "").strip())
            if "(ללא תשלום למנויים)" in self.hebrew_title:
                self.hebrew_title = str(self.hebrew_title.replace("(ללא תשלום למנויים)", "").strip())
            if "(ללא תוספת למנויים)" in self.hebrew_title:
                self.hebrew_title = str(self.hebrew_title.replace("(ללא תוספת למנויים)", "").strip())
            if "+ הרצאה" in self.hebrew_title:
                self.hebrew_title = str(self.hebrew_title.split("+ הרצאה")[0].strip())
            if "+ שיחה" in self.hebrew_title:
                self.hebrew_title = str(self.hebrew_title.split("+ שיחה")[0].strip())
            dub_check = self.element("//*[@data-elementor-type='single-post']").text
            if "דיבוב עברי" in dub_check or "דיבוב" in self.hebrew_title:
                self.dub_language = "Hebrew"
            else:
                self.dub_language = None
            dub_part = self.hebrew_title.rfind("– דיבוב")
            if dub_part != -1:
                self.hebrew_title = self.hebrew_title[:dub_part].strip()

            dub_part = self.hebrew_title.rfind("– אנגלית")
            if dub_part != -1:
                self.hebrew_title = self.hebrew_title[:dub_part].strip()

            release_year = re.search(r"\b(\d{4})\b", self.element("//*[@data-elementor-type='single-post']").text)
            if release_year:
                self.release_year = release_year.group(1)
            runtime = re.search(r"(\d+)\s*דק׳", self.element("//*[@data-elementor-type='single-post']").text)
            if runtime:
                self.runtime = int(runtime.group(1))

            self.date_of_showing = datetime.strptime(self.date_of_showings[idx], "%d/%m/%Y").date().isoformat()
            self.showtime = self.showtimes[idx]

            self.hebrew_href = self.element("//*[@data-elementor-type='single-post']//a[contains(@href, 'smarticket')]").get_attribute("href")
            self.english_href = self.hebrew_href

            self.screening_city = self.SCREENING_CITY
            self.screening_type = "Regular"
            self.screening_tech = "2D"

            self.appendToGatheringInfo()
