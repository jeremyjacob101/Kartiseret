"""Transport switching must obey the current pipeline's storage/lease boundary."""
import json
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
        self.english_title = 'HTTP film'
        self.appendToGatheringInfo()

    def selenium_logic(self):
        self.english_title = 'Browser film'
        self.appendToGatheringInfo()


class ScrapePipelineIntegrationTests(TestCase):
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
        rows = self.scraper.supabase.table.return_value.insert.call_args.args[0]
        saved = events[0][1]
        self.assertEqual(saved['rows'], rows)
        self.assertTrue(saved['successful'])
        self.assertEqual(rows[0]['snapshot_id'], self.scraper.snapshot_id)
        self.assertEqual(events[1], ('complete', 1))
        diagnostic = self.store.save_text_artifact.call_args.kwargs
        self.assertEqual(diagnostic['artifact_type'], 'scrape_transport')
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
        self.chrome.assert_called_once()
        diagnostics = [call.kwargs['metadata'] for call in self.store.save_text_artifact.call_args_list]
        self.assertEqual([d['transport'] for d in diagnostics], ['requests', 'selenium'])
        self.assertNotEqual(diagnostics[0]['snapshot_id'], diagnostics[1]['snapshot_id'])

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
