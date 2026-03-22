from backend.dataflow.BaseDataflow import BaseDataflow


class NowPlayingsPreview(BaseDataflow):
    MAIN_TABLE_NAME = "finalMovies"
    MOVING_TO_TABLE_NAME = "finalMoviesPreview"

    def logic(self):
        self.dedupeFinalMovies(self.MAIN_TABLE_NAME)
        self.refreshAllTables(self.MAIN_TABLE_NAME)
        self.refreshAllTables(self.MOVING_TO_TABLE_NAME)

        self.delete_these = [row["tmdb_id"] for row in self.moving_to_table_rows if row.get("tmdb_id") is not None]
        self.deleteTheseRows(self.MOVING_TO_TABLE_NAME, primary_key="tmdb_id", refresh=False)

        top_10 = sorted(self.main_table_rows, key=lambda row: self.clean_float(row.get("popularity")) or float("-inf"), reverse=True)[:10]

        self.updates = [{"english_title": row.get("english_title"), "tmdb_id": row.get("tmdb_id"), "en_poster": row.get("en_poster")} for row in top_10 if row.get("tmdb_id") is not None and row.get("english_title")]
        self.upsertUpdates(self.MOVING_TO_TABLE_NAME, addRunIdCol=False)
