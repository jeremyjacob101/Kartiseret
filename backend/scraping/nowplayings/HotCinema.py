from backend.scraping.BaseCinema import BaseCinema

from datetime import datetime, date
from selenium.webdriver.common.by import By
import re


def _is_unselectable_date_cell(class_name):
    classes = set((class_name or "").split())
    return bool(classes & {"disabled", "old", "new"})


class HotCinema(BaseCinema):
    CINEMA_NAME = "Hot Cinema"
    URL = "https://hotcinema.co.il/ShowingNow"

    def logic(self):
        self.driver.set_page_load_timeout(45)
        self.driver.set_script_timeout(15)
        self.waitForVisible("/html/body/div[2]/div[4]/div[2]/div/div/div[2]/div/div/a")
        self.jsRemoveAll("#liteboxFormat14, .pp-backdrop")
        self.tryExceptPass(lambda: self.click("/html/body/div[7]/div/button"))
        self.tryExceptPass(lambda: self.click("/html/body/div[7]/div/div/button"))
        self.clickWhenReady("/html/body/div[3]/div/div/div[1]/a")

        for film_card in range(1, self.lenElements("/html/body/div[2]/div[4]/div[2]/div/div/div[2]/div/div/a") + 1):
            self.hebrew_hrefs.append(self.element(f"/html/body/div[2]/div[4]/div[2]/div/div/div[2]/div[{film_card}]/div/a").get_attribute("href"))
        for href in self.hebrew_hrefs:
            self.driver.get(href)
            if self.is_forbidden_page():
                continue
            self.waitForVisible("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[1]/div[1]/h1")
            raw_text = (self.element("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[2]/div[1]/div[2]").text or "").strip()
            last_token = raw_text.split()[-1] if raw_text else ""
            if last_token.isdigit() and len(last_token) == 4:
                self.release_years.append(int(last_token))
            else:
                self.release_years.append(None)

            self.english_titles.append(self.element("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[1]/div[2]/h2").text.strip())
            self.hebrew_titles.append(self.element("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[1]/div[1]/h1").text.strip())
            try:
                self.ratings.append(self.element("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[2]/div[1]/div[3]/div[2]/div[2]/span").text.strip())
            except:
                self.ratings.append(None)
            try:
                self.runtimes.append(int(re.sub(r"\D", "", self.element("/html/body/div[2]/div[4]/div[2]/div[1]/div[1]/div[2]/div[2]/div[2]/div[1]/div[3]/div[1]/div[2]/span").text.strip())))
            except:
                self.runtimes.append(None)
        name_to_idx = {str(name): i for i, name in enumerate(self.hebrew_titles)}

        for cinema in range(1, self.lenElements("/html/body/div[2]/div[1]/div/div/div[1]/div[3]/div[2]/div[2]/a") + 1):
            self.driver.get(self.element(f"/html/body/div[2]/div[1]/div/div/div[1]/div[3]/div[2]/div[2]/a[{cinema}]").get_attribute("href"))
            self.waitForElement(".order-panel.d-md-block table")
            self.zoomOut(50, 0)
            self.jsRemoveAll(".pp-backdrop")

            self.screening_city = self.element("/html/body/div[2]/div[4]/div[1]/div/div/div/div[2]/h1").text.strip()

            for checking_month in range(1, 3):
                if checking_month == 2:
                    self.driver.execute_script("$('.datepicker-wrapper input').datepicker('show')")
                    self.waitForVisible(".datepicker-dropdown .datepicker-days")
                    previous_month = self.element(".datepicker-dropdown .datepicker-switch").text
                    self.jsRemoveAll(".pp-backdrop")
                    self.clickWhenReady(".datepicker-dropdown .datepicker-days th.next")
                    self.waitUntil(lambda driver: driver.find_element(By.CSS_SELECTOR, ".datepicker-dropdown .datepicker-switch").text != previous_month)
                for week in range(1, 7):
                    for day in range(1, 8):
                        self.jsRemoveAll(".pp-backdrop")
                        self.driver.execute_script("$('.datepicker-wrapper input').datepicker('show')")
                        self.waitForVisible(".datepicker-dropdown .datepicker-days")
                        day_class_label = self.element(f".datepicker-dropdown .datepicker-days tbody > tr:nth-child({week}) > td:nth-child({day})").get_attribute("class").strip()
                        if _is_unselectable_date_cell(day_class_label):
                            continue
                        date_element = self.element(f".datepicker-dropdown .datepicker-days tbody > tr:nth-child({week}) > td:nth-child({day})")
                        selected_date = date(int(self.element(".datepicker-dropdown .datepicker-days .datepicker-switch").text.split()[-1]), (int(self.current_month) + checking_month - 2) % 12 + 1, int(date_element.text)).strftime("%d/%m/%Y")
                        previous_showtime = next(iter(self.elements(".order-panel.d-md-block table td.dates a")), None)
                        same_date = self.element("/html/body/div[2]/div[4]/div[2]/div/div[3]/div/div/div/div[1]/div").get_attribute("innerHTML").strip().split("\n")[0].strip() == selected_date
                        self.jsRemoveAll(".pp-backdrop")
                        date_element.click()
                        self.waitUntil(lambda driver: driver.find_element(By.XPATH, "/html/body/div[2]/div[4]/div[2]/div/div[3]/div/div/div/div[1]/div").get_attribute("innerHTML").strip().split("\n")[0].strip() == selected_date)
                        if not same_date:
                            self.waitForStale(previous_showtime)
                        self.waitForElement(".order-panel.d-md-block table")
                        self.waitUntil(lambda driver: driver.execute_script("return window.jQuery && jQuery.active === 0"))
                        self.date_of_showing = self.element("/html/body/div[2]/div[4]/div[2]/div/div[3]/div/div/div/div[1]/div").get_attribute("innerHTML").strip().split("\n")[0].strip()
                        self.date_of_showing = datetime.strptime(self.date_of_showing, "%d/%m/%Y").date().isoformat()

                        for film_index in range(1, self.lenElements("/html/body/div[2]/div[4]/div[2]/div/div[2]/div/div/div/div/table/tbody/tr") + 1):
                            checking_film_name = str(self.element(f"/html/body/div[2]/div[4]/div[2]/div/div[2]/div/div/div/div/table/tbody/tr[{film_index}]/td[1]").get_attribute("textContent").strip())
                            checking_film = name_to_idx.get(checking_film_name)
                            if checking_film is None:
                                continue

                            self.english_title = str(self.english_titles[checking_film])
                            self.hebrew_title = str(self.hebrew_titles[checking_film])

                            if self.english_title == "Comedy Bar" or self.hebrew_title == "קומדי בר" or "comedy bar" in self.english_title or "Comedy Bar" in self.english_title:
                                continue

                            self.dub_language = None
                            if "מדובב לעברית" in self.hebrew_title:
                                self.dub_language = "Hebrew"
                                self.hebrew_title = self.hebrew_title.split("מדובב לעברית", 1)[0].strip()
                            if "מדובב לצרפתית" in self.hebrew_title:
                                self.dub_language = "French"
                                self.hebrew_title = self.hebrew_title.split("מדובב לצרפתית", 1)[0].strip()
                            if "מדובב לרוסית" in self.hebrew_title:
                                continue
                            if "מדובב לערבית" in self.hebrew_title:
                                continue

                            if self.hebrew_title.endswith(" אנגלית"):
                                self.hebrew_title = self.hebrew_title.removesuffix(" אנגלית").strip()

                            if "תלת-ממד HFR" in self.hebrew_title:
                                self.screening_tech = "3D HFR"
                                self.hebrew_title = self.hebrew_title.split("תלת-ממד HFR", 1)[0].strip()
                            elif "HFR" in self.hebrew_title:
                                self.screening_tech = "2D HFR"
                                self.hebrew_title = self.hebrew_title.split("HFR", 1)[0].strip()
                            elif "תלת-ממד" in self.hebrew_title:
                                self.screening_tech = "3D"
                                self.hebrew_title = self.hebrew_title.split("תלת-ממד", 1)[0].strip()
                            else:
                                self.screening_tech = "2D"

                            row_xpath = f"/html/body/div[2]/div[4]/div[2]/div/div[2]/div/div/div/div/table/tbody/tr[{film_index}]"
                            row_element = self.element(row_xpath)

                            showtime_to_event = self.driver.execute_script(
                                r"""
                            return (function(row){
                            function norm(s){ return String(s||'').replace(/\s+/g,' ').trim(); }

                            const title = norm(row?.querySelector('td:first-child')?.innerText);
                            if (!title) return {};

                            // find Vue instance (Vue 2 or 3)
                            let n = document.querySelector('#order-panel')
                                    || document.querySelector('div.table-responsive')
                                    || document.querySelector('table')
                                    || document.body;
                            while (n && !n.__vue__ && !n.__vueParentComponent) n = n.parentNode;
                            let vm = n ? (n.__vue__ || n.__vueParentComponent) : null;
                            vm = vm && (vm.ctx || vm);

                            const events = vm?.events || vm?._data?.events || [];
                            let movie = events[Array.from(row.parentNode.children).indexOf(row)];
                            if (norm(movie?.MovieName) !== title) movie = events.find(e => norm(e.MovieName) === title)
                                    || events.find(e => norm(e.MovieName).includes(title) || title.includes(norm(e.MovieName)));
                            if (!movie) return {};

                            const map = {};
                            (movie.Dates || []).forEach((d, index) => {
                                const id = d && (d.EventId ?? d.eventId ?? d.Id ?? d.id);
                                if (id != null) map[index + 1] = String(id);
                            });
                            return map;
                            })(arguments[0]);
                            """,
                                row_element,
                            )

                            base_tech = self.screening_tech
                            for showtime in range(1, self.lenElements(f"/html/body/div[2]/div[4]/div[2]/div/div[2]/div/div/div/div/table/tbody/tr[{film_index}]/td[5]/a") + 1):
                                showtime_element = self.element(f"{row_xpath}/td[5]/a[{showtime}]")
                                full_showtime_text = str(showtime_element.get_attribute("innerHTML"))

                                if "לא רק קולנוע" in full_showtime_text:
                                    self.screening_type = "Not Just Cinema"
                                elif "PREMIUM" in full_showtime_text:
                                    self.screening_type = "Premium"
                                else:
                                    self.screening_type = "Regular"

                                self.screening_tech = base_tech + (" Atmos" if "atmos" in full_showtime_text else "")

                                self.showtime = re.search(r"\b(?:[01]?\d|2[0-3]):[0-5]\d\b", full_showtime_text).group(0)

                                event_id = showtime_to_event.get(str(showtime))
                                href_index = re.search(r"/theater/(\d+)", self.element(f"/html/body/div[2]/div[1]/div/div/div[1]/div[3]/div[2]/div[2]/a[{cinema}]").get_attribute("href"))
                                href_index = int(href_index.group(1)) if href_index else None

                                theater_to_href_map = {16: 1197, 14: 1194, 1: 1183, 17: 1191, 9: 1195, 2: 1184, 15: 1192, 6: 1181, 8: 1193, 5: 1182, 3: 1196, 22: 1198}
                                href_index = theater_to_href_map.get(href_index)

                                use_this_href = f"https://tickets.hotcinema.co.il/site/{href_index}/tickets?code={href_index}-{event_id}"
                                self.english_href = use_this_href + "&languageid=en_gb"
                                self.hebrew_href = use_this_href + "&languageid=he_IL"

                                self.release_year = self.release_years[checking_film]
                                self.rating = self.ratings[checking_film]
                                self.runtime = self.runtimes[checking_film]

                                self.appendToGatheringInfo()
