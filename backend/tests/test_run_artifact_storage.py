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
    def __init__(self, *, results_written=2, changes=1):
        self.database_id = str(uuid.uuid4())
        self.results_written = results_written
        self.changes = changes
        self.calls = []
        self.fail_batch = False
        self.fail_execute = False

    def execute(self, sql, params=()):
        self.calls.append((sql, tuple(params)))
        if self.fail_execute:
            raise CloudflareStorageError("simulated D1 outage")
        return D1Result([], self.results_written, self.changes, {})

    def batch(self, statements):
        self.calls.append(statements)
        if self.fail_batch:
            raise CloudflareStorageError("simulated D1 outage")
        return [D1Result([], self.results_written, self.changes, {}) for _ in statements]


class RunArtifactStorageTests(TestCase):
    def test_d1_request_binds_values_and_does_not_retry(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {
            "success": True,
            "result": [{"results": [{"ok": 1}], "meta": {"rows_written": 0, "changes": 0}}],
        }
        client = D1Client("12345678-1234-4234-8234-123456789abc", "https://kartiseret-run-artifact-retention-dev.example.workers.dev", "x" * 40)
        with patch("backend.utils.log.cloudflare_storage.requests.post", return_value=response) as post:
            result = client.execute("SELECT ?", (None,))
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["json"]["params"], [None])
        self.assertEqual(post.call_args.args[0], "https://kartiseret-run-artifact-retention-dev.example.workers.dev/v1/d1/query")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], f"Bearer {'x' * 40}")
        self.assertEqual(result.rows, [{"ok": 1}])

    def test_d1_errors_redact_configured_secret_values(self):
        response = Mock(ok=False, status_code=403)
        response.json.return_value = {"success": False, "errors": [{"message": "denied token=super-secret-value"}]}
        client = D1Client("12345678-1234-4234-8234-123456789abc", "https://kartiseret-run-artifact-retention-dev.example.workers.dev", "x" * 40)
        with patch.dict(os.environ, {"TEST_SECRET_KEY": "super-secret-value"}), patch(
            "backend.utils.log.cloudflare_storage.requests.post", return_value=response
        ):
            with self.assertRaises(CloudflareStorageError) as raised:
                client.execute("SELECT 1")
        self.assertNotIn("super-secret-value", str(raised.exception))

    def test_scraped_rows_keep_known_fields_and_unexpected_future_fields(self):
        d1 = FakeD1()
        store = RunArtifactStore(d1, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            writes = store.save_scraped_rows(
                run_id=72, scraper="CCsoon", attempt=2, successful=True,
                rows=[{"english_title": "Alpha", "run_id": 72, "future_field": {"n": 1}}],
                insert_only=True, row_order_start=25,
            )
            self.assertEqual(writes, 2)
            sql, params = d1.calls[0][0]
            self.assertIn("ON CONFLICT(row_key) DO NOTHING", sql)
            self.assertEqual(params[5], 25)
            self.assertEqual(params[-3], "72")
            self.assertEqual(json.loads(params[-2]), {"future_field": {"n": 1}})
            self.assertFalse(list(Path(directory).rglob("*.json")))

    def test_failed_d1_batch_retains_a_local_recovery_envelope(self):
        d1 = FakeD1()
        d1.fail_batch = True
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

    def test_marking_a_run_unconfirmed_releases_its_d1_lease(self):
        d1 = FakeD1()
        store = RunArtifactStore(d1, bucket="private-test")
        store.mark_run_unconfirmed(17, "supabase_finalization_unconfirmed")
        self.assertEqual(len(d1.calls), 2)
        self.assertIn("status = 'unconfirmed'", d1.calls[0][0])
        self.assertIn("WHERE id = 1 AND run_id = ?", d1.calls[1][0])

    def test_scraped_row_reads_are_paged_to_keep_worker_responses_bounded(self):
        d1 = FakeD1()
        first_page = [{"row_key": f"row-{index}"} for index in range(500)]
        last_page = [{"row_key": "row-500"}]
        d1.execute = Mock(side_effect=[
            D1Result(first_page, 0, 0, {}),
            D1Result(last_page, 0, 0, {}),
        ])
        store = RunArtifactStore(d1, bucket="private-test")

        rows = store.read_scraped_rows_since(since_iso="2026-01-01T00:00:00Z")

        self.assertEqual(len(rows), 501)
        self.assertEqual(d1.execute.call_count, 2)
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
        self.assertEqual(d1.execute.call_args_list[0].args[1], ("2026-01-01T00:00:00Z", 25, 0))
        self.assertEqual(d1.execute.call_args_list[1].args[1], ("2026-01-01T00:00:00Z", 25, 25))

    def test_r2_failure_keeps_local_artifact_and_d1_failure_leaves_reconciliation_copy(self):
        failing_r2 = Mock()
        failing_r2.put_object.side_effect = RuntimeError("R2 unavailable")
        d1 = FakeD1()
        store = RunArtifactStore(d1, r2_client=failing_r2, bucket="private-test")
        with TemporaryDirectory() as directory, patch.dict(os.environ, {"KARTISERET_RECOVERY_ROOT": directory}):
            with self.assertRaisesRegex(RuntimeError, "R2 unavailable"):
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
            self.assertNotIn("a-service-secret-value", d1.calls[0][1][6])
            self.assertIn("[REDACTED]", d1.calls[0][1][6])

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
