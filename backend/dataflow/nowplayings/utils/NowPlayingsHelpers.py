from datetime import datetime
import re


class NowPlayingsHelpers:
    def hebrewShowtimeTitleKey(self, title):
        # The sensory-friendly listing identifies the same film. Keep the
        # suffix on the screening itself and use the base title for lookup.
        title = self.normalizeFixTitle(title).removesuffix(" הקרנה רגישה")
        return title if re.search(r"[א-ת]", title) else ""

    def isHebrewShowtimeTitleFallback(self, english, hebrew_key):
        if not hebrew_key:
            return False
        english = self.clean_str(english).strip()
        normalized = self.normalizeTitle(english)
        if re.search(r"[a-z]", normalized):
            return False
        # Match the digits left by older cleanup runs, while leaving unrelated
        # numeric English titles to the existing matcher.
        return (
            not english or bool(re.search(r"[א-ת]", english))
            or (normalized.isdecimal() and normalized == self.normalizeTitle(hebrew_key))
        )

    def recoverHebrewShowtimeTitles(self, rows_by_cinema, manifests_by_cinema):
        candidates = {}
        fallbacks = []
        for cinema, rows in rows_by_cinema.items():
            manifest_run_id = self.clean_int(manifests_by_cinema.get(cinema, {}).get("run_id"))
            for row in rows:
                hebrew_key = self.hebrewShowtimeTitleKey(row.get("hebrew_title") or row.get("english_title"))
                if not hebrew_key:
                    continue
                # The cleaner can stamp rows with its own run ID. The manifest
                # identifies the actual scrape run for snapshot rows.
                run_id = manifest_run_id if row.get("snapshot_id") else self.clean_int(row.get("run_id"))
                key = (run_id, hebrew_key)
                english = self.clean_str(row.get("english_title")).strip()
                fix = self.tmdbFixMatch(english, self.tmdb_fix_by_title)
                if self.isHebrewShowtimeTitleFallback(english, hebrew_key):
                    if not fix:
                        fallbacks.append((key, row))
                elif run_id is not None and re.search(r"[a-z]", self.normalizeTitle(english)):
                    # Equivalent title variants count as one choice unless their
                    # explicit fixes point to different movies.
                    choice = (self.normalizeFixTitle(english), fix["tmdb_id"] if fix else None)
                    choices = candidates.setdefault(key, {})
                    choices[choice] = min(english, choices.get(choice, english))

        unresolved = []
        for key, row in fallbacks:
            choices = candidates.get(key, {})
            if len(choices) == 1:
                row["english_title"] = next(iter(choices.values()))
            else:
                unresolved.append(row)
        return unresolved

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
        self.chosen_path = None
        self.alt_options = []

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
