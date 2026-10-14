from datetime import date, timedelta
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC


class QuickbookHelpers:
    calendar_selector = "section.npm-quickbook .datepicker-days"
    date_heading_selector = "section.npm-quickbook .qb-calendar-widget h5"
    tickets_selector = "section.npm-quickbook a[data-url]"

    def acceptQuickbookCookies(self):
        button = self.tryExceptNone(lambda: self.waitUntil(lambda driver: (button := driver.execute_script("return document.querySelector('#usercentrics-cmp-ui')?.shadowRoot?.querySelector('#accept')")) and button.is_displayed() and button.is_enabled() and button, 10))
        if button is not None:
            button.click()
            self.waitUntil(EC.invisibility_of_element(button), 10)

    def waitForQuickbook(self):
        self.waitUntil(lambda driver: driver.find_elements(By.CSS_SELECTOR, self.tickets_selector))
        self.waitUntil(lambda driver: driver.find_elements(By.CSS_SELECTOR, 'section.npm-quickbook .qb-days-group button[data-automation-id^="day_"]:not([disabled])'))

    def openQuickbookCalendar(self, checking_month: int):
        if not self.tryExceptNone(lambda: self.driver.find_element(By.CSS_SELECTOR, self.calendar_selector).is_displayed()):
            self.clickWhenReady('section.npm-quickbook .qb-days-group button.datepicker-toggle')
        self.waitForVisible(self.calendar_selector)
        checking_date = (date(int(self.current_year), int(self.current_month), 1) + timedelta(days=32 * (checking_month - 1))).replace(day=1)
        month_name = next(name for name, number in self.month_mapping.items() if int(number) == checking_date.month)
        expected_month = month_name
        current_month = self.element(self.calendar_selector + " .datepicker-switch").text.strip()
        if current_month != expected_month:
            direction = "prev" if (int(self.month_mapping[current_month]) - checking_date.month) % 12 == 1 else "next"
            self.clickWhenReady(self.calendar_selector + " th." + direction)
        self.waitUntil(lambda driver: driver.find_element(By.CSS_SELECTOR, self.calendar_selector + " .datepicker-switch").text.strip() == expected_month)

    def selectQuickbookDate(self, path: str, checking_month: int):
        button = self.waitForVisible(path)
        checking_date = (date(int(self.current_year), int(self.current_month), 1) + timedelta(days=32 * (checking_month - 1))).replace(day=int(button.text))
        expected_date = checking_date.strftime("%d/%m/%Y")
        same_date = self.element(self.date_heading_selector).text.strip().endswith(expected_date)
        previous_ticket = next(iter(self.elements(self.tickets_selector)), None)
        button.click()
        self.waitUntil(lambda driver: driver.find_element(By.CSS_SELECTOR, self.date_heading_selector).text.strip().endswith(expected_date))
        # The date heading changes before the tickets; selecting the same date may not reload them.
        if not same_date:
            self.waitForStale(previous_ticket)
        self.waitForQuickbook()
