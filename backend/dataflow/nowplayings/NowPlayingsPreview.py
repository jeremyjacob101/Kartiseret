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

        valid_rows = [row for row in self.main_table_rows if row.get("tmdb_id") is not None and row.get("english_title")]
        sorted_by_popularity = sorted(valid_rows, key=lambda row: self.clean_float(row.get("popularity")) or float("-inf"), reverse=True)
        top_4 = sorted_by_popularity[:4]
        least_popular = sorted_by_popularity[-1:] if sorted_by_popularity else []

        selected_rows = top_4 + [row for row in least_popular if row.get("tmdb_id") not in {r.get("tmdb_id") for r in top_4}]
        self.updates = [{"english_title": row.get("english_title"), "tmdb_id": row.get("tmdb_id"), "en_poster": row.get("en_poster"), "popularity": self.clean_float(row.get("popularity"))} for row in selected_rows]
        self.upsertUpdates(self.MOVING_TO_TABLE_NAME, addRunIdCol=False)
