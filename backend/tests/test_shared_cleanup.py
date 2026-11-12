from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import time
from tempfile import TemporaryDirectory
from io import BytesIO
import unittest
from contextlib import nullcontext
from unittest.mock import Mock, patch
from types import SimpleNamespace

from backend.utils.log.cloudflare_storage import CloudflareStorageError, D1Result
from backend.utils.log.run_storage import RunArtifactStore, _schema_ready
from backend.utils.log import shared_cleanup


class SQLiteD1:
    def __init__(self, name: str):
        self.database_id = name
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(
            Path("backend/cloudflare/d1/migrations/0001_run_artifacts.sql").read_text()
        )

    def execute(self, sql, params=()):
        cursor = self.connection.execute(sql, params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        changes = max(0, cursor.rowcount)
        return D1Result(rows, changes, changes, {"results": rows})

    def measure_database_size(self):
        return 1_000


class SharedCleanupTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch("backend.utils.log.job_lease.activate"))
        self.d1 = SQLiteD1(f"cleanup-test-{id(self)}")
        self.addCleanup(self.d1.connection.close)
        _schema_ready.discard(self.d1.database_id)
        self.store = RunArtifactStore(self.d1, r2_client=Mock(), bucket="test-bucket")
        self.store.ensure_schema()

    def test_schema_migrates_shared_cleanup_state_idempotently(self):
        self.assertEqual(
            self.d1.connection.execute("SELECT count(*) FROM cleanup_state WHERE id=1").fetchone()[0],
            1,
        )

    def test_scrape_archive_reader_merges_legacy_rows_with_verified_r2_snapshot(self):
        class MemoryR2:
            objects = {}
            def put_object(inner, *, Bucket, Key, Body, **_kwargs):
                inner.objects[(Bucket, Key)] = bytes(Body)
            def get_object(inner, *, Bucket, Key):
                return {"Body": BytesIO(inner.objects[(Bucket, Key)])}

        r2 = MemoryR2()
        self.store.r2 = r2
        self.d1.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) "
            "VALUES (42,'dev','test','successful','2026-11-10T08:00:00+00:00','2026-11-10')"
        )
        row = {
            "row_key": "same-row", "run_id": 42, "scraper": "Cinema", "attempt": 1,
            "outcome": "successful", "row_order": 0, "english_title": "Film",
            "created_at": "2026-11-10T08:01:00+00:00",
        }
        self.d1.execute(
            "INSERT INTO scraped_rows (row_key,run_id,scraper,attempt,outcome,row_order,english_title,created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (row["row_key"], 42, "Cinema", 1, "successful", 0, "Film", row["created_at"]),
        )
        with TemporaryDirectory() as recovery, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": recovery}):
            self.store.save_scraped_snapshot(
                run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=[row],
            )
        result = self.store.read_scraped_rows_since(since_iso="2026-11-10T00:00:00+00:00")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["english_title"], "Film")
        self.assertIn("artifact_id", result[0])

    def test_scrape_archive_migration_copies_then_resumes_budgeted_deletion(self):
        from backend.utils.log import migrate_scraped_archives

        class MemoryR2:
            objects = {}
            def put_object(inner, *, Bucket, Key, Body, **_kwargs):
                inner.objects[(Bucket, Key)] = bytes(Body)
            def get_object(inner, *, Bucket, Key):
                return {"Body": BytesIO(inner.objects[(Bucket, Key)])}

        self.store.r2 = MemoryR2()
        self.d1.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) "
            "VALUES (43,'dev','test','failed','2026-11-10T08:00:00+00:00','2026-11-10')"
        )
        for index, title in enumerate(("Film A", "Film B", "Film C")):
            self.d1.execute(
                "INSERT INTO scraped_rows (row_key,run_id,scraper,attempt,outcome,row_order,english_title,created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (f"legacy-{index}", 43, "Cinema", 2, "unsuccessful", index, title, "2026-11-10T08:01:00+00:00"),
            )
        budget = Mock()
        budget.available.return_value = 60_000
        lease_context = nullcontext((self.store, "held"))
        patches = (
            patch("backend.utils.log.shared_cleanup._load_target"),
            patch("backend.utils.log.shared_cleanup.maintenance_lease", return_value=lease_context),
            patch("backend.utils.log.migrate_scraped_archives.RunArtifactStore", return_value=self.store),
            patch("backend.utils.log.migrate_scraped_archives.MigrationWriteBudget.from_environment", return_value=budget),
        )
        with TemporaryDirectory() as recovery, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": recovery}):
            with patch("backend.config.target_environment.resolve_target_environment", return_value={"D1_DATABASE_ID": self.d1.database_id, "R2_ACCOUNT_ID": "a" * 32, "D1_API_TOKEN": "x" * 40}), patches[0], patches[1], patches[2], patches[3]:
                copied = migrate_scraped_archives.run("production", phase="copy", apply=True)
            self.assertEqual(copied["rows_copied"], 3)
            self.assertGreater(copied["snapshot_bytes_verified"], 0)
            self.assertEqual(copied["budget_reserved_writes"], 20)
            # Simulate an interruption after one small deletion batch.
            self.d1.execute("DELETE FROM scraped_rows WHERE row_key = ?", ("legacy-0",))
            with patch("backend.config.target_environment.resolve_target_environment", return_value={"D1_DATABASE_ID": self.d1.database_id, "R2_ACCOUNT_ID": "a" * 32, "D1_API_TOKEN": "x" * 40}), patches[0], patches[1], patches[2], patches[3]:
                deleted = migrate_scraped_archives.run("production", phase="delete", apply=True)
        self.assertEqual(deleted["rows_deleted"], 2)
        self.assertGreater(deleted["snapshot_bytes_verified"], 0)
        self.assertEqual(deleted["budget_reserved_writes"], 16)
        self.assertEqual(self.d1.connection.execute("SELECT count(*) FROM scraped_rows WHERE run_id=43").fetchone()[0], 0)
        self.assertEqual(self.d1.connection.execute("SELECT count(*) FROM artifacts WHERE artifact_type='scraped_snapshot' AND run_id=43").fetchone()[0], 1)

    def test_migration_budget_is_persistent_and_resets_by_d1_utc_day(self):
        from backend.utils.log.migrate_scraped_archives import MigrationWriteBudget

        budget = MigrationWriteBudget(self.d1)
        budget.initialize()
        budget.reserve(59_990)
        self.assertEqual(budget.available(), 10)
        with self.assertRaisesRegex(CloudflareStorageError, "budget exhausted"):
            budget.reserve(11)
        yesterday = self.d1.execute("SELECT date('now','-1 day') AS day").rows[0]["day"]
        self.d1.execute("UPDATE snapshot_migration_budget SET day_utc = ? WHERE id = 1", (yesterday,))
        self.assertEqual(budget.available(), 60_000)

    def test_uncertain_budget_reservation_remains_charged(self):
        from backend.utils.log.migrate_scraped_archives import MigrationWriteBudget

        budget = MigrationWriteBudget(self.d1)
        budget.initialize()
        execute = self.d1.execute

        def commit_then_lose_response(sql, params=()):
            result = execute(sql, params)
            if sql.startswith("UPDATE snapshot_migration_budget"):
                raise CloudflareStorageError("uncertain response after reservation commit")
            return result

        with patch.object(self.d1, "execute", side_effect=commit_then_lose_response):
            with self.assertRaisesRegex(CloudflareStorageError, "uncertain response"):
                budget.reserve(321)
        self.assertEqual(budget.available(), 60_000 - 321)

    def test_expired_snapshot_cleanup_deletes_object_before_catalog(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        self.d1.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,finished_at,created_at) "
            "VALUES (51,'dev','test','failed','2025-01-01',?,'2025-01-01')", (old,),
        )
        object_key = "runs/2025-01-01/51/scraped_snapshots/Cinema-1-deadbeef.json.gz"
        self.d1.execute(
            "INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,metadata_json,created_at) "
            "VALUES ('snapshot',51,'scraped_snapshot','Cinema-1',?,'application/gzip','{\"size_bytes\":1234}',?)",
            (object_key, old),
        )
        self.store.r2 = Mock()
        with patch("backend.utils.log.shared_cleanup._recoverable_run_ids", return_value=set()):
            dry = shared_cleanup.cleanup_scraped_snapshots(self.store, apply=False)
            applied = shared_cleanup.cleanup_scraped_snapshots(self.store, apply=True)
        self.assertEqual(dry["eligible"], 1)
        self.assertEqual(applied["deleted"], 1)
        self.assertEqual(applied["deleted_bytes"], 1234)
        self.assertEqual(applied["retained_bytes"], 0)
        self.store.r2.delete_object.assert_called_once_with(Bucket="test-bucket", Key=object_key)
        self.assertEqual(self.d1.execute("SELECT count(*) AS c FROM artifacts WHERE artifact_id='snapshot'").rows[0]["c"], 0)
        self.store.ensure_schema()
        self.assertEqual(
            self.d1.connection.execute("SELECT count(*) FROM cleanup_state WHERE id=1").fetchone()[0],
            1,
        )

    def test_snapshot_catalog_is_retained_when_r2_deletion_is_uncertain(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        self.d1.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,finished_at,created_at) "
            "VALUES (55,'dev','test','successful','2025-01-01',?,'2025-01-01')", (old,),
        )
        object_key = "runs/2025-01-01/55/scraped_snapshots/Cinema-1-deadbeef.json.gz"
        self.d1.execute(
            "INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,metadata_json,created_at) "
            "VALUES ('snapshot-r2-failure',55,'scraped_snapshot','Cinema-1',?,'application/gzip','{\"size_bytes\":1234}',?)",
            (object_key, old),
        )
        self.store.r2 = Mock()
        self.store.r2.delete_object.side_effect = RuntimeError("timeout")
        with patch("backend.utils.log.shared_cleanup._recoverable_run_ids", return_value=set()):
            with self.assertRaisesRegex(CloudflareStorageError, "deletion was not confirmed"):
                shared_cleanup.cleanup_scraped_snapshots(self.store, apply=True)
        self.assertEqual(
            self.d1.execute("SELECT count(*) AS c FROM artifacts WHERE artifact_id='snapshot-r2-failure'").rows[0]["c"],
            1,
        )

    def test_snapshot_without_confirmed_completion_time_is_retained(self):
        old = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        self.d1.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,finished_at,created_at) "
            "VALUES (52,'dev','test','failed','2025-01-01',NULL,'2025-01-01')"
        )
        object_key = "runs/2025-01-01/52/scraped_snapshots/Cinema-1-deadbeef.json.gz"
        self.d1.execute(
            "INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,metadata_json,created_at) "
            "VALUES ('snapshot-no-finish',52,'scraped_snapshot','Cinema-1',?,'application/gzip','{\"size_bytes\":1234}',?)",
            (object_key, old),
        )
        self.store.r2 = Mock()
        with patch("backend.utils.log.shared_cleanup._recoverable_run_ids", return_value=set()):
            result = shared_cleanup.cleanup_scraped_snapshots(self.store, apply=True)
        self.assertEqual(result["deleted"], 0)
        self.assertEqual(result["protected"], 1)
        self.assertEqual(result["retained_bytes"], 1234)
        self.store.r2.delete_object.assert_not_called()
        self.assertEqual(
            self.d1.execute("SELECT count(*) AS c FROM artifacts WHERE artifact_id='snapshot-no-finish'").rows[0]["c"],
            1,
        )

    def test_snapshot_cleanup_respects_deletion_batch_and_reports_remaining_bytes(self):
        old = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        for run_id in (53, 54):
            self.d1.execute(
                "INSERT INTO run_logs (run_id,target,run_from,status,started_at,finished_at,created_at) "
                "VALUES (?, 'dev','test','successful','2025-01-01',?,'2025-01-01')", (run_id, old),
            )
            self.d1.execute(
                "INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,metadata_json,created_at) "
                "VALUES (?,?,'scraped_snapshot','Cinema-1',?,'application/gzip','{\"size_bytes\":1234}',?)",
                (f"snapshot-{run_id}", run_id,
                 f"runs/2025-01-01/{run_id}/scraped_snapshots/Cinema-1-deadbeef.json.gz", old),
            )
        self.store.r2 = Mock()
        with patch("backend.utils.log.shared_cleanup._recoverable_run_ids", return_value=set()):
            result = shared_cleanup.cleanup_scraped_snapshots(self.store, apply=True, max_deletes=1)
        self.assertEqual(result["eligible"], 2)
        self.assertEqual(result["deletion_batch"], 1)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["deleted_bytes"], 1234)
        self.assertEqual(result["retained"], 1)
        self.assertEqual(result["retained_bytes"], 1234)
        self.store.r2.delete_object.assert_called_once()

    def test_target_lease_can_be_renewed_and_released(self):
        token = self.store.acquire_run_lease()
        self.store.renew_run_lease(token)
        self.store.release_run_lease(token=token)
        self.assertEqual(
            self.d1.connection.execute("SELECT lease_token FROM run_locks WHERE id=1").fetchone()[0],
            "",
        )

    def test_elapsed_timestamp_never_allows_a_second_owner(self):
        token = self.store.acquire_run_lease()
        self.d1.execute("UPDATE run_locks SET lease_until = '1970-01-01T00:00:00+00:00' WHERE id=1")
        with self.assertRaises(CloudflareStorageError):
            self.store.renew_run_lease(token)
        with self.assertRaises(CloudflareStorageError):
            self.store.release_run_lease(token="another-owner")
        self.store.release_run_lease(token=token)
        self.assertNotEqual(self.store.acquire_run_lease(), token)

    def test_uncertain_finalization_is_preserved_across_release_and_takeover(self):
        token = self.store.acquire_run_lease()
        self.store.attach_run_id_to_lease(token, 42)
        self.store.release_run_lease(token=token, reconcile_run_id=42)
        row = self.d1.execute('SELECT * FROM run_locks WHERE id=1').rows[0]
        self.assertEqual(row['lease_token'], '')
        self.assertEqual(row['predecessor_run_id'], 42)
        self.store.acquire_run_lease()
        self.assertEqual(self.store.predecessor_run_id, 42)

    def test_failed_recovery_marker_write_does_not_release_ownership(self):
        token = self.store.acquire_run_lease()
        self.store.attach_run_id_to_lease(token, 42)
        with patch.object(self.d1, 'execute', side_effect=CloudflareStorageError('offline')), patch(
            'backend.utils.log.job_lease.deactivate'
        ) as deactivate:
            with self.assertRaises(CloudflareStorageError):
                self.store.release_run_lease(token=token, reconcile_run_id=42)
        deactivate.assert_not_called()
        self.assertEqual(self.d1.execute('SELECT lease_token FROM run_locks').rows[0]['lease_token'], token)

    def test_unconfirmed_session_finalization_preserves_predecessor(self):
        from backend.utils.log.run_logging import RunLogSession
        session = RunLogSession()
        session.run_id, session._start_time = 42, 1.0
        session._storage, session._lease_token = Mock(), 'owner'
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
        with patch.dict('os.environ', {'SUPABASE_URL': 'url', 'SUPABASE_SERVICE_ROLE_KEY': 'key'}), patch(
            'backend.utils.log.run_logging.create_client', return_value=client
        ), patch('backend.utils.log.run_logging.write_recovery_envelope'), self.assertRaisesRegex(RuntimeError, 'unconfirmed in Supabase'):
            session.__exit__(None, None, None)
        session._storage.release_run_lease.assert_called_once_with(token='owner', reconcile_run_id=42)

    def test_recovery_requires_confirmation_and_exact_owner(self):
        from backend.utils.log.recover_run_lock import recover_lock
        token = self.store.acquire_run_lease()
        with self.assertRaises(ValueError):
            recover_lock(self.store, Mock(), expected_token=token, owner_stopped=False)
        with self.assertRaises(CloudflareStorageError):
            recover_lock(self.store, Mock(), expected_token="wrong", owner_stopped=True)
        recover_lock(self.store, Mock(), expected_token=token, owner_stopped=True)
        self.store.acquire_run_lease()

    def test_missing_artwork_configuration_prevents_retention_mutation(self):
        with patch("backend.dataflow.utils.ArtworkStorage.ArtworkStorage.from_environment", return_value=None), patch.object(
            self.store, "check_storage"
        ) as retention:
            with self.assertRaises(RuntimeError):
                shared_cleanup.run_shared_cleanup(self.store, lease_token="held", target="development", apply=True)
        retention.assert_not_called()

    def test_publication_cleanup_dry_run_reports_candidates_without_repeating(self):
        client = Mock()
        client.rpc.return_value.execute.return_value.data = {"eligible": 7, "deleted": 0}
        lease_guard = Mock(spec=[])

        result = shared_cleanup.cleanup_abandoned_publications(
            client, apply=False, lease_guard=lease_guard,
        )

        self.assertEqual(result, {"eligible": 7, "deleted": 0})
        client.rpc.assert_called_once_with("prune_abandoned_publications", {"p_apply": False})
        lease_guard.assert_called_once_with()

    def test_publication_cleanup_applies_all_batches_and_verifies_lease_each_time(self):
        client = Mock()
        client.rpc.return_value.execute.side_effect = [
            SimpleNamespace(data={"eligible": 235, "deleted": 100}),
            SimpleNamespace(data={"eligible": 135, "deleted": 100}),
            SimpleNamespace(data={"eligible": 35, "deleted": 35}),
        ]
        lease_guard = Mock(spec=[])

        result = shared_cleanup.cleanup_abandoned_publications(
            client, apply=True, lease_guard=lease_guard,
        )

        self.assertEqual(result, {"eligible": 235, "deleted": 235})
        self.assertEqual(client.rpc.call_count, 3)
        self.assertEqual(lease_guard.call_count, 3)

    def test_publication_cleanup_retries_a_partial_batch_when_rows_remain_eligible(self):
        client = Mock()
        client.rpc.return_value.execute.side_effect = [
            SimpleNamespace(data={"eligible": 100, "deleted": 99}),
            SimpleNamespace(data={"eligible": 1, "deleted": 1}),
        ]
        lease_guard = Mock(spec=[])

        result = shared_cleanup.cleanup_abandoned_publications(
            client, apply=True, lease_guard=lease_guard,
        )

        self.assertEqual(result, {"eligible": 100, "deleted": 100})
        self.assertEqual(client.rpc.call_count, 2)
        self.assertEqual(lease_guard.call_count, 2)

    def test_publication_cleanup_rejects_malformed_rpc_result(self):
        client = Mock()
        client.rpc.return_value.execute.return_value.data = {"eligible": "7", "deleted": 0}
        with self.assertRaisesRegex(RuntimeError, "invalid result"):
            shared_cleanup.cleanup_abandoned_publications(client, apply=False)

    def test_publications_only_cli_runs_under_lease_without_daily_marker(self):
        lease = nullcontext((self.store, "held"))
        with patch.object(shared_cleanup, "_load_target"), patch.object(
            shared_cleanup, "maintenance_lease", return_value=lease,
        ), patch.object(
            shared_cleanup, "_supabase_client", return_value=object(),
        ), patch.object(
            shared_cleanup, "cleanup_abandoned_publications",
            return_value={"eligible": 3, "deleted": 3},
        ) as cleanup, patch.object(shared_cleanup, "run_shared_cleanup") as daily_cleanup:
            result = shared_cleanup.main([
                "--target", "development", "--publications-only", "--apply",
            ])

        self.assertEqual(result, 0)
        cleanup.assert_called_once()
        daily_cleanup.assert_not_called()

    def test_publications_only_cli_skips_when_another_run_holds_lease(self):
        with patch.object(shared_cleanup, "_load_target"), patch.object(
            shared_cleanup, "maintenance_lease", return_value=nullcontext(None),
        ), patch.object(shared_cleanup, "cleanup_abandoned_publications") as cleanup:
            result = shared_cleanup.main([
                "--target", "development", "--publications-only", "--dry-run",
            ])

        self.assertEqual(result, 0)
        cleanup.assert_not_called()

    def test_publication_cleanup_has_a_separate_weekly_workflow(self):
        daily = Path(".github/workflows/daily_shared_cleanup.yml").read_text()
        weekly = Path(".github/workflows/weekly_publication_cleanup.yml").read_text()
        self.assertIn('"0 2 * * *"', daily)
        self.assertNotIn("0 3 * * 0", daily)
        self.assertIn('"0 3 * * 0"', weekly)
        self.assertIn("workflow_dispatch:", weekly)
        self.assertIn("--publications-only", weekly)
        self.assertIn("concurrency:", weekly)
        self.assertNotIn("KARTISERET_SHARED_CLEANUP_ENABLED", weekly)
        self.assertIn("vars.KARTISERET_SHARED_CLEANUP_APPLY", weekly)

    def test_publication_reference_source_rejects_missing_pages(self):
        from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace
        client = Mock()
        client.table.return_value.select.return_value.order.return_value.range.return_value.execute.return_value.data = None
        workspace = PublicationWorkspace("nowplayings", client=client)
        with self.assertRaisesRegex(RuntimeError, "Incomplete or malformed"):
            workspace._load("finalMovies")
        self.assertEqual(workspace.tables, {})

    def test_pipeline_recovery_marks_unconfirmed_before_release(self):
        from backend.utils.log.recover_run_lock import recover_lock
        token = self.store.acquire_run_lease()
        self.store.attach_run_id_to_lease(token, 42)
        self.store.start_run(run_id=42, target="development", run_from="test")
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = [{"run_id": 42}]
        recover_lock(self.store, client, expected_token=token, owner_stopped=True)
        self.assertEqual(self.d1.execute("SELECT status FROM run_logs WHERE run_id=42").rows[0]["status"], "unconfirmed")
        self.store.acquire_run_lease()

    def test_unconfirmed_run_recovery_retains_lock_when_supabase_fails(self):
        from backend.utils.log.recover_run_lock import recover_lock
        token = self.store.acquire_run_lease()
        self.store.attach_run_id_to_lease(token, 42)
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
        with self.assertRaises(CloudflareStorageError):
            recover_lock(self.store, client, expected_token=token, owner_stopped=True)
        with self.assertRaises(CloudflareStorageError):
            self.store.acquire_run_lease()

    def test_lease_renewal_callback_throttles_d1_writes(self):
        with patch("backend.utils.log.shared_cleanup.time.monotonic", side_effect=[0.0, 100.0, 110.0, 161.0]), patch.object(
            self.store, "renew_run_lease"
        ) as renew:
            guard = shared_cleanup.lease_renewal_callback(self.store, "held")
            guard()
            guard()
            guard()
        self.assertEqual(renew.call_count, 2)

    def test_destructive_check_revalidates_even_inside_throttle_window(self):
        with patch.object(self.store, "renew_run_lease") as renew:
            guard = shared_cleanup.lease_renewal_callback(self.store, "held")
            guard()
            renew.side_effect = CloudflareStorageError("lease lost")
            with self.assertRaisesRegex(CloudflareStorageError, "lease lost"):
                shared_cleanup.verify_lease(guard)
            self.assertEqual(renew.call_count, 2)

    def test_orphan_artifact_cleanup_aborts_on_incomplete_d1_scan(self):
        broken_d1 = Mock()
        broken_d1.execute.return_value = D1Result([], 0, 0, {"results": [{"run_id": 1}, None]})
        store = RunArtifactStore(broken_d1, r2_client=Mock(), bucket="test-bucket")
        with self.assertRaisesRegex(CloudflareStorageError, "incomplete or malformed"):
            shared_cleanup.cleanup_orphan_run_artifacts(store, apply=True)
        store.r2.get_paginator.assert_not_called()
        store.r2.delete_objects.assert_not_called()

    def test_orphan_movie_reference_scan_aborts_on_malformed_rows(self):
        from backend.utils.supabase.clear_orphan_final_movies import select_tmdb_ids

        client = Mock()
        client.table.return_value.select.return_value.range.return_value.execute.return_value.data = [None]
        with self.assertRaisesRegex(RuntimeError, "incomplete or malformed"):
            select_tmdb_ids(client, "finalShowtimes")

    def test_scheduled_cleanup_reports_safe_skip_when_target_lease_is_busy(self):
        busy_store = Mock()
        busy_store.ensure_schema.return_value = None
        busy_store.acquire_run_lease.side_effect = CloudflareStorageError(
            "Another scraper run holds the D1 run lease; no run was started."
        )
        with patch.object(shared_cleanup, "RunArtifactStore", return_value=busy_store), patch(
            "backend.utils.log.r2_budget.initialize_job_budget"
        ), patch.object(shared_cleanup, "_print_r2_budget_summary"):
            with shared_cleanup.maintenance_lease(skip_if_busy=True) as lease:
                self.assertIsNone(lease)
        busy_store.release_run_lease.assert_not_called()

    def test_daily_marker_skips_catalog_scans_but_keeps_d1_check(self):
        now = datetime(2026, 11, 5, 2, tzinfo=timezone.utc)
        self.d1.connection.execute(
            "UPDATE cleanup_state SET last_successful_cleanup_day=? WHERE id=1",
            (now.date().isoformat(),),
        )
        with patch.object(self.store, "check_storage", return_value={"size": 123}) as check, patch.object(
            self.store, "renew_run_lease"
        ), patch(
            "backend.utils.supabase.clear_old_entries.clear_old_entries"
        ) as old_entries, patch("backend.dataflow.utils.ArtworkStorage.ArtworkStorage.from_environment", return_value=object()):
            result = shared_cleanup.run_shared_cleanup(
                self.store, lease_token="held", target="development", apply=True, now=now,
            )
        self.assertEqual(result["skipped"], "already-cleaned-today")
        check.assert_called_once_with(lease_token="held")
        old_entries.assert_not_called()

    def test_pipeline_preflight_renders_cleanup_counts_storage_and_skip_reason(self):
        from io import StringIO
        from rich.console import Console

        output = StringIO()
        console = Console(file=output, force_terminal=False)
        guard = Mock()
        guard.summary.return_value = {
            "estimated_bytes": 1536000,
            "high_bytes": 6000000000,
            "low_bytes": 5000000000,
            "blocked": None,
        }
        report = {
            "target": "development",
            "mode": "apply",
            "d1_before": {"size": 79843328},
            "d1_after": {"size": 75000000},
            "supabase_old_entries": {"allShowtimes": 3, "finalShowtimes": 1},
            "orphan_final_movies": 2,
            "artwork": {"eligible": 3, "deleted": 2},
        }
        with patch.dict("os.environ", {"KARTISERET_TARGET": "development"}), patch.object(
            shared_cleanup, "resolve_target_environment"
        ), patch.object(shared_cleanup, "_cleanup_apply_from_environment", return_value=True), patch.object(
            shared_cleanup, "run_shared_cleanup", return_value=report
        ), patch(
            "backend.utils.log.r2_storage_guard.initialize_storage_guard", return_value=guard
        ), patch(
            "rich.console.Console", return_value=console
        ), patch(
            "backend.utils.console.stage_progress.load_stage_estimate", return_value=1
        ), patch(
            "backend.utils.console.stage_progress.record_stage_duration"
        ):
            result = shared_cleanup.run_pipeline_preflight(self.store, lease_token="held")

        self.assertEqual(result["artwork"]["deleted"], 2)
        rendered = output.getvalue()
        self.assertIn("Shared cleanup", rendered)
        self.assertIn("development", rendered)
        self.assertIn("apply", rendered)
        self.assertIn("2 removed", rendered)
        self.assertIn("allShowtimes 3", rendered)
        self.assertIn("2 removed", rendered)
        self.assertIn("79.8 MB", rendered)
        self.assertIn("6.0 GB", rendered)

        output.seek(0)
        output.truncate(0)
        guard.summary.return_value = {"estimated_bytes": 12, "high_bytes": 100, "low_bytes": 50, "blocked": None}
        skipped = {"target": "development", "mode": "apply", "skipped": "already-cleaned-today"}
        with patch.dict("os.environ", {"KARTISERET_TARGET": "development"}), patch.object(
            shared_cleanup, "resolve_target_environment"
        ), patch.object(shared_cleanup, "_cleanup_apply_from_environment", return_value=True), patch.object(
            shared_cleanup, "run_shared_cleanup", return_value=skipped
        ), patch(
            "backend.utils.log.r2_storage_guard.initialize_storage_guard", return_value=guard
        ), patch(
            "rich.console.Console", return_value=console
        ), patch(
            "backend.utils.console.stage_progress.load_stage_estimate", return_value=1
        ), patch(
            "backend.utils.console.stage_progress.record_stage_duration"
        ):
            result = shared_cleanup.run_pipeline_preflight(self.store, lease_token="held")
        self.assertEqual(result["skipped"], "already-cleaned-today")
        self.assertIn("already-cleaned-today", output.getvalue())

    def test_complete_dry_run_records_only_dry_run_day_and_reports_all_categories(self):
        now = datetime(2026, 11, 5, 2, tzinfo=timezone.utc)
        order = []
        report = {"eligible_objects": 0, "deleted": 0}
        with patch.object(self.store, "check_storage", side_effect=lambda **_kwargs: {"size": 10}), patch.object(
            self.store, "renew_run_lease", side_effect=lambda _token: order.append("renew")
        ), patch.object(self.store, "mark_cleanup_attempt") as mark, patch(
            "backend.utils.supabase.clear_old_entries.clear_old_entries",
            side_effect=lambda **kwargs: (order.append("old_entries"), {"old": 2})[1],
        ), patch(
            "backend.utils.supabase.clear_orphan_final_movies.clear_orphan_final_movies",
            side_effect=lambda **kwargs: (order.append("orphan_movies"), 3)[1],
        ), patch(
            "backend.utils.supabase.clear_orphan_final_theque_movies.clear_orphan_final_theque_movies",
            side_effect=lambda **kwargs: (order.append("orphan_theques"), 4)[1],
        ), patch(
            "backend.dataflow.utils.ArtworkStorage.ArtworkStorage.from_environment",
            return_value=object(),
        ), patch(
            "backend.dataflow.backfill_catalog_artwork.run_cleanup",
            side_effect=lambda *_args, **kwargs: (order.append("artwork"), report)[1],
        ), patch(
            "backend.dataflow.social_previews.cleanup_social_previews",
            side_effect=lambda *_args, **kwargs: (order.append("social"), report)[1],
        ), patch.object(
            shared_cleanup, "cleanup_orphan_run_artifacts",
            side_effect=lambda *_args, **kwargs: (order.append("artifacts"), report)[1],
        ), patch.object(shared_cleanup, "_supabase_client", return_value=object()):
            result = shared_cleanup.run_shared_cleanup(
                self.store, lease_token="held", target="development", apply=False, now=now,
            )
        self.assertEqual(
            [name for name in order if name in {"old_entries", "orphan_movies", "orphan_theques", "artwork", "social", "artifacts"}],
            ["old_entries", "orphan_movies", "orphan_theques", "artwork", "social", "artifacts"],
        )
        self.assertIn("d1_before", result)
        self.assertIn("d1_after", result)
        mark.assert_called_once_with(now.date().isoformat(), successful=False)

    def test_orphan_run_artifact_cleanup_retains_references_and_uncertain_runs(self):
        old = datetime.now(timezone.utc) - timedelta(days=31)
        recent = datetime.now(timezone.utc) - timedelta(days=1)
        self.d1.connection.executescript("""
            INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES
              (1,'dev','test','successful','2025-01-01','2025-01-01'),
              (2,'dev','test','running','2025-01-01','2025-01-01'),
              (3,'dev','test','unconfirmed','2025-01-01','2025-01-01'),
              (4,'dev','test','failed','2025-01-01','2025-01-01');
            INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,created_at)
              VALUES ('ref',1,'screenshots','ref','runs/2025-01-01/1/screenshots/ref.webp','image/webp','2025-01-01');
        """)
        orphan = "runs/2025-01-01/1/screenshots/orphan.webp"
        r2 = Mock()
        r2.delete_objects.return_value = {}
        r2.get_paginator.return_value.paginate.return_value = [{"Contents": [
            {"Key": orphan, "LastModified": old},
            {"Key": "runs/2025-01-01/1/screenshots/ref.webp", "LastModified": old},
            {"Key": "runs/2025-01-01/1/screenshots/recent.webp", "LastModified": recent},
            {"Key": "runs/2025-01-01/2/screenshots/active.webp", "LastModified": old},
            {"Key": "runs/2025-01-01/3/screenshots/unconfirmed.webp", "LastModified": old},
            {"Key": "runs/2025-01-01/4/screenshots/failed.webp", "LastModified": old},
            {"Key": "runs/2025-01-01/5/screenshots/unknown.webp", "LastModified": old},
            {"Key": "runs/unknown-owner", "LastModified": old},
        ]}]
        self.store.r2 = r2
        with TemporaryDirectory() as recovery:
            with patch.object(shared_cleanup, "recovery_root", return_value=Path(recovery)):
                dry = shared_cleanup.cleanup_orphan_run_artifacts(self.store, apply=False)
                applied = shared_cleanup.cleanup_orphan_run_artifacts(self.store, apply=True)
        self.assertEqual(dry["eligible_objects"], 1)
        self.assertEqual(applied["deleted"], 1)
        self.assertEqual(
            r2.delete_objects.call_args.kwargs["Delete"]["Objects"],
            [{"Key": orphan}],
        )

    def test_bad_d1_artifact_reference_aborts_before_r2_listing(self):
        self.d1.connection.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES (1,'dev','test','successful','2025','2025')"
        )
        self.d1.connection.execute(
            "INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,created_at) VALUES ('bad',1,'x','x','runs/bad-key','x','2025')"
        )
        self.store.r2 = Mock()
        with TemporaryDirectory() as recovery, patch.object(
            shared_cleanup, "recovery_root", return_value=Path(recovery)
        ):
            with self.assertRaisesRegex(CloudflareStorageError, "invalid R2 key"):
                shared_cleanup.cleanup_orphan_run_artifacts(self.store, apply=True)
        self.store.r2.get_paginator.assert_not_called()

    def test_recovery_envelope_keeps_its_successful_run_objects(self):
        old = datetime.now(timezone.utc) - timedelta(days=31)
        self.d1.connection.execute(
            "INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES (8,'dev','test','successful','2025','2025')"
        )
        key = "runs/2025-01-01/8/screenshots/recover.webp"
        r2 = Mock()
        r2.get_paginator.return_value.paginate.return_value = [{"Contents": [{"Key": key, "LastModified": old}]}]
        self.store.r2 = r2
        with TemporaryDirectory() as recovery:
            folder = Path(recovery) / "file_artifacts"
            folder.mkdir()
            (folder / "8-recover.json").write_text(json.dumps({"run_id": 8}))
            with patch.object(shared_cleanup, "recovery_root", return_value=Path(recovery)):
                result = shared_cleanup.cleanup_orphan_run_artifacts(self.store, apply=True)
        self.assertEqual(result["eligible_objects"], 0)
        r2.delete_objects.assert_not_called()

    def test_post_run_storage_check_uses_lease_before_releasing_and_marks_failure(self):
        from backend.utils.log.run_logging import RunLogSession

        timeline = []
        session = RunLogSession()
        session.run_id = 42
        session._start_time = 1.0
        session._storage = Mock()
        session._lease_token = "lease-token"
        session._storage.finalize_run.side_effect = lambda **_kwargs: timeline.append("finalize")
        session._storage.check_storage.side_effect = lambda **_kwargs: (timeline.append("check"), (_ for _ in ()).throw(RuntimeError("D1 size check failed")))[1]
        session._storage.release_run_lease.side_effect = lambda **_kwargs: timeline.append("release")
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.side_effect = [
            SimpleNamespace(data=[{"run_id": 42}]),
            SimpleNamespace(data=[{"run_id": 42}]),
        ]
        with patch.dict("os.environ", {"SUPABASE_URL": "https://example.test", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}), patch("backend.utils.log.run_logging.create_client", return_value=client), patch(
            "backend.utils.log.run_logging.write_recovery_envelope"
        ):
            with self.assertRaisesRegex(RuntimeError, "storage check failed; status is failed"):
                session.__exit__(None, None, None)
        self.assertEqual(timeline, ["finalize", "check", "finalize", "release"])
        self.assertEqual(session._storage.finalize_run.call_args.kwargs["error_type"], "storage_check_failed")

    def test_finalization_renders_confirmed_status_storage_and_lease(self):
        from io import StringIO
        from rich.console import Console
        from backend.utils.log.run_logging import RunLogSession
        from backend.utils.log import job_lease

        timeline = []

        def save_timing(*_args):
            job_lease.before_mutation()
            timeline.append("timing")

        def release(**_kwargs):
            timeline.append("release")
            job_lease._retired = True

        output = StringIO()
        console = Console(file=output, force_terminal=False)
        session = RunLogSession()
        session.run_id = 42
        session._start_time = time.monotonic() - 1
        session._storage = Mock()
        session._storage.release_run_lease.side_effect = release
        session._lease_token = "lease-token"
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{"run_id": 42}])
        with patch.dict(
            "os.environ",
            {
                "SUPABASE_URL": "https://example.test",
                "SUPABASE_SERVICE_ROLE_KEY": "test-key",
                "KARTISERET_TARGET": "development",
            },
        ), patch("backend.utils.log.run_logging.create_client", return_value=client), patch(
            "backend.utils.log.r2_budget.R2Budget.from_environment", return_value=None
        ), patch(
            "rich.console.Console", return_value=console
        ), patch(
            "backend.utils.console.stage_progress.load_stage_estimate", return_value=20
        ), patch(
            "backend.utils.console.stage_progress.record_stage_duration", side_effect=save_timing
        ), patch.object(job_lease, "_active", None), patch.object(job_lease, "_retired", False), patch.dict(
            "os.environ", {job_lease.TOKEN_ENV: ""}
        ):
            session.__exit__(None, None, None)

        self.assertEqual(timeline, ["timing", "release"])

        rendered = output.getvalue()
        self.assertIn("Run finalization", rendered)
        self.assertIn("Successful", rendered)
        self.assertIn("Confirmed in Supabase", rendered)
        self.assertIn("Passed", rendered)
        self.assertIn("Released", rendered)

    def test_r2_budget_failure_preserves_error_without_another_r2_cleanup_attempt(self):
        from backend.utils.log.r2_budget import R2BudgetExceeded
        from backend.utils.log.run_logging import RunLogSession

        session = RunLogSession()
        session.run_id = 43
        session._start_time = 1.0
        session._storage = Mock()
        session._lease_token = "lease-token"
        session._storage.d1.measure_database_size.return_value = 1234
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[{"run_id": 43}])
        error = R2BudgetExceeded("Class A operation budget reached")
        with patch.dict("os.environ", {"SUPABASE_URL": "https://example.test", "SUPABASE_SERVICE_ROLE_KEY": "test-key"}), patch(
            "backend.utils.log.run_logging.create_client", return_value=client
        ), patch("backend.utils.log.r2_budget.R2Budget.from_environment", return_value=None):
            self.assertFalse(session.__exit__(R2BudgetExceeded, error, None))
        session._storage.d1.measure_database_size.assert_called_once_with()
        session._storage.check_storage.assert_not_called()
        session._storage.finalize_run.assert_called_once()
        finalize_args = session._storage.finalize_run.call_args.kwargs
        self.assertEqual(finalize_args["run_id"], 43)
        self.assertFalse(finalize_args["successful"])
        self.assertEqual(finalize_args["error_type"], "R2BudgetExceeded")
        session._storage.release_run_lease.assert_called_once_with(token="lease-token")

    def test_supabase_old_entry_dry_run_reports_candidates_without_deleting(self):
        from backend.utils.supabase import clear_old_entries

        client = Mock()
        client.rpc.side_effect = lambda _name, args: SimpleNamespace(
            execute=lambda: SimpleNamespace(data={"table": args["p_table"], "eligible": 3,
                                                  "deleted": 0, "has_more": False}))
        guard = Mock()
        with patch.object(clear_old_entries, "create_client", return_value=client):
            counts = clear_old_entries.clear_old_entries(apply=False, lease_guard=guard)
        self.assertEqual(set(counts), {"allShowtimes", "finalShowtimes", "allSoons", "finalSoons", "allTheques", "finalTheques"})
        self.assertEqual(set(counts.values()), {3})
        self.assertEqual(guard.verify.call_count, 6)
        client.table.assert_not_called()

    def test_orphan_movie_dry_run_reports_candidates_without_deleting(self):
        from backend.utils.supabase import clear_orphan_final_movies

        client = Mock()
        with patch.object(clear_orphan_final_movies, "create_client", return_value=client), patch.object(
            clear_orphan_final_movies, "select_tmdb_ids", side_effect=[{1, 2}, {1, 2, 3}],
        ), patch(
            "backend.dataflow.utils.PublicationWorkspace.maintenance_publication",
            side_effect=lambda _category: nullcontext(),
        ):
            count = clear_orphan_final_movies.clear_orphan_final_movies(apply=False)
        self.assertEqual(count, 1)
        client.table.return_value.delete.assert_not_called()


if __name__ == "__main__":
    unittest.main()
