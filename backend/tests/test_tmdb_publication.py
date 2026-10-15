from contextlib import ExitStack
from datetime import date, timedelta
from importlib import import_module
from unittest import TestCase, main
from unittest.mock import patch

from dataflow_database import DB
from backend.dataflow.utils.DataflowRequests import DataflowRequestError
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow


FLOWS = ("comingsoons.ComingSoonsTmdb", "nowplayings.NowPlayingsTmdb", "cinematheques.CinemathequesTmdb")


def raw_row(row_id, title):
    return {"id": row_id, "english_title": title, "hebrew_title": "", "release_year": date.today().year, "release_date": (date.today() + timedelta(days=30)).isoformat(), "date_of_showing": (date.today() + timedelta(days=30)).isoformat(), "showtime": "20:00", "screening_city": "Tel Aviv", "cinema": "Test", "runtime": 117, "run_id": 9, "added": False}


class PublicationTests(TestCase):
    def build_flow(self, path, rows, fault=None, database=None):
        module = import_module("backend.dataflow." + path)
        cls = getattr(module, path.split(".")[-1])
        flow = cls.__new__(cls)
        InitializeBaseDataflow.__init__(flow)
        self.addCleanup(flow.closeDataflowRequests)
        flow.run_id, flow.solo_update_only, flow.TMDB_API_KEY = 10, False, "fixture"
        tables = {flow.MAIN_TABLE_NAME: rows, flow.MOVING_TO_TABLE_NAME: [], flow.HELPER_TABLE_NAME: [], flow.HELPER_TABLE_NAME_2: []}
        if flow.MOVING_TO_TABLE_NAME_2:
            tables[flow.MOVING_TO_TABLE_NAME_2] = []
        flow.supabase = database or DB(tables)
        flow.ensureMovieCodesForTable = lambda table: {}
        flow.refreshAllTables()

        def get(path, params=None, **kwargs):
            if fault:
                result = fault(path, params or {})
                if result is not None:
                    return result
            if path == "search/movie":
                movie_id = 102 if (params or {}).get("query", "").lower() == "beta" else 101
                return {"results": [{"id": movie_id}], "total_pages": 1}
            movie_id = int(path.split("/")[-1])
            return {"id": movie_id, "title": "Beta" if movie_id in (102, 999) else "Alpha", "release_date": f"{date.today().year}-01-01", "runtime": 117, "external_ids": {}, "credits": {"crew": []}, "videos": {"results": []}, "genres": []}

        flow.tmdbGet = get
        stack = self.enterContext(ExitStack())
        for name in ("clear_old_entries", "clear_orphan_final_movies", "clear_orphan_final_theque_movies", "dedupe_all_showtimes", "dedupe_all_theques", "dedupe_all_soons"):
            if hasattr(module, name):
                stack.enter_context(patch.object(module, name, lambda *args, **kwargs: None))
        return flow

    def test_exhausted_search_or_enrichment_never_marks_rows_complete(self):
        for path in FLOWS:
            for stage in ("search", "enrich"):
                with self.subTest(flow=path, stage=stage):
                    def fault(url, params):
                        if (stage == "search" and url == "search/movie") or (stage == "enrich" and params.get("append_to_response") == "external_ids,videos"):
                            raise DataflowRequestError("provider unavailable")
                    flow = self.build_flow(path, [raw_row("1", "Alpha")], fault)
                    with self.assertRaises(DataflowRequestError):
                        flow.logic()
                    self.assertFalse(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]["added"])
                    self.assertFalse(any(action.get("op") in ("upsert", "update", "delete") for action in flow.supabase.actions))

    def test_real_no_match_keeps_old_screenings_and_unresolved_raw_eligible(self):
        for path in FLOWS[1:]:
            with self.subTest(flow=path):
                def no_beta(url, params):
                    if url == "search/movie" and params.get("query", "").lower() == "beta":
                        return {"results": [], "total_pages": 0}
                flow = self.build_flow(path, [raw_row("1", "Alpha"), raw_row("2", "Beta")], no_beta)
                old = {**raw_row("old-beta", "Beta"), "tmdb_id": 999}
                flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [old]
                flow.refreshAllTables()
                flow.logic()
                raw = {row["id"]: row for row in flow.supabase.tables[flow.MAIN_TABLE_NAME]}
                self.assertTrue(raw["1"]["added"])
                self.assertFalse(raw["2"]["added"])
                self.assertIn("old-beta", [row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]])

    def test_final_movie_failure_leaves_raw_retryable_and_next_attempt_repairs_it(self):
        for path in FLOWS[1:]:
            with self.subTest(flow=path):
                flow = self.build_flow(path, [raw_row("1", "Alpha")])
                flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [{**raw_row("old-beta", "Beta"), "tmdb_id": 999}]
                flow.refreshAllTables()
                flow.supabase.fail_table = flow.MOVING_TO_TABLE_NAME_2
                with self.assertRaises(RuntimeError):
                    flow.logic()
                self.assertFalse(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]["added"])
                self.assertIn("old-beta", [row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]])
                flow.supabase.fail_table = None
                retry = self.build_flow(path, [], database=flow.supabase)
                retry.logic()
                self.assertTrue(retry.supabase.tables[retry.MAIN_TABLE_NAME][0]["added"])
                self.assertEqual(retry.supabase.tables[retry.MOVING_TO_TABLE_NAME_2][0]["tmdb_id"], 101)

    def test_duplicate_only_page_does_not_hide_later_candidates(self):
        for path in FLOWS:
            with self.subTest(flow=path):
                pages = []
                def paginated(url, params):
                    if url == "search/movie":
                        page = params["page"]
                        pages.append(page)
                        return {"results": [{"id": 102 if page == 3 else 101}], "total_pages": 3}
                row = raw_row("1", "Alpha")
                row["release_year"] = None
                flow = self.build_flow(path, [row], paginated)
                flow.logic()
                self.assertEqual(pages, [1, 2, 3])
                self.assertEqual(flow.candidates, [101, 102])

    def test_missing_or_invalid_page_count_still_has_a_finite_api_bound(self):
        for total_pages in (None, "invalid", 0):
            with self.subTest(total_pages=total_pages):
                pages = []
                def repeated(url, params):
                    if url == "search/movie":
                        pages.append(params["page"])
                        return {"results": [{"id": 101}], "total_pages": total_pages}
                row = raw_row("1", "Alpha")
                row["release_year"] = None
                flow = self.build_flow(FLOWS[1], [row], repeated)
                flow.logic()
                self.assertEqual(pages, list(range(1, 501)))

    def test_missing_movie_never_publishes_placeholder_metadata_or_marks_raw_added(self):
        for path in FLOWS:
            with self.subTest(flow=path):
                def missing_movie(url, params):
                    if params.get("append_to_response") == "external_ids,videos":
                        return {}
                flow = self.build_flow(path, [raw_row("1", "Alpha")], missing_movie)
                flow.logic()
                self.assertFalse(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]["added"])
                self.assertFalse(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME])
                if flow.MOVING_TO_TABLE_NAME_2:
                    self.assertFalse(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME_2])

    def test_already_added_snapshot_still_repairs_missing_referenced_movie(self):
        for path in FLOWS[1:]:
            with self.subTest(flow=path):
                raw = raw_row("1", "Alpha")
                raw["added"] = True
                flow = self.build_flow(path, [raw])
                flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [{**raw, "tmdb_id": 101}]
                flow.refreshAllTables()
                flow.logic()
                self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME_2][0]["tmdb_id"], 101)

    def test_undated_soons_cannot_block_dated_movies_or_overwrite_existing_metadata(self):
        for missing_date in (None, "", "null", "unknown", "2026-02-30"):
            for override in (False, True):
                with self.subTest(release_date=missing_date, override=override):
                    undated = {**raw_row("1", "Alpha"), "release_date": missing_date}
                    dated = raw_row("2", "Beta")
                    flow = self.build_flow(FLOWS[0], [undated, dated])
                    existing = {"tmdb_id": 101, "english_title": "Existing Alpha", "release_date": dated["release_date"], "imdb_id": "tt101"}
                    flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [existing.copy()]
                    if override:
                        flow.tmdbFixForTitle = lambda title, fixes: 101 if title == "Alpha" else None
                    flow.refreshAllTables()
                    flow.logic()
                    raw = {row["id"]: row for row in flow.supabase.tables[flow.MAIN_TABLE_NAME]}
                    final = {row["tmdb_id"]: row for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]}
                    self.assertFalse(raw["1"]["added"])
                    self.assertTrue(raw["2"]["added"])
                    self.assertEqual(final[101], existing)
                    self.assertEqual(final[102]["release_date"], dated["release_date"])

    def test_all_undated_soons_stay_pending_without_inventing_a_tmdb_release_date(self):
        flow = self.build_flow(FLOWS[0], [{**raw_row("1", "Alpha"), "release_date": None}])
        flow.logic()
        self.assertFalse(flow.supabase.tables[flow.MAIN_TABLE_NAME][0]["added"])
        self.assertFalse(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME])
        self.assertFalse(any(action["op"] == "upsert" for action in flow.supabase.actions))

    def test_dated_soon_duplicate_does_not_mark_undated_source_complete(self):
        undated = {**raw_row("1", "Alpha"), "release_date": None}
        dated = raw_row("2", "Alpha")
        flow = self.build_flow(FLOWS[0], [undated, dated])
        flow.logic()
        raw = {row["id"]: row for row in flow.supabase.tables[flow.MAIN_TABLE_NAME]}
        self.assertFalse(raw["1"]["added"])
        self.assertTrue(raw["2"]["added"])
        self.assertEqual(len(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]), 1)
        self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME][0]["release_date"], dated["release_date"])


if __name__ == "__main__":
    main()
