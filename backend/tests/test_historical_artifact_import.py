from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock

from backend.utils.log.import_historical_artifacts import (
    import_candidates,
    scan_import_candidates,
)


class HistoricalArtifactImportTests(TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "logger_artifacts"
        self.cron = self.root / "cron"
        self.as_of = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
        self.run = {
            "run_id": 42,
            "date_created": "2026-11-02 12:00:00",
            "running_now": False,
            "successful": True,
            "run_from": "JJ_INTEL_MAC_DAILY_RUN",
            "total_time": 4.5,
            "selected_runners": [{"kind": "cinema", "key": "allSoons"}],
        }

    def _csv(self, run_id=42, *, source="CCsoon", rows=None):
        path = self.artifacts / str(run_id) / "successful" / f"{source}-1.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=["run_id", "english_title", "release_date", "future"])
            writer.writeheader()
            writer.writerows(rows or [{"run_id": run_id, "english_title": "Alpha", "release_date": "2030-01-02", "future": "kept"}])
        return path

    def test_scan_uses_utilrunlogs_date_and_reports_unmatched_files(self):
        self._csv()
        unknown = self.artifacts / "99" / "successful" / "CCsoon-1.csv"
        unknown.parent.mkdir(parents=True)
        unknown.write_text("run_id,release_date\n99,2030-01-01\n")
        old = self.artifacts / "2" / "successful" / "CCsoon-1.csv"
        old.parent.mkdir(parents=True)
        old.write_text("run_id,release_date\n2,2030-01-01\n")
        cron_log = self.cron / "run_daily_logs" / "cron_daily_2026-11-02_12-00-00.log"
        cron_log.parent.mkdir(parents=True)
        cron_log.write_text("run log")

        candidates, unresolved = scan_import_candidates(
            run_logs=[self.run], artifacts_root=self.artifacts, cron_root=self.cron,
            as_of=self.as_of, lookback_days=3,
        )

        self.assertEqual([item["path"] for item in candidates], [self._csv(), cron_log])
        self.assertEqual(next(item for item in candidates if item["path"] == cron_log)["run_id"], 42)
        self.assertTrue(any(item["reason"] == "run_id_or_timestamp_not_in_utilRunLogs" for item in unresolved))
        self.assertFalse(any(item["path"] == old for item in candidates))

    def test_cron_transcript_with_ambiguous_or_missing_run_is_reported_unresolved(self):
        cron_log = self.cron / "run_daily_logs" / "cron_daily_2026-11-02_12-00-00.log"
        cron_log.parent.mkdir(parents=True)
        cron_log.write_text("cron output")
        candidates, unresolved = scan_import_candidates(
            run_logs=[self.run, {**self.run, "run_id": 43}], artifacts_root=self.root / "missing",
            cron_root=self.cron, as_of=self.as_of,
        )
        self.assertEqual(candidates, [])
        self.assertEqual(unresolved[0]["reason"], "cron_log_run_id_could_not_be_determined")

    def test_import_is_idempotent_and_preserves_csv_extras(self):
        path = self._csv()
        candidates, _ = scan_import_candidates(
            run_logs=[self.run], artifacts_root=self.artifacts, cron_root=self.root / "missing",
            as_of=self.as_of,
        )
        store = Mock()
        store.insert_imported_run.return_value = 2
        store._last_imported_run_changed = 1
        store.save_scraped_rows.return_value = 6
        store._last_scraped_rows_changed = 1
        result = import_candidates(store=store, candidates=candidates, target="production")

        self.assertEqual(result["d1_rows_written"], 8)
        self.assertEqual(result["imported_runs"], 1)
        self.assertEqual(result["imported_rows"], 1)
        self.assertEqual(result["imported_csv_files"], 1)
        call_kwargs = store.save_scraped_rows.call_args.kwargs
        self.assertTrue(call_kwargs["insert_only"])
        self.assertEqual(call_kwargs["rows"][0]["future"], "kept")
        store.insert_imported_run.assert_called_once()
        self.assertEqual(candidates[0]["path"], path)

    def test_dry_run_never_uses_the_storage_client(self):
        candidates = [{"path": Path("a.csv"), "kind": "csv"}]
        result = import_candidates(store=None, candidates=candidates, target="production", dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["candidate_count"], 1)

    def test_import_budget_is_hard_capped_and_stops_before_writes(self):
        with self.assertRaisesRegex(ValueError, "between 1 and"):
            import_candidates(store=Mock(), candidates=[], target="production", write_budget=60_001)

        self._csv(rows=[{"run_id": 42, "english_title": f"Movie {index}", "release_date": "2030-01-02", "future": ""} for index in range(30)])
        candidates, _ = scan_import_candidates(
            run_logs=[self.run], artifacts_root=self.artifacts, cron_root=self.root / "missing",
            as_of=self.as_of,
        )
        store = Mock()
        result = import_candidates(store=store, candidates=candidates, target="production", write_budget=20)
        self.assertEqual(result["d1_rows_written"], 0)
        self.assertTrue(result["skipped_due_to_budget"])
        store.insert_imported_run.assert_not_called()

    def test_scan_supports_older_lookback_and_converts_gathering_csv(self):
        path = self.artifacts / "42" / "CCsoon-ThreadPoolExecutor-0_2-20260116-150422-gathering_info.csv"
        path.parent.mkdir(parents=True)
        path.write_text("english_title,future\nAlpha,kept\n", encoding="utf-8")
        candidates, _ = scan_import_candidates(run_logs=[self.run], artifacts_root=self.artifacts, cron_root=self.cron, as_of=self.as_of, lookback_days=30)
        self.assertEqual(candidates[0]["kind"], "gathering_csv")
        store = Mock()
        store.insert_imported_run.return_value = 1
        store.save_gathering_rows.return_value = 1
        store._last_imported_run_changed = store._last_gathering_rows_changed = 1
        result = import_candidates(store=store, candidates=candidates, target="production")
        self.assertEqual(result["imported_rows"], 1)
        self.assertEqual(store.save_gathering_rows.call_args.kwargs["rows"][0]["future"], "kept")
        store.save_file_artifact.assert_not_called()


if __name__ == "__main__":
    import unittest

    unittest.main()
