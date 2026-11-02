from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.utils.ScrapeRequests import BoundedRetry, CountingAdapter, configure_scrape_session


class ScrapeRequestsTests(TestCase):
    def test_session_uses_bounded_get_retries(self):
        session = Mock()
        self.assertIs(configure_scrape_session(session), session)
        self.assertEqual(session.mount.call_count, 2)
        retry = session.mount.call_args.args[1].max_retries
        self.assertEqual(retry.total, 2)
        self.assertEqual(retry.allowed_methods, frozenset({'GET'}))
        self.assertEqual(set(retry.status_forcelist), {429, 500, 502, 503, 504})

    def test_retry_after_is_capped(self):
        retry = BoundedRetry()
        response = Mock(headers={'Retry-After': '300'})
        self.assertEqual(retry.get_retry_after(response), 10)

    def test_counts_requests_and_reported_retries(self):
        stats = {'requests': 0, 'observed_retries': 0}
        response = Mock()
        response.raw.retries.history = [object(), object()]
        adapter = CountingAdapter(stats=stats)
        with patch('requests.adapters.HTTPAdapter.send', return_value=response):
            self.assertIs(adapter.send(Mock()), response)
        self.assertEqual(stats, {'requests': 1, 'observed_retries': 2})
