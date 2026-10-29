from datetime import date
from unittest import TestCase

from backend.dataflow.utils.DataflowHelpers import DataflowHelpers
from test_tmdb_publication import FLOWS, PublicationTests, raw_row
from test_raw_cleaning_scope import CLEANERS, RawCleaningScopeTests, raw


class FixMatchingTests(TestCase):
    def test_unicode_fallback_and_conflicts(self):
        h = DataflowHelpers()
        _, fixes, aliases = h.buildTmdbFixMaps([
            {"title_fix": "MovieRetro- הוק", "tmdb_id": 1},
            {"title_fix": "MovieRetro- אסירים", "tmdb_id": 2},
            {"title_fix": "Kabul: 13 Days", "tmdb_id": 3},
            {"title_fix": "Kabul - 13 Days", "tmdb_id": 4},
            {"title_fix": "101", "tmdb_id": 102},
        ])
        self.assertEqual(h.tmdbFixForTitle("movieretro - הוק", fixes), 1)
        self.assertEqual(h.tmdbFixForTitle("movieretro - אסירים", fixes), 2)
        self.assertIsNone(h.tmdbFixForTitle("movieretro", fixes))
        self.assertEqual(h.tmdbFixMatch("Kabul: 13 Days", fixes)["tier"], "exact")
        self.assertTrue(h.tmdbFixMatch("KABUL 13 DAYS", fixes)["conflict"])
        self.assertIsNone(h.tmdbFixForTitle("KABUL 13 DAYS", fixes))
        self.assertEqual(aliases[101], 102)

    def test_same_id_collision_is_not_ambiguous(self):
        h = DataflowHelpers()
        _, fixes, _ = h.buildTmdbFixMaps([{"title_fix": "A: Film", "tmdb_id": 1}, {"title_fix": "A - Film", "tmdb_id": 1}])
        match = h.tmdbFixMatch("a film", fixes)
        self.assertEqual(match["tier"], "normalized")
        self.assertEqual(match["tmdb_id"], 1)
        self.assertFalse(match["conflict"])


class FixPublicationTests(PublicationTests):
    def test_unicode_fix_matches_normalized_input_and_logs_tier(self):
        for path in FLOWS:
            with self.subTest(path=path):
                row = raw_row("1", "MovieRetro- הוק")
                row["hebrew_title"] = "MovieRetro- הוק"
                flow = self.build_flow(path, [row])
                flow.supabase.tables[flow.HELPER_TABLE_NAME] = [{"title_fix": "movieretro הוק", "tmdb_id": 101}]
                flow.refreshAllTables()
                flow.logic()
                self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME][0]["tmdb_id"], 101)
                self.assertTrue(any("tier=normalized" in note and "movieretro הוק" in note for note in flow.summaryNotes))

    def test_ambiguous_fix_does_not_search_or_publish(self):
        for path in FLOWS:
            with self.subTest(path=path):
                calls = []
                flow = self.build_flow(path, [raw_row("1", "A FILM")], lambda url, params: calls.append(url))
                flow.supabase.tables[flow.HELPER_TABLE_NAME] = [
                    {"title_fix": "A: Film", "tmdb_id": 101}, {"title_fix": "A - Film", "tmdb_id": 102}]
                flow.refreshAllTables()
                flow.logic()
                self.assertEqual(calls, [])
                self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME], [])
                self.assertTrue(any("ambiguous_tmdb_fix" in s for s in flow.summaryUnresolvedOrDropped))


class FixCleaningTests(RawCleaningScopeTests):
    def test_ambiguous_fixes_survive_cleaning_for_review(self):
        for path, table in CLEANERS:
            with self.subTest(table=table):
                row = raw(english_title="A FILM")
                flow = self.build(path, table, [row], [], mapping=False)
                flow.supabase.tables["tableFixes"] = [{"title_fix": "A: Film", "tmdb_id": 1}, {"title_fix": "A - Film", "tmdb_id": 2}]
                flow.refreshAllTables()
                flow.logic()
                stored = flow.supabase.tables[table][0]
                self.assertEqual(stored["english_title"], "A FILM")
                self.assertTrue(stored["cleaned"])

    def test_unicode_fix_is_checked_before_cleaning(self):
        for path, table in CLEANERS:
            with self.subTest(table=table):
                row = raw(english_title="MovieRetro- הוק", hebrew_title="MovieRetro- הוק")
                flow = self.build(path, table, [row], [], mapping=False)
                flow.supabase.tables["tableFixes"] = [{"title_fix": "movieretro הוק", "tmdb_id": 1}]
                flow.refreshAllTables()
                flow.logic()
                self.assertEqual(flow.supabase.tables[table][0]["english_title"], "MovieRetro- הוק")
