from typing import Callable, Any
from datetime import datetime, timezone
import re


class SupabaseTables:
    def selectAll(self, table: str, select: str = "*", batch_size: int = 200) -> list[dict]:
        if not table:
            return []

        all_rows: list[dict] = []
        start = 0

        while True:
            end = start + batch_size - 1
            rows = self.supabase.table(table).select(select).range(start, end).execute().data or []
            all_rows.extend(rows)
            if len(rows) < batch_size:
                break
            start += batch_size

        return all_rows

    def refreshAllTables(self, table_name: str | None = None):
        table_to_attr: dict[str, str] = {
            self.MAIN_TABLE_NAME: "main_table_rows",
            self.DUPLICATE_TABLE_NAME: "duplicate_table_rows",
            self.MOVING_TO_TABLE_NAME: "moving_to_table_rows",
            self.MOVING_TO_TABLE_NAME_2: "moving_to_table_2_rows",
            self.HELPER_TABLE_NAME: "helper_table_rows",
            self.HELPER_TABLE_NAME_2: "helper_table_2_rows",
            self.HELPER_TABLE_NAME_3: "helper_table_3_rows",
            self.HELPER_TABLE_NAME_4: "helper_table_4_rows",
        }

        if table_name:
            attr = table_to_attr.get(table_name)
            if attr:
                setattr(self, attr, self.selectAll(table_name))
            return

        for table, attr in table_to_attr.items():
            if table:
                setattr(self, attr, self.selectAll(table))

    def deleteTheseRows(self, table_name: str, primary_key: str = "id", refresh: bool = True):
        if not self.delete_these:
            if refresh:
                self.refreshAllTables(table_name)
            return

        seen = set()
        deduped = []
        for x in self.delete_these:
            if x in (None, "", "null") or x in seen:
                continue
            seen.add(x)
            deduped.append(x)

        for i in range(0, len(deduped), 200):
            chunk = deduped[i : i + 200]
            self.supabase.table(table_name).delete().in_(primary_key, chunk).execute()
        self.delete_these = []
        if refresh:
            self.refreshAllTables(table_name)

    def upsertUpdates(self, table_name: str, refresh: bool = True):
        if self.updates:
            for row in self.updates:
                if isinstance(row, dict) and "run_id" not in row:
                    row["run_id"] = int(self.run_id)
            self.supabase.table(table_name).upsert(self.updates).execute()
        self.updates = []
        if refresh:
            self.refreshAllTables(table_name)

    def _norm_text(self, value: Any) -> str:
        if value is None:
            return ""
        return re.sub(r"\s+", " ", str(value)).strip().lower()

    def _has_value(self, value: Any) -> bool:
        if value is None:
            return False

        if isinstance(value, str):
            text = self._norm_text(value)
            return text not in {"", "0", "0.0", "none", "null", "nan"}

        if isinstance(value, (int, float)):
            return value != 0

        if isinstance(value, (list, tuple, set, dict)):
            return len(value) > 0

        return True

    def _parse_created_at(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if not value:
            return datetime.min.replace(tzinfo=timezone.utc)

        text = str(value).strip().replace("T", " ").replace("Z", "+00:00")
        if re.search(r"[+-]\d{2}$", text):
            text += ":00"
        elif re.search(r"[+-]\d{4}$", text):
            text = text[:-2] + ":" + text[-2:]

        try:
            return datetime.fromisoformat(text)
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)

    def _filled_count(self, row: dict, cols: list[str]) -> int:
        return sum(1 for col in cols if self._has_value(row.get(col)))

    def _dedupe_by_key(self, table_name: str, key_func: Callable[[dict], tuple], prefer_key: Callable[[dict], Any], id_col: str = "id", refresh: bool = True):
        rows = self.selectAll(table_name)
        if not rows:
            if refresh:
                self.refreshAllTables(table_name)
            return

        rows.sort(key=prefer_key, reverse=True)

        seen: dict[tuple, dict] = {}
        delete_ids: list[Any] = []
        promote_added_ids: list[Any] = []
        has_added_col = any("added" in row for row in rows)

        for row in rows:
            row_id = row.get(id_col)
            key = key_func(row)

            if not key:
                key = ("__row__", str(row_id))

            keeper = seen.get(key)
            if keeper is None:
                seen[key] = row
                continue

            keeper_id = keeper.get(id_col)

            if has_added_col and row.get("added") is True and keeper.get("added") is not True and keeper_id:
                promote_added_ids.append(keeper_id)
                keeper["added"] = True

            if row_id not in (None, "", "null"):
                delete_ids.append(row_id)

        if has_added_col and promote_added_ids:
            promote_added_ids = list(dict.fromkeys(promote_added_ids))
            for i in range(0, len(promote_added_ids), 200):
                chunk = promote_added_ids[i : i + 200]
                self.supabase.table(table_name).update({"added": True}).in_(id_col, chunk).execute()

        if delete_ids:
            self.delete_these.extend(delete_ids)
            self.deleteTheseRows(table_name, primary_key=id_col, refresh=refresh)
        elif refresh:
            self.refreshAllTables(table_name)

    # PRE-TMDB SOONS (allSoons)
    def _all_soon_key(self, row: dict) -> tuple:
        return (self._norm_text(row.get("english_title")), self._norm_text(row.get("hebrew_title")), str(row.get("release_date") or ""))

    def _all_soon_prefer_key(self, row: dict):
        runtime = row.get("runtime")
        good_runtime = (runtime is not None) and (runtime not in getattr(self, "fake_runtimes", set()))
        has_release_year = bool(row.get("release_year"))
        has_directed_by = bool((row.get("directed_by") or "").strip())
        rich_cols = ["english_title", "hebrew_title", "release_date", "original_language", "release_year", "rating", "directed_by", "runtime"]
        return (
            1 if row.get("added") is True else 0,
            self._filled_count(row, rich_cols),
            1 if has_directed_by else 0,
            1 if good_runtime else 0,
            1 if has_release_year else 0,
            self._parse_created_at(row.get("created_at")),
        )

    def dedupeAllSoons(self, table_name: str, refresh: bool = True):
        self._dedupe_by_key(table_name=table_name, key_func=self._all_soon_key, prefer_key=self._all_soon_prefer_key, refresh=refresh)

    # FINAL SOONS (finalSoons)
    def _soon_key(self, row: dict) -> tuple:
        tmdb_id = row.get("tmdb_id")
        if self._has_value(tmdb_id):
            return ("tmdb", str(tmdb_id))
        imdb_id = row.get("imdb_id")
        if self._has_value(imdb_id):
            return ("imdb", self._norm_text(imdb_id))
        return ("fallback", self._norm_text(row.get("english_title")), str(row.get("release_date") or ""))

    def _soon_prefer_key(self, row: dict):
        rich_cols = ["tmdb_id", "imdb_id", "english_title", "hebrew_title", "release_date", "release_year", "en_poster", "backdrop", "en_trailer", "genres"]
        return (
            1 if row.get("added") is True else 0,
            1 if self._has_value(row.get("tmdb_id")) else 0,
            1 if self._has_value(row.get("imdb_id")) else 0,
            self._filled_count(row, rich_cols),
            self._parse_created_at(
                row.get("created_at"),
            ),
        )

    def dedupeFinalSoons(self, table_name: str, refresh: bool = True):
        self._dedupe_by_key(table_name=table_name, key_func=self._soon_key, prefer_key=self._soon_prefer_key, refresh=refresh)

    # MOVIES (finalMovies)
    def _movie_key(self, row: dict) -> tuple:
        tmdb_id = row.get("tmdb_id")
        if self._has_value(tmdb_id):
            return ("tmdb", str(tmdb_id))
        imdb_id = row.get("imdb_id")
        if self._has_value(imdb_id):
            return ("imdb", self._norm_text(imdb_id))
        return (
            "fallback",
            self._norm_text(row.get("english_title")),
            str(row.get("release_year") or ""),
            str(row.get("runtime") or ""),
        )

    def _movie_prefer_key(self, row: dict):
        rich_cols = ["tmdb_id", "imdb_id", "english_title", "release_year", "runtime", "en_poster", "backdrop", "en_trailer", "genres", "imdbRating", "imdbVotes", "rt_id", "rtAudienceRating", "rtAudienceVotes", "rtCriticRating", "rtCriticVotes", "lb_id", "lbRating", "lbVotes", "tmdbRating", "tmdbVotes"]
        return (
            1 if row.get("added") is True else 0,
            1 if self._has_value(row.get("tmdb_id")) else 0,
            1 if self._has_value(row.get("imdb_id")) else 0,
            self._filled_count(row, rich_cols),
            self._parse_created_at(row.get("created_at")),
        )

    def dedupeFinalMovies(self, table_name: str, refresh: bool = True):
        self._dedupe_by_key(table_name=table_name, key_func=self._movie_key, prefer_key=self._movie_prefer_key, refresh=refresh)

    # SHOWTIMES (allShowtimes / finalShowtimes)
    def _showtime_key(self, row: dict) -> tuple:
        return (
            self._norm_text(row.get("english_title")),
            self._norm_text(row.get("cinema")),
            self._norm_text(row.get("screening_city")),
            str(row.get("date_of_showing") or ""),
            str(row.get("showtime") or ""),
            self._norm_text(row.get("screening_tech")),
            self._norm_text(row.get("screening_type")),
            self._norm_text(row.get("original_language")),
            self._norm_text(row.get("dub_language")),
        )

    def _showtime_prefer_key(self, row: dict):
        rich_cols = ["tmdb_id", "release_year", "rating", "directed_by", "runtime", "english_href", "hebrew_href", "hebrew_title"]
        return (
            1 if row.get("added") is True else 0,
            1 if self._has_value(row.get("tmdb_id")) else 0,
            self._filled_count(row, rich_cols),
            self._parse_created_at(row.get("created_at")),
        )

    def dedupeFinalShowtimes(self, table_name: str, refresh: bool = True):
        self._dedupe_by_key(table_name=table_name, key_func=self._showtime_key, prefer_key=self._showtime_prefer_key, refresh=refresh)
