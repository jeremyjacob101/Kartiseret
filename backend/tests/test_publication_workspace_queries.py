from unittest import TestCase
from unittest.mock import patch
import uuid

from dataflow_database import DB
from backend.dataflow.utils.PublicationWorkspace import PublicationWorkspace, key_for


class PublicationWorkspaceQueryTests(TestCase):
    def workspace(self, table="allShowtimes", rows=None, category="nowplayings"):
        live = DB({table: rows or []})
        return PublicationWorkspace(category, 10, live), live

    def test_bulk_upsert_preserves_partial_rows_order_and_repeated_keys(self):
        original = [{"id": "a", "title": "Alpha", "cleaned": False}, {"id": "b", "title": "Beta"}]
        workspace, live = self.workspace(rows=original)
        result = workspace.table("allShowtimes").upsert([
            {"id": "b", "cleaned": True},
            {"id": "c", "title": "Gamma"},
            {"id": "a", "cleaned": True},
            {"id": "c", "cleaned": True},
        ]).execute().data
        self.assertEqual([row["id"] for row in result], ["b", "c", "a", "c"])
        self.assertEqual(result[0], {"id": "b", "title": "Beta", "cleaned": True})
        self.assertEqual(result[2], {"id": "a", "title": "Alpha", "cleaned": True})
        self.assertEqual(result[1], result[3])
        self.assertTrue(result[1]["cleaned"])
        self.assertIn("created_at", result[1])
        self.assertEqual([row["id"] for row in workspace.tables["allShowtimes"]], ["a", "b", "c"])
        result[0]["title"] = "Detached result"
        self.assertEqual(workspace.tables["allShowtimes"][1]["title"], "Beta")
        self.assertEqual(workspace.baseline["allShowtimes"], original)
        self.assertEqual(live.tables["allShowtimes"], original)
        self.assertFalse(live.actions)

    def test_first_existing_duplicate_remains_the_upsert_target(self):
        workspace, _ = self.workspace(rows=[{"id": "a", "value": 1}, {"id": "a", "value": 2}])
        workspace.table("allShowtimes").upsert({"id": "a", "value": 3}).execute()
        self.assertEqual([row["value"] for row in workspace.tables["allShowtimes"]], [3, 2])

    def test_insert_detects_existing_and_same_batch_duplicates(self):
        workspace, _ = self.workspace(rows=[{"id": "a", "value": 1}])
        with self.assertRaisesRegex(ValueError, "Duplicate preparation key"):
            workspace.table("allShowtimes").insert({"id": "a", "value": 2}).execute()
        self.assertEqual(workspace.tables["allShowtimes"], [{"id": "a", "value": 1}])
        with self.assertRaisesRegex(ValueError, "Duplicate preparation key"):
            workspace.table("allShowtimes").insert([
                {"id": "b", "value": 3}, {"id": "b", "value": 4},
            ]).execute()
        # A batch failure has always left earlier private mutations for the
        # caller's stage savepoint to restore.
        self.assertEqual([row["value"] for row in workspace.tables["allShowtimes"]], [1, 3])

    def test_upsert_uses_each_tables_existing_identity_definition(self):
        cases = [
            ("nowplayings", "allShowtimes", {"id": "a"}, {"id": "b"}),
            ("nowplayings", "finalMovies", {"tmdb_id": 1}, {"tmdb_id": 2}),
            ("cinematheques", "finalThequeMovies", {"tmdb_id": 1}, {"tmdb_id": 2}),
            ("nowplayings", "movieCodes", {"tmdb_id": 1}, {"tmdb_id": 2}),
            ("comingsoons", "finalSoons", {"id": "a", "tmdb_id": 1}, {"id": "b", "tmdb_id": 1}),
            ("nowplayings", "pipeline_scrape_snapshots", {"snapshot_id": "a"}, {"snapshot_id": "b"}),
            ("nowplayings", "pipeline_publication_checkpoints",
             {"category": "nowplayings", "snapshot_id": "a"},
             {"category": "comingsoons", "snapshot_id": "a"}),
            ("nowplayings", "pipeline_publication_checkpoints",
             {"category": "nowplayings", "snapshot_id": "a"},
             {"category": "nowplayings", "snapshot_id": "b"}),
        ]
        for category, table, first, second in cases:
            with self.subTest(table=table):
                workspace, _ = self.workspace(table, [{**first, "value": 1}, {**second, "value": 2}], category)
                workspace.table(table).upsert({**first, "value": 3}).execute()
                self.assertEqual(
                    {key_for(table, row): row["value"] for row in workspace.tables[table]},
                    {key_for(table, first): 3, key_for(table, second): 2},
                )

    def test_generated_ids_and_missing_non_id_keys_keep_existing_behavior(self):
        workspace, _ = self.workspace()
        payload = [{"value": 1}, {"value": 2}]
        result = workspace.table("allShowtimes").insert(payload).execute().data
        self.assertNotEqual(result[0]["id"], result[1]["id"])
        for row in result:
            self.assertEqual(str(uuid.UUID(row["id"])), row["id"])
            self.assertIn("created_at", row)
        self.assertEqual(payload, [{"value": 1}, {"value": 2}])
        workspace, _ = self.workspace("finalMovies", [{"tmdb_id": None, "value": 1}])
        result = workspace.table("finalMovies").upsert({"value": 2}).execute().data
        self.assertEqual(result, [{"tmdb_id": None, "value": 2}])

    def test_lookup_is_rebuilt_after_key_changes_deletes_and_restore(self):
        workspace, _ = self.workspace(rows=[{"id": "a", "value": 1}])
        workspace.table("allShowtimes").select().execute()
        saved = workspace.savepoint()
        workspace.table("allShowtimes").upsert({"id": "a", "value": 2}).execute()
        workspace.table("allShowtimes").update({"id": "b"}).eq("id", "a").execute()
        workspace.table("allShowtimes").upsert({"id": "a", "value": 3}).execute()
        self.assertEqual([row["id"] for row in workspace.tables["allShowtimes"]], ["b", "a"])
        workspace.table("allShowtimes").delete().eq("id", "a").execute()
        workspace.table("allShowtimes").upsert({"id": "a", "value": 4}).execute()
        self.assertEqual([row["value"] for row in workspace.tables["allShowtimes"]], [2, 4])
        workspace.restore(saved)
        workspace.table("allShowtimes").upsert({"id": "a", "value": 5}).execute()
        self.assertEqual(workspace.tables["allShowtimes"], [{"id": "a", "value": 5}])

    def test_bulk_upsert_key_lookup_cost_is_linear_in_table_and_batch_size(self):
        row_count, update_count = 2000, 1500
        workspace, _ = self.workspace(rows=[{"id": str(index), "cleaned": False} for index in range(row_count)])
        # Preload so this measures the real workspace mutation, excluding I/O.
        workspace.table("allShowtimes").select().execute()
        payload = [{"id": str(index), "cleaned": True} for index in range(row_count - update_count, row_count)]
        calls, budget = 0, 2 * (row_count + update_count)

        def counted_key(table, row):
            nonlocal calls
            calls += 1
            self.assertLessEqual(calls, budget, "Bulk upsert must not search the table separately for each update")
            return key_for(table, row)

        with patch("backend.dataflow.utils.PublicationWorkspace.key_for", side_effect=counted_key):
            result = workspace.table("allShowtimes").upsert(payload).execute().data
        self.assertEqual(len(result), update_count)
        self.assertTrue(all(row["cleaned"] for row in result))
        self.assertEqual(sum(row["cleaned"] for row in workspace.tables["allShowtimes"]), update_count)
