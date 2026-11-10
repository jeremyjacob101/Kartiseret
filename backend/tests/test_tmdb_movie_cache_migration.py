from pathlib import Path
from unittest import TestCase


MIGRATION = Path("supabase/migrations/20261109151600_tmdb_movie_details_cache.sql")


class TmdbMovieCacheMigrationTests(TestCase):
    def test_cache_table_is_service_role_only_and_rejects_incomplete_profiles(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create table public.tmdb_movie_details_cache", sql)
        self.assertIn("tmdb_id integer primary key", sql)
        self.assertIn("response_profile", sql)
        self.assertIn("payload jsonb not null", sql)
        self.assertIn("original_release_date date", sql)
        self.assertIn("fetched_at timestamptz not null", sql)
        self.assertIn("cache_format_version smallint not null", sql)
        self.assertIn("jsonb_typeof(payload -> 'credits' -> 'crew') = 'array'", sql)
        self.assertIn("jsonb_typeof(payload -> 'videos' -> 'results') = 'array'", sql)
        self.assertIn("jsonb_typeof(payload -> 'original_title') = 'string'", sql)
        self.assertIn("enable row level security", sql)
        self.assertIn("revoke all privileges", sql)
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn("grant select, insert, update", sql)
        self.assertIn("to service_role", sql)
        self.assertNotIn("grant delete", sql)


if __name__ == "__main__":
    import unittest
    unittest.main()
