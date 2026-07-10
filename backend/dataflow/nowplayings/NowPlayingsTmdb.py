from backend.dataflow.BaseDataflow import BaseDataflow
from backend.utils.supabase.clear_orphan_final_movies import clear_orphan_final_movies
from backend.utils.supabase.clear_old_entries import clear_old_entries
from collections import defaultdict
from datetime import date
import requests


class NowPlayingsTmdb(BaseDataflow):
    MAIN_TABLE_NAME = "allShowtimes"
    MOVING_TO_TABLE_NAME = "finalShowtimes"
    MOVING_TO_TABLE_NAME_2 = "finalMovies"
    HELPER_TABLE_NAME = "tableFixes"
    HELPER_TABLE_NAME_2 = "tableSkips"

    def logic(self):
        self.dedupeFinalShowtimes(self.MOVING_TO_TABLE_NAME)
        self.dedupeFinalMovies(self.MOVING_TO_TABLE_NAME_2)
        self.trace_write_action(f"dedupeFinalShowtimes({self.MOVING_TO_TABLE_NAME})")
        self.trace_write_action(f"dedupeFinalMovies({self.MOVING_TO_TABLE_NAME_2})")

        # SKIP TOKENS
        for skip_row in self.helper_table_2_rows:
            skip_value = self.clean_str(skip_row.get("name_or_tmdb_id")).strip()
            if skip_value:
                self.skip_tokens.add(skip_value.lower())
            skip_norm = self.normalizeTitle(skip_value).strip().lower()
            if skip_norm:
                self.skip_tokens.add(skip_norm)

        self.tmdb_fix_ids, self.tmdb_fix_by_title, self.tmdb_fix_alias_by_tmdb = self.buildTmdbFixMaps(self.helper_table_rows)

        # LATEST RAW SNAPSHOT PER CINEMA
        for row in self.main_table_rows:
            cinema = self.clean_str(row.get("cinema")).strip()
            run_id = self.clean_int(row.get("run_id"))

            current_latest = self.latest_run_id_by_cinema.get(cinema)
            if current_latest is None or run_id > current_latest:
                self.latest_run_id_by_cinema[cinema] = run_id
                self.latest_rows_by_cinema[cinema] = [row]
            elif current_latest == run_id:
                self.latest_rows_by_cinema[cinema].append(row)

        for cinema, rows in self.latest_rows_by_cinema.items():
            invalid_rows = [row for row in rows if not all(self.clean_str(row.get(field)).strip().lower() not in {"", "null", "none"} for field in ("english_title", "screening_city", "date_of_showing", "showtime"))]
            if invalid_rows:
                self.unhealthy_cinemas.add(cinema)
                self.trace_note(f"snapshot_guard | cinema={cinema} | invalid_rows={len(invalid_rows)}")

            if rows and all(row.get("added") is True for row in rows):
                continue
            self.latest_snapshot_rows.extend(rows)

        # CURRENT FINALSHOWTIMES IDS PER CINEMA
        for row in self.moving_to_table_rows:
            cinema = self.clean_str(row.get("cinema")).strip()
            row_id = row.get("id")
            self.existing_final_ids_by_cinema[cinema].add(row_id)

        # GROUP RAW ROWS FROM EACH CINEMA'S LATEST SNAPSHOT
        for row in self.latest_snapshot_rows:
            self.reset_np_main_row_state()
            self.load_np_main_row(row)
            if self.date_of_showing and self.dateToDate(self.date_of_showing) < date.today():
                continue

            override_tmdb = self.tmdbFixForTitle(self.english_title, self.tmdb_fix_by_title)
            if override_tmdb:
                title_for_count = self.clean_str(self.english_title).strip()
                key = f"tmdb_fix:{override_tmdb}"
            else:
                title_norm = self.normalizeTitle(self.english_title)
                key = self.nowPlayingsGroupKey(title_norm)
                title_for_count = title_norm
                if not (title_norm and key):
                    continue

            self.grouped_rows_by_key[key].append(row)
            self.title_counts_by_key[key][title_for_count] += 1

            meta = self.meta_by_key.setdefault(key, {"hebrew_title": self.hebrew_title, "directed_by": self.directed_by, "runtime": self.runtime, "year_counts": defaultdict(int)})
            meta["hebrew_title"] = meta.get("hebrew_title") if meta.get("hebrew_title") or not self.hebrew_title else self.hebrew_title
            meta["directed_by"] = meta.get("directed_by") if meta.get("directed_by") or not self.directed_by else self.directed_by
            meta["runtime"] = meta.get("runtime") if meta.get("runtime") or not self.runtime else self.runtime

            self.release_year is not None and self.tryExceptPass(lambda: meta["year_counts"].__setitem__(self.release_year, meta["year_counts"].get(self.release_year, 0) + 1))

        # RESOLVE TMDB FOR EACH GROUPED TITLE
        for key, rows in self.grouped_rows_by_key.items():
            self.reset_np_groupkey_row_state()
            self.load_np_groupkey_meta_row(key)
            row_count = len(rows)

            if self.year_counts:
                self.parsed_year = self.tryExceptNone(lambda: max(self.year_counts.items(), key=lambda kv: kv[1])[0])

            title_counts = self.title_counts_by_key.get(key) or {}
            titles_sorted = sorted(title_counts.items(), key=lambda kv: kv[1], reverse=True)
            representative_title = titles_sorted[0][0] if titles_sorted else ""
            if key.startswith("tmdb_fix:"):
                self.potential_chosen_id = self.clean_int(key.split(":", 1)[1])
                if str(self.potential_chosen_id).lower() in self.skip_tokens:
                    self.trace_event("tmdb_choice", "dropped", "skip_token", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": self.potential_chosen_id, "chosen_path": "tmdb_fix_override"})
                    self.trace_unresolved(f"skip_token_on_override | group={key} | title={representative_title}")
                    continue
                self.key_result[key] = {"tmdb_id": self.potential_chosen_id, "imdb_id": None, "hebrew_title": self.hebrew_title, "alt_options": self.alt_options}
                self.trace_event("tmdb_choice", "mapped", "tmdb_fix_override", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": self.potential_chosen_id, "chosen_path": "tmdb_fix_override"})
                continue

            candidate_titles = [title for title, _ in titles_sorted if not self.titleIsSkipped(title, self.skip_tokens)]
            if not candidate_titles:
                self.trace_event("group_filter", "dropped", "skip_token", key=key, payload={"key": key, "row_count": row_count, "representative_title": "", "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": "", "chosen_path": ""})
                self.trace_unresolved(f"skip_token | group={key} | rows={row_count}")
                continue
            representative_title = candidate_titles[0]

            # TMDB FIX OVERRIDE (title -> tmdb_id)
            for title in candidate_titles:
                self.override_tmdb = self.tmdbFixForTitle(title, self.tmdb_fix_by_title)
                if self.override_tmdb:
                    break
            if self.override_tmdb:
                self.potential_chosen_id = self.override_tmdb
                if str(self.potential_chosen_id).lower() in self.skip_tokens:
                    self.trace_event("tmdb_choice", "dropped", "skip_token", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": self.potential_chosen_id, "chosen_path": "tmdb_fix_override"})
                    self.trace_unresolved(f"skip_token_on_override | group={key} | title={representative_title}")
                    continue
                self.key_result[key] = {"tmdb_id": self.potential_chosen_id, "imdb_id": None, "hebrew_title": self.hebrew_title, "alt_options": self.alt_options}
                self.trace_event("tmdb_choice", "mapped", "tmdb_fix_override", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": self.potential_chosen_id, "chosen_path": "tmdb_fix_override"})
                continue

            # 1) SEARCH TMDB AND COLLECT CANDIDATES
            if self.parsed_year:
                self.search_plans += [(24, 8, year) for year in (self.parsed_year, self.parsed_year - 1, self.parsed_year + 1)]
            self.search_plans.append((20, None, None))
            for max_total, max_plan, year in self.search_plans:
                if len(self.candidates) >= max_total:
                    continue

                added, page = 0, 1
                while len(self.candidates) < max_total and (max_plan is None or added < max_plan):
                    params = {"api_key": self.TMDB_API_KEY, "query": representative_title, "page": page}
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
                        if len(self.candidates) >= max_total or (max_plan is not None and added >= max_plan):
                            break
                    page += 1

            if not self.candidates:
                self.trace_event("tmdb_search", "dropped", "no_candidates", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": 0, "chosen_tmdb": "", "chosen_path": ""})
                self.trace_unresolved(f"no_candidates | group={key} | title={representative_title}")
                continue

            # 2) FETCH FULL DETAILS (external_ids + credits)
            for tmdb_id in self.candidates:
                self.tryExceptPass(lambda: (resp := requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,credits"}, timeout=10).json()) and resp.get("id") and self.details.update({tmdb_id: resp}))
            if not self.details:
                self.trace_event("tmdb_search", "dropped", "no_details", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": len(self.candidates), "chosen_tmdb": "", "chosen_path": ""})
                self.trace_unresolved(f"no_details | group={key} | title={representative_title}")
                continue

            # 3) TMDb FIX TABLE HARD MATCH (fast set membership)
            for tmdb_id in self.details.keys():
                tmdb_id = self.clean_int(tmdb_id)
                if tmdb_id in self.tmdb_fix_ids:
                    self.potential_chosen_id = tmdb_id
                    self.chosen_path = "tmdb_fix_id_match"
                    break

            # 4) FALLBACK FIRST/DIRECTOR/RUNTIME RANKING LOGIC
            if self.potential_chosen_id is None:
                first = self.details.get(self.candidates[0])
                if first and (self.normalizeTitle(first.get("title")) == self.normalizeTitle(representative_title)) and (not self.parsed_year or self.tryExceptNone(lambda: int((first.get("release_date") or "")[:4]) == self.parsed_year)):
                    self.potential_chosen_id = self.candidates[0]
                    self.chosen_path = "title_first_match"

                if self.potential_chosen_id is None and self.directed_by:
                    target = str(self.directed_by).lower()
                    for tmdb_id, movie_details in self.details.items():
                        crew = movie_details.get("credits", {}).get("crew", [])
                        directors = [crew_member["name"].lower() for crew_member in crew if crew_member.get("job") == "Director" and crew_member.get("name")]
                        if target in directors:
                            self.potential_chosen_id = tmdb_id
                            self.chosen_path = "director_match"
                            break

                if self.potential_chosen_id is None and self.runtime and self.runtime not in self.fake_runtimes:
                    for tmdb_id, movie_details in self.details.items():
                        if movie_details.get("runtime") == self.runtime:
                            self.potential_chosen_id = tmdb_id
                            self.chosen_path = "runtime_match"
                            break

                if self.potential_chosen_id is None:
                    self.potential_chosen_id = self.candidates[0]
                    self.chosen_path = "fallback_first_candidate"

            if not self.potential_chosen_id or str(self.potential_chosen_id).lower() in self.skip_tokens:
                self.trace_event("tmdb_choice", "dropped", "chosen_skipped_or_missing", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": len(self.candidates), "chosen_tmdb": self.potential_chosen_id, "chosen_path": self.chosen_path or ""})
                self.trace_unresolved(f"chosen_skipped_or_missing | group={key} | title={representative_title}")
                continue

            if alias_tmdb := self.tmdbFixAliasForTmdbId(self.potential_chosen_id, self.tmdb_fix_alias_by_tmdb):
                if str(alias_tmdb).lower() in self.skip_tokens:
                    self.trace_event("tmdb_choice", "dropped", "skip_token", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": len(self.candidates), "chosen_tmdb": alias_tmdb, "chosen_path": "alias_remap"})
                    self.trace_unresolved(f"skip_token_on_alias | group={key} | title={representative_title}")
                    continue
                self.potential_chosen_id = alias_tmdb
                self.chosen_path = "alias_remap"

            chosen_details = self.details.get(self.potential_chosen_id) or {}
            chosen_imdb = (chosen_details.get("external_ids", {}) or {}).get("imdb_id")

            # Build up to ten alternate TMDb candidates for manual match correction.
            self.alt_options = []
            for tmdb_id in self.candidates:
                if not tmdb_id or tmdb_id == self.potential_chosen_id:
                    continue
                details = self.details.get(tmdb_id) or {}
                if not details.get("id"):
                    continue

                release_date = (details.get("release_date") or "").strip()
                release_year = release_date[:4] if len(release_date) >= 4 else None
                poster_path = details.get("poster_path")
                poster_url = f"https://image.tmdb.org/t/p/w342{poster_path}" if poster_path else None
                self.alt_options.append({"tmdb": tmdb_id, "title": details.get("title"), "year": release_year, "poster_url": poster_url})
                if len(self.alt_options) >= 10:
                    break

            self.key_result[key] = {"tmdb_id": self.potential_chosen_id, "imdb_id": chosen_imdb, "hebrew_title": self.hebrew_title, "alt_options": self.alt_options}
            self.trace_event("tmdb_choice", "mapped", self.chosen_path or "mapped", key=key, payload={"key": key, "row_count": row_count, "representative_title": representative_title, "parsed_year": self.parsed_year, "candidate_count": len(self.candidates), "chosen_tmdb": self.potential_chosen_id, "chosen_path": self.chosen_path or "mapped"})

        # 5) DEDUPE BY TMDB ID
        for key, res in self.key_result.items():
            if (tmdb_id := res.get("tmdb_id")) and tmdb_id not in self.movies_by_tmdb:
                self.movies_by_tmdb[tmdb_id] = res
                self.trace_event("dedupe", "merged", "deduped_into_tmdb", key=key, payload={"key": key, "row_count": len(self.grouped_rows_by_key.get(key) or []), "representative_title": "", "parsed_year": None, "candidate_count": 0, "chosen_tmdb": tmdb_id, "chosen_path": "deduped_into_tmdb"})

        # 6) ENRICH TITLE + POSTER + IMDB_ID + GENRES
        for tmdb_id, res in self.movies_by_tmdb.items():
            try:
                data = requests.get(f"https://api.themoviedb.org/3/movie/{tmdb_id}", params={"api_key": self.TMDB_API_KEY, "append_to_response": "external_ids,videos"}, timeout=10).json()
            except:
                self.trace_unresolved(f"enrich_fetch_failed | tmdb={tmdb_id}")
                continue
            if not isinstance(data, dict) or not data.get("id"):
                self.trace_unresolved(f"enrich_invalid_details | tmdb={tmdb_id}")
                continue
            external_ids = data.get("external_ids") or {}
            genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3]
            trailer = next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None)

            res["english_title"] = data["title"].strip() if data.get("title") else res.get("english_title")
            res["runtime"] = data["runtime"] if data.get("runtime") is not None else res.get("runtime")
            res["popularity"] = data["popularity"] if data.get("popularity") is not None else res.get("popularity")
            res["imdb_id"] = external_ids.get("imdb_id") or res.get("imdb_id")
            res["en_poster"] = "https://image.tmdb.org/t/p/w342" + data["poster_path"] if data.get("poster_path") else res.get("en_poster")
            res["backdrop"] = "https://image.tmdb.org/t/p/w1280" + data["backdrop_path"] if data.get("backdrop_path") else res.get("backdrop")
            res["genres"] = genres or res.get("genres")
            res["en_trailer"] = trailer.get("key") if trailer else res.get("en_trailer")
            res["release_year"] = data["release_date"][:4] if data.get("release_date") else res.get("release_year")
            res["alt_options"] = res.get("alt_options") or []

        tmdb_id_to_enriched = dict(self.movies_by_tmdb)

        # BUILD FINALSHOWTIMES CANDIDATES
        for key, rows in self.grouped_rows_by_key.items():
            group_res = self.key_result.get(key)
            tmdb_id = (group_res or {}).get("tmdb_id")
            enriched = tmdb_id_to_enriched.get(tmdb_id) if tmdb_id else None
            final_title = (enriched or {}).get("english_title") if enriched else None

            for row in rows:
                if not tmdb_id or self.titleIsSkipped(self.normalizeTitle(row.get("english_title")), self.skip_tokens):
                    continue

                new_row = dict(row)
                new_row["tmdb_id"] = tmdb_id
                new_row["english_title"] = final_title if final_title else self.normalizeTitle(row.get("english_title"))

                for column in ("added", "cleaned", "release_year", "rating", "directed_by", "runtime"):
                    new_row.pop(column, None)

                self.updates.append(new_row)

        for row in self.updates:
            cinema = self.clean_str(row.get("cinema")).strip()
            row_id = row.get("id")

            self.updates_by_cinema[cinema].append(row)
            self.new_final_ids_by_cinema[cinema].add(row_id)

        # PUBLISH EACH CINEMA'S LATEST SNAPSHOT
        for cinema, cinema_rows in self.updates_by_cinema.items():
            if not cinema_rows:
                continue

            # UPSERT FINALSHOWTIMES FOR THIS CINEMA
            self.updates = list(cinema_rows)
            self.upsertUpdates(self.MOVING_TO_TABLE_NAME, refresh=False)
            self.trace_event("write", "mapped", "upserted", key=cinema, payload={"key": cinema, "row_count": len(cinema_rows), "representative_title": "", "parsed_year": None, "candidate_count": 0, "chosen_tmdb": "", "chosen_path": "publish_by_cinema"})
            self.trace_write_action(f"upsertUpdates({self.MOVING_TO_TABLE_NAME}) cinema={cinema} rows={len(cinema_rows)}")

            # MARK THIS CINEMA'S WHOLE RAW SNAPSHOT AS ADDED
            raw_snapshot_rows = self.latest_rows_by_cinema[cinema]
            if cinema in self.unhealthy_cinemas:
                raw_snapshot_rows = [row for row in raw_snapshot_rows if all(self.clean_str(row.get(field)).strip().lower() not in {"", "null", "none"} for field in ("english_title", "screening_city", "date_of_showing", "showtime"))]
            raw_snapshot_ids = sorted(row["id"] for row in raw_snapshot_rows)
            if raw_snapshot_ids:
                for i in range(0, len(raw_snapshot_ids), 200):
                    self.supabase.table(self.MAIN_TABLE_NAME).update({"added": True}).in_("id", raw_snapshot_ids[i : i + 200]).execute()
                self.trace_event("write", "mapped", "marked_added", key=cinema, payload={"key": cinema, "row_count": len(raw_snapshot_ids), "representative_title": "", "parsed_year": None, "candidate_count": 0, "chosen_tmdb": "", "chosen_path": "publish_by_cinema"})
                self.trace_write_action(f"mark_added({self.MAIN_TABLE_NAME}) cinema={cinema} rows={len(raw_snapshot_ids)}")

            # DELETE STALE FINALSHOWTIMES ROWS FOR THIS CINEMA
            if cinema in self.unhealthy_cinemas:
                self.trace_write_action(f"skip_delete_stale({self.MOVING_TO_TABLE_NAME}) cinema={cinema}")
                continue

            stale_final_ids = self.existing_final_ids_by_cinema.get(cinema, set()) - self.new_final_ids_by_cinema.get(cinema, set())
            if stale_final_ids:
                self.delete_these.extend(sorted(stale_final_ids))
                self.deleteTheseRows(self.MOVING_TO_TABLE_NAME, refresh=False)
                self.trace_write_action(f"delete_stale({self.MOVING_TO_TABLE_NAME}) cinema={cinema} rows={len(stale_final_ids)}")

        # UPSERT FINALMOVIES
        self.dedupeFinalShowtimes(self.MOVING_TO_TABLE_NAME)
        self.trace_write_action(f"dedupeFinalShowtimes({self.MOVING_TO_TABLE_NAME})")
        for tmdb_id, res in tmdb_id_to_enriched.items():
            if not tmdb_id:
                continue
            imdb_id = res.get("imdb_id") or None
            self.updates.append({"tmdb_id": tmdb_id, "english_title": res.get("english_title"), "runtime": res.get("runtime"), "popularity": res.get("popularity"), "imdb_id": imdb_id, "genres": res.get("genres"), "en_poster": res.get("en_poster"), "en_trailer": res.get("en_trailer"), "backdrop": res.get("backdrop"), "release_year": res.get("release_year"), "alt_options": res.get("alt_options") or []})

        final_movies_upsert_count = len(self.updates)
        self.upsertUpdates(self.MOVING_TO_TABLE_NAME_2)
        self.trace_event("write", "mapped", "upserted", key=self.MOVING_TO_TABLE_NAME_2, payload={"key": self.MOVING_TO_TABLE_NAME_2, "row_count": final_movies_upsert_count, "representative_title": "", "parsed_year": None, "candidate_count": 0, "chosen_tmdb": "", "chosen_path": "final_movies"})
        self.trace_write_action(f"upsertUpdates({self.MOVING_TO_TABLE_NAME_2}) rows={final_movies_upsert_count}")
        self.dedupeFinalMovies(self.MOVING_TO_TABLE_NAME_2)
        self.trace_write_action(f"dedupeFinalMovies({self.MOVING_TO_TABLE_NAME_2})")

        clear_old_entries("nowplayings")
        clear_orphan_final_movies()
