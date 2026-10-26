from backend.dataflow.BaseDataflow import BaseDataflow
from backend.dataflow.cinematheques.utils.CinemathequesHelpers import CinemathequesHelpers
from backend.dataflow.utils.RottenTomatoesScores import parse_rotten_tomatoes_scorecard

from urllib.parse import quote_plus, urlsplit
from backend.dataflow.utils.ProviderFreshness import utc_now, observation, failure
from concurrent.futures import ThreadPoolExecutor, as_completed
import json, re


class CinemathequesUpdate(CinemathequesHelpers, BaseDataflow):
    MAIN_TABLE_NAME = "finalThequeMovies"
    USES_BROWSER = False
    LETTERBOXD_MAX_ATTEMPTS = 10
    UPDATE_WORKERS = 5

    def process_row(self, row):
        new_row = self.updating_output_row(row)
        existing = self.updating_existing_values(row)
        self.startProviderFreshness(row, new_row)

        tmdb_id = existing["tmdb_id"]
        if not tmdb_id:
            return self.normalizeUpdateRuntime(new_row)

        # TMDb
        data = self.tmdbForUpdate(tmdb_id)

        genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3]
        trailer = next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None)

        new_row["english_title"] = data["title"].strip() if data.get("title") else existing["english_title"]
        new_row["runtime"] = data["runtime"] if data.get("runtime") is not None else existing["runtime"]
        new_row["popularity"] = data["popularity"] if data.get("popularity") is not None else existing["popularity"]
        new_row["imdb_id"] = data.get("external_ids", {}).get("imdb_id") or existing["imdb_id"]
        new_row["en_poster"] = "https://image.tmdb.org/t/p/w342" + data["poster_path"] if data.get("poster_path") else existing["en_poster"]
        new_row["backdrop"] = "https://image.tmdb.org/t/p/w1280" + data["backdrop_path"] if data.get("backdrop_path") else existing["backdrop"]
        new_row["release_year"] = data["release_date"][:4] if data.get("release_date") else existing["release_year"]
        new_row["tmdbRating"] = int(round(data["vote_average"] * 10)) if data.get("vote_average") is not None else existing["tmdbRating"]
        new_row["tmdbVotes"] = data["vote_count"] if data.get("vote_count") is not None else existing["tmdbVotes"]
        new_row["lb_id"] = f"tmdb/{tmdb_id}"
        new_row["en_trailer"] = trailer.get("key") if trailer else existing["en_trailer"]
        new_row["genres"] = genres or existing["genres"]

        self.recordTmdbFreshness(new_row, data, tmdb_id)
        self.updateProviders(new_row, existing, tmdb_id)

        # IMDb
        imdb_id = (new_row.get("imdb_id") or "").strip()
        ratings = self._imdb_ratings.get(imdb_id)
        if ratings:
            new_row["imdbRating"] = ratings["rating"]
            new_row["imdbVotes"] = ratings["votes"]

        self.recordImdbFreshness(new_row, imdb_id, ratings)
        return self.normalizeUpdateRuntime(self.apply_solo_update_postprocess(new_row))

    def updateLetterboxd(self, new_row, existing, tmdb_id):
        started, refreshed = utc_now(), []
        film_url = self.resolveLetterboxd(tmdb_id)
        source = {"tmdb_id": str(tmdb_id)}
        if not film_url:
            outcome, reason = getattr(self._request_local, "letterboxd_failure", ("failed", "resolution_failed"))
            self.recordProviderFreshness(new_row, "letterboxd", observation(outcome, reason, source, started))
            return
        source["film_path"] = urlsplit(film_url).path[:256]
        try:
            rf = self.requestGet(film_url, headers={**self.requests_headers, "Referer": f"https://letterboxd.com/tmdb/{tmdb_id}/"}, timeout=20, allow_redirects=True)
            html = rf.text or ""
            m1 = re.search(r'meta name="twitter:data2" content="([\d.]+) out of 5"', html)
            if m1:
                try:
                    new_row["lbRating"] = round(float(m1.group(1)), 1)
                    refreshed.append("lbRating")
                except Exception:
                    new_row["lbRating"] = existing["lbRating"]
            m2 = re.search(r'"ratingCount":\s*(\d+)', html)
            if m2:
                try:
                    new_row["lbVotes"] = int(m2.group(1))
                    refreshed.append("lbVotes")
                except Exception:
                    new_row["lbVotes"] = existing["lbVotes"]
            if refreshed:
                outcome, reason = "success", "usable_fields" if len(refreshed) == 2 else "partial_fields"
            elif getattr(rf, "status_code", None) == 404:
                outcome, reason = "no_listing", "http_404"
            elif 'og:type' in html and ('video.movie' in html or 'film' in html):
                outcome, reason = "no_score", "listing_without_score"
            else:
                outcome, reason = "parse_error", "score_markup_unrecognized"
        except Exception as error:
            outcome, reason = failure(error)
        self.recordProviderFreshness(new_row, "letterboxd", observation(outcome, reason, source, started), refreshed)

    def updateRottenTomatoes(self, new_row, existing):
        started, refreshed = utc_now(), []
        picked_url, search_failure = None, None
        search_url = f"https://www.rottentomatoes.com/search?search={quote_plus(new_row['english_title'])}"
        try:
            search_response = self.requestGet(search_url, headers=self.requests_headers, timeout=20)
            search_html = search_response.text or ""
            if getattr(search_response, "status_code", None) == 404:
                search_failure = ("no_listing", "http_404")
        except Exception as error:
            search_html, search_failure = "", failure(error)
        rt_rows = re.findall(r"<search-page-media-row\b.*?>.*?</search-page-media-row>", search_html, flags=re.S | re.I)[:10]
        target_year = int(new_row.get("release_year") or 0)
        if target_year:
            for tolerance in (1, 2):
                for rt_row in rt_rows:
                    year = re.search(r'release-year="(\d{4})"', rt_row, flags=re.I)
                    href = re.search(r'href="(https?://www\.rottentomatoes\.com/m/[^"]+)"', rt_row, flags=re.I)
                    if year and href and abs(int(year.group(1)) - target_year) <= tolerance:
                        picked_url = href.group(1)
                        break
                if picked_url:
                    break
        fallback_rt_id = new_row.get("rt_id") or existing["rt_id"]
        if not picked_url and fallback_rt_id:
            picked_url = fallback_rt_id if fallback_rt_id.startswith("http") else f"https://www.rottentomatoes.com{fallback_rt_id}"
        source = {}
        if not picked_url:
            outcome, reason = search_failure or (("no_listing", "no_search_match") if "search-page" in search_html else ("parse_error", "search_markup_unrecognized"))
            self.recordProviderFreshness(new_row, "rotten_tomatoes", observation(outcome, reason, source, started))
            return
        path = re.search(r"rottentomatoes\.com(/m/[^/?#]+)", picked_url)
        new_row["rt_id"] = path.group(1) if path else existing["rt_id"]
        source["film_path"] = urlsplit(picked_url).path[:256]
        try:
            film_response = self.requestGet(picked_url, headers={**self.requests_headers, "Referer": search_url}, timeout=20)
            html = film_response.text or ""
        except Exception as error:
            self.recordProviderFreshness(new_row, "rotten_tomatoes", observation(*failure(error), source, started))
            return
        scorecard, valid_scorecard = {}, False
        match = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*(\{.*?\})\s*</script>', html, flags=re.S | re.I)
        if match:
            try:
                scorecard = json.loads(match.group(1))
                valid_scorecard = isinstance(scorecard, dict)
            except Exception:
                pass
        if html:
            for field, value in parse_rotten_tomatoes_scorecard(scorecard).items():
                new_row[field] = value if value is not None else existing[field]
                if value is not None:
                    refreshed.append(field)
        outcome, reason = (("success", "usable_fields" if len(refreshed) == 4 else "partial_fields") if refreshed else (("no_score", "listing_without_score") if valid_scorecard else ("parse_error", "score_markup_unrecognized")))
        if not refreshed and getattr(film_response, "status_code", None) == 404:
            outcome, reason = "no_listing", "http_404"
        self.recordProviderFreshness(new_row, "rotten_tomatoes", observation(outcome, reason, source, started), refreshed)

    def beginSharedUpdate(self):
        self.dedupeFinalMovies(self.MAIN_TABLE_NAME)
        return self.rows_for_update()

    def finishSharedUpdate(self, target_count: int, updated_rows: list[dict]) -> None:
        self.updates = updated_rows
        self.trace_note(f"update_rows | requested={target_count} | updated={len(self.updates)}")
        if self.updates:
            self.upsertUpdates(self.MAIN_TABLE_NAME)
            self.dedupeFinalMovies(self.MAIN_TABLE_NAME)

    def logic(self):
        target_rows = self.beginSharedUpdate()
        if not target_rows:
            return

        self.prepareUpdateTmdb(target_rows)
        self._imdb_ratings = self.loadImdbRatings(target_rows)

        with ThreadPoolExecutor(max_workers=self.UPDATE_WORKERS) as executor:
            futures = [executor.submit(self.process_row, row) for row in target_rows]
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result:
                        self.updates.append(result)
                except Exception as error:
                    self.trace_note(f"row_update_failed | error={type(error).__name__}")

        self.finishSharedUpdate(len(target_rows), self.updates)
