from backend.dataflow.BaseDataflow import BaseDataflow

from urllib.parse import quote_plus
from concurrent.futures import ThreadPoolExecutor, as_completed
import requests
import re
import time
import json
import threading


class NowPlayingsUpdate(BaseDataflow):
    MAIN_TABLE_NAME = "finalMovies"

    def process_row(self, row):
        new_row = dict(row)
        existing = self.per_thread_updating_extract_existing_values(row)

        tmdb_id = existing["tmdb_id"]
        if not tmdb_id:
            return new_row

        # TMDb
        try:
            data = requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,videos"}, timeout=10).json()
        except:
            data = ""

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

        # Letterboxd
        tmdb_url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
        r0, loc, session, lb_resolved, film_url = None, None, None, False, ""
        for attempt in range(10):
            if attempt:
                time.sleep(0.5)
            session = requests.Session()

            try:
                session.get("https://letterboxd.com/", headers=self.requests_headers, timeout=20)
            except Exception:
                pass
            try:
                r0 = session.get(tmdb_url, headers=self.requests_headers, timeout=20, allow_redirects=False)
            except Exception:
                continue

            loc = r0.headers.get("Location")
            if r0.status_code in (301, 302, 303, 307, 308) and loc:
                lb_resolved = True
                break
            if r0.status_code == 403:
                t = (r0.text or "").lower()
                if ("just a moment" in t) or ("cf-challenge" in t) or ("challenge-platform" in t):
                    continue
            break

        if lb_resolved:
            film_url = loc if (loc and (loc.startswith("http://") or loc.startswith("https://"))) else ("https://letterboxd.com" + loc if loc else "")
            if film_url and "/film/" in film_url:
                try:
                    rf = session.get(film_url, headers={**self.requests_headers, "Referer": tmdb_url}, timeout=20, allow_redirects=True)
                    html = rf.text or ""

                    m1 = re.search(r'meta name="twitter:data2" content="([\d.]+) out of 5"', html)
                    if m1:
                        try:
                            new_row["lbRating"] = round(float(m1.group(1)), 1)
                        except Exception:
                            new_row["lbRating"] = existing["lbRating"]

                    m2 = re.search(r'"ratingCount":\s*(\d+)', html)
                    if m2:
                        try:
                            new_row["lbVotes"] = int(m2.group(1))
                        except Exception:
                            new_row["lbVotes"] = existing["lbVotes"]
                except Exception:
                    pass

        # IMDb
        imdb_id = (new_row.get("imdb_id") or "").strip()
        if imdb_id:
            with self._imdb_driver_lock:
                self.driver.get(f"https://www.imdb.com/title/{imdb_id}/")

                imdb_dom = None
                for _ in range(3):
                    try:
                        imdb_dom = self.element("#__NEXT_DATA__").get_attribute("innerHTML")
                        if imdb_dom:
                            break
                    except Exception:
                        pass
                    time.sleep(0.5)

                if imdb_dom:
                    imdb_data = json.loads(imdb_dom)
                    ratings = imdb_data.get("props", {}).get("pageProps", {}).get("aboveTheFoldData", {}).get("ratingsSummary") or self.per_thread_updating_imdb_find_ratings_summary(imdb_data) or {}

                    aggregate_rating = ratings.get("aggregateRating")
                    vote_count = ratings.get("voteCount")

                    new_row["imdbRating"] = aggregate_rating if aggregate_rating is not None else existing["imdbRating"]
                    new_row["imdbVotes"] = vote_count if vote_count is not None else existing["imdbVotes"]

        # Rotten Tomatoes
        picked_url = None
        search_url = f"https://www.rottentomatoes.com/search?search={quote_plus(new_row['english_title'])}"
        try:
            search_html = requests.get(search_url, headers=self.requests_headers, timeout=20).text or ""
        except Exception:
            search_html = ""

        rt_rows = re.findall(r"<search-page-media-row\b.*?>.*?</search-page-media-row>", search_html, flags=re.S | re.I)[:10]
        target_year = int(new_row.get("release_year") or 0)
        if target_year:
            # First pass: first result within ±1 year
            for rt_row in rt_rows:
                y = re.search(r'release-year="(\d{4})"', rt_row, flags=re.I)
                href = re.search(r'href="(https?://www\.rottentomatoes\.com/m/[^"]+)"', rt_row, flags=re.I)
                if not y or not href:
                    continue
                try:
                    row_year = int(y.group(1))
                except Exception:
                    continue
                if abs(row_year - target_year) <= 1:
                    picked_url = href.group(1)
                    break

            # Second pass: fallback to first result within ±2 years
            if not picked_url:
                for rt_row in rt_rows:
                    y = re.search(r'release-year="(\d{4})"', rt_row, flags=re.I)
                    href = re.search(r'href="(https?://www\.rottentomatoes\.com/m/[^"]+)"', rt_row, flags=re.I)
                    if not y or not href:
                        continue
                    try:
                        row_year = int(y.group(1))
                    except Exception:
                        continue
                    if abs(row_year - target_year) <= 2:
                        picked_url = href.group(1)
                        break

        fallback_rt_id = new_row.get("rt_id") or existing["rt_id"]
        if not picked_url and fallback_rt_id:
            picked_url = fallback_rt_id if fallback_rt_id.startswith("http") else f"https://www.rottentomatoes.com{fallback_rt_id}"

        if picked_url:
            m_path = re.search(r"rottentomatoes\.com(/m/[^/?#]+)", picked_url)
            new_row["rt_id"] = m_path.group(1) if m_path else existing["rt_id"]
            try:
                html = requests.get(picked_url, headers={**self.requests_headers, "Referer": search_url}, timeout=20).text or ""
            except Exception:
                html = ""

            if html:
                scorecard = {}
                m_scorecard = re.search(r'<script[^>]*id="media-scorecard-json"[^>]*>\s*(\{.*?\})\s*</script>', html, flags=re.S | re.I)
                if m_scorecard:
                    try:
                        scorecard = json.loads(m_scorecard.group(1))
                    except Exception:
                        scorecard = {}

                overlay = scorecard.get("overlay") or {}
                critics = scorecard.get("criticsScore") or overlay.get("criticsAll") or {}
                audience = scorecard.get("audienceScore") or overlay.get("audienceVerified") or overlay.get("audienceAll") or {}
                critic_rating = (lambda s: int(s) if s else None)(re.sub(r"[^\d]", "", str((critics.get("score") or critics.get("scorePercent") or ""))))
                critic_votes = (lambda s: int(s) if s else None)(re.sub(r"[^\d]", "", str((critics.get("ratingCount") or critics.get("reviewCount") or ""))))
                audience_rating = (lambda s: int(s) if s else None)(re.sub(r"[^\d]", "", str((audience.get("score") or audience.get("scorePercent") or ""))))
                audience_votes = (lambda s: int(s) if s else None)(re.sub(r"[^\d]", "", str((audience.get("bandedRatingCount") or audience.get("ratingCount") or audience.get("reviewCount") or ""))))

                new_row["rtCriticRating"] = critic_rating if critic_rating is not None else existing["rtCriticRating"]
                new_row["rtCriticVotes"] = critic_votes if critic_votes is not None else existing["rtCriticVotes"]
                new_row["rtAudienceRating"] = audience_rating if audience_rating is not None else existing["rtAudienceRating"]
                new_row["rtAudienceVotes"] = audience_votes if audience_votes is not None else existing["rtAudienceVotes"]

        return self.apply_solo_update_postprocess(new_row)

    def logic(self):
        self.dedupeFinalMovies(self.MAIN_TABLE_NAME)
        target_rows = self.rows_for_update()
        if not target_rows:
            return

        self._imdb_driver_lock = threading.Lock()
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
            self.dedupeFinalMovies(self.MAIN_TABLE_NAME)
