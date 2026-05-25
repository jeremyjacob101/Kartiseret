from backend.dataflow.BaseDataflow import BaseDataflow
from backend.utils.supabase.clear_old_entries import clear_old_entries
from collections import defaultdict
from datetime import date
import requests


class ComingSoonsTmdb(BaseDataflow):
    MAIN_TABLE_NAME = "allSoons"
    MOVING_TO_TABLE_NAME = "finalSoons"
    HELPER_TABLE_NAME = "tableFixes"
    HELPER_TABLE_NAME_2 = "tableSkips"

    def _build_alt_options(self, chosen_tmdb_id):
        alt_options = []
        for tmdb_id in self.candidates:
            if not tmdb_id or tmdb_id == chosen_tmdb_id:
                continue
            details = self.details.get(tmdb_id) or {}
            if not details.get("id"):
                continue

            release_date = (details.get("release_date") or "").strip()
            release_year = release_date[:4] if len(release_date) >= 4 else None
            poster_path = details.get("poster_path")
            poster_url = f"https://image.tmdb.org/t/p/w342{poster_path}" if poster_path else None

            alt_options.append(
                {
                    "tmdb": tmdb_id,
                    "title": details.get("title"),
                    "year": release_year,
                    "poster_url": poster_url,
                }
            )
            if len(alt_options) >= 10:
                break
        return alt_options

    def logic(self):
        self.dedupeAllSoons(self.MAIN_TABLE_NAME)
        self.dedupeFinalSoons(self.MOVING_TO_TABLE_NAME)
        self.trace_write_action(f"dedupeAllSoons({self.MAIN_TABLE_NAME})")
        self.trace_write_action(f"dedupeFinalSoons({self.MOVING_TO_TABLE_NAME})")

        for skip_row in self.helper_table_2_rows:
            skip_value = skip_row.get("name_or_tmdb_id").strip()
            self.skip_tokens.add(skip_value.lower())
            self.skip_tokens.add(self.normalizeTitle(skip_value).strip().lower())

        tmdb_fix_ids, tmdb_fix_by_title, tmdb_fix_alias_by_tmdb = self.buildTmdbFixMaps(self.helper_table_rows)

        for row in self.main_table_rows:
            self.reset_soon_row_state()
            self.load_soon_row(row)
            title_norm = self.normalizeTitle(self.english_title)

            if row.get("added"):
                self.trace_event("row_filter", "skipped", "already_added", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                continue

            if self.release_date and self.dateToDate(self.release_date) < date.today():
                self.trace_event("row_filter", "skipped", "past_release_date", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"past_release_date | {self.english_title} | row_id={row.get('id')}")
                continue

            title_raw = (self.english_title or "").strip().lower()
            if title_raw in self.skip_tokens or title_norm in self.skip_tokens:
                self.trace_event("row_filter", "skipped", "skip_token", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"skip_token | {self.english_title} | row_id={row.get('id')}")
                continue

            if override_tmdb := (tmdb_fix_by_title.get(title_raw) or tmdb_fix_by_title.get(title_norm)):
                if str(override_tmdb).lower() in self.skip_tokens:
                    self.trace_event("tmdb_choice", "skipped", "skip_token", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": override_tmdb})
                    self.trace_unresolved(f"skip_token_on_override | {self.english_title} | tmdb={override_tmdb}")
                    continue
                self.potential_chosen_id = override_tmdb
                self.non_deduplicated_updates.append({"old_uuid": row.get("id"), "run_id": row.get("run_id"), "english_title": self.english_title, "hebrew_title": self.hebrew_title, "release_date": self.release_date, "tmdb_id": override_tmdb, "imdb_id": None, "alt_options": []})
                self.trace_event("tmdb_choice", "mapped", "tmdb_fix_override", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": override_tmdb})
                self.processed_ids.add(row.get("id"))
                continue

            # 1) SEARCH TMDB AND COLLECT CANDIDATES
            if self.release_year:
                self.search_plans += [(24, 8, year) for year in (self.release_year, self.release_year - 1, self.release_year + 1)]
            self.search_plans.append((20, None, None))
            for max_total, max_plan, year in self.search_plans:
                if len(self.candidates) >= max_total:
                    continue

                added, page = 0, 1
                while len(self.candidates) < max_total and (max_plan is None or added < max_plan):
                    params = {"api_key": self.TMDB_API_KEY, "query": self.english_title, "page": page}
                    if year is not None:
                        params["primary_release_year"] = year
                    try:
                        response = requests.get("https://api.themoviedb.org/3/search/movie", params=params, timeout=10).json()
                    except:
                        break
                    results = response.get("results") or []
                    if not results:
                        break

                    for movie_result in results:
                        if not (tmdb_id := movie_result.get("id")) or tmdb_id in self.seen_already:
                            continue
                        self.seen_already.add(tmdb_id)
                        self.candidates.append(tmdb_id)
                        added += 1
                        if len(self.candidates) == max_total or (max_plan is not None and added == max_plan):
                            break
                    page += 1

            if not self.candidates:
                self.trace_event("tmdb_search", "dropped", "no_candidates", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"no_candidates | {self.english_title} | row_id={row.get('id')}")
                continue

            # 2) FETCH FULL DETAILS (external_ids + credits)
            for tmdb_id in self.candidates:
                self.tryExceptPass(lambda: (resp := requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,credits"}, timeout=10).json()) and resp.get("id") and self.details.update({tmdb_id: resp}))

            if not self.details:
                self.trace_event("tmdb_search", "dropped", "no_details", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"no_details | {self.english_title} | row_id={row.get('id')}")
                continue

            # 3) TMDb FIX TABLE HARD MATCH (fast set membership)
            chosen_path = None
            for tmdb_id in self.details.keys():
                tmdb_id = self.clean_int(tmdb_id)
                if tmdb_id in tmdb_fix_ids:
                    self.potential_chosen_id = tmdb_id
                    chosen_path = "tmdb_fix_id_match"
                    self.trace_event("tmdb_choice", "mapped", "tmdb_fix_id_match", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": tmdb_id})
                    break

            # 4) FALLBACK FIRST/DIRECTOR/RUNTIME RANKING LOGIC
            if self.potential_chosen_id is None:
                first = self.details.get(self.candidates[0])
                if first and (self.normalizeTitle(first.get("title")) == self.normalizeTitle(self.english_title)) and self.release_year and self.tryExceptNone(lambda: int((first.get("release_date") or "")[:4]) == self.release_year):
                    self.potential_chosen_id = self.candidates[0]
                    chosen_path = "title_first_match"
                    self.trace_event("tmdb_choice", "mapped", "title_first_match", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})

                # Director match
                if self.potential_chosen_id is None and self.directed_by:
                    target = self.directed_by.lower()
                    for tmdb_id, movie_details in self.details.items():
                        crew = movie_details.get("credits", {}).get("crew", [])
                        directors = [crew_member["name"].lower() for crew_member in crew if crew_member.get("job") == "Director" and crew_member.get("name")]
                        if target in directors:
                            self.potential_chosen_id = tmdb_id
                            chosen_path = "director_match"
                            self.trace_event("tmdb_choice", "mapped", "director_match", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})
                            break

                # Runtime match
                if self.potential_chosen_id is None and self.runtime and self.runtime not in self.fake_runtimes:
                    for tmdb_id, movie_details in self.details.items():
                        if movie_details.get("runtime") == self.runtime:
                            self.potential_chosen_id = tmdb_id
                            chosen_path = "runtime_match"
                            self.trace_event("tmdb_choice", "mapped", "runtime_match", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})
                            break

                if self.potential_chosen_id is None:
                    self.potential_chosen_id = self.candidates[0]
                    chosen_path = "fallback_first_candidate"
                    self.trace_event("tmdb_choice", "mapped", "fallback_first_candidate", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})

            if not self.potential_chosen_id or str(self.potential_chosen_id).lower() in self.skip_tokens:
                self.trace_event("tmdb_choice", "dropped", "chosen_skipped_or_missing", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})
                self.trace_unresolved(f"chosen_skipped_or_missing | {self.english_title} | tmdb={self.potential_chosen_id}")
                continue

            if alias_tmdb := self.tmdbFixAliasForTmdbId(self.potential_chosen_id, tmdb_fix_alias_by_tmdb):
                if str(alias_tmdb).lower() in self.skip_tokens:
                    self.trace_event("tmdb_choice", "dropped", "skip_token", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": alias_tmdb})
                    self.trace_unresolved(f"skip_token_on_alias | {self.english_title} | tmdb={alias_tmdb}")
                    continue
                self.potential_chosen_id = alias_tmdb
                chosen_path = "alias_remap"
                self.trace_event("tmdb_choice", "mapped", "alias_remap", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": alias_tmdb})

            chosen_details = self.details.get(self.potential_chosen_id) or {}
            chosen_imdb = (chosen_details.get("external_ids", {}) or {}).get("imdb_id")
            alt_options = self._build_alt_options(self.potential_chosen_id)

            self.non_deduplicated_updates.append({"old_uuid": row.get("id"), "run_id": row.get("run_id"), "english_title": self.english_title, "hebrew_title": self.hebrew_title, "release_date": self.release_date, "tmdb_id": self.potential_chosen_id, "imdb_id": chosen_imdb, "alt_options": alt_options})
            self.trace_event("tmdb_choice", "mapped", chosen_path or "mapped", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})
            self.processed_ids.add(row.get("id"))

        # 5) DEDUPE BY TMDB ID
        grouped = defaultdict(list)
        for r in self.non_deduplicated_updates:
            if tmdb_id := r.get("tmdb_id"):
                grouped[tmdb_id].append(r)

        for tmdb_id, rows in grouped.items():
            rows_sorted = sorted(rows, key=self.comingSoonsFreshnessPreferKey, reverse=True)
            best = rows_sorted[0]
            self.trace_event("dedupe", "merged", "deduped_into_tmdb", key=str(best.get("old_uuid") or ""), payload={"title": best.get("english_title"), "title_norm": self.normalizeTitle(best.get("english_title") or ""), "chosen_tmdb": tmdb_id})

            if (best.get("hebrew_title") or "").strip() in ("", "null"):
                for candidate_row in rows_sorted:
                    hebrew_title = (candidate_row.get("hebrew_title") or "").strip()
                    if hebrew_title not in ("", "null"):
                        best["hebrew_title"] = hebrew_title
                        break

            self.non_enriched_updates.append(best)

        # 6) ENRICH: TITLE + POSTER + IMDB_ID + TRAILER + RELEASE_YEAR + GENRES
        for row in self.non_enriched_updates:
            if not (tmdb_id := row.get("tmdb_id")):
                continue
            try:
                data = requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,videos"}, timeout=10).json()
            except:
                self.trace_event("enrich", "dropped", "no_details", key=str(row.get("old_uuid") or ""), payload={"title": row.get("english_title"), "title_norm": self.normalizeTitle(row.get("english_title") or ""), "chosen_tmdb": tmdb_id})
                self.trace_unresolved(f"enrich_fetch_failed | {row.get('english_title')} | tmdb={tmdb_id}")
                continue
            if not isinstance(data, dict) or not data.get("id"):
                self.trace_event("enrich", "dropped", "no_details", key=str(row.get("old_uuid") or ""), payload={"title": row.get("english_title"), "title_norm": self.normalizeTitle(row.get("english_title") or ""), "chosen_tmdb": tmdb_id})
                self.trace_unresolved(f"enrich_invalid_details | {row.get('english_title')} | tmdb={tmdb_id}")
                continue
            external_ids = data.get("external_ids") or {}
            new_row = dict(row)

            genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3]
            trailer = next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None)

            new_row["english_title"] = data["title"].strip() if data.get("title") else new_row.get("english_title")
            new_row["runtime"] = data["runtime"] if data.get("runtime") else new_row.get("runtime")
            new_row["imdb_id"] = external_ids.get("imdb_id") or new_row.get("imdb_id")
            new_row["en_poster"] = "https://image.tmdb.org/t/p/w342" + data["poster_path"] if data.get("poster_path") else new_row.get("en_poster")
            new_row["backdrop"] = "https://image.tmdb.org/t/p/w1280" + data["backdrop_path"] if data.get("backdrop_path") else new_row.get("backdrop")
            new_row["genres"] = genres or new_row.get("genres")
            new_row["en_trailer"] = trailer.get("key") if trailer else new_row.get("en_trailer")
            new_row["release_year"] = data["release_date"][:4] if data.get("release_date") else new_row.get("release_year")
            new_row["alt_options"] = new_row.get("alt_options") or []

            self.updates.append(new_row)
            self.trace_event("enrich", "mapped", "enriched", key=str(new_row.get("old_uuid") or ""), payload={"title": new_row.get("english_title"), "title_norm": self.normalizeTitle(new_row.get("english_title") or ""), "chosen_tmdb": tmdb_id})

        pre_upsert_count = len(self.updates)
        self.upsertUpdates(self.MOVING_TO_TABLE_NAME)
        self.trace_event("write", "mapped", "upserted", key=self.MOVING_TO_TABLE_NAME, payload={"title": "", "title_norm": "", "chosen_tmdb": ""})
        self.trace_write_action(f"upsertUpdates({self.MOVING_TO_TABLE_NAME}) rows={pre_upsert_count}")
        if self.processed_ids:
            ids = list(self.processed_ids)
            for i in range(0, len(ids), 200):
                chunk = ids[i : i + 200]
                self.supabase.table(self.MAIN_TABLE_NAME).update({"added": True}).in_("id", chunk).execute()
            self.trace_event("write", "mapped", "marked_added", key=self.MAIN_TABLE_NAME, payload={"title": "", "title_norm": "", "chosen_tmdb": ""})
            self.trace_write_action(f"mark_added({self.MAIN_TABLE_NAME}) rows={len(ids)}")
        self.dedupeFinalSoons(self.MOVING_TO_TABLE_NAME)
        self.trace_write_action(f"dedupeFinalSoons({self.MOVING_TO_TABLE_NAME})")

        clear_old_entries("soons")
