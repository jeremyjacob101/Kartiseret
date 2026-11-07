"""Discover complete Wix movie lists through the existing browser UI."""

import time
from selenium.webdriver.common.by import By


def collect_movie_links(scraper, card_selector):
    more_selector = "//button[normalize-space()='תראו לי עוד סרטים']"
    scraper.waitForElement(card_selector)

    def settled_cards():
        previous = None
        changed_at = time.monotonic()

        def settled(driver):
            nonlocal previous, changed_at
            cards = driver.find_elements(By.CSS_SELECTOR, card_selector)
            identifiers = tuple(card.get_attribute('id') for card in cards)
            buttons = [button for button in driver.find_elements(By.XPATH, more_selector) if button.is_displayed()]
            state = (identifiers, bool(buttons))
            if not cards or state != previous:
                previous, changed_at = state, time.monotonic()
                return False
            # Wix can remove the button before React appends the last cards.
            # Wait for the whole list and button state to stop changing.
            if time.monotonic() - changed_at < 1:
                return False
            return cards, buttons

        return scraper.waitUntil(settled)

    while True:
        cards, buttons = settled_cards()
        if not buttons:
            links = []
            for card in cards:
                identifier = card.get_attribute('id').split('__')[-1]
                if not identifier.isdigit():
                    raise ValueError('Cinema City movie card has no valid film ID')
                links.append(f'https://www.cinema-city.co.il/movie/{identifier}')
            return links
        count = len(cards)
        scraper.driver.execute_script('arguments[0].scrollIntoView({block: "center"});', buttons[0])
        scraper.clickWhenReady(more_selector)
        scraper.waitUntil(lambda driver: len(driver.find_elements(By.CSS_SELECTOR, card_selector)) > count)
