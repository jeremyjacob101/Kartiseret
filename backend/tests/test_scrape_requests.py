from unittest import TestCase
import base64
import gzip
import json
from pathlib import Path
import tempfile
from unittest.mock import Mock, patch
from requests import Response, HTTPError, Session

from backend.scraping.utils.ScrapeRequests import BoundedRetry, CountingAdapter, configure_scrape_session, validate_scrape_response, validate_scrape_coverage


class ScrapeRequestsTests(TestCase):
    def test_bootstrap_reconfiguration_keeps_connections_owned_by_session(self):
        with Session() as session:
            configure_scrape_session(session, capture=False)
            adapter = session.get_adapter('https://example.test')
            configure_scrape_session(session, retry_methods=('GET', 'POST'))
            self.assertIs(session.get_adapter('https://example.test'), adapter)
            self.assertEqual(adapter.max_retries.allowed_methods, frozenset({'GET', 'POST'}))
            self.assertEqual(session.hooks['response'].count(validate_scrape_response), 1)

    def response(self, text, status=200, headers=None):
        response = Response()
        response.status_code = status
        response.url = 'https://example.test/movies'
        response._content = text.encode()
        response.headers.update(headers or {'Content-Type': 'text/html'})
        return response

    def test_denials_and_200_challenges_fail_before_parsing(self):
        for response in (
            self.response('Forbidden', 403),
            self.response('<title>Just a moment...</title>'),
            self.response('<title>403 Forbidden</title>'),
            self.response('challenge', headers={'cf-mitigated': 'challenge'}),
        ):
            with self.subTest(response=response.text), self.assertRaises((ValueError, HTTPError)):
                validate_scrape_response(response)

    def test_ordinary_page_with_captcha_widget_is_not_a_challenge(self):
        response = self.response('<title>Movies</title><script>cloudflare; captcha;</script>')
        self.assertIs(validate_scrape_response(response), response)

    def test_incomplete_discovery_counts_are_not_accepted_as_partial_success(self):
        for coverage in (
            {},
            {'cinemas_expected': 12, 'cinemas_completed': 11},
            {'calendar_dates_expected': 20, 'dates_completed': 19},
            {'pages_expected': 2},
            {'cards_expected': 4, 'cards_parsed': 3},
        ):
            with self.subTest(coverage=coverage), self.assertRaisesRegex(ValueError, 'coverage'):
                validate_scrape_coverage(coverage)
        validate_scrape_coverage({'cards_expected': 4, 'cards_parsed': 4})
        validate_scrape_coverage({'calendar_dates_expected': 20, 'dates_completed': 20})

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
