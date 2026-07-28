from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime
import re


class JAFCtheque(BaseCinema):
    CINEMA_NAME = "Jaffa Cinema"
    SCREENING_CITY = "Jaffa"
    URL = "https://www.jaffacinema.com/"

    def logic(self):
        self.sleep(2)

        for hebrew_film_block in range(1, self.lenElements("//div[contains(@class, 'jaffa-movies')]/article[contains(@class, 'jaffa-movie-card')]") + 1):
            hebrew_title = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{hebrew_film_block}]//h2[contains(@class, 'jaffa-movie-card__title')]").text.strip()
            self.hebrew_titles.append(re.sub(r"[\s\-\u2013\u2014]*(?:(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles)|(?:eng(?:lish)?|heb(?:rew)?)\s*(?:\+|&|/|and)\s*(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles))[\s\-\u2013\u2014]*$", "", hebrew_title, flags=re.I))

        self.driver.get("https://www.jaffacinema.com/en/main/")
        self.sleep(2)
        for film_block in range(1, self.lenElements("//div[contains(@class, 'jaffa-movies')]/article[contains(@class, 'jaffa-movie-card')]") + 1):
            english_title = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//h2[contains(@class, 'jaffa-movie-card__title')]").text.strip()
            self.english_title = re.sub(r"[\s\-\u2013\u2014]*(?:(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles)|(?:eng(?:lish)?|heb(?:rew)?)\s*(?:\+|&|/|and)\s*(?:eng(?:lish)?|heb(?:rew)?)\s*(?:subs|subtitles))[\s\-\u2013\u2014]*$", "", english_title, flags=re.I)
            self.hebrew_title = self.hebrew_titles[film_block - 1]

            run_director_info = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]").get_attribute("textContent").strip().split("\n")[0].strip()

            parts = [p.strip() for p in run_director_info.split("|")]
            runtime_part = parts[0]
            director_part = parts[1] if len(parts) > 1 else ""

            if "," in director_part:
                director_part = director_part.split(",")[0].strip()
            minutes, hours = 0, 0
            if re.match(r"^\d+\s*h", runtime_part.strip()):
                hours_str = runtime_part.strip().split("h")[0].strip()
                hours = int(hours_str)
                runtime_part = runtime_part.strip().split("h")[1].strip()
            if re.match(r"^\d+\s*m", runtime_part.strip()):
                minutes_str = runtime_part.strip().replace("m", "").strip()
                minutes = int(minutes_str)

            self.runtime = hours * 60 + minutes
            self.directed_by = director_part

            xpaths = {
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]": "content",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]/p[1]/strong": "strip",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]//p[1]/strong": "strip",
                f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//div[contains(@class, 'jaffa-movie-card__desc-inner')]//p[1]": "content",
            }

            for xpath, mode in xpaths.items():
                try:
                    if mode == "strip":
                        release_year = self.element(xpath).text.strip()
                    elif mode == "content":
                        release_year = self.element(xpath).get_attribute("textContent")
                    break
                except:
                    continue

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
                self.hebrew_href = self.element(f"//div[contains(@class, 'jaffa-movies')]/article[{film_block}]//a[contains(@class, 'jaffa-movie-card__screening')][{idx + 1}]").get_attribute("href")
                self.screening_city = self.SCREENING_CITY
                self.screening_type = "Regular"
                self.screening_tech = "2D"

                self.appendToGatheringInfo()
