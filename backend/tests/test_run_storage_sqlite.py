from __future__ import annotations

import os
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.utils.log.cloudflare_storage import D1Result
from backend.utils.log.run_storage import RunArtifactStore


class SQLiteD1:
    database_id = 'sqlite-diagnostics-test'

    def __init__(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        schema = Path('backend/cloudflare/d1/migrations/0001_run_artifacts.sql').read_text()
        self.connection.executescript(schema)

    def execute(self, sql, params=()):
        cursor = self.connection.execute(sql, params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        changes = max(0, cursor.rowcount)
        return D1Result(rows, changes, changes, {})

    def batch(self, statements):
        return [self.execute(sql, params) for sql, params in statements]


class SQLiteRunStorageTests(TestCase):
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
