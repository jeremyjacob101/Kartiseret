from contextlib import ExitStack
from datetime import date, timedelta
from importlib import import_module
from unittest import TestCase, main
from unittest.mock import patch
import uuid

from dataflow_database import DB
from backend.dataflow.utils.DataflowRequests import DataflowRequestError
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow
from backend.scraping.BaseCinema import BaseCinema
from backend.scraping.utils.FormatAndAppend import formatAndUpload
from backend.utils.supabase.dedupe_all_showtimes import duplicate_ids as duplicate_showtime_ids
from backend.utils.supabase.dedupe_all_theques import duplicate_ids as duplicate_theque_ids
from backend.utils.supabase.dedupe_all_soons import duplicate_ids as duplicate_soon_ids


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

    def install_snapshot(self, flow, rows, *, status="complete", row_count=None, run_id=11, cinema="Test", snapshot_id=None):
        snapshot_id = snapshot_id or str(uuid.uuid4())
        snapshot_rows = []
        for row in rows:
            snapshot_rows.append({**row, "snapshot_id": snapshot_id, "run_id": run_id, "added": False})
        flow.supabase.tables[flow.MAIN_TABLE_NAME] = snapshot_rows
        flow.supabase.tables.setdefault("pipeline_scrape_snapshots", []).append({
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "attempt": 1,
            "table_name": flow.MAIN_TABLE_NAME,
            "source_name": "TestScraper",
            "cinema": cinema,
            "status": status,
            "row_count": len(snapshot_rows) if row_count is None else row_count,
            "started_at": f"{date.today().isoformat()}T10:00:00+00:00",
            "completed_at": f"{date.today().isoformat()}T10:01:00+00:00" if status == "complete" else None,
        })
        flow.refreshAllTables()
        return snapshot_id

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

    def test_real_no_match_replaces_old_screenings_and_keeps_raw_eligible(self):
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
                self.assertNotIn("old-beta", [row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]])

                def beta_appeared(url, params):
                    if url == "search/movie" and params.get("query", "").lower() == "beta":
                        return {"results": [{"id": 102}], "total_pages": 1}

                retry = self.build_flow(path, [], beta_appeared, database=flow.supabase)
                retried_queries = []
                original_get = retry.tmdbGet

                def track_get(request_path, params=None, **kwargs):
                    if request_path == "search/movie":
                        retried_queries.append((params or {}).get("query"))
                    return original_get(request_path, params, **kwargs)

                retry.tmdbGet = track_get
                retry.logic()

                self.assertIn("beta", [query.lower() for query in retried_queries if query])
                retried_raw = {row["id"]: row for row in retry.supabase.tables[retry.MAIN_TABLE_NAME]}
                self.assertTrue(retried_raw["2"]["added"])
                beta_rows = [
                    row for row in retry.supabase.tables[retry.MOVING_TO_TABLE_NAME]
                    if row.get("english_title") == "Beta"
                ]
                self.assertEqual(len(beta_rows), 1)

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

    def test_coming_soon_rematches_when_publication_retries_after_failure(self):
        row = raw_row("soon-snapshot-row", "Dune: Part Two")
        first = self.build_flow(FLOWS[0], [row])
        self.install_snapshot(first, [row])
        first.supabase.fail_table = first.MOVING_TO_TABLE_NAME

        with self.assertRaisesRegex(RuntimeError, "Injected final-table failure"):
            first.logic()

        self.assertFalse(first.supabase.tables[first.MAIN_TABLE_NAME][0]["added"])
        checkpoint = first.supabase.tables["pipeline_publication_checkpoints"][0]
        self.assertEqual(checkpoint["phase"], "prepared")
        first.supabase.fail_table = None

        retry = self.build_flow(FLOWS[0], [row], database=first.supabase)
        calls = []
        original_get = retry.tmdbGet
        def track_get(path, params=None, **kwargs):
            calls.append(path)
            return original_get(path, params, **kwargs)
        retry.tmdbGet = track_get
        retry.logic()

        self.assertIn("search/movie", calls)
        self.assertTrue(retry.supabase.tables[retry.MAIN_TABLE_NAME][0]["added"])
        self.assertEqual(retry.supabase.tables["pipeline_publication_checkpoints"][0]["phase"], "published")

    def test_publication_evidence_fingerprint_changes_with_metadata_fixes_skips_and_policy(self):
        flow = self.build_flow(FLOWS[1], [raw_row("1", "The Film")])
        row = {**raw_row("1", "The Film"), "directed_by": "Director A", "runtime": 100, "_checkpoint_source": "CinemaScraper"}
        flow.helper_table_rows = [{"title_fix": "The Film", "tmdb_id": 123}]
        flow.helper_table_2_rows = [{"name_or_tmdb_id": "Ignore Me"}]
        initial = flow.matchInputFingerprint("nowplayings", "the film", [row])

        flow.helper_table_rows = [{"title_fix": "The Film", "tmdb_id": 456}]
        changed_fix = flow.matchInputFingerprint("nowplayings", "the film", [row])
        flow.helper_table_rows = [{"title_fix": "The Film", "tmdb_id": 123}]
        flow.helper_table_2_rows = [{"name_or_tmdb_id": "Other Skip"}]
        changed_skip = flow.matchInputFingerprint("nowplayings", "the film", [row])
        changed_metadata = flow.matchInputFingerprint("nowplayings", "the film", [{**row, "runtime": 101}])
        with patch("backend.dataflow.utils.PipelineCheckpoints.MATCHING_POLICY_VERSION", 2):
            changed_policy = flow.matchInputFingerprint("nowplayings", "the film", [row])

        self.assertNotEqual(initial, changed_fix)
        self.assertNotEqual(initial, changed_skip)
        self.assertNotEqual(initial, changed_metadata)
        self.assertNotEqual(initial, changed_policy)

    def test_latest_snapshot_selection_accepts_confirmed_empty_and_rejects_failed_or_partial(self):
        flow = self.build_flow(FLOWS[1], [])
        complete_empty = str(uuid.uuid4())
        failed = str(uuid.uuid4())
        running = str(uuid.uuid4())
        mismatched = str(uuid.uuid4())
        flow.supabase.tables["pipeline_scrape_snapshots"] = [
            {"snapshot_id": complete_empty, "run_id": 10, "attempt": 1, "table_name": flow.MAIN_TABLE_NAME, "source_name": "EmptyScraper", "cinema": "Empty", "status": "complete", "row_count": 0, "completed_at": "2026-10-15T10:00:00+00:00"},
            {"snapshot_id": failed, "run_id": 12, "attempt": 1, "table_name": flow.MAIN_TABLE_NAME, "source_name": "FailedScraper", "cinema": "Failed", "status": "failed", "row_count": 0},
            {"snapshot_id": running, "run_id": 13, "attempt": 1, "table_name": flow.MAIN_TABLE_NAME, "source_name": "RunningScraper", "cinema": "Running", "status": "running", "row_count": 0},
            {"snapshot_id": mismatched, "run_id": 14, "attempt": 1, "table_name": flow.MAIN_TABLE_NAME, "source_name": "MismatchScraper", "cinema": "Mismatch", "status": "complete", "row_count": 2, "completed_at": "2026-10-15T10:00:00+00:00"},
        ]
        flow.supabase.tables[flow.MAIN_TABLE_NAME] = [{**raw_row("partial-row", "Partial"), "snapshot_id": mismatched}]
        flow.refreshAllTables()

        rows_by_cinema, manifests, snapshot_ids, _legacy = flow.selectLatestRawSnapshots(flow.MAIN_TABLE_NAME, flow.main_table_rows)

        self.assertEqual(rows_by_cinema["Empty"], [])
        self.assertEqual(snapshot_ids["Empty"], complete_empty)
        self.assertNotIn("Failed", manifests)
        self.assertNotIn("Running", manifests)
        self.assertNotIn("Mismatch", manifests)

    def test_publication_retry_skips_screenings_after_the_screening_phase_succeeded(self):
        for path in FLOWS[1:]:
            with self.subTest(flow=path):
                row = raw_row("screening-1", "Alpha")
                first = self.build_flow(path, [row])
                snapshot_id = self.install_snapshot(first, [row])
                first.supabase.fail_table = first.MOVING_TO_TABLE_NAME_2
                with self.assertRaisesRegex(RuntimeError, "Injected final-table failure"):
                    first.logic()

                checkpoint = next(row for row in first.supabase.tables["pipeline_publication_checkpoints"] if row["snapshot_id"] == snapshot_id)
                self.assertEqual(checkpoint["phase"], "screenings_written")
                self.assertTrue(any(action["op"] == "upsert" and action["table"] == first.MOVING_TO_TABLE_NAME for action in first.supabase.actions))
                first.supabase.fail_table = None
                screen_upserts_before_retry = sum(action["op"] == "upsert" and action["table"] == first.MOVING_TO_TABLE_NAME for action in first.supabase.actions)

                retry = self.build_flow(path, [], database=first.supabase)
                retry.logic()

                screen_upserts_after_retry = sum(action["op"] == "upsert" and action["table"] == retry.MOVING_TO_TABLE_NAME for action in retry.supabase.actions)
                self.assertEqual(screen_upserts_after_retry, screen_upserts_before_retry)
                self.assertTrue(retry.supabase.tables[retry.MAIN_TABLE_NAME][0]["added"])
                self.assertTrue(retry.supabase.tables[retry.MOVING_TO_TABLE_NAME_2])
                self.assertEqual(retry.supabase.tables["pipeline_publication_checkpoints"][0]["phase"], "published")

    def test_newer_failed_scrape_fences_off_older_complete_snapshot(self):
        old_row = raw_row("old-raw", "Old Film")
        flow = self.build_flow(FLOWS[1], [old_row])
        old_snapshot = self.install_snapshot(flow, [old_row], run_id=11)
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [{**old_row, "tmdb_id": 888}]
        flow.supabase.tables["pipeline_scrape_snapshots"].append({
            "snapshot_id": str(uuid.uuid4()),
            "run_id": 12,
            "attempt": 1,
            "table_name": flow.MAIN_TABLE_NAME,
            "source_name": "NewerFailedScraper",
            "cinema": "Test",
            "status": "failed",
            "row_count": 0,
            "started_at": f"{date.today().isoformat()}T11:00:00+00:00",
            "completed_at": f"{date.today().isoformat()}T11:01:00+00:00",
        })
        flow.refreshAllTables()

        flow.logic()

        self.assertEqual([row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]], ["old-raw"])
        self.assertFalse(flow._publication_claims)
        self.assertEqual(flow.latest_snapshot_ids_by_cinema, {})

    def test_unresolved_snapshot_retries_from_matching_after_a_partial_publication(self):
        row = raw_row("unresolved-row", "Alpha")
        first = self.build_flow(FLOWS[1], [row])
        snapshot_id = self.install_snapshot(first, [row])
        first.claimSnapshotPublication("nowplayings", snapshot_id, "same-input", cinema="Test")
        first.advanceSnapshotPublication(snapshot_id, "prepared", has_unresolved=True)
        first.advanceSnapshotPublication(snapshot_id, "screenings_written", has_unresolved=True)
        retry = self.build_flow(FLOWS[1], [row], database=first.supabase)
        retry.claimSnapshotPublication("nowplayings", snapshot_id, "same-input", cinema="Test")

        self.assertEqual(retry._publication_claims[snapshot_id]["phase"], "in_progress")
        self.assertFalse(retry.snapshotPublicationReached(snapshot_id, "screenings_written"))

    def test_scraper_manifest_marks_only_explicit_empty_as_complete(self):
        database = DB({"pipeline_scrape_snapshots": []})
        scraper = BaseCinema.__new__(BaseCinema)
        scraper.supabase = database
        scraper.supabase_table_name = "allShowtimes"
        scraper.run_id = 10
        scraper.snapshot_id = str(uuid.uuid4())
        scraper._artifact_attempt = 2
        scraper._snapshot_manifest_started = False
        scraper._empty_snapshot_evidence = None
        scraper.CINEMA_NAME = "Test Cinema"
        scraper.gathering_info = {"english_title": [], "showtime": []}
        scraper.startScrapeSnapshot()

        with self.assertRaisesRegex(Exception, "without confirmed empty-source evidence"):
            formatAndUpload(scraper)
        self.assertEqual(database.tables["pipeline_scrape_snapshots"][0]["status"], "running")

        scraper.confirmEmptySnapshot("All source dates explicitly said no screenings")
        formatAndUpload(scraper)
        scraper.finishScrapeSnapshot(scraper._snapshot_row_count)
        manifest = database.tables["pipeline_scrape_snapshots"][0]
        self.assertEqual(manifest["status"], "complete")
        self.assertEqual(manifest["row_count"], 0)
        self.assertEqual(manifest["attempt"], 2)
        scraper.failScrapeSnapshot(RuntimeError("metrics failed after successful upload"))
        self.assertEqual(database.tables["pipeline_scrape_snapshots"][0]["status"], "complete")

        failed = BaseCinema.__new__(BaseCinema)
        failed.supabase = database
        failed.supabase_table_name = "allShowtimes"
        failed.run_id = 11
        failed.snapshot_id = str(uuid.uuid4())
        failed._artifact_attempt = 1
        failed._snapshot_manifest_started = False
        failed.CINEMA_NAME = "Failed Cinema"
        failed.startScrapeSnapshot()
        failed.failScrapeSnapshot(RuntimeError("navigation failed"))
        self.assertEqual(database.tables["pipeline_scrape_snapshots"][1]["status"], "failed")

    def test_reused_scraper_starts_a_fresh_snapshot_without_old_empty_evidence(self):
        database = DB({"pipeline_scrape_snapshots": []})
        scraper = BaseCinema.__new__(BaseCinema)
        scraper.supabase = database
        scraper.supabase_table_name = "allShowtimes"
        scraper.run_id = 10
        scraper._artifact_attempt = 1
        scraper._snapshot_manifest_started = False
        scraper._empty_snapshot_evidence = None
        scraper.CINEMA_NAME = "Test Cinema"

        scraper.startScrapeSnapshot()
        first_snapshot_id = scraper.snapshot_id
        scraper.confirmEmptySnapshot("The first attempt confirmed no listings")
        scraper.startScrapeSnapshot()

        self.assertNotEqual(scraper.snapshot_id, first_snapshot_id)
        self.assertIsNone(scraper._empty_snapshot_evidence)
        self.assertEqual(len(database.tables["pipeline_scrape_snapshots"]), 2)
        self.assertEqual([row["status"] for row in database.tables["pipeline_scrape_snapshots"]], ["running", "running"])

    def test_unresolved_match_replaces_old_cinema_screenings(self):
        beta = raw_row("new-beta", "Beta")
        alpha = raw_row("new-alpha", "Alpha")
        old_beta = {**raw_row("old-beta", "Beta"), "tmdb_id": 999}
        old_gamma = {**raw_row("old-gamma", "Gamma"), "tmdb_id": 555}
        flow = self.build_flow(FLOWS[1], [alpha, beta], lambda path, params: {"results": [], "total_pages": 0} if path == "search/movie" and params.get("query", "").lower() == "beta" else None)
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [old_beta, old_gamma]
        snapshot_id = self.install_snapshot(flow, [alpha, beta])

        flow.logic()

        screenings = flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]
        ids = {row["id"] for row in screenings}
        self.assertEqual(ids, {"new-alpha"})
        raw = {row["id"]: row for row in flow.supabase.tables[flow.MAIN_TABLE_NAME]}
        self.assertTrue(raw["new-alpha"]["added"])
        self.assertFalse(raw["new-beta"]["added"])
        checkpoint = next(row for row in flow.supabase.tables["pipeline_publication_checkpoints"] if row["snapshot_id"] == snapshot_id)
        self.assertTrue(checkpoint["has_unresolved"])

    def test_unresolved_only_snapshot_replaces_old_cinema_screenings(self):
        beta = raw_row("new-beta", "Beta")
        old_beta = {**raw_row("old-beta", "Beta"), "tmdb_id": 999}
        old_gamma = {**raw_row("old-gamma", "Gamma"), "tmdb_id": 555}
        flow = self.build_flow(FLOWS[1], [beta], lambda path, params: {"results": [], "total_pages": 0} if path == "search/movie" else None)
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [old_beta, old_gamma]
        self.install_snapshot(flow, [beta])

        flow.logic()

        ids = {row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]}
        self.assertEqual(ids, set())

    def test_current_intentional_skip_allows_old_title_screenings_to_be_removed(self):
        beta = raw_row("new-beta", "Beta")
        old_beta = {**raw_row("old-beta", "Beta"), "tmdb_id": 999}
        old_gamma = {**raw_row("old-gamma", "Gamma"), "tmdb_id": 555}
        flow = self.build_flow(FLOWS[1], [beta])
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [old_beta, old_gamma]
        flow.supabase.tables[flow.HELPER_TABLE_NAME_2] = [{"name_or_tmdb_id": "Beta"}]
        self.install_snapshot(flow, [beta])

        flow.logic()

        self.assertEqual(flow.supabase.tables[flow.MOVING_TO_TABLE_NAME], [])
        raw = flow.supabase.tables[flow.MAIN_TABLE_NAME][0]
        self.assertTrue(raw["added"])

    def test_fresh_raw_id_for_same_logical_screening_keeps_one_final_row(self):
        raw = raw_row("fresh-raw-id", "Alpha")
        existing = {**raw_row("previous-raw-id", "Alpha"), "tmdb_id": 101}
        flow = self.build_flow(FLOWS[1], [raw])
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [existing]
        flow.supabase.tables[flow.MOVING_TO_TABLE_NAME_2] = [{"tmdb_id": 101, "english_title": "Alpha"}]
        self.install_snapshot(flow, [raw])

        flow.logic()

        final_rows = flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]
        self.assertEqual(len(final_rows), 1)
        self.assertEqual(flow._showtime_key(final_rows[0]), flow._showtime_key(existing))

    def test_confirmed_empty_snapshot_removes_old_rows_but_failed_snapshot_does_not(self):
        for status, should_delete in (("complete", True), ("failed", False), ("running", False)):
            with self.subTest(status=status):
                old = {**raw_row("old-screening", "Old Film"), "tmdb_id": 888}
                flow = self.build_flow(FLOWS[1], [])
                flow.supabase.tables[flow.MOVING_TO_TABLE_NAME] = [old]
                self.install_snapshot(flow, [], status=status, row_count=0)

                flow.logic()

                ids = {row["id"] for row in flow.supabase.tables[flow.MOVING_TO_TABLE_NAME]}
                self.assertEqual("old-screening" not in ids, should_delete)

    def test_raw_deduplication_keeps_different_snapshot_attempts_isolated(self):
        common = raw_row("a", "Alpha")
        first = {**common, "id": "first", "snapshot_id": "attempt-one", "run_id": 20}
        second = {**common, "id": "second", "snapshot_id": "attempt-two", "run_id": 20}
        same_attempt = {**common, "id": "duplicate", "snapshot_id": "attempt-one", "run_id": 20}
        legacy_later_run = {**common, "id": "legacy-later-run", "snapshot_id": None, "run_id": 21}

        self.assertEqual(duplicate_showtime_ids([first, second]), [])
        self.assertEqual(duplicate_theque_ids([first, second]), [])
        self.assertEqual(duplicate_soon_ids([first, second]), [])
        self.assertEqual(duplicate_showtime_ids([first, same_attempt]), ["duplicate"])
        self.assertEqual(duplicate_theque_ids([first, same_attempt]), ["duplicate"])
        self.assertEqual(duplicate_soon_ids([first, same_attempt]), ["duplicate"])
        self.assertEqual(duplicate_showtime_ids([{**common, "id": "legacy-first", "snapshot_id": None, "run_id": 20}, legacy_later_run]), ["legacy-first"])

    def test_dataflow_dedupe_keeps_snapshot_attempts_and_reconciles_removed_rows(self):
        first_snapshot, second_snapshot = str(uuid.uuid4()), str(uuid.uuid4())
        common = raw_row("first", "Film")
        rows = [
            {**common, "id": "first", "snapshot_id": first_snapshot},
            {**common, "id": "second", "snapshot_id": second_snapshot},
        ]
        flow = self.build_flow(FLOWS[0], rows)
        flow.supabase.tables["pipeline_scrape_snapshots"] = [
            {"snapshot_id": first_snapshot, "table_name": "allSoons", "status": "complete", "row_count": 1},
            {"snapshot_id": second_snapshot, "table_name": "allSoons", "status": "complete", "row_count": 1},
        ]
        flow.refreshAllTables()
        flow.dedupeAllSoons(flow.MAIN_TABLE_NAME)
        self.assertEqual(len(flow.supabase.tables[flow.MAIN_TABLE_NAME]), 2)

        flow.supabase.tables[flow.MAIN_TABLE_NAME].append({**common, "id": "duplicate", "snapshot_id": first_snapshot})
        flow.supabase.tables["pipeline_scrape_snapshots"][0]["row_count"] = 2
        flow.refreshAllTables()
        flow.dedupeAllSoons(flow.MAIN_TABLE_NAME)

        self.assertEqual(len(flow.supabase.tables[flow.MAIN_TABLE_NAME]), 2)
        self.assertEqual(flow.supabase.tables["pipeline_scrape_snapshots"][0]["row_count"], 1)


if __name__ == "__main__":
    main()
