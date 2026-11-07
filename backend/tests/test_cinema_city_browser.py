from collections import deque
from unittest import TestCase
from unittest.mock import Mock, patch

from selenium.webdriver.common.by import By

from backend.scraping.utils.CinemaCityBrowser import collect_movie_links


class MovieListBrowserTests(TestCase):
    def scraper(self, frames):
        scraper = Mock()
        pending = deque(frames)
        state = {'ids': [], 'more': False, 'clock': 0}

        def find(by, selector):
            if by == By.CSS_SELECTOR:
                return [Mock(**{'get_attribute.return_value': 'comp__' + identifier}) for identifier in state['ids']]
            return [Mock(**{'is_displayed.return_value': True})] if state['more'] else []

        def wait(condition):
            for _ in range(30):
                state['clock'] += .25
                if pending:
                    state['ids'], state['more'] = pending.popleft()
                result = condition(scraper.driver)
                if result:
                    return result
            raise TimeoutError('Movie list never completed')

        scraper.driver.find_elements.side_effect = find
        scraper.waitUntil.side_effect = wait
        return scraper, state

    def test_waits_for_late_final_cards_after_button_disappears(self):
        frames = [(['1'], True)] * 5
        frames += [(['1', '2'], False)] * 2
        frames += [(['1', '2', '3'], False)] * 6
        scraper, state = self.scraper(frames)
        with patch('backend.scraping.utils.CinemaCityBrowser.time.monotonic', side_effect=lambda: state['clock']):
            links = collect_movie_links(scraper, '.cards')
        self.assertEqual(links, [f'https://www.cinema-city.co.il/movie/{i}' for i in (1, 2, 3)])
        scraper.clickWhenReady.assert_called_once()

    def test_stalled_pagination_fails_instead_of_returning_first_page(self):
        scraper, state = self.scraper([(['1'], True)] * 40)
        with patch('backend.scraping.utils.CinemaCityBrowser.time.monotonic', side_effect=lambda: state['clock']), self.assertRaises(TimeoutError):
            collect_movie_links(scraper, '.cards')

    def test_missing_required_film_identifier_fails(self):
        scraper, state = self.scraper([(['placeholder'], False)] * 6)
        with patch('backend.scraping.utils.CinemaCityBrowser.time.monotonic', side_effect=lambda: state['clock']), self.assertRaisesRegex(ValueError, 'film ID'):
            collect_movie_links(scraper, '.cards')
