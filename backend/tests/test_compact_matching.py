from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from backend.tests.test_shared_cleanup import SQLiteD1
from backend.tests.test_run_artifact_storage import FakeR2
from backend.dataflow.nowplayings.NowPlayingsTmdb import NowPlayingsTmdb
from backend.dataflow.utils.DataflowRequests import DataflowRequestContext
from backend.utils.log.compact_matching import canonical, compact_dataflow_summary, compact_document
from backend.utils.log.run_storage import RunArtifactStore, CloudflareStorageError
from backend.utils.log.replace_run_diagnostics import replace, source_rows
from backend.utils.log.tmdb_matching_report import read_tmdb_evidence, build_tmdb_matching_report
from backend.tests.test_tmdb_matching_report import evidence


class CompactMatchingTests(TestCase):
    def setUp(self):
        self.directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": self.directory}))
        self.d1 = SQLiteD1(f"compact-{id(self)}")
        self.addCleanup(self.d1.connection.close)
        self.r2 = FakeR2()
        self.store = RunArtifactStore(self.d1, r2_client=self.r2, bucket="private")
        self.store.ensure_schema()
        self.enterContext(patch("backend.utils.log.run_storage._r2_client", return_value=self.r2))
        self.enterContext(patch.dict(os.environ, {"RUN_ARTIFACTS_R2_BUCKET": "private"}))
        self.d1.execute("INSERT INTO run_logs(run_id,target,run_from,status,started_at,finished_at,created_at) "
                        "VALUES(693,'production','test','successful','2026-11-11','2026-11-11','2026-11-11')")

    def document(self):
        # Legacy fixture exercises all metrics the existing read-only report consumes.
        return {"evidence_format_version": 1, "run_id": 693, "dataflow": "NowPlayingsTmdb",
                "attempt": 1, "groups": [evidence(693, "Arrival", 2016, 11)]}

    def test_compact_report_is_equivalent_and_mixed_versions_deduplicate(self):
        original = self.document()
        compact = compact_document(original)
        self.assertEqual(build_tmdb_matching_report(original["groups"]), build_tmdb_matching_report(compact["groups"]))
        self.assertEqual(build_tmdb_matching_report(original["groups"] + compact["groups"]), build_tmdb_matching_report(compact["groups"]))

    def test_thousands_of_showtimes_do_not_expand_candidate_comparisons(self):
        flow = NowPlayingsTmdb.__new__(NowPlayingsTmdb)
        flow.run_id = 693
        flow.init_dataflow_summary_state()
        flow.initDataflowRequests(DataflowRequestContext())
        self.addCleanup(flow.closeDataflowRequests)
        rows = [{"id": f"unique-showtime-{i}", "english_title": "Arrival", "cinema": "Cinema", "release_year": 2016} for i in range(10000)]
        flow.beginTmdbMatchEvidence("arrival", rows, input_fingerprint="stable")
        self.assertEqual(len(flow._tmdb_current_match_evidence["source_rows"]), 1)
        flow.candidates = [11]
        flow.details = {11: {"id": 11, "title": "Arrival", "original_title": "Arrival", "release_date": "2016-01-01"}}
        flow.finishTmdbMatchEvidence("title_first_match", "mapped", 11)
        summary = flow.summaryTmdbEvidence[0]
        self.assertEqual(summary["source_row_count"], 10000)
        self.assertEqual(summary["selected_comparisons"]["title"], [{"signal": "agree", "weight": 10000}])
        self.assertNotIn("unique-showtime", canonical(summary))
        self.assertLess(len(canonical(summary).encode()), 8000)

    def test_dataflow_summary_compaction_is_bounded_and_idempotent(self):
        source = {"summary_format_version": 1, "notes": ["warning"] * 100,
                  "write_or_dedupe_actions": [{"action": "insert", "count": 2}] * 100,
                  "coming_soon_details": [{"status": "mapped", "reason": "alias"}] * 100}
        compact = compact_dataflow_summary(source)
        self.assertEqual(compact["notes"], [{"value": "warning", "count": 100}])
        self.assertEqual(compact["write_or_dedupe_actions"], [{"value": {"action": "insert", "count": 2}, "count": 100}])
        self.assertEqual(compact["coming_soon_details"], [{"status": "mapped", "reason": "alias", "event_count": 100}])
        self.assertEqual(compact_dataflow_summary(compact), compact)

    def test_upload_roundtrip_idempotency_conflicts_and_corruption(self):
        document = compact_document(self.document())
        pointer = self.store.save_matching_summary(document, name="test")
        self.assertEqual(self.store.resolve_matching_pointer(pointer), document)
        self.store.save_matching_summary(document, name="test")
        self.assertEqual(len(self.r2.objects), 1)
        changed = {**document, "attempt": 2}
        with self.assertRaisesRegex(CloudflareStorageError, "conflicts"):
            self.store.save_matching_summary(changed, name="test")
        key = next(iter(self.r2.objects))
        self.r2.objects[key] = b"corrupt"
        with self.assertRaisesRegex(CloudflareStorageError, "checksum"):
            self.store.resolve_matching_pointer(pointer)
        del self.r2.objects[key]
        with self.assertRaises(KeyError):
            self.store.resolve_matching_pointer(pointer)

    def test_catalog_failure_keeps_recovery_and_retry_finishes(self):
        document = compact_document(self.document())
        with patch.object(self.store, "_insert_artifact_row", side_effect=RuntimeError("D1 outage")):
            with self.assertRaises(RuntimeError):
                self.store.save_matching_summary(document, name="test")
        self.assertTrue(list(Path(self.directory).glob("matching_summaries/*.json")))
        pointer = self.store.save_matching_summary(document, name="test")
        self.assertEqual(self.store.resolve_matching_pointer(pointer), document)
        self.assertFalse(list(Path(self.directory).glob("matching_summaries/*.json")))

    def test_upload_and_pointer_registration_failures_do_not_lose_recovery(self):
        document = compact_document(self.document())
        with patch.object(self.r2, "put_object", side_effect=RuntimeError("upload failed")):
            with self.assertRaisesRegex(RuntimeError, "upload failed"):
                self.store.save_matching_summary(document, name="test")
        self.assertEqual(self.d1.execute("SELECT count(*) n FROM artifacts").rows[0]["n"], 0)
        with patch.object(self.store, "save_text_artifact", side_effect=RuntimeError("pointer failed")):
            with self.assertRaisesRegex(RuntimeError, "pointer failed"):
                self.store.save_matching_summary(document, name="test")
        self.assertTrue(list(Path(self.directory).glob("matching_summaries/*.json")))
        pointer = self.store.save_matching_summary(document, name="test")
        self.assertEqual(self.store.resolve_matching_pointer(pointer), document)
        self.assertEqual(len(self.r2.objects), 1)

    def test_replacement_upload_failure_keeps_all_originals_and_resumes(self):
        original = self.original()
        with patch.object(self.r2, "put_object", side_effect=RuntimeError("upload failed")):
            with self.assertRaises(RuntimeError):
                replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        self.assertEqual(source_rows(self.store, 693), original)
        result = replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        self.assertEqual(result["deleted_rows"], len(original))

    def test_incomplete_original_and_changed_run_are_never_deleted(self):
        original = self.original()
        self.d1.execute("UPDATE diagnostics SET chunk_count=2")
        with self.assertRaisesRegex(CloudflareStorageError, "incomplete"):
            replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        self.assertEqual(source_rows(self.store, 693)[0]["text_content"], original[0]["text_content"])
        self.d1.execute("UPDATE run_logs SET status='unconfirmed'")
        with self.assertRaisesRegex(CloudflareStorageError, "successful"):
            replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))

    def test_replacement_refuses_a_different_captured_source_identity_set(self):
        original = self.original()
        with self.assertRaisesRegex(CloudflareStorageError, "approved source set"):
            replace(self.store, run_id=693, target="production", apply=True,
                    expected_source_rows=len(original), expected_source_sha256="0" * 64)
        self.assertEqual(source_rows(self.store, 693), original)

    def test_unicode_conflicts_examples_and_alternatives_are_bounded(self):
        original = self.document()
        item = original["groups"][0]
        item["source_rows"][0]["title"] = "הגעה"
        from copy import deepcopy
        item["candidates"] = [deepcopy(item["candidates"][0]) | {"tmdb_id": i + 100} for i in range(20)]
        item["chosen_tmdb_id"] = 100
        for candidate in item["candidates"]:
            candidate["comparisons"]["runtime"] *= 10
        compact = compact_document(original)
        self.assertEqual(build_tmdb_matching_report(original["groups"]), build_tmdb_matching_report(compact["groups"]))
        self.assertIn("הגעה", canonical(compact))
        self.assertLessEqual(len(compact["groups"][0]["comparison_examples"]["runtime"]["examples"]), 3)
        self.assertEqual(compact_document(compact), compact)

    def test_pointer_size_limit_precedes_any_upload(self):
        document = compact_document(self.document())
        document["groups"][0]["selection_reason"] = "reason" * 4000
        with self.assertRaisesRegex(CloudflareStorageError, "16 KiB"):
            self.store.save_matching_summary(document, name="test")
        self.assertFalse(self.r2.objects)

    def original(self):
        self.store.save_text_artifact(run_id=693, artifact_type="tmdb_matching_evidence",
            name="old", text=canonical(self.document()), metadata={}, created_at="2026-11-11T00:00:00+00:00")
        return source_rows(self.store, 693)

    def test_replacement_dry_run_then_replaces_exact_original_identities(self):
        original = self.original()
        preview = replace(self.store, run_id=693, target="production", expected_source_rows=len(original))
        self.assertEqual(preview["deleted_rows"], 0)
        self.assertEqual(source_rows(self.store, 693), original)
        result = replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        self.assertEqual(result["deleted_rows"], len(original))
        new = source_rows(self.store, 693)
        self.assertNotEqual(new[0]["diagnostic_id"], original[0]["diagnostic_id"])
        self.assertEqual(new[0]["created_at"], original[0]["created_at"])
        self.assertLess(len(new[0]["text_content"].encode()) + len(new[0]["metadata_json"].encode()), 16384)
        self.assertEqual(build_tmdb_matching_report(read_tmdb_evidence(self.d1, run_id=693)), build_tmdb_matching_report(self.document()["groups"]))

    def test_uncertain_delete_retains_journal_and_resumes_without_duplicate_replacements(self):
        original = self.original()
        execute = self.d1.execute
        failed = False
        def uncertain(sql, params=()):
            nonlocal failed
            result = execute(sql, params)
            if sql.startswith("DELETE FROM diagnostics") and not failed:
                failed = True
                raise RuntimeError("ack lost")
            return result
        with patch.object(self.d1, "execute", side_effect=uncertain):
            with self.assertRaisesRegex(RuntimeError, "ack lost"):
                replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        result = replace(self.store, run_id=693, target="production", apply=True, expected_source_rows=len(original))
        self.assertEqual(result["remaining_records"], 1)
        self.assertEqual(len(self.r2.objects), 1)
        self.assertFalse(list(Path(self.directory).glob("diagnostic_replacements/*.json")))

    def test_retention_protects_until_completion_age_and_object_delete_is_confirmed(self):
        from backend.utils.log.shared_cleanup import cleanup_scraped_snapshots
        document = compact_document(self.document())
        self.store.save_matching_summary(document, name="test")
        now = datetime.now(timezone.utc)
        self.d1.execute("UPDATE run_logs SET finished_at=? WHERE run_id=693", ((now-timedelta(days=29)).isoformat(),))
        def cleanup(apply=True):
            return cleanup_scraped_snapshots(self.store, apply=apply, artifact_type="tmdb_matching_summary")
        self.assertEqual(cleanup()["eligible"], 0)
        self.d1.execute("UPDATE run_logs SET finished_at=? WHERE run_id=693", ((now-timedelta(days=31)).isoformat(),))
        self.assertEqual(cleanup(False)["eligible"], 1)
        self.r2.delete_object = lambda **kw: (_ for _ in ()).throw(RuntimeError("offline"))
        with self.assertRaises(CloudflareStorageError):
            cleanup()
        self.assertEqual(len(source_rows(self.store, 693)), 1)
        self.r2.delete_object = lambda *, Bucket, Key: self.r2.objects.pop((Bucket, Key), None)
        self.assertEqual(cleanup()["deleted"], 1)
        self.assertEqual(source_rows(self.store, 693), [])
