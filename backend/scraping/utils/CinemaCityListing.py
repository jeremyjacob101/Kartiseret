from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By


MORE_BUTTON = "//button[normalize-space()='תראו לי עוד סרטים']"
# The poster panel is unmounted when Wix switches a hovered card to its
# details state. Count/discover persistent repeater items instead of panels.
SHOWTIME_CARD_SELECTOR = "[id^='comp-mkmrxabz__']"
COMING_SOON_CARD_SELECTOR = "[id^='comp-mrjafvoi1__']"


def load_movie_listing(scraper, card_selector):
    """Load every page, including when Wix renders before wiring click handlers."""
    scraper.waitForElement(card_selector)
    while True:
        buttons = scraper.elements(MORE_BUTTON)
        if not buttons or not buttons[0].is_displayed():
            return
        film_count = scraper.lenElements(card_selector)
        # Wix can present an enabled button before hydration. A successful DOM
        # click alone does not prove the page accepted the request. Retry only
        # when no new cards appeared, and keep a broken listing fatal.
        for attempt in range(3):
            try:
                button = scraper.waitForElement(MORE_BUTTON)
                scraper.driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", button)
                scraper.clickWhenReady(MORE_BUTTON)
                scraper.waitUntil(lambda driver: len(driver.find_elements(By.CSS_SELECTOR, card_selector)) > film_count)
                break
            except TimeoutException as error:
                # Cards and the terminal button update separately. The final
                # button can disappear while clickWhenReady is still waiting.
                if scraper.lenElements(card_selector) > film_count:
                    break
                buttons = scraper.elements(MORE_BUTTON)
                if not buttons or not buttons[0].is_displayed():
                    return
                if attempt == 2:
                    raise TimeoutException(
                        f"Cinema City pagination stalled after {film_count} films ({card_selector})"
                    ) from error
