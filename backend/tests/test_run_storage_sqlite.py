from __future__ import annotations

import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.utils.log.cloudflare_storage import D1Result
from backend.utils.log.cloudflare_storage import CloudflareStorageError
from backend.utils.log.run_storage import RunArtifactStore


class SQLiteD1:
    database_id = 'sqlite-diagnostics-test'

    def __init__(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        schema = Path('backend/cloudflare/d1/migrations/0001_run_artifacts.sql').read_text()
        self.connection.executescript(schema)
        self.connection.executescript(Path("backend/cloudflare/d1/migrations/0003_lease_predecessor.sql").read_text())
        self.size = 1_000

    def execute(self, sql, params=()):
        cursor = self.connection.execute(sql, params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        changes = max(0, cursor.rowcount)
        if sql.startswith('DELETE FROM run_logs') and changes:
            self.size = 299_000_000
        return D1Result(rows, changes, changes, {})

    def measure_database_size(self):
        return self.size

    def batch(self, statements):
        return [self.execute(sql, params) for sql, params in statements]


class SQLiteRunStorageTests(TestCase):
    def setUp(self):
        self.enterContext(patch('backend.utils.log.job_lease.activate'))

    def test_d1_pressure_cleanup_protects_legacy_rows_until_snapshot_migration(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        d1.size = 351_000_000
        d1.connection.executescript("""
            INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES
            (1,'dev','test','successful','2025-01-01','2025-01-01'),
            (2,'dev','test','running','2025-01-01','2025-01-01');
            INSERT INTO scraped_rows (row_key,run_id,scraper,attempt,outcome,row_order,created_at)
            VALUES ('row',1,'test',1,'successful',0,'2025-01-01');
            INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,created_at)
            VALUES ('image',1,'screenshots','test','runs/2025-01-01/1/screenshots/a.webp','image/webp','2025-01-01');
        """)
        r2 = Mock()
        r2.delete_objects.return_value = {}
        store = RunArtifactStore(d1, r2_client=r2, bucket='dev')
        with self.assertRaisesRegex(CloudflareStorageError, 'No safely removable completed run'):
            store.check_storage()
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM run_logs').fetchone()[0], 2)
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM scraped_rows').fetchone()[0], 1)
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM artifacts').fetchone()[0], 1)
        r2.delete_objects.assert_not_called()

    def test_r2_cleanup_failure_keeps_metadata_for_next_scrape(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        d1.size = 351_000_000
        d1.connection.executescript("""
            INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at)
            VALUES (1,'dev','test','successful','2025-01-01','2025-01-01');
            INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,created_at)
            VALUES ('image',1,'screenshots','test','runs/2025-01-01/1/screenshots/a.webp','image/webp','2025-01-01');
        """)
        r2 = Mock()
        r2.delete_objects.side_effect = RuntimeError('offline')
        store = RunArtifactStore(d1, r2_client=r2, bucket='dev')
        with self.assertRaisesRegex(CloudflareStorageError, 'R2 screenshot cleanup failed'):
            store.check_storage()
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM artifacts').fetchone()[0], 1)
        r2.delete_objects.side_effect = None
        r2.delete_objects.return_value = {}
        self.assertFalse(store.check_storage()['pending'])

    def test_low_storage_never_deletes_and_missing_measurement_fails_closed(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        r2 = Mock()
        store = RunArtifactStore(d1, r2_client=r2, bucket='dev')
        self.assertEqual(store.check_storage()['size'], 1000)
        r2.delete_objects.assert_not_called()
        with patch.object(d1, 'measure_database_size', side_effect=CloudflareStorageError('measurement unavailable')):
            with self.assertRaisesRegex(CloudflareStorageError, 'measurement unavailable'):
                store.check_storage()
        r2.delete_objects.assert_not_called()

    def test_write_budget_exhaustion_preserves_remaining_run(self):
        from datetime import datetime, timezone
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        d1.size = 351_000_000
        d1.connection.execute("INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES (1,'dev','test','successful','2025-01-01','2025-01-01')")
        d1.connection.execute("UPDATE retention_state SET budget_day = ?, writes_reserved = 5000 WHERE id = 1", (datetime.now(timezone.utc).date().isoformat(),))
        store = RunArtifactStore(d1, r2_client=Mock(), bucket='dev')
        with self.assertRaisesRegex(CloudflareStorageError, 'above the safe threshold'):
            store.check_storage()
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM run_logs').fetchone()[0], 1)

    def test_unicode_chunks_round_trip_with_structured_metadata(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        store = RunArtifactStore(d1, bucket='dev')
        text = 'שלום 🎬\n' * 100_000
        metadata = {'item_name': 'Cinema', 'attempt': 2, 'url': 'https://example.test', 'exception_type': 'ValueError'}
        with TemporaryDirectory() as directory, patch.dict(os.environ, {'KARTISERET_RECOVERY_ROOT': directory}):
            store.save_text_artifact(run_id=42, artifact_type='scrape_error', name='Cinema-2', text=text, metadata=metadata)
        diagnostics = store.read_text_artifacts_since(since_iso='2000-01-01')
        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0]['text_content'], text)
        self.assertGreater(diagnostics[0]['chunk_count'], 1)
        row = d1.connection.execute('SELECT scraper,attempt,error_type,source_url FROM diagnostics WHERE chunk_index=0').fetchone()
        self.assertEqual(tuple(row), ('Cinema', 2, 'ValueError', 'https://example.test'))

    def test_regular_diagnostic_occupies_one_row_and_gathering_is_idempotent(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        store = RunArtifactStore(d1, bucket='dev')
        with TemporaryDirectory() as directory, patch.dict(os.environ, {'KARTISERET_RECOVERY_ROOT': directory}):
            store.save_text_artifact(run_id=42, artifact_type='cron_output', name='cron', text='line one\nline two')
            rows = [{'english_title': 'Film', 'new_field': 'retained'}]
            store.save_gathering_rows(run_id=42, scraper='Cinema', source_file='old.csv', rows=rows)
            store.save_gathering_rows(run_id=42, scraper='Cinema', source_file='old.csv', rows=rows)
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM diagnostics').fetchone()[0], 1)
        self.assertEqual(d1.connection.execute('SELECT count(*) FROM gathering_rows').fetchone()[0], 1)
        self.assertIn('retained', d1.connection.execute('SELECT extra_json FROM gathering_rows').fetchone()[0])

    def test_interrupted_chunk_write_retains_recovery_and_manual_retry_is_idempotent(self):
        d1 = SQLiteD1()
        self.addCleanup(d1.connection.close)
        store = RunArtifactStore(d1, bucket='dev')
        text = 'סרט 🎬\n' * 100_000
        execute = d1.execute
        def interrupt(sql, params=()):
            if sql.startswith('INSERT OR IGNORE INTO diagnostics') and params[1] == 1:
                raise RuntimeError('simulated outage')
            return execute(sql, params)
        with TemporaryDirectory() as directory, patch.dict(os.environ, {'KARTISERET_RECOVERY_ROOT': directory}):
            with patch.object(d1, 'execute', side_effect=interrupt):
                with self.assertRaisesRegex(RuntimeError, 'simulated outage'):
                    store.save_text_artifact(run_id=42, artifact_type='cron_output', name='cron', text=text)
            self.assertTrue(list(Path(directory).rglob('*.json')))
            store.save_text_artifact(run_id=42, artifact_type='cron_output', name='cron', text=text)
            self.assertFalse(list(Path(directory).rglob('*.json')))
            self.assertEqual(store.read_text_artifacts_since(since_iso='2000-01-01')[0]['text_content'], text)
