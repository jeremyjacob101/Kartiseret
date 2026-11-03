import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from backend.dataflow import backfill_catalog_artwork as backfill
from backend.dataflow.utils.ArtworkStorage import VARIANTS


class ArtworkBackfillTests(unittest.TestCase):
    def test_cli_selects_development_profile_before_creating_clients(self):
        env = {
            "DEV_SUPABASE_URL": "https://jbydpmjjptwevyijarzl.supabase.co",
            "DEV_SUPABASE_SERVICE_ROLE_KEY": "dev-secret",
            "PROD_SUPABASE_URL": "https://gsdrcyrduxbrxgsvhxvr.supabase.co",
            "PROD_SUPABASE_SERVICE_ROLE_KEY": "prod-secret",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(backfill, "load_dotenv"), patch(
            "sys.argv", ["backfill", "--target", "development", "--backfill"]
        ), patch.object(backfill, "build_clients", return_value=(Mock(), Mock())) as clients, patch.object(
            backfill, "run_backfill", return_value={}
        ):
            backfill.main()
            self.assertEqual(os.environ["SUPABASE_URL"], env["DEV_SUPABASE_URL"])
            self.assertEqual(os.environ["SUPABASE_SERVICE_ROLE_KEY"], "dev-secret")
            clients.assert_called_once()

    def test_cli_rejects_mismatched_profile_before_creating_clients(self):
        env = {
            "DEV_SUPABASE_URL": "https://gsdrcyrduxbrxgsvhxvr.supabase.co",
            "DEV_SUPABASE_SERVICE_ROLE_KEY": "dev-secret",
        }
        with patch.dict(os.environ, env, clear=True), patch.object(backfill, "load_dotenv"), patch(
            "sys.argv", ["backfill", "--target", "development", "--backfill"]
        ), patch.object(backfill, "build_clients") as clients:
            with self.assertRaises(ValueError):
                backfill.main()
            clients.assert_not_called()

    def test_tmdb_path_accepts_only_clean_tmdb_image_urls(self):
        self.assertEqual(
            backfill.tmdb_path("https://image.tmdb.org/t/p/w500/poster_1.jpg"),
            "/poster_1.jpg",
        )
        for value in (
            "http://image.tmdb.org/t/p/w500/a.jpg",
            "https://image.tmdb.org.attacker.test/t/p/w500/a.jpg",
            "https://user@image.tmdb.org/t/p/w500/a.jpg",
            "https://image.tmdb.org:444/t/p/w500/a.jpg",
            "https://image.tmdb.org/t/p/original/a.jpg?redirect=1",
            "https://image.tmdb.org/t/p/w500/a.svg",
            None,
        ):
            with self.subTest(value=value):
                self.assertIsNone(backfill.tmdb_path(value))

    def test_reference_check_covers_every_variant_and_deduplicates_shared_art(self):
        poster = f"https://seret.site/api/images/v1/poster/{'a' * 64}/342.webp"
        backdrop = f"/api/images/v1/backdrop/{'b' * 64}/1280.webp"
        by_table = {
            "finalMovies": [{"en_poster": poster, "backdrop": None}],
            "finalThequeMovies": [{"en_poster": poster, "backdrop": backdrop}],
            "finalSoons": [],
        }
        with patch.object(
            backfill, "each_row", side_effect=lambda _client, table, _columns: iter(by_table[table])
        ):
            keys = backfill.referenced_keys(Mock())

        self.assertEqual(
            keys,
            {
                *(f"artwork/v1/poster/{'a' * 64}/{width}.webp" for width in backfill.VARIANTS["poster"]),
                *(f"artwork/v1/backdrop/{'b' * 64}/{width}.webp" for width in backfill.VARIANTS["backdrop"]),
            },
        )

    def test_dry_run_does_not_upload_or_update_and_apply_is_resumable(self):
        row = {
            "tmdb_id": 42,
            "en_poster": "https://image.tmdb.org/t/p/w500/poster.jpg",
            "backdrop": "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
        }
        client = Mock()
        update_query = Mock()
        update_query.eq.return_value = update_query
        update_query.select.return_value = update_query
        update_query.execute.return_value.data = [{"tmdb_id": 42}]
        client.table.return_value.update.return_value = update_query
        image_storage = Mock()
        image_storage.store.side_effect = lambda kind, path: SimpleNamespace(
            source_path=path,
            url=f"https://seret.site/api/images/v1/{kind}/{'c' * 64}/{342 if kind == 'poster' else 1280}.webp",
            variants=tuple((width, f"https://seret.site/api/images/v1/{kind}/{'c' * 64}/{width}.webp") for width in VARIANTS[kind]),
        )

        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            dry_counts = backfill.run_backfill(client, image_storage, apply=False)
        self.assertEqual(dry_counts, {"scanned": 1, "updated": 1, "unchanged": 0, "failed": 0})
        image_storage.store.assert_not_called()
        client.table.return_value.update.assert_not_called()

        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            applied = backfill.run_backfill(client, image_storage, apply=True)
        self.assertEqual(applied["updated"], 1)
        self.assertEqual(image_storage.store.call_count, 2)
        updated = client.table.return_value.update.call_args.args[0]
        self.assertTrue(updated["en_poster"].startswith("https://seret.site/api/images/"))
        self.assertTrue(updated["backdrop"].startswith("https://seret.site/api/images/"))

        row.update(updated)
        image_storage.store.reset_mock()
        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            resumed = backfill.run_backfill(client, image_storage, apply=True)
        self.assertEqual(resumed["unchanged"], 1)
        self.assertEqual(resumed["updated"], 0)
        image_storage.store.assert_not_called()

    def test_failed_variant_keeps_database_url_for_retry(self):
        row = {
            "tmdb_id": 42,
            "en_poster": "https://image.tmdb.org/t/p/w500/old.jpg",
            "backdrop": "https://image.tmdb.org/t/p/w1280/old-backdrop.jpg",
        }
        client = Mock()
        client.table.return_value.update.return_value.eq.return_value.select.return_value.execute.return_value.data = [{"tmdb_id": 42}]
        image_storage = Mock()
        image_storage.store.side_effect = [
            SimpleNamespace(source_path="/old.jpg", url="https://seret.site/api/images/poster/new", variants=((342, "https://seret.site/api/images/poster/new"),)),
            RuntimeError("upload interrupted"),
        ]
        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            counts = backfill.run_backfill(client, image_storage, apply=True)
        self.assertEqual(counts["failed"], 1)
        self.assertEqual(counts["updated"], 1)
        published = client.table.return_value.update.call_args.args[0]
        self.assertIn("en_poster", published)
        self.assertNotIn("backdrop", published)

    def test_rollback_uses_the_persisted_source_identity(self):
        row = {
            "tmdb_id": 42,
            "en_poster": f"https://seret.site/api/images/v1/poster/{'a' * 64}/342.webp",
            "backdrop": f"https://seret.site/api/images/v1/backdrop/{'b' * 64}/1280.webp",
            "provider_freshness": {
                "artwork": {
                    "poster": {"processing_version": "v1", "source_path": "/poster.jpg"},
                    "backdrop": {"processing_version": "v1", "source_path": "/backdrop.jpg"},
                },
            },
        }
        client = Mock()
        query = Mock()
        query.eq.return_value = query
        query.select.return_value = query
        query.execute.return_value.data = [{"tmdb_id": 42}]
        client.table.return_value.update.return_value = query
        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            preview = backfill.run_rollback(client, apply=False)
        self.assertEqual(preview["restored"], 1)
        client.table.return_value.update.assert_not_called()

        with patch.object(
            backfill,
            "each_row",
            side_effect=lambda _client, table, _columns: iter([row] if table == "finalMovies" else []),
        ):
            result = backfill.run_rollback(client, apply=True)
        self.assertEqual(result["restored"], 1)
        restored = client.table.return_value.update.call_args.args[0]
        self.assertEqual(restored["en_poster"], "https://image.tmdb.org/t/p/w342/poster.jpg")
        self.assertEqual(restored["backdrop"], "https://image.tmdb.org/t/p/w1280/backdrop.jpg")

    def test_cleanup_requires_pause_and_respects_shared_refs_and_grace(self):
        live_hash = "a" * 64
        old = datetime.now(timezone.utc) - timedelta(days=31)
        recent = datetime.now(timezone.utc) - timedelta(days=2)
        storage = Mock()
        storage.bucket = "dev"
        storage.client.get_paginator.return_value.paginate.return_value = [
            {"Contents": [
                {"Key": f"artwork/v1/poster/{live_hash}/185.webp", "LastModified": old},
                {"Key": f"artwork/v1/poster/{live_hash}/complete", "LastModified": old},
                {"Key": "artwork/v1/backdrop/dead/complete", "LastModified": old},
                {"Key": "artwork/v1/backdrop/dead/780.webp", "LastModified": old},
                {"Key": "artwork/v1/backdrop/fresh/complete", "LastModified": recent},
            ]},
        ]
        client = Mock()
        live_keys = {
            f"artwork/v1/poster/{live_hash}/{width}.webp"
            for width in backfill.VARIANTS["poster"]
        }
        with patch.dict(os.environ, {"ARTWORK_CLEANUP_PIPELINE_PAUSED": "true"}), patch.object(
            backfill, "referenced_keys", return_value=live_keys
        ), patch.object(backfill, "ensure_no_active_pipeline"):
            result = backfill.run_cleanup(client, storage, apply=False)
            applied = backfill.run_cleanup(client, storage, apply=True)

        self.assertEqual(result["eligible_objects"], 2)
        self.assertEqual(applied["deleted"], 2)
        deleted = [call.kwargs["Key"] for call in storage.client.delete_object.call_args_list]
        self.assertEqual(set(deleted), {
            "artwork/v1/backdrop/dead/complete",
            "artwork/v1/backdrop/dead/780.webp",
        })
        with patch.dict(os.environ, {}, clear=True), self.assertRaisesRegex(RuntimeError, "Pause the dataflow"):
            backfill.run_cleanup(client, storage, apply=True)

    def test_cleanup_aborts_when_a_workflow_is_active(self):
        storage = Mock()
        storage.bucket = "dev"
        storage.client.get_paginator.return_value.paginate.return_value = [{
            "Contents": [{
                "Key": "artwork/v1/poster/dead/185.webp",
                "LastModified": datetime.now(timezone.utc) - timedelta(days=31),
            }],
        }]
        with patch.dict(os.environ, {"ARTWORK_CLEANUP_PIPELINE_PAUSED": "true"}), patch.object(
            backfill, "ensure_no_active_pipeline", side_effect=RuntimeError("active")
        ):
            with self.assertRaisesRegex(RuntimeError, "active"):
                backfill.run_cleanup(Mock(), storage, apply=True)
        storage.client.delete_object.assert_not_called()

    def test_production_detection_is_read_only_guard(self):
        self.assertTrue(backfill.is_production(f"https://{backfill.PRODUCTION_PROJECT_REF}.supabase.co"))
        self.assertFalse(backfill.is_production("https://jbydpmjjptwevyijarzl.supabase.co"))


if __name__ == "__main__":
    unittest.main()
