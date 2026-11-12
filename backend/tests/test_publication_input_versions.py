import json
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from dataflow_database import DB
from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace
from backend.dataflow.utils.SupabaseTables import SupabaseTables


class PublicationInputVersionTests(TestCase):
    def workspace(self, count=1):
        db = DB({"allShowtimes": [{"id": str(i), "english_title": "Film", "added": False}
                                 for i in range(count)]})
        return PublicationWorkspace("nowplayings", 10, db), db

    def test_large_unchanged_history_stages_only_one_small_token(self):
        workspace, _ = self.workspace(20_000)
        workspace.table("allShowtimes").update({"added": True}).eq("id", "1").execute()
        parts = [json.loads(part) for part in workspace.parts()]
        guards = [part for part in parts if part["kind"] == "guard"]
        self.assertEqual(guards, [{"kind": "guard", "table": "allShowtimes", "revision": "0", "rows": []}])
        self.assertLess(sum(len(part) for part in workspace.parts()), 1000)
        changes = [row for part in parts if part["kind"] == "changes" for row in part["rows"]]
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0]["before"]["added"], False)
        self.assertEqual(changes[0]["after"]["added"], True)

    def test_changes_during_paginated_scan_discard_partial_baseline_and_can_retry(self):
        workspace, db = self.workspace(501)
        versions = iter(["10", "11", "11", "11"])
        with patch.object(db, "rpc", side_effect=lambda *_args: SimpleNamespace(
                execute=lambda: SimpleNamespace(data=next(versions)))):
            with self.assertRaisesRegex(RuntimeError, "changed while reading"):
                workspace.table("allShowtimes").select().execute()
            self.assertNotIn("allShowtimes", workspace.baseline)
            self.assertNotIn("allShowtimes", workspace.tables)
            self.assertNotIn("allShowtimes", workspace.input_revisions)
            self.assertEqual(len(workspace.table("allShowtimes").select().execute().data), 501)
        self.assertEqual(workspace.input_revisions["allShowtimes"], "11")

    def test_revision_rpc_receives_the_workspace_category(self):
        workspace, db = self.workspace()
        original = db.rpc
        with patch.object(db, "rpc", wraps=original) as rpc:
            workspace.table("allShowtimes").select().execute()
            self.assertEqual(rpc.call_count, 2)
            rpc.assert_called_with("get_publication_input_revision", {
                "p_table": "allShowtimes", "p_category": "nowplayings",
            })

    def test_shared_metadata_scans_filter_category_before_pagination(self):
        workspace, db = self.workspace()
        for table, column, ours, other in (
            ("pipeline_scrape_snapshots", "table_name", "allShowtimes", "allSoons"),
            ("pipeline_publication_checkpoints", "category", "nowplayings", "comingsoons"),
        ):
            db.tables[table] = [{"snapshot_id": str(i), column: ours if i % 2 else other}
                                for i in range(1200)]
            result = workspace.table(table).select().execute().data
            self.assertEqual(len(result), 600)
            self.assertTrue(all(row[column] == ours for row in result))
            self.assertEqual(workspace.baseline[table], result)

    def test_keyset_pages_use_the_last_primary_key_without_offset(self):
        workspace, db = self.workspace(1201)
        queries = []
        original = db.table
        def table(name):
            query = original(name)
            query.range = Mock(side_effect=AssertionError("OFFSET must not be used"))
            query.gt = Mock(wraps=query.gt)
            query.limit = Mock(wraps=query.limit)
            queries.append(query)
            return query
        from unittest.mock import Mock
        with patch.object(db, "table", side_effect=table):
            rows = workspace.table("allShowtimes").select().execute().data
        self.assertEqual(len(rows), 1201)
        self.assertEqual(len(queries), 3)
        queries[0].gt.assert_not_called()
        expected = sorted(db.tables["allShowtimes"], key=lambda r: r["id"])
        queries[1].gt.assert_called_once_with("id", expected[499]["id"])
        queries[2].gt.assert_called_once_with("id", expected[999]["id"])
        for query in queries:
            query.limit.assert_called_once_with(500)

    def test_composite_checkpoint_cursor_stays_within_its_category(self):
        workspace, db = self.workspace()
        db.tables["pipeline_publication_checkpoints"] = [
            {"category": category, "snapshot_id": str(i)}
            for category in ("comingsoons", "nowplayings") for i in range(1201)]
        rows = workspace.table("pipeline_publication_checkpoints").select().execute().data
        self.assertEqual(len(rows), 1201)
        self.assertEqual({r["category"] for r in rows}, {"nowplayings"})
        self.assertEqual(len({r["snapshot_id"] for r in rows}), 1201)

    def test_private_select_all_does_not_repeatedly_sort_and_page_the_memory_copy(self):
        workspace, _ = self.workspace(1201)
        flow = SupabaseTables()
        flow.supabase = workspace
        with patch.object(workspace, "table", wraps=workspace.table) as table:
            rows = flow.selectAll("allShowtimes")
        self.assertEqual(len(rows), 1201)
        table.assert_called_once_with("allShowtimes")

    def test_repeated_full_page_cursor_fails_closed(self):
        workspace, db = self.workspace(500)
        original = db.table
        def table(name):
            query = original(name)
            query.gt = lambda *_args: query
            return query
        with patch.object(db, "table", side_effect=table):
            with self.assertRaisesRegex(RuntimeError, "publication cursor"):
                workspace.table("allShowtimes").select().execute()
        self.assertEqual(workspace.baseline, {})

    def test_missing_malformed_and_overflowing_revisions_fail_closed(self):
        for revision in (None, 0, True, {}, [], "", "-1", "01", "1.0", "1\n", "9223372036854775808"):
            with self.subTest(revision=revision):
                workspace, db = self.workspace()
                with patch.object(db, "rpc", return_value=SimpleNamespace(
                        execute=lambda: SimpleNamespace(data=revision))):
                    with self.assertRaisesRegex(RuntimeError, "invalid publication input revision"):
                        workspace.table("allShowtimes").select().execute()
                self.assertEqual(workspace.baseline, {})

    def test_rpc_failure_never_falls_back_to_full_row_guards(self):
        workspace, db = self.workspace()
        with patch.object(db, "rpc", side_effect=RuntimeError("migration missing")):
            with self.assertRaisesRegex(RuntimeError, "migration missing"):
                workspace.table("allShowtimes").select().execute()
        self.assertEqual(workspace.baseline, {})

    def test_restore_preserves_captured_revision_including_reads_from_failed_stage(self):
        workspace, db = self.workspace()
        saved = workspace.savepoint()
        with patch.object(db, "rpc", return_value=SimpleNamespace(
                execute=lambda: SimpleNamespace(data="9223372036854775807"))):
            workspace.table("allShowtimes").update({"added": True}).eq("id", "0").execute()
        workspace.restore(saved)
        workspace.table("allShowtimes").update({"added": True}).eq("id", "0").execute()
        guard = json.loads(workspace.parts()[0])
        self.assertEqual(guard["revision"], "9223372036854775807")
        self.assertFalse(workspace.baseline["allShowtimes"][0]["added"])

    def test_permanent_code_reservations_keep_their_existing_concurrency_contract(self):
        workspace, db = self.workspace()
        with patch.object(db, "rpc", side_effect=AssertionError("Codes do not use input guards")):
            workspace.table("movieCodes").insert({"tmdb_id": 1, "movie_code": "ABC"}).execute()
        self.assertFalse(any(json.loads(part)["kind"] == "guard" for part in workspace.parts()))
