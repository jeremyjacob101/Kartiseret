import csv, gzip, os, requests, time
from datetime import datetime


class NowPlayingsHelpers:
    IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
    IMDB_RATINGS_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "title.ratings.tsv.gz")

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

    def loadImdbRatings(self, rows):
        imdb_ids = {self.clean_str(row.get("imdb_id")).strip() for row in rows if self.clean_str(row.get("imdb_id")).strip()}
        if not imdb_ids:
            return {}

        ratings = {}
        try:
            for attempt in range(3):
                try:
                    with requests.get(self.IMDB_RATINGS_URL, stream=True, timeout=(10, 120)) as response:
                        response.raise_for_status()
                        with open(self.IMDB_RATINGS_PATH, "wb") as ratings_file:
                            for chunk in response.iter_content(chunk_size=1024 * 1024):
                                if chunk:
                                    ratings_file.write(chunk)
                    break
                except Exception:
                    if attempt == 2:
                        return {}
                    time.sleep(1)

            with gzip.open(self.IMDB_RATINGS_PATH, "rt", encoding="utf-8") as ratings_file:
                dataset_rows = csv.DictReader(ratings_file, delimiter="\t")
                if not {"tconst", "averageRating", "numVotes"}.issubset(dataset_rows.fieldnames or []):
                    return {}
                for row in dataset_rows:
                    imdb_id = row.get("tconst")
                    if imdb_id not in imdb_ids:
                        continue
                    try:
                        ratings[imdb_id] = {"rating": float(row["averageRating"]), "votes": int(row["numVotes"])}
                    except Exception:
                        continue
                    if len(ratings) == len(imdb_ids):
                        break
        except Exception:
            return {}

        return ratings

    def deleteImdbRatingsFile(self):
        try:
            os.remove(self.IMDB_RATINGS_PATH)
        except OSError:
            pass
