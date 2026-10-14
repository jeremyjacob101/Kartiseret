from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.QuickbookHelpers import QuickbookHelpers
from selenium.webdriver.common.by import By

from datetime import datetime
import re


class RavHen(QuickbookHelpers, BaseCinema):
    CINEMA_NAME = "Rav Hen"
    URL = "https://www.rav-hen.co.il/#/"

    month_mapping = {"ינואר": "01", "פברואר": "02", "מרץ": "03", "אפריל": "04", "מאי": "05", "יוני": "06", "יולי": "07", "אוגוסט": "08", "ספטמבר": "09", "אוקטובר": "10", "נובמבר": "11", "דצמבר": "12"}

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.acceptQuickbookCookies()

        self.clickWhenReady("#header-select-location")
        self.clickWhenReady("body > div.modal.location-picker-modal.fade.search.in > div > div > div > div:nth-child(2) > div:nth-child(3) > div.row.all-cinemas-list > div > div > div > button")
        self.clickWhenReady(f"/html/body/div[12]/div[2]/div/ul/li[1]/a")
        self.driver.get(self.URL)
        self.waitForVisible("/html/body/div[6]/section/div[2]/div/div/div/div[2]/div/div/div/div[1]/div/a")

        for film_card in range(1, self.lenElements("/html/body/div[6]/section/div[2]/div/div/div/div[2]/div/div/div/div[1]/div") + 1):
            self.hebrew_hrefs.append(str(self.element(f"/html/body/div[6]/section/div[2]/div/div/div/div[2]/div/div/div/div[1]/div[{film_card}]/a").get_attribute("href")))

        for film_card in range(1, self.lenElements("/html/body/div[6]/section/div[4]/div/div/div/div[2]/div/div/div/div[1]/div") + 1):
            self.hebrew_hrefs.append(str(self.element(f"/html/body/div[6]/section/div[4]/div/div/div/div[2]/div/div/div/div[1]/div[{film_card}]/a").get_attribute("href")))

        for href in self.hebrew_hrefs:
            self.driver.get(href)
            self.reloadQuickbookErrorPage()
            self.waitUntil(lambda driver: driver.find_element(By.CSS_SELECTOR, "#more-info dd").get_attribute("textContent").strip())
            self.waitForResponse("/films/byDistributorCode/" + self.driver.execute_script("return window.filmDetails.id"))

            self.english_titles.append(str(self.element("/html/body/div[5]/section[1]/div/div[2]/div[1]/div/ul/li/h1").get_attribute("textContent").strip()))
            self.hebrew_titles.append(str(self.element("#more-info > div > div:nth-child(2) > div.col-md-8.col-sm-6.col-xs-12 > dl > div:nth-child(1) > dd").get_attribute("textContent").strip()))
            release_year = self.element("#more-info > div > div:nth-child(2) > div.col-md-8.col-sm-6.col-xs-12 > dl > div:nth-child(5) > dd").get_attribute("textContent").strip()
            if re.search(r"\b\d{4}\b", release_year):
                self.release_years.append(int(re.search(r"\b\d{4}\b", release_year).group(0)))
            else:
                self.release_years.append(None)
            self.original_languages.append(str(self.element("#more-info > div > div:nth-child(2) > div.col-md-8.col-sm-6.col-xs-12 > dl > div:nth-child(6) > dd").get_attribute("textContent").strip()))

            rating = self.element("#more-info > div > div:nth-child(2) > div.col-md-8.col-sm-6.col-xs-12 > dl > div:nth-child(7) > dd").get_attribute("textContent").strip()
            self.ratings.append(str(rating) if rating else None)

            runtime = self.element("/html/body/div[5]/section[2]/div/div[2]/div[1]/div[1]/div[2]/p").get_attribute("textContent").strip()
            if runtime and runtime == "יעודכן בקרוב":
                runtime = None
            self.runtimes.append(int(m.group()) if runtime and (m := re.search(r"\d+", runtime)) else None)

        name_to_idx = {str(name): i for i, name in enumerate(self.hebrew_titles)}

        self.clickWhenReady("#header-change-location")
        self.clickWhenReady("body > div.modal.location-picker-modal.fade.search.in > div > div > div > div:nth-child(2) > div:nth-child(3) > div.row.all-cinemas-list > div > div > div > button")
        num_cinemas = self.lenElements(f"body > div.selectpicker-dropdown-container.npm-quickbook > div.bs-container.btn-group.bootstrap-select.qb-.open > div > ul > li")
        self.driver.execute_script("arguments[0].click();", self.waitForVisible("body > div.modal.location-picker-modal.fade.search.in > div > div > div > div:nth-child(2) > div:nth-child(3) > div:nth-child(1) > div > h2 > small"))
        for cinema in range(1, num_cinemas + 1):
            previous_ticket = next(iter(self.elements(self.tickets_selector)), None)
            if cinema == 1:
                self.clickWhenReady("/html/body/div[3]/div/div[1]/div[1]/div/div[2]/nav/div/ul/li[1]/div/a[1]")
            else:
                self.clickWhenReady("#header-change-location")
                self.clickWhenReady("body > div.modal.location-picker-modal.fade.search.in > div > div > div > div:nth-child(2) > div:nth-child(3) > div.row.all-cinemas-list > div > div > div > button")
                self.clickWhenReady(f"body > div.selectpicker-dropdown-container.npm-quickbook > div.bs-container.btn-group.bootstrap-select.qb-.open > div > ul > li:nth-child({cinema}) > a")
            self.zoomOut(30, 0)
            self.waitForStale(previous_ticket)
            self.waitForQuickbook()

            self.screening_city = self.element("body > section.light.quickbook-section.npm-quickbook > section > div:nth-child(1) > div > div > div:nth-child(1) > div > h2").text

            found_first_day_of_next_month = False
            for checking_month in range(1, 3):
                if found_first_day_of_next_month == False and checking_month == 2:
                    continue

                self.openQuickbookCalendar(checking_month)
                for week in range(1, self.lenElements("body > section.light.quickbook-section.npm-quickbook > section > div:nth-child(1) > div > div > div:nth-child(2) > div.col-xs-12.col-md-6.qb-calendar-widget > div > div.qb-days-group.btn-group > div > div:nth-child(3) > div > div.datepicker.datepicker-inline > div.datepicker-days > table > tbody > tr") + 1):
                    for day in range(1, 8):
                        if found_first_day_of_next_month == True and checking_month == 1:
                            continue

                        self.openQuickbookCalendar(checking_month)

                        day_number = self.element(f"body > section.light.quickbook-section.npm-quickbook > section > div:nth-child(1) > div > div > div:nth-child(2) > div.col-xs-12.col-md-6.qb-calendar-widget > div > div.qb-days-group.btn-group > div > div:nth-child(3) > div > div.datepicker.datepicker-inline > div.datepicker-days > table > tbody > tr:nth-child({week}) > td:nth-child({day})").get_attribute("class") or ""
                        if "old" in day_number:
                            continue
                        if "new" in day_number:
                            if checking_month == 1 and not found_first_day_of_next_month:
                                found_first_day_of_next_month = True
                            continue
                        if "disabled" in day_number:
                            continue

                        self.selectQuickbookDate(f"body > section.light.quickbook-section.npm-quickbook > section > div:nth-child(1) > div > div > div:nth-child(2) > div.col-xs-12.col-md-6.qb-calendar-widget > div > div.qb-days-group.btn-group > div > div:nth-child(3) > div > div.datepicker.datepicker-inline > div.datepicker-days > table > tbody > tr:nth-child({week}) > td:nth-child({day}) > button", checking_month)
                        date_name = self.element(f"body > section.light.quickbook-section.npm-quickbook > section > div:nth-child(1) > div > div > div:nth-child(2) > div.col-xs-12.col-md-6.qb-calendar-widget > div > div.col-xs-12.mb-sm > h5").text
                        self.date_of_showing = datetime.strptime(date_name.split(" ", 1)[1], "%d/%m/%Y").date().isoformat()

                        self.clickWhenReady("/html/body/section[2]/section/div[1]/div/div/div[2]/div[3]/div/div/button")
                        self.clickWhenReady("/html/body/div[12]/div[2]/div/ul/li[2]/a")
                        self.clickWhenReady("/html/body/section[2]/section/div[1]/div/div/div[2]/div[3]/div/div/button")
                        self.clickWhenReady("/html/body/div[12]/div[2]/div/ul/li[1]/a")

                        for film_index in range(1, self.lenElements("/html/body/section[2]/section/div[1]/div/section/div[2]/div") + 1):
                            selector = f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div/div/h4"
                            if self.lenElements(selector) and self.element(selector).text == "להזמנת כרטיסים במכירה מוקדמת בחרו בתאריך ההקרנה הרצוי":
                                continue

                            checking_film_name = self.element(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[1]/a/h3").text
                            checking_film = name_to_idx.get(checking_film_name)
                            if checking_film is None:
                                continue

                            for showtype in range(1, self.lenElements(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div") + 1):
                                dub_stuff = " ".join((element.get_attribute("innerText") or "").strip() for element in self.elements(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div[{showtype}]/div/ul[1]/li[contains(concat(' ', normalize-space(@class), ' '), ' lang-attributes ')]"))
                                self.dub_language = "Hebrew" if "מדובב" in dub_stuff else None

                                self.screening_type = "".join((element.get_attribute("innerText") or "").strip() for element in self.elements(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div[{showtype}]/div/ul[1]/li[not(contains(concat(' ', normalize-space(@class), ' '), ' lang-attributes '))]"))
                                self.screening_tech = self.screening_type

                                for showtime in range(1, self.lenElements(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div[{showtype}]/div/a") + 1):
                                    self.showtime = self.element(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div[{showtype}]/div/a[{showtime}]").text
                                    self.english_href = self.element(f"/html/body/section[2]/section/div[1]/div/section/div[2]/div[{film_index}]/div/div/div[2]/div/div[2]/div[{showtype}]/div/a[{showtime}]").get_attribute("data-url").replace("/api", "")
                                    self.hebrew_href = self.english_href.replace("lang=en", "lang=he")

                                    self.original_language = self.original_languages[checking_film]
                                    self.release_year = self.release_years[checking_film]
                                    self.rating = self.ratings[checking_film]
                                    self.runtime = self.runtimes[checking_film]

                                    self.english_title = self.english_titles[checking_film]
                                    self.hebrew_title = self.hebrew_titles[checking_film]

                                    self.appendToGatheringInfo()
