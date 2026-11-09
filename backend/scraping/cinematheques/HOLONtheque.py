from collections import defaultdict
from datetime import date, datetime, timedelta

from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.HolonRequests import (
    _append_holon_row,
    collect_holon,
    parse_event_page,
    parse_schedule_week,
)

from selenium.common.exceptions import StaleElementReferenceException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from zoneinfo import ZoneInfo


class HOLONtheque(BaseCinema):
    CINEMA_NAME = "Holon Cinematheque"
    SCREENING_CITY = "Holon"
    URL = "https://www.cinemaholon.org.il/screening-and-events/"
    # The Requests route is fast but still has one unresolved live ticket-link
    # mismatch against Chrome; keep the production default on Selenium until
    # it reaches exact parity.
    DEFAULT_SCRAPE_MODE = "selenium"

    def requests_logic(self):
        return collect_holon(self)

    def logic(self):
        self.waitForElement(".events-results .entry-result")
        first_day = self.driver.find_element(By.CSS_SELECTOR, ".days-wrap li").get_attribute("data-moment_date")
        try:
            first_week = date.fromisoformat(first_day)
        except (TypeError, ValueError) as error:
            raise ValueError(f"Holon calendar has an invalid initial week date: {first_day!r}") from error

        event_occurrences = defaultdict(list)
        self._coverage = {
            "weeks_expected": 5,
            "weeks_completed": 0,
            "calendar_days_expected": 35,
            "calendar_days_completed": 0,
            "calendar_activities": 0,
        }
        for week_index in range(5):
            week_start = first_week + timedelta(days=7 * week_index)
            week_html = self.driver.page_source
            week_occurrences, activity_count = parse_schedule_week(week_html, week_start)
            for href, showing_slots in week_occurrences.items():
                event_occurrences[href].extend(showing_slots)
            self._coverage["weeks_completed"] += 1
            self._coverage["calendar_days_completed"] += 7
            self._coverage["calendar_activities"] += activity_count

            if week_index < 4:
                next_week = week_start + timedelta(days=7)
                self.driver.find_element(By.CSS_SELECTOR, ".events-calendar button.next").click()
                WebDriverWait(self.driver, 20, poll_frequency=0.1, ignored_exceptions=(StaleElementReferenceException,)).until(
                    lambda driver: driver.find_element(By.CSS_SELECTOR, ".days-wrap li").get_attribute("data-moment_date") == next_week.isoformat()
                )
                WebDriverWait(self.driver, 20, poll_frequency=0.1, ignored_exceptions=(StaleElementReferenceException,)).until(
                    lambda driver: driver.find_element(By.CSS_SELECTOR, ".events-results .entry-result").get_attribute("data-daytime")
                    and datetime.fromtimestamp(
                        int(driver.find_element(By.CSS_SELECTOR, ".events-results .entry-result").get_attribute("data-daytime")),
                        ZoneInfo("Asia/Jerusalem"),
                    ).date() == next_week
                )

        if self._coverage["weeks_completed"] != self._coverage["weeks_expected"] or self._coverage["calendar_days_completed"] != self._coverage["calendar_days_expected"]:
            raise ValueError("Holon Selenium calendar coverage is incomplete")
        event_urls = list(event_occurrences)
        if not event_urls:
            raise ValueError("Holon schedule returned no event links")
        self._coverage.update(event_pages_expected=len(event_urls), event_pages_completed=0, expired_events_skipped=0)
        for href in event_urls:
            self.driver.get(href)
            self.waitForElement(".header-image h1.entry-title")
            rows = parse_event_page(self.driver.page_source, href, event_occurrences[href], self.today_date)
            self._coverage["event_pages_completed"] += 1
            if not rows:
                self._coverage["expired_events_skipped"] += 1
                continue
            for row in rows:
                _append_holon_row(self, row)
