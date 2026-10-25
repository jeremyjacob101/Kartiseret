from contextlib import redirect_stdout
from io import StringIO
import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch
import uuid

from dataflow_database import DB
import test_tmdb_publication as fixtures
from backend.config.registry import DATAFLOW_REGISTRY
from backend.config.runners import runPlan
from backend.dataflow.nowplayings.NowPlayingsUpdate import NowPlayingsUpdate
from backend.dataflow.cinematheques.CinemathequesTmdb import CinemathequesTmdb
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow
from backend.dataflow.utils.MovieCodes import MovieCodes
from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace, create_client


class CategoryPublicationTests(TestCase):
    def workspace(self, category="nowplayings", tables=None):
        db = DB(tables or {})
        return PublicationWorkspace(category, 10, db), db

    def test_existing_mapper_and_update_prepare_one_private_result(self):
        fixture = fixtures.PublicationTests()
        self.addCleanup(fixture.doCleanups)
        row = fixtures.raw_row(str(uuid.uuid4()), "Alpha")
        row.pop("release_date")
        workspace, live = self.workspace(tables={"allShowtimes": [row]})
        mapper = fixture.build_flow("nowplayings.NowPlayingsTmdb", [], database=workspace)
        mapper.logic()
        self.assertFalse(live.tables.get("finalMovies"))
        self.assertFalse(live.tables.get("finalShowtimes"))
        self.assertFalse(live.tables["allShowtimes"][0]["added"])
        update = NowPlayingsUpdate.__new__(NowPlayingsUpdate)
        InitializeBaseDataflow.__init__(update)
        self.addCleanup(update.closeDataflowRequests)
        update.supabase, update.run_id, update.solo_update_only = workspace, 10, False
        update.refreshAllTables()
        targets = update.beginSharedUpdate()
        self.assertEqual([r["tmdb_id"] for r in targets], [101])
        update.finishSharedUpdate(1, [{**targets[0], "rtCriticRating": 0, "imdbRating": 8.2}])
        parts = [json.loads(p) for p in workspace.parts()]
        changes = [r for p in parts if p["kind"] == "changes" for r in p["rows"]]
        movie = next(r["after"] for r in changes if r["table"] == "finalMovies")
        self.assertEqual(movie["rtCriticRating"], 0)
        self.assertEqual(movie["imdbRating"], 8.2)
        self.assertTrue(any(r["table"] == "finalShowtimes" for r in changes))
        self.assertTrue(next(r["after"] for r in changes if r["table"] == "allShowtimes")["added"])
        self.assertFalse(live.tables.get("finalMovies"))
        self.assertFalse(live.actions)

    def test_category_commit_happens_after_last_selected_stage_and_before_alerts(self):
        events = []
        publication = SimpleNamespace(commit=lambda: events.append("commit"))
        def stage(kind, key, run_id, **kwargs):
            names = [c.__name__ for c in kwargs["classes_override"]]
            if any(name.endswith("Dispatcher") for name in names):
                self.assertIn("commit", events)
                events.append(names[0])
            else:
                events.append("map")
                kwargs["request_context"].publications["nowplayings"] = publication
            return {c: True for c in kwargs["classes_override"]}
        def update(entries, *_args, **_kwargs):
            self.assertNotIn("commit", events)
            events.append("update")
            return {c: True for _, c in entries}
        plan = [("dataflow", "nowPlayingData", DATAFLOW_REGISTRY["nowPlayingData"][1:])]
        with patch("backend.config.runners.runGroup", side_effect=stage), patch("backend.config.runners._run_shared_updates", side_effect=update), redirect_stdout(StringIO()):
            self.assertTrue(runPlan(10, plan))
        self.assertEqual(
            events,
            [
                "map",
                "update",
                "commit",
                "TicketAlertDispatcher",
                "LetterboxdSourceDispatcher",
            ],
        )

    def test_failed_update_never_publishes_or_dispatches_alerts(self):
        publication = SimpleNamespace(commit=lambda: self.fail("Failed category was published"))
        def stage(kind, key, run_id, **kwargs):
            self.assertNotIn("TicketAlertDispatcher", [c.__name__ for c in kwargs["classes_override"]])
            kwargs["request_context"].publications["nowplayings"] = publication
            return {c: True for c in kwargs["classes_override"]}
        with patch("backend.config.runners.runGroup", side_effect=stage), patch("backend.config.runners._run_shared_updates", side_effect=lambda entries, *_a, **_k: {c: False for _, c in entries}), redirect_stdout(StringIO()):
            self.assertFalse(runPlan(10, [("dataflow", "nowPlayingData", DATAFLOW_REGISTRY["nowPlayingData"][1:])]))

    def test_failed_category_commit_fails_the_run_and_skips_alerts(self):
        publication = SimpleNamespace(commit=Mock(side_effect=TimeoutError("commit timed out")))
        dispatchers = []
        output = StringIO()

        def stage(_kind, _key, _run_id, **kwargs):
            classes = kwargs["classes_override"]
            if any(cls.__name__.endswith("Dispatcher") for cls in classes):
                dispatchers.extend(cls.__name__ for cls in classes)
                return {cls: True for cls in classes}
            kwargs["request_context"].publications["nowplayings"] = publication
            return {cls: True for cls in classes}

        with patch("backend.config.runners.runGroup", side_effect=stage), patch(
            "backend.config.runners._run_shared_updates",
            side_effect=lambda entries, *_args, **_kwargs: {
                cls: True for _key, cls in entries
            },
        ), patch("backend.config.runners.artifactPrinting"), redirect_stdout(output):
            successful = runPlan(
                10,
                [("dataflow", "nowPlayingData", DATAFLOW_REGISTRY["nowPlayingData"][1:])],
            )

        self.assertFalse(successful)
        publication.commit.assert_called_once_with()
        self.assertEqual(dispatchers, [])
        self.assertIn(
            "nowPlayingData publication failed or was unconfirmed",
            " ".join(output.getvalue().split()),
        )

    def test_failed_stage_restore_keeps_prior_clean_work_and_live_state_unchanged(self):
        workspace, live = self.workspace(tables={"allShowtimes": [{"id": "raw", "cleaned": False, "added": False}]})
        workspace.table("allShowtimes").update({"cleaned": True}).eq("id", "raw").execute()
        saved = workspace.savepoint()
        workspace.table("finalMovies").insert({"tmdb_id": 1, "english_title": "Partial"}).execute()
        workspace.table("allShowtimes").update({"added": True}).eq("id", "raw").execute()
        workspace.restore(saved)
        self.assertTrue(workspace.table("allShowtimes").select().execute().data[0]["cleaned"])
        self.assertFalse(workspace.table("allShowtimes").select().execute().data[0]["added"])
        self.assertEqual(workspace.table("finalMovies").select().execute().data, [])
        self.assertFalse(live.tables["allShowtimes"][0]["cleaned"])

    def test_cinematheque_direct_run_uses_same_boundary_and_maintenance_client(self):
        workspace, live = self.workspace("cinematheques")
        with patch("backend.dataflow.utils.InitializeBaseDataflow.workspace_for", return_value=(workspace, True)):
            flow = CinemathequesTmdb(10)
        seen = []
        flow.logic = lambda: seen.append(create_client("unused", "unused"))
        flow.flush_summary = lambda **_kwargs: None
        flow.ensureCinemathequeTimingRow = lambda: None
        with patch.object(workspace, "commit", side_effect=lambda: seen.append("commit")), patch("backend.dataflow.BaseDataflow.logSuccessfulRun"):
            flow.dataRun()
        self.assertEqual(seen, [workspace, "commit"])
        self.assertFalse(live.actions)

    def test_lost_commit_response_reconciles_receipt_without_republishing(self):
        workspace, live = self.workspace()
        workspace.table("finalMovies").insert({"tmdb_id": 1, "english_title": "Ready"}).execute()
        calls = []
        def rpc(name, params):
            def execute():
                calls.append(name)
                header = live.tables["pipeline_publications"][0]
                header.update(status="applied", revision=7)
                raise ConnectionError("commit acknowledgement lost")
            return SimpleNamespace(execute=execute)
        live.rpc = rpc
        with patch("backend.dataflow.utils.PublicationWorkspace.Path"):
            receipt = workspace.commit()
            self.assertEqual(receipt["status"], "applied")
            self.assertEqual(workspace.commit(), receipt)
        self.assertEqual(calls, ["commit_category_publication"])

    def test_non_applied_commit_receipt_fails(self):
        workspace, live = self.workspace()
        workspace.table("finalMovies").insert({"tmdb_id": 1, "english_title": "Ready"}).execute()
        live.rpc = lambda *_args, **_kwargs: SimpleNamespace(
            execute=lambda: SimpleNamespace(data={"status": "prepared"})
        )

        with patch("backend.dataflow.utils.PublicationWorkspace.Path"):
            with self.assertRaisesRegex(RuntimeError, "was not applied"):
                workspace.commit()

    def test_read_only_preparation_does_not_write_receipts_and_chunk_limits_are_bounded(self):
        workspace, live = self.workspace(tables={"finalMovies": [{"tmdb_id": 1, "english_title": "Old"}]})
        workspace.table("finalMovies").select().execute()
        self.assertEqual(workspace.commit(), {"status": "unchanged"})
        self.assertFalse(live.actions)
        workspace, _ = self.workspace()
        for index in range(450):
            workspace.table("finalMovies").insert({"tmdb_id": index + 1, "english_title": "X" * 5000}).execute()
        parts = workspace.parts()
        self.assertTrue(all(len(p.encode()) < 1_048_576 for p in parts))
        self.assertTrue(all(len(json.loads(p)["rows"]) <= 200 for p in parts))
        with self.assertRaisesRegex(RuntimeError, "frozen"):
            workspace.table("finalMovies").update({"english_title": "Too late"}).execute()
        with self.assertRaisesRegex(ValueError, "outside"):
            workspace.table("finalSoons")

    def test_private_categories_reserve_codes_without_exposing_them_live(self):
        reserved = set()
        workspaces = [PublicationWorkspace(category, 10, DB({}), reserved_movie_codes=reserved) for category in ("nowplayings", "comingsoons")]
        for index, workspace in enumerate(workspaces):
            flow = MovieCodes()
            flow.supabase = workspace
            flow.selectAll = lambda table, select: workspace.table(table).select(select).execute().data
            flow.randomAvailableMovieCode = lambda used: next(code for code in ("AAA", "BBB") if code not in used)
            result = flow.ensureMovieCodes([index + 1])
            self.assertEqual(result[index + 1], ("AAA", "BBB")[index])
            self.assertFalse(workspace.client.tables["movieCodes"])
        self.assertEqual(reserved, {"AAA", "BBB"})

    def test_complete_snapshot_stages_checkpoints_and_leaves_unmatched_rows_retryable(self):
        fixture = fixtures.PublicationTests()
        self.addCleanup(fixture.doCleanups)
        seed = fixture.build_flow("nowplayings.NowPlayingsTmdb", [])
        fixture.install_snapshot(seed, [fixtures.raw_row(str(uuid.uuid4()), "Alpha"), fixtures.raw_row(str(uuid.uuid4()), "Beta")])
        for row in seed.supabase.tables["allShowtimes"]:
            row.pop("release_date")
        workspace = PublicationWorkspace("nowplayings", 10, seed.supabase)
        flow = fixture.build_flow("nowplayings.NowPlayingsTmdb", [], database=workspace,
                                  fault=lambda path, params: {"results": [], "total_pages": 0} if path == "search/movie" and params.get("query", "").lower() == "beta" else None)
        flow.logic()
        self.assertFalse(seed.supabase.tables.get("pipeline_publication_checkpoints"))
        checkpoint = workspace.table("pipeline_publication_checkpoints").select().execute().data[0]
        self.assertEqual(checkpoint["phase"], "published")
        self.assertTrue(checkpoint["has_unresolved"])
        rows = workspace.table("allShowtimes").select().execute().data
        self.assertEqual({r["english_title"]: r["added"] for r in rows}, {"Alpha": True, "Beta": False})
        self.assertTrue(all(not r["added"] for r in seed.supabase.tables["allShowtimes"]))
        self.assertEqual(len(workspace.claims), 1)
