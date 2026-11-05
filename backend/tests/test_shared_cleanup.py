from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
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
        self.store.ensure_schema()
        self.assertEqual(
            self.d1.connection.execute("SELECT count(*) FROM cleanup_state WHERE id=1").fetchone()[0],
            1,
        )

    def test_target_lease_can_be_renewed_and_released(self):
        token = self.store.acquire_run_lease()
        self.store.renew_run_lease(token)
        self.store.release_run_lease(token=token)
        self.assertEqual(
            self.d1.connection.execute("SELECT lease_token FROM run_locks WHERE id=1").fetchone()[0],
            "",
        )

    def test_lease_renewal_callback_throttles_d1_writes(self):
        with patch("backend.utils.log.shared_cleanup.time.monotonic", side_effect=[0.0, 100.0, 110.0, 161.0]), patch.object(
            self.store, "renew_run_lease"
        ) as renew:
            guard = shared_cleanup.lease_renewal_callback(self.store, "held")
            guard()
            guard()
            guard()
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
        ) as old_entries:
            result = shared_cleanup.run_shared_cleanup(
                self.store, lease_token="held", target="development", apply=True, now=now,
            )
        self.assertEqual(result["skipped"], "already-cleaned-today")
        check.assert_called_once_with(lease_token="held")
        old_entries.assert_not_called()

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
        query = Mock()
        query.select.return_value = query
        query.lte.return_value = query
        query.order.return_value = query
        query.range.return_value = query
        query.execute.return_value = SimpleNamespace(data=[])
        client.table.return_value = query
        guard = Mock()
        with patch.object(clear_old_entries, "create_client", return_value=client), patch(
            "backend.utils.supabase.clear_old_entries.maintenance_publication",
            side_effect=lambda _category: nullcontext(),
        ):
            counts = clear_old_entries.clear_old_entries(apply=False, lease_guard=guard)
        self.assertEqual(set(counts), {"allShowtimes", "finalShowtimes", "allSoons", "finalSoons", "allTheques", "finalTheques"})
        self.assertEqual(guard.call_count, 6)
        query.delete.assert_not_called()

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
