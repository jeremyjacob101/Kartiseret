"""Transport switching must obey the current pipeline's storage/lease boundary."""
import json
from datetime import datetime
import pytz
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.scraping.BaseCinema import BaseCinema
from backend.utils.log.cloudflare_storage import CloudflareStorageError, LeaseLostError
from backend.utils.log.r2_budget import R2BudgetExceeded


class ExampleCinema(BaseCinema):
    CINEMA_NAME = 'Test Cinema'
    DEFAULT_SCRAPE_MODE = 'auto'
    URL = 'https://example.test'

    def requests_logic(self):
        self._coverage = {'pages_expected': 1, 'pages_completed': 1}
        self.english_title = 'HTTP film'
        self.date_of_showing = '2026-11-07'
        self.showtime = '20:00'
        self.screening_city = 'Test City'
        self.english_href = 'https://example.test/ticket/1'
        self.appendToGatheringInfo()

    def selenium_logic(self):
        self.english_title = 'Browser film'
        self.date_of_showing = '2026-11-07'
        self.showtime = '20:00'
        self.screening_city = 'Test City'
        self.english_href = 'https://example.test/ticket/1'
        self.appendToGatheringInfo()


class ScrapePipelineIntegrationTests(TestCase):
    def test_forced_selenium_records_only_the_browser_transport(self):
        self.scraper.scrape_mode = 'selenium'
        self.scraper.requests_logic = Mock(side_effect=AssertionError('Unexpected HTTP attempt'))
        self.scraper._timing_transport_callback = Mock()
        self.scraper.scrape()
        self.assertEqual(self.scraper._timing_transport, 'selenium')
        self.scraper.requests_logic.assert_not_called()
        self.assertEqual(self.scraper._timing_transport_callback.call_args.args[0], 'selenium')

    def test_fallback_refreshes_source_calendar_after_new_year_rollover(self):
        self.scraper.today_date = datetime(2026, 12, 31, 23, 59)
        self.scraper.current_year, self.scraper.current_month = '2026', '12'
        started, weekday = self.scraper.startTime, self.scraper._timing_weekday
        self.scraper.requests_logic = Mock(side_effect=ValueError('source unavailable'))
        original = self.scraper.selenium_logic
        def browser():
            self.assertEqual(self.scraper.today_date, datetime(2027, 1, 1, 0, 1))
            self.assertEqual((self.scraper.current_year, self.scraper.current_month), ('2027', '1'))
            self.assertEqual((self.scraper.startTime, self.scraper._timing_weekday), (started, weekday))
            original()
        self.scraper.selenium_logic = Mock(side_effect=browser)
        instant = pytz.UTC.localize(datetime(2026, 12, 31, 22, 1))
        with patch('backend.scraping.utils.InitializeBaseCinema.datetime') as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            self.scraper.scrape()
        self.scraper.selenium_logic.assert_called_once()

    def setUp(self):
        with patch('backend.scraping.BaseCinema.setUpSupabase'):
            self.scraper = ExampleCinema('allShowtimes', 'allShowtimes', 71)
        self.scraper.supabase = Mock()
        self.scraper.supabase.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{}]
        self.store = self.patch('backend.utils.log.run_storage.RunArtifactStore').return_value
        self.chrome = self.patch('backend.scraping.BaseCinema.build_chrome')
        self.patch('backend.scraping.BaseCinema.navigate')
        self.patch('backend.scraping.BaseCinema.logSuccessfulRun')

    def patch(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def test_success_persists_exact_uploaded_rows_before_completing_manifest(self):
        events = []
        self.store.save_scraped_rows.side_effect = lambda **kw: events.append(('rows', kw))
        self.scraper.finishScrapeSnapshot = Mock(side_effect=lambda n: events.append(('complete', n)))
        self.scraper.scrape()
        self.chrome.assert_not_called()
        self.assertEqual(self.scraper._timing_transport, 'requests')
        rows = self.scraper.supabase.table.return_value.insert.call_args.args[0]
        saved = events[0][1]
        self.assertEqual(saved['rows'], rows)
        self.assertTrue(saved['successful'])
        self.assertEqual(rows[0]['snapshot_id'], self.scraper.snapshot_id)
        self.assertEqual(events[1], ('complete', 1))
        diagnostic = self.store.save_text_artifact.call_args.kwargs
        self.assertEqual(diagnostic['artifact_type'], 'scraper_transport')
        self.assertEqual(json.loads(diagnostic['text'])['snapshot_id'], self.scraper.snapshot_id)

    def test_fallback_retains_failed_snapshot_and_uploads_only_fresh_browser_rows(self):
        weekday = self.scraper._timing_weekday
        def partial():
            self.scraper.english_title = 'partial HTTP'
            self.scraper.appendToGatheringInfo()
            raise ValueError('missing later page')
        self.scraper.requests_logic = Mock(side_effect=partial)
        with patch('backend.scraping.utils.InitializeBaseCinema.current_weekday', return_value='different-day'):
            self.scraper.scrape()
        saves = self.store.save_scraped_rows.call_args_list
        self.assertEqual(len(saves), 2)
        failed, successful = [call.kwargs for call in saves]
        self.assertFalse(failed['successful'])
        self.assertTrue(successful['successful'])
        self.assertEqual(failed['rows'][0]['english_title'], 'partial HTTP')
        self.assertEqual(successful['rows'][0]['english_title'], 'Browser film')
        self.assertEqual(successful['rows'][0]['snapshot_id'], self.scraper.snapshot_id)
        self.assertEqual(self.scraper._timing_weekday, weekday)
        self.assertEqual(self.scraper._timing_transport, 'requests_selenium_fallback')
        self.chrome.assert_called_once()
        diagnostics = [call.kwargs['metadata'] for call in self.store.save_text_artifact.call_args_list]
        self.assertEqual([d['transport'] for d in diagnostics], ['requests', 'selenium'])
        self.assertNotEqual(diagnostics[0]['snapshot_id'], diagnostics[1]['snapshot_id'])
        self.assertEqual(diagnostics[1]['fallback_from'], {
            'snapshot_id': diagnostics[0]['snapshot_id'], 'reason': 'ValueError',
        })

    def test_diagnostic_storage_failure_blocks_upload_without_fallback(self):
        self.store.save_text_artifact.side_effect = CloudflareStorageError('D1 unavailable')
        with self.assertRaises(CloudflareStorageError):
            self.scraper.scrape()
        self.chrome.assert_not_called()
        tables = [call.args[0] for call in self.scraper.supabase.table.call_args_list]
        self.assertNotIn('allShowtimes', tables)
        self.store.save_scraped_rows.assert_not_called()

    def test_post_upload_storage_failure_does_not_complete_or_recollect(self):
        self.scraper.requests_logic = Mock(wraps=self.scraper.requests_logic)
        self.scraper.finishScrapeSnapshot = Mock()
        self.store.save_scraped_rows.side_effect = CloudflareStorageError('D1 unavailable')
        with self.assertRaisesRegex(CloudflareStorageError, 'published to Supabase'):
            self.scraper.scrape()
        self.scraper.requests_logic.assert_called_once()
        self.chrome.assert_not_called()
        self.scraper.finishScrapeSnapshot.assert_not_called()
        self.store.save_scraped_rows.assert_called_once()
        self.assertEqual(len(self.scraper._uploaded_scrape_rows), 1)

    def test_lease_loss_and_budget_exhaustion_stop_without_fallback_or_more_storage(self):
        for error in (LeaseLostError('lost'), R2BudgetExceeded('spent')):
            with self.subTest(error=type(error).__name__):
                self.scraper.requests_logic = Mock(side_effect=error)
                with self.assertRaises(type(error)):
                    self.scraper.scrape()
                self.chrome.assert_not_called()
                self.store.save_text_artifact.assert_not_called()
                self.store.save_scraped_rows.assert_not_called()

    def test_reused_instance_cannot_log_a_previous_attempts_uploaded_payload(self):
        self.scraper._uploaded_scrape_rows = [{'english_title': 'stale'}]
        self.scraper.requests_logic = Mock(side_effect=ValueError('bad source'))
        self.scraper.scrape_mode = 'requests'
        with self.assertRaises(ValueError):
            self.scraper.scrape()
        self.store.save_scraped_rows.assert_not_called()
        self.assertIsNone(self.scraper._uploaded_scrape_rows)

    def test_incomplete_coverage_discards_valid_http_rows_and_falls_back(self):
        original = self.scraper.requests_logic
        def partial():
            original()
            self.scraper._coverage = {'pages_expected': 2, 'pages_completed': 1}
        self.scraper.requests_logic = Mock(side_effect=partial)
        self.scraper.scrape()
        self.chrome.assert_called_once()
        uploaded = self.scraper._uploaded_scrape_rows
        self.assertEqual([row['english_title'] for row in uploaded], ['Browser film'])

    def test_both_transports_fail_without_uploading_or_completing_snapshot(self):
        self.scraper.requests_logic = Mock(side_effect=ValueError('challenge'))
        self.scraper.selenium_logic = Mock(side_effect=ValueError('browser denied'))
        self.scraper.finishScrapeSnapshot = Mock()
        with self.assertRaisesRegex(ValueError, 'browser denied'):
            self.scraper.scrape()
        self.scraper.requests_logic.assert_called_once()
        self.scraper.selenium_logic.assert_called_once()
        self.scraper.finishScrapeSnapshot.assert_not_called()
        self.assertIsNone(self.scraper._uploaded_scrape_rows)

    def assert_invalid_field_falls_back(self, column, invalid):
        original = self.scraper.requests_logic
        def malformed():
            original()
            self.scraper.gathering_info[column][0] = invalid
        self.scraper.requests_logic = Mock(side_effect=malformed)
        self.scraper.scrape()
        self.chrome.assert_called_once()
        self.assertEqual(self.scraper._uploaded_scrape_rows[0]['english_title'], 'Browser film')

    def test_invalid_screening_date_falls_back(self):
        self.assert_invalid_field_falls_back('date_of_showing', 'not-a-date')

    def test_invalid_screening_time_falls_back(self):
        self.assert_invalid_field_falls_back('showtime', '25:00')

    def test_missing_location_falls_back(self):
        self.assert_invalid_field_falls_back('screening_city', '')

    def test_missing_ticket_falls_back(self):
        self.assert_invalid_field_falls_back('english_href', 'javascript:void(0)')
