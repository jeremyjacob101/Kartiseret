from unittest import TestCase
import base64
import gzip
import json
from pathlib import Path
import tempfile
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

    def test_read_only_post_retry_can_be_enabled_per_session(self):
        session = Mock()
        configure_scrape_session(session, retry_methods=("GET", "POST"))
        retry = session.mount.call_args.args[1].max_retries
        self.assertEqual(retry.allowed_methods, frozenset({"GET", "POST"}))

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

    def test_optional_source_capture_keeps_raw_response_and_request_identity(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict('os.environ', {'SCRAPER_SOURCE_CAPTURE_DIR': directory}):
            session = Mock()
            session.hooks = {'response': []}
            stats = {'requests': 0, 'observed_retries': 0}
            configure_scrape_session(session, stats=stats)

            response = Mock()
            response.content = b'{"events": []}'
            response.request.method = 'POST'
            response.request.body = 'filterdate=123'
            response.url = 'https://example.test/calendar'
            response.status_code = 200
            response.headers = {'Content-Type': 'application/json'}
            hook = session.hooks['response'][0]
            self.assertIs(hook(response), response)

            capture = Path(directory, 'source-responses.jsonl.gz')
            with gzip.open(capture, 'rt', encoding='utf-8') as stream:
                record = json.loads(stream.readline())
            self.assertEqual(record['request_body'], 'filterdate=123')
            self.assertEqual(record['method'], 'POST')
            self.assertEqual(base64.b64decode(record['body_base64']), response.content)
            self.assertEqual(stats['captured_responses'], 1)
