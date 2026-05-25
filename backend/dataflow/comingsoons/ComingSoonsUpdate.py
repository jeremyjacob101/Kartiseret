from backend.dataflow.BaseDataflow import BaseDataflow

from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import time


class ComingSoonsUpdate(BaseDataflow):
    MAIN_TABLE_NAME = "finalSoons"

    def process_row(self, row):
        new_row = self.updating_output_row(row)
        existing = self.updating_existing_values(row)

        tmdb_id = existing["tmdb_id"]
        if not tmdb_id:
            return new_row

        # TMDb
        try:
            data = requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,videos"}, timeout=10).json()
        except:
            data = ""

        genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3] if isinstance(data, dict) else []
        trailer = (next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key")), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key")), None)) if isinstance(data, dict) else None

        new_row["english_title"] = data["title"].strip() if isinstance(data, dict) and data.get("title") else existing["english_title"]
        # Keep source/cinema release_date for coming-soons. TMDB release dates can
        # be historical first-release dates and should not replace local schedule dates.
        source_release_date = new_row.get("release_date")
        if source_release_date:
            new_row["release_year"] = str(source_release_date)[:4]
        else:
            new_row["release_year"] = data["release_date"][:4] if isinstance(data, dict) and data.get("release_date") else existing["release_year"]
        new_row["runtime"] = data["runtime"] if isinstance(data, dict) and data.get("runtime") is not None else existing["runtime"]
        new_row["popularity"] = data["popularity"] if isinstance(data, dict) and data.get("popularity") is not None else existing["popularity"]
        new_row["genres"] = genres or existing["genres"]
        new_row["imdb_id"] = data.get("external_ids", {}).get("imdb_id") if isinstance(data, dict) and data.get("external_ids", {}).get("imdb_id") else existing["imdb_id"]
        new_row["en_trailer"] = trailer.get("key") if trailer else existing["en_trailer"]
        new_row["en_poster"] = "https://image.tmdb.org/t/p/w342" + data["poster_path"] if isinstance(data, dict) and data.get("poster_path") else existing["en_poster"]
        new_row["backdrop"] = "https://image.tmdb.org/t/p/w1280" + data["backdrop_path"] if isinstance(data, dict) and data.get("backdrop_path") else existing["backdrop"]

        return self.apply_solo_update_postprocess(new_row)

    def logic(self):
        self.dedupeFinalSoons(self.MAIN_TABLE_NAME)
        target_rows = self.rows_for_update()
        if not target_rows:
            return

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(self.process_row, row) for row in target_rows]
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result:
                        self.updates.append(result)
                except Exception:
                    pass

        if self.updates:
            self.upsertUpdates(self.MAIN_TABLE_NAME)
            self.dedupeFinalSoons(self.MAIN_TABLE_NAME)
