from backend.dataflow.BaseDataflow import BaseDataflow
from backend.dataflow.utils.ArtworkStorage import resolve_tmdb_artwork
from backend.dataflow.utils.TmdbMovieDetailsCache import movie_release_year

from concurrent.futures import ThreadPoolExecutor, as_completed


class ComingSoonsUpdate(BaseDataflow):
    MAIN_TABLE_NAME = "finalSoons"
    USES_BROWSER = False

    def process_row(self, row):
        new_row = self.updating_output_row(row)
        existing = self.updating_existing_values(row)
        self.startProviderFreshness(row, new_row)

        tmdb_id = existing["tmdb_id"]
        if not tmdb_id:
            return new_row

        # TMDb
        data = self.tmdbForUpdate(tmdb_id)

        genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3] if isinstance(data, dict) else []
        trailer = (next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key")), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key")), None)) if isinstance(data, dict) else None

        new_row["english_title"] = data["title"].strip() if isinstance(data, dict) and data.get("title") else existing["english_title"]
        # release_date is the upcoming local screening; release_year is the
        # movie's original year, including when details come from the archive cache.
        original_year = movie_release_year(data.get("release_date")) if isinstance(data, dict) else None
        new_row["release_year"] = original_year if original_year is not None else existing["release_year"]
        new_row["runtime"] = data["runtime"] if isinstance(data, dict) and data.get("runtime") is not None else existing["runtime"]
        new_row["popularity"] = data["popularity"] if isinstance(data, dict) and data.get("popularity") is not None else existing["popularity"]
        new_row["genres"] = genres or existing["genres"]
        new_row["imdb_id"] = data.get("external_ids", {}).get("imdb_id") if isinstance(data, dict) and data.get("external_ids", {}).get("imdb_id") else existing["imdb_id"]
        new_row["en_trailer"] = trailer.get("key") if trailer else existing["en_trailer"]
        resolve_tmdb_artwork(self, new_row, data)

        self.recordTmdbFreshness(new_row, data, tmdb_id)
        return self.apply_solo_update_postprocess(new_row)

    def beginSharedUpdate(self):
        self.dedupeFinalSoons(self.MAIN_TABLE_NAME)
        return self.rows_for_update()

    def finishSharedUpdate(self, target_count: int, updated_rows: list[dict]) -> None:
        self.updates = updated_rows
        self.trace_note(f"update_rows | requested={target_count} | updated={len(self.updates)}")
        if self.updates:
            self.upsertUpdates(self.MAIN_TABLE_NAME)
            self.dedupeFinalSoons(self.MAIN_TABLE_NAME)

    def logic(self):
        target_rows = self.beginSharedUpdate()
        if not target_rows:
            return

        self.prepareUpdateTmdb(target_rows)
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(self.process_row, row) for row in target_rows]
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result:
                        self.updates.append(result)
                except Exception as error:
                    from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded
                    from backend.utils.log.cloudflare_storage import LeaseLostError

                    if isinstance(error, (R2BudgetError, R2BudgetExceeded, LeaseLostError)):
                        raise
                    self.trace_note(f"row_update_failed | error={type(error).__name__}")

        self.finishSharedUpdate(len(target_rows), self.updates)
