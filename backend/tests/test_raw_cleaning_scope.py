from copy import deepcopy
from importlib import import_module
import json
from types import SimpleNamespace
from unittest import TestCase
import uuid

from dataflow_database import DB
import test_tmdb_publication as fixtures
from backend.dataflow.utils.InitializeBaseDataflow import InitializeBaseDataflow
from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace


CLEANERS = (
    ("nowplayings.NowPlayingsClean", "allShowtimes"),
    ("comingsoons.ComingSoonsClean", "allSoons"),
    ("cinematheques.CinemathequesClean", "allTheques"),
)


def manifest(table, snapshot_id, *, run_id=9, status="failed", count=0,
             cinema="Test", source="TestScraper", attempt=1):
    return {
        "snapshot_id": snapshot_id, "table_name": table, "cinema": cinema,
        "source_name": source, "run_id": run_id, "attempt": attempt,
        "started_at": "2026-10-23T08:00:00Z", "status": status, "row_count": count,
    }


def raw(snapshot_id=None, **fields):
    return {
        **fixtures.raw_row(str(uuid.uuid4()), "Alpha!"),
        "snapshot_id": snapshot_id, "cleaned": False, "added": False, **fields,
    }


class RawCleaningScopeTests(TestCase):
    def build(self, path, table, rows, manifests, *, mapping=True, database=None):
        cls = getattr(import_module("backend.dataflow." + path), path.split(".")[-1])
        flow = cls.__new__(cls)
        InitializeBaseDataflow.__init__(flow)
        self.addCleanup(flow.closeDataflowRequests)
        flow.run_id = 10
        flow._shared_request_context = SimpleNamespace(
            selected_mapping_tables=frozenset({table}) if mapping else frozenset()
        )
        flow.supabase = database or DB({
            table: rows, "pipeline_scrape_snapshots": manifests,
            "tableFixes": [], "tableSkips": [],
        })
        flow.refreshAllTables()
        return flow

    def test_only_replaced_failed_attempts_are_excluded_without_mutating_rows(self):
        for path, table in CLEANERS:
            with self.subTest(table=table):
                failed, complete, current = [str(uuid.uuid4()) for _ in range(3)]
                rows = [
                    raw(failed), raw(complete), raw(current, run_id=10),
                    raw(None, run_id=1), raw(str(uuid.uuid4()), run_id=1),
                ]
                manifests = [
                    manifest(table, failed),
                    manifest(table, complete, status="complete", count=1),
                    manifest(table, current, run_id=10, status="complete", count=1),
                ]
                flow = self.build(path, table, rows, manifests)
                before = deepcopy(flow.main_table_rows)
                selected = flow.rawRowsForCleaning(table, flow.main_table_rows)
                self.assertEqual([r["id"] for r in selected], [r["id"] for r in before if r["snapshot_id"] != failed])
                self.assertEqual(flow.main_table_rows, before)
                self.assertEqual(flow.supabase.actions, [])
                self.assertTrue(all("_checkpoint_source" not in r for r in selected))

    def test_uncertain_or_unready_replacement_keeps_all_pending_work(self):
        cases = (
            {"status": "failed"}, {"status": "running"}, {"count": 2},
            {"count": -1}, {"count": None}, {"source": "DifferentScraper"},
            {"source": ""}, {"status": "unknown"},
        )
        for path, table in CLEANERS:
            for override in cases:
                with self.subTest(table=table, replacement=override):
                    old, new = str(uuid.uuid4()), str(uuid.uuid4())
                    rows = [raw(old), raw(new, run_id=10)]
                    replacement = {"run_id": 10, "status": "complete", "count": 1, **override}
                    flow = self.build(path, table, rows, [manifest(table, old), manifest(table, new, **replacement)])
                    self.assertCountEqual(flow.rawRowsForCleaning(table, flow.main_table_rows), rows)

    def test_failed_running_complete_and_unknown_old_states_are_not_conflated(self):
        for status in ("complete", "running", "unknown"):
            with self.subTest(status=status):
                old, new = str(uuid.uuid4()), str(uuid.uuid4())
                rows = [raw(old), raw(new, run_id=10)]
                flow = self.build(*CLEANERS[0], rows, [
                    manifest("allShowtimes", old, status=status, count=1),
                    manifest("allShowtimes", new, run_id=10, status="complete", count=1),
                ])
                self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)

    def test_newer_failed_attempt_fences_an_intermediate_complete_replacement(self):
        old, middle, latest = [str(uuid.uuid4()) for _ in range(3)]
        rows = [raw(old), raw(middle), raw(latest)]
        flow = self.build(*CLEANERS[0], rows, [
            manifest("allShowtimes", old, attempt=1),
            manifest("allShowtimes", middle, attempt=2, status="complete", count=1),
            manifest("allShowtimes", latest, attempt=3),
        ])
        self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)

    def test_mismatched_source_rows_cannot_authorize_excluding_pending_work(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        rows = [raw(old), raw(new, cinema="Wrong cinema")]
        flow = self.build(*CLEANERS[0], rows, [
            manifest("allShowtimes", old),
            manifest("allShowtimes", new, run_id=10, status="complete", count=1),
        ])
        self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)

    def test_complete_empty_replacement_and_same_run_retry_use_attempt_order(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        rows = [raw(old)]
        flow = self.build(*CLEANERS[0], rows, [
            manifest("allShowtimes", old, attempt=1),
            manifest("allShowtimes", new, attempt=2, status="complete", count=0),
        ])
        self.assertEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), [])
        # Row run_id can have been stamped by an earlier cleaner. The source
        # attempt's identity/order, rather than the row's age, is authoritative.
        flow.main_table_rows[0]["run_id"] = 999
        self.assertEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), [])

    def test_clean_only_direct_and_different_category_runs_keep_historical_scope(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        rows = [raw(old), raw(new)]
        manifests = [manifest("allShowtimes", old), manifest("allShowtimes", new, run_id=10, status="complete", count=1)]
        flow = self.build(*CLEANERS[0], rows, manifests, mapping=False)
        self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)
        flow._shared_request_context = None
        self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)
        flow._shared_request_context = SimpleNamespace(selected_mapping_tables={"allSoons"})
        self.assertCountEqual(flow.rawRowsForCleaning("allShowtimes", flow.main_table_rows), rows)

    def test_actual_cleaners_retain_older_complete_legacy_unknown_and_current_rows(self):
        for path, table in CLEANERS:
            with self.subTest(table=table):
                failed, complete, current = [str(uuid.uuid4()) for _ in range(3)]
                rows = [
                    raw(failed), raw(complete), raw(current, run_id=10),
                    raw(None, run_id=1), raw(str(uuid.uuid4())),
                    raw(None, cleaned=None, added=None, english_title="Nullable!"),
                    raw(None, added=True, english_title="Handled!"),
                    raw(None, cleaned=True, english_title="Already Clean"),
                ]
                flow = self.build(path, table, rows, [
                    manifest(table, failed), manifest(table, complete, status="complete", count=1),
                    manifest(table, current, run_id=10, status="complete", count=1),
                ])
                flow.logic()
                stored = {r["id"]: r for r in flow.supabase.tables[table]}
                self.assertEqual(stored[rows[0]["id"]], rows[0])
                for row in rows[1:]:
                    self.assertTrue(stored[row["id"]]["cleaned"])
                    self.assertIs(stored[row["id"]]["added"], row["added"])
                    expected_title = row["english_title"] if row["cleaned"] is True else flow.normalizeTitle(row["english_title"])
                    self.assertEqual(stored[row["id"]]["english_title"], expected_title)

    def test_older_active_snapshot_for_another_cinema_still_cleans_and_maps(self):
        fixture = fixtures.PublicationTests()
        self.addCleanup(fixture.doCleanups)
        for (path, table), mapper_path in zip(CLEANERS, (fixtures.FLOWS[1], fixtures.FLOWS[0], fixtures.FLOWS[2])):
            with self.subTest(table=table):
                active, newest = str(uuid.uuid4()), str(uuid.uuid4())
                rows = [raw(active, run_id=1), raw(newest, cinema="Other", run_id=100)]
                flow = self.build(path, table, rows, [
                    manifest(table, active, run_id=1, status="complete", count=1),
                    manifest(table, newest, run_id=100, cinema="Other", status="complete", count=1),
                ])
                flow.logic()
                mapper = fixture.build_flow(mapper_path, [], database=flow.supabase)
                mapper.logic()
                stored = {r["id"]: r for r in flow.supabase.tables[table]}
                self.assertTrue(stored[rows[0]["id"]]["cleaned"])
                self.assertTrue(stored[rows[0]["id"]]["added"])
                self.assertTrue(flow.supabase.tables[mapper.MOVING_TO_TABLE_NAME])

    def test_private_stage_keeps_failed_rows_and_complete_before_guards(self):
        old, new = str(uuid.uuid4()), str(uuid.uuid4())
        old_row, new_row = raw(old), raw(new, run_id=10)
        db = DB({"allShowtimes": [old_row, new_row], "pipeline_scrape_snapshots": [
            manifest("allShowtimes", old), manifest("allShowtimes", new, run_id=10, status="complete", count=1),
        ]})
        workspace = PublicationWorkspace("nowplayings", 10, db)
        flow = self.build(*CLEANERS[0], [], [], database=workspace)
        flow.logic()
        self.assertEqual(db.tables["allShowtimes"], [old_row, new_row])
        parts = [json.loads(part) for part in workspace.parts()]
        changes = [r for part in parts if part["kind"] == "changes" for r in part["rows"]]
        self.assertEqual([c["after"]["id"] for c in changes], [new_row["id"]])
        guarded = [r for p in parts if p["kind"] == "guard" and p["table"] == "allShowtimes" for r in p["rows"]]
        self.assertCountEqual(guarded, [old_row, new_row])
        guarded_manifests = [r for p in parts if p["kind"] == "guard" and p["table"] == "pipeline_scrape_snapshots" for r in p["rows"]]
        self.assertCountEqual(guarded_manifests, db.tables["pipeline_scrape_snapshots"])

    def test_manual_fix_and_historical_cross_cinema_title_evidence_are_preserved(self):
        old, new, rav = [str(uuid.uuid4()) for _ in range(3)]
        failed = raw(old, cinema="Yes Planet", english_title="Alpha", hebrew_title="סרט")
        current = raw(rav, cinema="Rav Hen", english_title="סרט")
        fixed = raw(rav, cinema="Rav Hen", english_title="Manual--Title")
        db = DB({"allShowtimes": [failed, current, fixed], "pipeline_scrape_snapshots": [
            manifest("allShowtimes", old, cinema="Yes Planet"),
            manifest("allShowtimes", new, cinema="Yes Planet", run_id=10, status="complete", count=0),
            manifest("allShowtimes", rav, cinema="Rav Hen", run_id=10, status="complete", count=2),
        ], "tableFixes": [{"title_fix": "Manual--Title", "tmdb_id": 101}]})
        flow = self.build(*CLEANERS[0], [], [], database=db)
        flow.logic()
        stored = {r["id"]: r for r in db.tables["allShowtimes"]}
        self.assertEqual(stored[failed["id"]], failed)
        self.assertEqual(stored[current["id"]]["english_title"], "alpha")
        self.assertEqual(stored[fixed["id"]]["english_title"], "Manual--Title")
        self.assertTrue(stored[fixed["id"]]["cleaned"])
        self.assertNotIn("_checkpoint_source", stored[fixed["id"]])

    def test_full_backlog_stages_all_legitimate_pending_rows(self):
        failed, current = str(uuid.uuid4()), str(uuid.uuid4())
        base = raw()
        base.pop("release_date")
        rows = []
        for n in range(59_416):
            snapshot_id = failed if n < 31_864 else current if n < 42_383 else None
            rows.append({
                **base, "id": str(uuid.UUID(int=n + 1)), "snapshot_id": snapshot_id,
                "run_id": 9 if n < 31_864 else 10 if n < 42_383 else 1,
                "cleaned": n >= 45_488, "added": n >= 45_488,
            })
        workspace = PublicationWorkspace("nowplayings", 10, DB({}))
        # Bypass paginated network loading; exercise the real cleaner and diff
        # serializer at production cardinality, with its complete before guard.
        workspace.tables["allShowtimes"] = deepcopy(rows)
        workspace.baseline["allShowtimes"] = deepcopy(rows)
        manifests = [
            manifest("allShowtimes", failed),
            manifest("allShowtimes", current, run_id=10, status="complete", count=10_519),
        ]
        workspace.tables["pipeline_scrape_snapshots"] = deepcopy(manifests)
        workspace.baseline["pipeline_scrape_snapshots"] = deepcopy(manifests)
        flow = self.build(*CLEANERS[0], [], [], database=workspace)
        flow.logic()
        parts = [json.loads(part) for part in workspace.parts()]
        changes = [r for p in parts if p["kind"] == "changes" for r in p["rows"]]
        guarded = [r for p in parts if p["kind"] == "guard" and p["table"] == "allShowtimes" for r in p["rows"]]
        self.assertEqual(len(guarded), 59_416)
        self.assertEqual(len(changes), 10_519 + 3_105)
        self.assertTrue(all(c["before"]["snapshot_id"] != failed for c in changes))
        self.assertTrue(all(c["after"]["cleaned"] and not c["after"]["added"] for c in changes))
        stored = workspace.tables["allShowtimes"]
        self.assertTrue(all(not r["cleaned"] and not r["added"] for r in stored[:31_864]))
        self.assertEqual(workspace.client.actions, [])
