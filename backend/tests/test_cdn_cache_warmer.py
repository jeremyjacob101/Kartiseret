from __future__ import annotations

from pathlib import Path
import tempfile
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from backend.config.cdn_cache_warmer import (
    PUBLIC_CATALOG_CACHE_TAG,
    delete_cache_tag,
    acquire_singleton_lock,
    load_saved_revision,
    run_cycle,
    save_revision,
    validate_configuration,
)


class CdnCacheWarmerTests(TestCase):
    def test_revision_change_deletes_tag_before_persisting_and_warming(self):
        calls: list[str] = []

        revision, succeeded = run_cycle(
            "7",
            read_revision=lambda: "8",
            delete_tag=lambda: calls.append("delete"),
            warm_homepage=lambda: calls.append("warm") or {
                "status": 200,
                "cache": "MISS",
                "vercel_id": "arn1::abc",
                "ttfb_ms": 42.0,
            },
            persist_revision=lambda value: calls.append(f"save:{value}"),
        )

        self.assertEqual(revision, "8")
        self.assertTrue(succeeded)
        self.assertEqual(calls, ["delete", "save:8", "warm"])

    def test_saved_revision_warms_without_redeleting_on_restart(self):
        warmed: list[bool] = []

        revision, succeeded = run_cycle(
            "42",
            read_revision=lambda: "42",
            delete_tag=lambda: self.fail("unchanged revision should stay cached"),
            warm_homepage=lambda: warmed.append(True)
            or {"status": 200, "cache": "HIT", "vercel_id": "arn1", "ttfb_ms": 5},
            persist_revision=lambda _value: self.fail("unchanged revision needs no save"),
        )

        self.assertEqual(revision, "42")
        self.assertTrue(succeeded)
        self.assertEqual(warmed, [True])

    def test_deletion_failure_skips_warming_and_retries_from_previous_revision(self):
        calls: list[str] = []

        def delete_tag():
            calls.append("delete")
            raise RuntimeError("Vercel is unavailable")

        revision, succeeded = run_cycle(
            "7",
            read_revision=lambda: "8",
            delete_tag=delete_tag,
            warm_homepage=lambda: calls.append("warm") or {},
            persist_revision=lambda value: calls.append(f"save:{value}"),
        )

        self.assertEqual(revision, "7")
        self.assertFalse(succeeded)
        self.assertEqual(calls, ["delete"])

    def test_revision_read_failure_keeps_known_revision_and_still_warms(self):
        warmed: list[bool] = []

        def read_revision():
            raise RuntimeError("database unavailable")

        revision, succeeded = run_cycle(
            "7",
            read_revision=read_revision,
            delete_tag=lambda: self.fail("cache should not be deleted"),
            warm_homepage=lambda: warmed.append(True)
            or {"status": 200, "cache": "HIT", "vercel_id": "arn1", "ttfb_ms": 5},
            persist_revision=lambda _value: self.fail("state should not be saved"),
        )

        self.assertEqual(revision, "7")
        self.assertTrue(succeeded)
        self.assertEqual(warmed, [True])

    def test_first_cycle_waits_for_revision_before_warming(self):
        warmed: list[bool] = []

        def read_revision():
            raise RuntimeError("database unavailable")

        revision, succeeded = run_cycle(
            None,
            read_revision=read_revision,
            delete_tag=lambda: self.fail("revision is unknown"),
            warm_homepage=lambda: warmed.append(True) or {},
            persist_revision=lambda _value: self.fail("revision is unknown"),
        )

        self.assertIsNone(revision)
        self.assertFalse(succeeded)
        self.assertEqual(warmed, [])

    def test_failed_warm_retries_without_deleting_the_new_revision_again(self):
        calls: list[str] = []

        def fail_warm():
            raise RuntimeError("network error")

        revision, succeeded = run_cycle(
            None,
            read_revision=lambda: "8",
            delete_tag=lambda: calls.append("delete"),
            warm_homepage=fail_warm,
            persist_revision=lambda value: calls.append(f"save:{value}"),
        )
        self.assertEqual(revision, "8")
        self.assertFalse(succeeded)
        self.assertEqual(calls, ["delete", "save:8"])

        revision, succeeded = run_cycle(
            revision,
            read_revision=lambda: "8",
            delete_tag=lambda: calls.append("unexpected-delete"),
            warm_homepage=lambda: calls.append("retry-warm")
            or {"status": 200, "cache": "HIT", "vercel_id": "arn1", "ttfb_ms": 5},
            persist_revision=lambda value: calls.append(f"unexpected-save:{value}"),
        )
        self.assertEqual(revision, "8")
        self.assertTrue(succeeded)
        self.assertEqual(calls, ["delete", "save:8", "retry-warm"])

    def test_revision_is_saved_atomically_for_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state" / "revision"
            self.assertIsNone(load_saved_revision(state_path))
            save_revision(state_path, "42")
            self.assertEqual(load_saved_revision(state_path), "42")
            self.assertEqual(list(state_path.parent.glob(".*")), [])

    def test_singleton_lock_rejects_a_second_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "revision"
            first_lock = acquire_singleton_lock(state_path)
            try:
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    acquire_singleton_lock(state_path)
            finally:
                first_lock.close()

            second_lock = acquire_singleton_lock(state_path)
            second_lock.close()

    def test_vercel_delete_is_scoped_to_production_project_and_tag(self):
        captured: dict[str, object] = {}

        class Response:
            status_code = 200

        def post(url, **kwargs):
            captured["url"] = url
            captured.update(kwargs)
            return Response()

        delete_cache_tag(
            "token-value",
            "prj_production",
            "team_production",
            request_post=post,
        )

        parsed_url = urlsplit(str(captured["url"]))
        self.assertEqual(parsed_url.path, "/v1/edge-cache/dangerously-delete-by-tags")
        self.assertEqual(
            parse_qs(parsed_url.query),
            {"projectIdOrName": ["prj_production"], "teamId": ["team_production"]},
        )
        self.assertEqual(captured["headers"]["Authorization"], "Bearer token-value")
        self.assertEqual(
            captured["json"],
            {"tags": [PUBLIC_CATALOG_CACHE_TAG], "target": "production"},
        )

    def test_configuration_rejects_publisher_database_login(self):
        environment = {
            "PROD_DATABASE_URL": (
                "postgresql://kartiseret_publisher_login."
                "gsdrcyrduxbrxgsvhxvr:secret@db.gsdrcyrduxbrxgsvhxvr."
                "supabase.co:5432/postgres"
            ),
            "PROD_DATABASE_SSL_CA_CERT": "certificate",
            "VERCEL_API_TOKEN": "token",
            "VERCEL_PROJECT_ID": "project",
            "VERCEL_TEAM_ID": "team",
        }
        with patch.dict("os.environ", environment, clear=True):
            with self.assertRaisesRegex(ValueError, "kartiseret_api runtime login"):
                validate_configuration()


if __name__ == "__main__":
    import unittest

    unittest.main()
