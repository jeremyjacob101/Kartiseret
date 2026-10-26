import re
import unittest
from unittest.mock import Mock

from selenium.webdriver.common.by import By

from backend.scraping.nowplayings.HotCinema import HotCinema


class StopAfterFirstSelectedDate(Exception):
    pass


class CalendarElement:
    def __init__(self, driver, text="", class_name="", href=""):
        self.driver = driver
        self.text = text
        self.class_name = class_name
        self.href = href

    def get_attribute(self, name):
        if name == "class":
            return self.class_name
        if name == "href":
            return self.href
        if name == "innerHTML":
            return f"{self.driver.selected_date}\nיום"
        raise AssertionError(f"Unexpected attribute: {name}")

    def click(self):
        self.driver.clicks.append(self.text)
        classes = set(self.class_name.split())
        if classes & {"disabled", "old", "new"}:
            return
        self.driver.selected_date = f"{int(self.text):02d}/11/2026"


class CalendarDriver:
    def __init__(self):
        self.month_label = "אוקטובר 2026"
        self.selected_date = "25/10/2026"
        self.clicks = []

    def set_page_load_timeout(self, _timeout):
        pass

    def set_script_timeout(self, _timeout):
        pass

    def get(self, _url):
        pass

    def execute_script(self, script):
        return True if "jQuery.active" in script else None

    def find_element(self, by, _selector):
        if by == By.CSS_SELECTOR:
            return CalendarElement(self, text=self.month_label)
        return CalendarElement(self)


class HotCinemaCalendarTests(unittest.TestCase):
    def test_logic_skips_previous_month_disabled_cell_then_selects_november_6(self):
        scraper = HotCinema.__new__(HotCinema)
        scraper.driver = CalendarDriver()
        scraper.current_month = "10"
        scraper.hebrew_hrefs = []
        scraper.hebrew_titles = []
        scraper.waitForVisible = Mock()
        scraper.waitForElement = Mock()
        scraper.waitForStale = Mock()
        scraper.jsRemoveAll = Mock()
        scraper.tryExceptPass = Mock()
        scraper.zoomOut = Mock()
        scraper.elements = lambda _selector: []

        def len_elements(selector):
            if selector == "/html/body/div[2]/div[4]/div[2]/div/div/div[2]/div/div/a":
                return 0
            if selector == "/html/body/div[2]/div[1]/div/div/div[1]/div[3]/div[2]/div[2]/a":
                return 1
            if selector.endswith("/table/tbody/tr"):
                raise StopAfterFirstSelectedDate
            return 0

        scraper.lenElements = len_elements

        def element(selector):
            if selector.endswith("/a[1]"):
                return CalendarElement(scraper.driver, href="https://hotcinema.co.il/theater/22")
            if selector.endswith("/h1"):
                return CalendarElement(scraper.driver, text="HOT CINEMA DREAM STAGE חולון")
            if selector in (
                ".datepicker-dropdown .datepicker-switch",
                ".datepicker-dropdown .datepicker-days .datepicker-switch",
            ):
                return CalendarElement(scraper.driver, text=scraper.driver.month_label)
            if selector == "/html/body/div[2]/div[4]/div[2]/div/div[3]/div/div/div/div[1]/div":
                return CalendarElement(scraper.driver)

            match = re.search(r"tr:nth-child\((\d+)\) > td:nth-child\((\d+)\)$", selector)
            if not match:
                raise AssertionError(f"Unexpected selector: {selector}")
            row, column = map(int, match.groups())
            if scraper.driver.month_label == "אוקטובר 2026":
                return CalendarElement(scraper.driver, text="25", class_name="day disabled")
            if row == 1:
                classes = "old active day disabled" if column == 1 else "old day disabled"
                return CalendarElement(scraper.driver, text=str(24 + column), class_name=classes)
            if row == 2:
                classes = "day" if column in (6, 7) else "day disabled"
                return CalendarElement(scraper.driver, text=str(column), class_name=classes)
            return CalendarElement(scraper.driver, text="1", class_name="day disabled")

        scraper.element = element

        def click_when_ready(selector):
            if selector == ".datepicker-dropdown .datepicker-days th.next":
                scraper.driver.month_label = "נובמבר 2026"

        scraper.clickWhenReady = click_when_ready

        def wait_until(condition, timeout=15):
            if not condition(scraper.driver):
                raise AssertionError(f"Wait condition failed with timeout {timeout}")

        scraper.waitUntil = wait_until

        with self.assertRaises(StopAfterFirstSelectedDate):
            scraper.logic()

        self.assertEqual(scraper.driver.clicks, ["6"])
        self.assertEqual(scraper.driver.selected_date, "06/11/2026")


if __name__ == "__main__":
    unittest.main()
