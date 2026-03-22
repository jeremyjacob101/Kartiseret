from backend.dataflow.BaseDataflow import BaseDataflow


class ComingSoonsPreview(BaseDataflow):
    MAIN_TABLE_NAME = "finalSoons"
    MOVING_TO_TABLE_NAME = "finalSoonsPreview"

    def logic(self):
        self.dedupeFinalSoons(self.MAIN_TABLE_NAME)
        self.refreshAllTables(self.MAIN_TABLE_NAME)
        self.refreshAllTables(self.MOVING_TO_TABLE_NAME)

        self.delete_these = [row["tmdb_id"] for row in self.moving_to_table_rows if row.get("tmdb_id") is not None]
        self.deleteTheseRows(self.MOVING_TO_TABLE_NAME, primary_key="tmdb_id", refresh=False)

        valid_rows = [row for row in self.main_table_rows if row.get("tmdb_id") is not None and row.get("english_title") and row.get("release_date") is not None]
        sorted_by_release_date = sorted(valid_rows, key=lambda row: row.get("release_date"))
        first_4 = sorted_by_release_date[:4]
        furthest_away = sorted_by_release_date[-1:] if sorted_by_release_date else []

        selected_rows = first_4 + [row for row in furthest_away if row.get("tmdb_id") not in {r.get("tmdb_id") for r in first_4}]
        self.updates = [{"english_title": row.get("english_title"), "release_date": row.get("release_date"), "en_poster": row.get("en_poster"), "tmdb_id": row.get("tmdb_id")} for row in selected_rows]
        self.upsertUpdates(self.MOVING_TO_TABLE_NAME, addRunIdCol=False)
