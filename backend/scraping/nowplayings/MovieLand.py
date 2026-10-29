from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime, date
from selenium.webdriver.common.by import By
import re


class MovieLand(BaseCinema):
    CINEMA_NAME = "MovieLand"
    URL = "https://movieland.co.il/movies"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.sleep(5)
        self.waitForVisible("#change-bg .movies-page a[poster-summary]")
        self.tryExceptPass(lambda: self.waitAndClick("#sbuzz-confirm", 2))
        self.tryExceptPass(lambda: self.waitAndClick("#gdpr-module-message > div > div > div.gdpr-content-part.gdpr-accept > a", 2))
        self.tryExceptPass(lambda: self.click("#chooseTheaterModalCenter a[data-dismiss='modal']"))

        for film_card in self.elements("#change-bg .movies-page a[poster-summary]"):
            self.hebrew_hrefs.append(film_card.get_attribute("href"))

        for href in range(len(self.hebrew_hrefs)):
            self.driver.get(self.hebrew_hrefs[href])
            self.waitForVisible("#change-bg .bg-more-b")
            hebrew_name = self.element("#change-bg > div > div:nth-child(3) > div > div.col-12.col-sm-8.col-md-8.col-lg-9 > div > div > div.bg-more-b > span:nth-child(1)").text.strip()
            self.hebrew_titles.append(hebrew_name)
            self.english_titles.append(self.element("#change-bg > div > div:nth-child(3) > div > div.col-12.col-sm-8.col-md-8.col-lg-9 > div > div > div.bg-more-b > span:nth-of-type(2)").text.strip())
            self.original_languages.append(str(self.element(f"//*[@id='change-bg']/div/div[3]/div/div[2]/div/div/div[2]/span[16]").text.split(":", 1)[-1].strip()))
            release_year = self.element(f"//*[@id='change-bg']/div/div[3]/div/div[2]/div/div/div[2]/span[15]").text
            if re.search(r"\b\d{4}\b", release_year):
                self.release_years.append(int(re.search(r"\b\d{4}\b", release_year).group(0)))
            else:
                self.release_years.append(None)
            self.ratings.append(str(self.element(f"//*[@id='change-bg']/div/div[3]/div/div[2]/div/div/div[2]/span[10]").text))
        name_to_idx = {str(name): i for i, name in enumerate(self.hebrew_titles)}

        for cinema in range(1, self.lenElements(".newnav-upper-menu a.dropdown-item[href^='/theater/']") + 1):
            self.driver.get(self.element(f".newnav-upper-menu a.dropdown-item[href^='/theater/']:nth-of-type({cinema})").get_attribute("href"))
            self.waitForVisible("#events-list .bg-choose > div")
            self.waitUntil(lambda driver: driver.execute_script("return window.jQuery && jQuery.active === 0"))
            self.zoomOut(30, 0)

            self.screening_city = self.element("#change-bg > div.container-fluid.inner-page-header > div > h1").text

            self.clickWhenReady("#events-list > div.bd-days.br-v2.nav.nav-tabs.d-flex.d-md-block.justify-content-center > div > div")
            self.waitForVisible("#events-list .datepicker-days")
            found_first_day_of_next_month = False
            for checking_month in range(1, 3):
                if checking_month == 2:
                    previous_month = self.element("#events-list .datepicker-switch").text
                    self.clickWhenReady("#events-list .datepicker-days th.next")
                    self.waitUntil(lambda driver: driver.find_element(By.CSS_SELECTOR, "#events-list .datepicker-switch").text != previous_month)

                checking_year = str(self.element("#events-list > div.bd-days.br-v2.nav.nav-tabs.d-flex.d-md-block.justify-content-center > div > div > div > div > div.datepicker-days > table > thead > tr:nth-child(2) > th.datepicker-switch").text.split()[-1])
                for week in range(1, self.lenElements(f"#events-list > div > div > div > div > div > div.datepicker-days > table > tbody > tr") + 1):
                    for day in range(1, 8):
                        if not self.element("#events-list .datepicker-days").is_displayed():
                            self.clickWhenReady("#events-list > div.bd-days.br-v2.nav.nav-tabs.d-flex.d-md-block.justify-content-center > div > div")
                        self.waitForVisible("#events-list .datepicker-days")
                        date_element = self.element(f"#events-list > div > div > div > div > div > div.datepicker-days > table > tbody > tr:nth-child({week}) > td:nth-child({day})")
                        day_test_num = date_element.text
                        if day_test_num != "1" and found_first_day_of_next_month == False and checking_month == 2:
                            continue
                        if day_test_num == "1" and found_first_day_of_next_month == False and checking_month == 2:
                            found_first_day_of_next_month = True
                        date_class_name = date_element.get_attribute("class")
                        if date_class_name == "day":
                            selected_date = date(int(checking_year), (int(self.current_month) + checking_month - 2) % 12 + 1, int(date_element.text))
                            date_element.click()
                            self.waitUntil(lambda driver: driver.execute_script("return window.jQuery && jQuery.active === 0") and driver.find_elements(By.CSS_SELECTOR, "#events-list .bg-choose > div") and ("לא נמצאו הקרנות" in driver.find_element(By.CSS_SELECTOR, "#events-list .bg-choose").text or any(re.search(r"\b0?" + str(selected_date.day) + r"\.0?" + str(selected_date.month) + r"\b", element.text) for element in driver.find_elements(By.CSS_SELECTOR, "#events-list .bg-day-c"))))

                            for film_index in range(1, self.lenElements("#events-list > div.bg-choose > div > div > div.col-12 > a") + 1):
                                elems = self.elements("#events-list > div.bg-choose > div")
                                if not elems or "לא נמצאו הקרנות" in elems[0].text:
                                    break

                                film_name = self.element(f"#events-list > div.bg-choose > div:nth-child({film_index}) > div > div.col-12 > a").text
                                checking_film = name_to_idx.get(film_name)
                                if checking_film is None:
                                    continue

                                self.english_title = self.english_titles[checking_film]
                                self.hebrew_title = self.hebrew_titles[checking_film]
                                self.release_year = self.release_years[checking_film]
                                self.rating = self.ratings[checking_film]
                                self.original_language = self.original_languages[checking_film]
                                self.dub_language = None

                                if "(מדובב)" in self.hebrew_title:
                                    self.hebrew_title = self.hebrew_title.replace("(מדובב)", "").strip()
                                    self.dub_language = "Hebrew"

                                if "3D תלת מימד HFR" in self.hebrew_title:
                                    self.screening_tech = "3D HFR"
                                    self.hebrew_title = self.hebrew_title.replace("3D תלת מימד HFR", "").strip()
                                elif "תלת מימד HFR" in self.hebrew_title:
                                    self.screening_tech = "3D HFR"
                                    self.hebrew_title = self.hebrew_title.replace("תלת מימד HFR", "").strip()
                                elif "תלת מימד" in self.hebrew_title:
                                    self.screening_tech = "3D"
                                    self.hebrew_title = self.hebrew_title.replace("תלת מימד", "").strip()
                                elif "3D תלת מימד" in self.hebrew_title:
                                    self.screening_tech = "3D"
                                    self.hebrew_title = self.hebrew_title.replace("3D תלת מימד", "").strip()
                                elif "3D" in self.hebrew_title:
                                    self.screening_tech = "3D"
                                    self.hebrew_title = self.hebrew_title.replace("3D", "").strip()
                                elif "3D HFR" in self.hebrew_title:
                                    self.screening_tech = "3D HFR"
                                    self.hebrew_title = self.hebrew_title.replace("3D HFR", "").strip()
                                elif "HFR" in self.hebrew_title:
                                    self.screening_tech = "2D HFR"
                                    self.hebrew_title = self.hebrew_title.replace("HFR", "").strip()
                                else:
                                    self.screening_tech = "2D"

                                if "3D" in self.english_title:
                                    self.english_title = self.english_title.replace("3D", "").strip()

                                full_text = self.element(f"#events-list > div.bg-choose > div:nth-child({film_index}) > div > div.col-7.col-md-8.col-lg-9.col-xl-10.px-0.right-help > div.bg-day-c").text.strip()
                                date_part = full_text.split()[-1].replace(".", "/", 1) + f"/{checking_year}"
                                self.date_of_showing = datetime.strptime(date_part, "%d/%m/%Y").date().isoformat()

                                for screening_time in range(1, self.lenElements(f"//*[@id='change-bg']/div[2]/div[1]/div/div/div/div[2]/div[4]/div[{film_index}]/div/div[3]/div[2]/div/div[2]/a") + 1):
                                    self.showtime = self.element(f"//*[@id='change-bg']/div[2]/div[1]/div/div/div/div[2]/div[4]/div[{film_index}]/div/div[3]/div[2]/div/div[2]/a[{screening_time}]/div/span").text
                                    self.english_href = self.element(f"//*[@id='change-bg']/div[2]/div[1]/div/div/div/div[2]/div[4]/div[{film_index}]/div/div[3]/div[2]/div/div[2]/a[{screening_time}]").get_attribute("href")
                                    self.hebrew_href = self.element(f"//*[@id='change-bg']/div[2]/div[1]/div/div/div/div[2]/div[4]/div[{film_index}]/div/div[3]/div[2]/div/div[2]/a[{screening_time}]").get_attribute("href")
                                    self.screening_type = "Upgrade" if self.lenElements(f"//*[@id='change-bg']/div[2]/div[1]/div/div/div/div[2]/div[4]/div[{film_index}]/div/div[3]/div[2]/div/div[2]/a[{screening_time}]/div/img", "vip") else "Regular"

                                    self.appendToGatheringInfo()
