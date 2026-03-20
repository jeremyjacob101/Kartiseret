from datetime import datetime


class NowPlayingsHelpers:
    def applyYesPlanetHebrewToRavHenEnglish(self):
        yes_map = {}
        for row in self.main_table_rows:
            if row.get("cinema") == "Yes Planet":
                hebrew = (row.get("hebrew_title") or "").strip()
                english = (row.get("english_title") or "").strip()
                if hebrew and english and hebrew not in yes_map:
                    yes_map[hebrew] = english
        for row in self.main_table_rows:
            if row.get("cinema") == "Rav Hen":
                key = (row.get("english_title") or "").strip()
                if key in yes_map:
                    row["english_title"] = yes_map[key]

    def createdAtToDatetime(self, ca):
        if isinstance(ca, datetime):
            return ca
        s = str(ca).replace("T", " ")
        s = s[:-3] + "+0000"
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S.%f%z")

    def newestCreatedAtSortKey(self, row: dict):
        return self.datetimeToDatetime(row["created_at"])

    def nowPlayingsGroupKey(self, normalized_title: str) -> str:
        t = (normalized_title or "").strip().lower()
        for prefix in ("the ", "a ", "an "):
            if t.startswith(prefix):
                t = t[len(prefix) :].strip()
                break
        return t

    def titleIsSkipped(self, title: str, skip_tokens: set) -> bool:
        title_raw = (title or "").strip().lower()
        try:
            title_norm = self.normalizeTitle(title or "").strip().lower()
        except:
            title_norm = title_raw
        return title_raw in skip_tokens or title_norm in skip_tokens

    def reset_np_main_row_state(self):
        self.english_title = None
        self.hebrew_title = None
        self.date_of_showing = None
        self.release_year = None
        self.directed_by = None
        self.runtime = None

        self.popularity = None
        self.tmdb_id = None
        self.tmdbRating = None
        self.tmdbVotes = None
        self.imdb_id = None
        self.imdbRating = None
        self.imdbVotes = None
        self.rt_id = None
        self.rtAudienceRating = None
        self.rtAudienceVotes = None
        self.rtCriticRating = None
        self.rtCriticVotes = None
        self.lb_id = None
        self.lbRating = None
        self.lbVotes = None
        self.en_poster = None
        self.en_trailer = None
        self.genres = None
        self.backdrop = None

    def load_np_main_row(self, row: dict):
        self.english_title = self.clean_str(row.get("english_title"))
        self.hebrew_title = self.clean_str(row.get("hebrew_title"))
        self.date_of_showing = self.clean_date(row.get("date_of_showing"))
        self.release_year = self.clean_int(row.get("release_year"))
        self.directed_by = self.clean_str(row.get("directed_by"))
        self.runtime = self.clean_int(row.get("runtime"))

    def load_update_final_movies_main_row(self, row: dict):
        self.english_title = self.clean_str(row.get("english_title"))
        self.release_year = self.clean_int(row.get("release_year"))
        self.runtime = self.clean_int(row.get("runtime"))
        self.popularity = self.clean_float(row.get("popularity"))
        self.tmdb_id = self.clean_int(row.get("tmdb_id"))
        self.tmdbRating = self.clean_int(row.get("tmdbRating"))
        self.tmdbVotes = self.clean_int(row.get("tmdbVotes"))
        self.imdb_id = self.clean_str(row.get("imdb_id"))
        self.imdbRating = self.clean_float(row.get("imdbRating"))
        self.imdbVotes = self.clean_int(row.get("imdbVotes"))
        self.rt_id = self.clean_str(row.get("rt_id"))
        self.rtAudienceRating = self.clean_int(row.get("rtAudienceRating"))
        self.rtAudienceVotes = self.clean_int(row.get("rtAudienceVotes"))
        self.rtCriticRating = self.clean_int(row.get("rtCriticRating"))
        self.rtCriticVotes = self.clean_int(row.get("rtCriticVotes"))
        self.lb_id = self.clean_str(row.get("lb_id"))
        self.lbRating = self.clean_float(row.get("lbRating"))
        self.lbVotes = self.clean_int(row.get("lbVotes"))
        self.en_poster = self.clean_str(row.get("en_poster"))
        self.en_trailer = self.clean_str(row.get("en_trailer"))
        self.genres = self.clean_array(row.get("genres"))
        self.backdrop = self.clean_str(row.get("backdrop"))

    def reset_np_groupkey_row_state(self):
        self.potential_chosen_id = None
        self.candidates = []
        self.details = {}

        self.override_tmdb = None
        self.seen_already = set()
        self.search_plans = []

        self.parsed_year = None
        self.year_counts = {}

    def load_np_groupkey_meta_row(self, key):
        meta = self.meta_by_key.get(key) or {}
        self.hebrew_title = meta.get("hebrew_title")
        self.directed_by = meta.get("directed_by")
        self.runtime = meta.get("runtime")
        self.year_counts = meta.get("year_counts") or {}
        self.parsed_year = None

    def per_thread_updating_extract_existing_values(self, row):
        return {
            "english_title": self.clean_str(row.get("english_title")),
            "release_year": self.clean_int(row.get("release_year")),
            "runtime": self.clean_int(row.get("runtime")),
            "popularity": self.clean_float(row.get("popularity")),
            "tmdb_id": self.clean_int(row.get("tmdb_id")),
            "tmdbRating": self.clean_int(row.get("tmdbRating")),
            "tmdbVotes": self.clean_int(row.get("tmdbVotes")),
            "imdb_id": self.clean_str(row.get("imdb_id")),
            "imdbRating": self.clean_float(row.get("imdbRating")),
            "imdbVotes": self.clean_int(row.get("imdbVotes")),
            "rt_id": self.clean_str(row.get("rt_id")),
            "rtAudienceRating": self.clean_int(row.get("rtAudienceRating")),
            "rtAudienceVotes": self.clean_int(row.get("rtAudienceVotes")),
            "rtCriticRating": self.clean_int(row.get("rtCriticRating")),
            "rtCriticVotes": self.clean_int(row.get("rtCriticVotes")),
            "lb_id": self.clean_str(row.get("lb_id")),
            "lbRating": self.clean_float(row.get("lbRating")),
            "lbVotes": self.clean_int(row.get("lbVotes")),
            "en_poster": self.clean_str(row.get("en_poster")),
            "en_trailer": self.clean_str(row.get("en_trailer")),
            "genres": self.clean_array(row.get("genres")),
            "backdrop": self.clean_str(row.get("backdrop")),
        }

    def per_thread_updating_imdb_find_ratings_summary(self, obj):
        if isinstance(obj, dict):
            if "ratingsSummary" in obj and isinstance(obj["ratingsSummary"], dict):
                return obj["ratingsSummary"]
            for v in obj.values():
                found = self._find_ratings_summary(v)
                if found:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = self._find_ratings_summary(item)
                if found:
                    return found
        return None
