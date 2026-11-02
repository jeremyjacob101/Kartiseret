from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime
import re


class JAFCtheque(BaseCinema):
    CINEMA_NAME = "Jaffa Cinema"
    SCREENING_CITY = "Jaffa"
    URL = "https://www.jaffacinema.com/"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.waitForVisible(".jaffa-movies .jaffa-movie-card__title")

        self.hebrew_titles = {}
        self.hebrew_hrefs = {}
        for hebrew_film_block in range(1, self.lenElements("//div[contains(@class, 'jaffa-movies')]/article[contains(@class, 'jaffa-movie-card')]") + 1):
            hebrew_title = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{hebrew_film_block}]//h2[contains(@class, 'jaffa-movie-card__title')]").text.strip()
            movie_id = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{hebrew_film_block}]").get_attribute("data-movie-id")
            if movie_id:
                self.hebrew_titles[movie_id] = re.sub(r"[\s\-\u2013\u2014]*(?:(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles)|(?:eng(?:lish)?|heb(?:rew)?)\s*(?:\+|&|/|and)\s*(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles))[\s\-\u2013\u2014]*$", "", hebrew_title, flags=re.I)

            for screening in self.elements(f"//div[contains(@class, 'jaffa-movies')]/article[{hebrew_film_block}]//a[contains(@class, 'jaffa-movie-card__screening')]"):
                date_and_time = re.search(r"(\d{1,2})/(\d{1,2}).*?(\d{1,2}:\d{2})", " ".join(screening.text.split()))
                if movie_id and date_and_time:
                    dd, mm, showtime = date_and_time.groups()
                    self.hebrew_hrefs[(movie_id, int(dd), int(mm), showtime.zfill(5))] = screening.get_attribute("href")

        self.driver.get("https://www.jaffacinema.com/en/main/")
        self.waitForVisible(".jaffa-movies .jaffa-movie-card__title")
        for film_block in range(1, self.lenElements("//div[contains(@class, 'jaffa-movies')]/article[contains(@class, 'jaffa-movie-card')]") + 1):
            english_title = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//h2[contains(@class, 'jaffa-movie-card__title')]").text.strip()
            self.english_title = re.sub(r"[\s\-\u2013\u2014]*(?:(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles)|(?:eng(?:lish)?|heb(?:rew)?)\s*(?:\+|&|/|and)\s*(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles))[\s\-\u2013\u2014]*$", "", english_title, flags=re.I)
            movie_id = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]").get_attribute("data-movie-id")
            self.hebrew_title = self.hebrew_titles.get(movie_id)

            runtime_elements = self.elements(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//span[contains(@class, 'jaffa-movie-card__meta-item') and span[normalize-space()='Running time:']]/span[last()]")
            director_elements = self.elements(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//span[contains(@class, 'jaffa-movie-card__meta-item') and span[normalize-space()='Director:']]/span[last()]")
            runtime_part = runtime_elements[0].text.strip() if runtime_elements else ""
            director_part = director_elements[0].text.strip() if director_elements else ""

            if "," in director_part:
                director_part = director_part.split(",")[0].strip()
            hours = re.search(r"(\d+)\s*h", runtime_part)
            minutes = re.search(r"(\d+)\s*m", runtime_part)
            self.runtime = self.ifElseNone(hours or minutes, (int(hours.group(1)) if hours else 0) * 60 + (int(minutes.group(1)) if minutes else 0))
            self.directed_by = director_part

            xpaths = {
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]": "content",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]/p[1]/strong": "strip",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]//p[1]/strong": "strip",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]//p[1]": "content",
            }

            release_year = None
            for xpath, mode in xpaths.items():
                year_elements = self.elements(xpath)
                if not year_elements:
                    continue
                if mode == "strip":
                    release_year = year_elements[0].text.strip()
                elif mode == "content":
                    release_year = year_elements[0].get_attribute("textContent")
                break

            self.release_year = self.tryExceptNone(lambda: int(re.search(r"\b(\d{4})\b", release_year).group(1)))

            showtime_strings = []
            screenings_text = self.driver.find_elements("xpath", f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__screenings')]/p")
            if screenings_text:
                showtime_strings.append(screenings_text[0].text.strip())
            else:
                for showdate in range(1, self.lenElements(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//a[contains(@class, 'jaffa-movie-card__screening')]/span[contains(@class, 'jaffa-movie-card__date-link')]") + 1):
                    showtime_strings.append(self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//a[contains(@class, 'jaffa-movie-card__screening')][{showdate}]/span[contains(@class, 'jaffa-movie-card__date-link')]").text.strip())

            crossed_year = False
            trying_year = self.current_year
            for idx, showtime_string in enumerate(showtime_strings):
                left_info, right_info = [p.strip() for p in showtime_string.split(",", 1)]
                dd, mm = [p.strip() for p in left_info.split("/", 1)]
                if self.current_month == "12" and not crossed_year and (str(mm) == "1" or str(mm) == "01"):
                    crossed_year = True
                    trying_year = str(int(trying_year) + 1)
                yyyy = str(trying_year)
                date_of_showing = f"{str(dd)}/{str(mm)}" + f"/{yyyy}"
                self.date_of_showing = datetime.strptime(date_of_showing, "%d/%m/%Y").date().isoformat()
                self.showtime = str(right_info.split(" ")[1])

                self.english_href = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//a[contains(@class, 'jaffa-movie-card__screening')][{idx + 1}]").get_attribute("href")
                self.hebrew_href = self.hebrew_hrefs.get((movie_id, int(dd), int(mm), self.showtime.zfill(5)), self.english_href)
                self.screening_city = self.SCREENING_CITY
                self.screening_type = "Regular"
                self.screening_tech = "2D"

                self.appendToGatheringInfo()
