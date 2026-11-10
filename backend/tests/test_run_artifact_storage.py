from __future__ import annotations

from io import BytesIO
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch
import uuid

from backend.utils.log.cloudflare_storage import CloudflareStorageError, D1Client, D1Result
from backend.utils.log.run_storage import RunArtifactStore, optimize_screenshot


class FakeD1:
    def __init__(self, *, results_written=1, changes=1):
        self.database_id = str(uuid.uuid4())
        self.results_written = results_written
        self.changes = changes
        self.calls = []
        self.fail_batch = False
        self.fail_execute = False
        self.fail_artifact_insert = False
        self.artifacts = {}

    def execute(self, sql, params=()):
        self.calls.append((sql, tuple(params)))
        if self.fail_execute or (self.fail_artifact_insert and sql.startswith("INSERT OR IGNORE INTO artifacts")):
            raise CloudflareStorageError("simulated D1 outage")
        if sql.startswith("SELECT artifact_id, run_id, object_key, metadata_json FROM artifacts"):
            artifact = self.artifacts.get(params[0])
            return D1Result([artifact] if artifact else [], 0, 0, {})
        if sql.startswith("INSERT OR IGNORE INTO artifacts"):
            (artifact_id, run_id, artifact_type, artifact_name, object_key,
             content_type, text_content, metadata_json, created_at) = params
            self.artifacts[artifact_id] = {
                "artifact_id": artifact_id, "run_id": run_id, "artifact_type": artifact_type,
                "artifact_name": artifact_name, "object_key": object_key, "content_type": content_type,
                "text_content": text_content, "metadata_json": metadata_json, "created_at": created_at,
            }
        return D1Result([], self.results_written, self.changes, {})

    def batch(self, statements):
        self.calls.append(statements)
        if self.fail_batch:
            raise CloudflareStorageError("simulated D1 outage")
        return [D1Result([], self.results_written, self.changes, {}) for _ in statements]


class FakeR2:
    def __init__(self):
        self.objects = {}

    def put_object(self, *, Bucket, Key, Body, **_kwargs):
        self.objects[(Bucket, Key)] = bytes(Body)

    def get_object(self, *, Bucket, Key):
        return {"Body": BytesIO(self.objects[(Bucket, Key)])}


class RunArtifactStorageTests(TestCase):
    def test_d1_request_binds_values_and_does_not_retry(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {
            "success": True,
            "result": [{"results": [{"ok": 1}], "meta": {"rows_written": 0, "changes": 0}}],
        }
        client = D1Client("12345678-1234-4234-8234-123456789abc", "a" * 32, "x" * 40)
        with patch("backend.utils.log.cloudflare_storage.requests.post", return_value=response) as post:
            result = client.execute("SELECT ?", (None,))
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["json"]["params"], [None])
        self.assertEqual(post.call_args.args[0], f"https://api.cloudflare.com/client/v4/accounts/{'a' * 32}/d1/database/12345678-1234-4234-8234-123456789abc/query")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], f"Bearer {'x' * 40}")
        self.assertEqual(result.rows, [{"ok": 1}])

    def test_d1_errors_redact_configured_secret_values(self):
        response = Mock(ok=False, status_code=403)
        response.json.return_value = {"success": False, "errors": [{"message": "denied token=super-secret-value"}]}
        client = D1Client("12345678-1234-4234-8234-123456789abc", "a" * 32, "x" * 40)
        with patch.dict(os.environ, {"TEST_SECRET_KEY": "super-secret-value"}), patch(
            "backend.utils.log.cloudflare_storage.requests.post", return_value=response
        ):
            with self.assertRaises(CloudflareStorageError) as raised:
                client.execute("SELECT 1")
        self.assertNotIn("super-secret-value", str(raised.exception))

    def test_scraped_rows_keep_known_fields_and_unexpected_future_fields(self):
        d1 = FakeD1()
        r2 = FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            writes = store.save_scraped_rows(
                run_id=72, scraper="CCsoon", attempt=2, successful=True,
                rows=[{"english_title": "Alpha", "run_id": 72, "future_field": {"n": 1}}],
                insert_only=True, row_order_start=25,
            )
            self.assertEqual(writes, 1)
            artifact = next(iter(d1.artifacts.values()))
            self.assertEqual(artifact["artifact_type"], "scraped_snapshot")
            snapshot = store.read_scraped_snapshot(artifact)
            self.assertEqual(snapshot["rows"][0]["row_order"], 25)
            self.assertEqual(snapshot["rows"][0]["source_run_id"], "72")
            self.assertEqual(json.loads(snapshot["rows"][0]["extra_json"]), {"future_field": {"n": 1}})
            self.assertFalse(list(Path(directory).rglob("*.json")))

    def test_representative_seventeen_scraper_run_writes_snapshots_not_d1_rows(self):
        d1, r2 = FakeD1(), FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            for index in range(17):
                store.save_scraped_rows(
                    run_id=420, scraper=f"Cinema{index}", attempt=1, successful=True,
                    rows=[{"english_title": f"Film {index}", "run_id": 420}],
                )
        self.assertEqual(len(r2.objects), 17)
        self.assertEqual(len(d1.artifacts), 17)
        self.assertFalse(any("INSERT INTO scraped_rows" in sql for sql, _params in d1.calls if isinstance(sql, str)))

    def test_snapshot_upload_failure_keeps_local_recovery_copy(self):
        d1 = FakeD1()
        r2 = Mock()
        r2.put_object.side_effect = RuntimeError("R2 unavailable")
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            with self.assertRaisesRegex(CloudflareStorageError, "R2 scrape snapshot upload failed"):
                store.save_scraped_rows(
                    run_id=3, scraper="CinemaCity", attempt=1,
                    successful=False, rows=[{"english_title": "Beta"}],
                )
            self.assertEqual(len(list(Path(directory).rglob("*.json"))), 1)
            self.assertEqual(len(list(Path(directory).rglob("*.bin"))), 1)

    def test_failed_d1_batch_retains_a_local_recovery_envelope(self):
        d1 = FakeD1()
        d1.fail_execute = True
        store = RunArtifactStore(d1, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            with self.assertRaisesRegex(CloudflareStorageError, "simulated D1 outage"):
                store.save_scraped_rows(
                    run_id=3, scraper="CinemaCity", attempt=1,
                    successful=False, rows=[{"english_title": "Beta"}],
                )
            recovery_files = list(Path(directory).rglob("*.json"))
            self.assertEqual(len(recovery_files), 1)
            self.assertEqual(json.loads(recovery_files[0].read_text())["run_id"], 3)

    def test_snapshot_retry_is_idempotent_and_conflicts_are_rejected(self):
        d1, r2 = FakeD1(), FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        rows = [{"row_key": "stable", "run_id": 42, "scraper": "Cinema", "attempt": 1,
                 "outcome": "successful", "row_order": 0, "english_title": "A",
                 "created_at": "2026-11-10T10:00:00+00:00"}]
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            store.save_scraped_snapshot(run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=rows)
            first_key = next(iter(r2.objects))
            retry = [dict(rows[0], created_at="2026-11-10T10:01:00+00:00")]
            self.assertEqual(store.save_scraped_snapshot(
                run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=retry,
            ), 0)
            self.assertEqual(list(r2.objects), [first_key])
            conflicting = [dict(rows[0], english_title="different")]
            with self.assertRaisesRegex(CloudflareStorageError, "conflicting rows"):
                store.save_scraped_snapshot(
                    run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=conflicting,
                )

    def test_snapshot_retry_keeps_recovery_copy_when_catalogued_object_is_missing(self):
        d1, r2 = FakeD1(), FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        rows = [{"row_key": "stable", "run_id": 42, "scraper": "Cinema", "attempt": 1,
                 "outcome": "successful", "row_order": 0, "english_title": "A",
                 "created_at": "2026-11-10T10:00:00+00:00"}]
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            store.save_scraped_snapshot(run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=rows)
            r2.objects.clear()
            with self.assertRaisesRegex(CloudflareStorageError, "could not be read"):
                store.save_scraped_snapshot(run_id=42, scraper="Cinema", attempt=1, outcome="successful", rows=rows)
            self.assertEqual(len(list(Path(directory).rglob("*.json"))), 1)
            self.assertEqual(len(list(Path(directory).rglob("*.bin"))), 1)

    def test_snapshot_catalog_failure_keeps_compressed_recovery_copy(self):
        d1, r2 = FakeD1(), FakeR2()
        d1.fail_artifact_insert = True
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            with self.assertRaisesRegex(CloudflareStorageError, "simulated D1 outage"):
                store.save_scraped_snapshot(
                    run_id=8, scraper="Cinema", attempt=1, outcome="unsuccessful",
                    rows=[{"row_key": "r", "run_id": 8, "row_order": 0}],
                )
            self.assertEqual(len(list(Path(directory).rglob("*.bin"))), 1)
            self.assertEqual(len(r2.objects), 1)

    def test_snapshot_reader_rejects_corrupt_object(self):
        d1, r2 = FakeD1(), FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            store.save_scraped_snapshot(
                run_id=9, scraper="Cinema", attempt=1, outcome="successful",
                rows=[{"row_key": "r", "run_id": 9, "row_order": 0}],
            )
        artifact = next(iter(d1.artifacts.values()))
        key = ("private-test", artifact["object_key"])
        r2.objects[key] = b"corrupt"
        with self.assertRaisesRegex(CloudflareStorageError, "checksum"):
            store.read_scraped_snapshot(artifact)

    def test_snapshot_reader_rejects_non_object_json_header(self):
        import gzip
        from hashlib import sha256

        d1, r2 = FakeD1(), FakeR2()
        store = RunArtifactStore(d1, r2_client=r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            store.save_scraped_snapshot(
                run_id=9, scraper="Cinema", attempt=1, outcome="successful",
                rows=[{"row_key": "r", "run_id": 9, "scraper": "Cinema", "attempt": 1,
                       "outcome": "successful", "row_order": 0}],
            )
        artifact = next(iter(d1.artifacts.values()))
        key = ("private-test", artifact["object_key"])
        malformed = gzip.compress(b"[]", mtime=0)
        r2.objects[key] = malformed
        metadata = json.loads(artifact["metadata_json"])
        metadata["compressed_sha256"] = sha256(malformed).hexdigest()
        artifact["metadata_json"] = json.dumps(metadata)
        with self.assertRaisesRegex(CloudflareStorageError, "header is malformed"):
            store.read_scraped_snapshot(artifact)

    def test_marking_a_run_unconfirmed_cannot_release_by_run_id_alone(self):
        d1 = FakeD1()
        store = RunArtifactStore(d1, bucket="private-test")
        store.mark_run_unconfirmed(17, "supabase_finalization_unconfirmed")
        self.assertEqual(len(d1.calls), 1)
        self.assertIn("status = 'unconfirmed'", d1.calls[0][0])
        self.assertFalse(any("UPDATE run_locks" in sql for sql, _params in d1.calls))

    def test_scraped_row_reads_are_paged_to_keep_worker_responses_bounded(self):
        d1 = FakeD1()
        first_page = [{"row_key": f"row-{index}"} for index in range(500)]
        last_page = [{"row_key": "row-500"}]
        d1.execute = Mock(side_effect=[
            D1Result(first_page, 0, 0, {}),
            D1Result(last_page, 0, 0, {}),
            D1Result([], 0, 0, {}),
        ])
        store = RunArtifactStore(d1, bucket="private-test")

        rows = store.read_scraped_rows_since(since_iso="2026-01-01T00:00:00Z")

        self.assertEqual(len(rows), 501)
        self.assertEqual(d1.execute.call_count, 3)
        self.assertEqual(d1.execute.call_args_list[0].args[1], ("2026-01-01T00:00:00Z", 500, 0))
        self.assertEqual(d1.execute.call_args_list[1].args[1], ("2026-01-01T00:00:00Z", 500, 500))

    def test_text_artifact_reads_are_paged_and_stably_ordered(self):
        d1 = FakeD1()
        d1.execute = Mock(side_effect=[
            D1Result([{"artifact_id": f"artifact-{index}"} for index in range(25)], 0, 0, {}),
            D1Result([{"artifact_id": "artifact-25"}], 0, 0, {}),
        ])
        store = RunArtifactStore(d1, bucket="private-test")

        rows = store.read_text_artifacts_since(since_iso="2026-01-01T00:00:00Z")

        self.assertEqual(len(rows), 26)
        self.assertIn("artifact_id", d1.execute.call_args_list[0].args[0])
        self.assertEqual(d1.execute.call_args_list[0].args[1], ("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 25, 0))
        self.assertEqual(d1.execute.call_args_list[1].args[1], ("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 25, 25))

    def test_r2_failure_keeps_local_artifact_and_d1_failure_leaves_reconciliation_copy(self):
        failing_r2 = Mock()
        failing_r2.put_object.side_effect = RuntimeError("R2 unavailable")
        d1 = FakeD1()
        store = RunArtifactStore(d1, r2_client=failing_r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            with self.assertRaisesRegex(CloudflareStorageError, "R2 screenshot upload failed"):
                store.save_file_artifact(
                    run_id=6, artifact_type="screenshots", name="x.png",
                    content=b"png", content_type="image/png",
                )
            self.assertTrue(list(Path(directory).rglob("*.bin")))

            d1.fail_execute = True
            succeeding_r2 = Mock()
            store = RunArtifactStore(d1, r2_client=succeeding_r2, bucket="private-test")
            with self.assertRaisesRegex(CloudflareStorageError, "simulated D1 outage"):
                store.save_file_artifact(
                    run_id=7, artifact_type="screenshots", name="y.png",
                    content=b"png", content_type="image/png",
                )
            succeeding_r2.put_object.assert_called_once()
            self.assertGreaterEqual(len(list(Path(directory).rglob("*.json"))), 2)

    def test_text_artifact_redacts_secrets_before_d1_persistence(self):
        d1 = FakeD1()
        store = RunArtifactStore(d1, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(
            os.environ,
            {"KARTISERET_RECOVERY_ROOT": directory, "SUPABASE_SERVICE_ROLE_KEY": "a-service-secret-value"},
        ):
            store.save_text_artifact(
                run_id=7, artifact_type="scrape_error", name="failure",
                text="request failed with a-service-secret-value",
            )
            self.assertNotIn("a-service-secret-value", d1.calls[0][1][15])
            self.assertIn("[REDACTED]", d1.calls[0][1][15])

    def test_long_unicode_diagnostic_keeps_columns_and_reconstructs_text(self):
        d1 = FakeD1()
        store = RunArtifactStore(d1, bucket="private-test")
        text = "שלום 🎬\n" * 100_000
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            store.save_text_artifact(run_id=7, artifact_type="scrape_error", name="Cinema-2", text=text,
                                     metadata={"item_name": "Cinema", "attempt": 2, "url": "https://example.com", "selector": ".film"})
        self.assertGreater(len(d1.calls), 1)
        self.assertEqual("".join(call[1][15] for call in d1.calls), text)
        self.assertEqual(d1.calls[0][1][6:8], ("Cinema", 2))
        self.assertEqual(d1.calls[0][1][9:11], ("https://example.com", ".film"))
        self.assertTrue(all(len(json.dumps(call[1]).encode()) < 700_000 for call in d1.calls))

    def test_non_image_file_cannot_be_uploaded_to_artifact_bucket(self):
        store = RunArtifactStore(FakeD1(), r2_client=Mock(), bucket="private-test")
        with self.assertRaises(CloudflareStorageError):
            store.save_file_artifact(run_id=7, artifact_type="cron_output", name="log", content=b"text", content_type="text/plain")

    def test_screenshot_webp_is_smaller_and_width_is_bounded_without_upscaling(self):
        from PIL import Image
        import random

        randomizer = random.Random(99)
        image = Image.new("RGB", (2400, 1200))
        image.putdata([(randomizer.randrange(256), randomizer.randrange(256), randomizer.randrange(256)) for _ in range(2400 * 1200)])
        png = BytesIO()
        image.save(png, format="PNG")
        converted, content_type, metadata = optimize_screenshot(png.getvalue())
        self.assertEqual(content_type, "image/webp")
        self.assertLess(len(converted), len(png.getvalue()))
        self.assertEqual(metadata["width"], 1920)
        self.assertLess(metadata["height"], 1200)

        small = Image.new("RGB", (320, 200), "white")
        small_png = BytesIO()
        small.save(small_png, format="PNG")
        _converted, _type, small_metadata = optimize_screenshot(small_png.getvalue())
        self.assertEqual(small_metadata["original_width"], 320)

    def test_invalid_png_is_preserved_as_original(self):
        invalid = b"not a png"
        data, content_type, metadata = optimize_screenshot(invalid)
        self.assertEqual(data, invalid)
        self.assertEqual(content_type, "image/png")
        self.assertEqual(metadata["compression"], "png_fallback")


if __name__ == "__main__":
    import unittest

    unittest.main()
