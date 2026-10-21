from backend.dataflow.BaseDataflow import BaseDataflow
from backend.utils.supabase.clear_old_entries import clear_old_entries
from backend.utils.supabase.dedupe_all_soons import dedupe_all_soons
from backend.dataflow.utils.PipelineCheckpoints import PreparedPublication
from collections import defaultdict
from datetime import date
import json


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
            skip_value = self.clean_str(skip_row.get("name_or_tmdb_id")).strip()
            if skip_value:
                self.skip_tokens.add(skip_value.lower())
            skip_norm = self.normalizeTitle(skip_value).strip().lower()
            if skip_norm:
                self.skip_tokens.add(skip_norm)

        tmdb_fix_ids, tmdb_fix_by_title, tmdb_fix_alias_by_tmdb = self.buildTmdbFixMaps(self.helper_table_rows)

        rows_by_cinema, manifests_by_cinema, snapshot_ids_by_cinema, legacy_cinemas = self.selectLatestRawSnapshots(
            self.MAIN_TABLE_NAME,
            self.main_table_rows,
        )
        self.latest_rows_by_cinema = defaultdict(list, rows_by_cinema)
        self.latest_snapshot_manifests_by_cinema = manifests_by_cinema
        self.latest_snapshot_ids_by_cinema = snapshot_ids_by_cinema
        self.latest_snapshot_rows = [row for rows in rows_by_cinema.values() for row in rows]

        identity_key_by_row_id = {}
        fingerprint_by_row_id = {}
        fingerprint_by_identity = {}
        for row in self.latest_snapshot_rows:
            identity_key = json.dumps(list(self._all_soon_key(row)), ensure_ascii=False, separators=(",", ":"))
            row_id = self.clean_str(row.get("id"))
            fingerprint = self.matchInputFingerprint("comingsoons", identity_key, [row])
            identity_key_by_row_id[row_id] = identity_key
            fingerprint_by_row_id[row_id] = fingerprint
            fingerprint_by_identity[identity_key] = fingerprint
        self.claimSnapshotPublications(
            "comingsoons",
            manifests_by_cinema,
            rows_by_cinema,
            identity_key_by_row_id,
            fingerprint_by_identity,
            row_fingerprints_by_id=fingerprint_by_row_id,
        )
        claimed_snapshot_ids = set(self._publication_claims)
        claimed_cinemas = {
            cinema for cinema, manifest in manifests_by_cinema.items()
            if self.clean_str(manifest.get("snapshot_id")).strip() in claimed_snapshot_ids
        }
        eligible_cinemas = claimed_cinemas | legacy_cinemas
        self.latest_snapshot_rows = [
            row for cinema in sorted(eligible_cinemas)
            for row in rows_by_cinema.get(cinema, [])
        ]
        intentional_skip_ids = set()

        for row in self.latest_snapshot_rows:
            self.reset_soon_row_state()
            self.load_soon_row(row)
            title_norm = self.normalizeTitle(self.english_title)
            row_key = self.clean_str(row.get("id"))
            identity_key = identity_key_by_row_id.get(row_key, "")
            if row.get("added") is True and not self.clean_str(row.get("snapshot_id")).strip():
                self.trace_event("row_filter", "skipped", "already_added", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                continue

            if not self.release_date:
                self.protectUnresolvedSnapshot([row], category="comingsoons", identity_key=identity_key)
                self.trace_event("row_filter", "skipped", "missing_release_date", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"missing_release_date | {self.english_title} | row_id={row.get('id')}")
                continue

            if self.release_date and self.dateToDate(self.release_date) < date.today():
                self.trace_event("row_filter", "skipped", "past_release_date", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"past_release_date | {self.english_title} | row_id={row.get('id')}")
                continue

            title_raw = (self.english_title or "").strip().lower()
            if title_raw in self.skip_tokens or title_norm in self.skip_tokens:
                intentional_skip_ids.add(row.get("id"))
                self.trace_event("row_filter", "skipped", "skip_token", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"skip_token | {self.english_title} | row_id={row.get('id')}")
                continue

            if override_tmdb := self.tmdbFixForTitle(self.english_title, tmdb_fix_by_title):
                if str(override_tmdb).lower() in self.skip_tokens:
                    intentional_skip_ids.add(row.get("id"))
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
                    response = self.tmdbGet("search/movie", params)
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
                    total_pages = self.clean_int(response.get("total_pages"))
                    if page >= 500 or (total_pages is not None and total_pages > 0 and page >= total_pages):
                        break
                    page += 1

            if not self.candidates:
                self.protectUnresolvedSnapshot([row], category="comingsoons", identity_key=identity_key)
                self.trace_event("tmdb_search", "dropped", "no_candidates", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"no_candidates | {self.english_title} | row_id={row.get('id')}")
                continue

            # 2) FETCH FULL DETAILS (external_ids + credits)
            self.details = self.fetchTmdbDetails(self.candidates)

            if not self.details:
                self.protectUnresolvedSnapshot([row], category="comingsoons", identity_key=identity_key)
                self.trace_event("tmdb_search", "dropped", "no_details", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm})
                self.trace_unresolved(f"no_details | {self.english_title} | row_id={row.get('id')}")
                continue

            # Title-specific fixes were handled above; otherwise keep the existing ranking.
            chosen_path = None
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
                if self.potential_chosen_id and str(self.potential_chosen_id).lower() in self.skip_tokens:
                    intentional_skip_ids.add(row.get("id"))
                else:
                    self.protectUnresolvedSnapshot([row], category="comingsoons", identity_key=identity_key)
                self.trace_event("tmdb_choice", "dropped", "chosen_skipped_or_missing", key=str(row.get("id") or ""), payload={"title": self.english_title, "title_norm": title_norm, "chosen_tmdb": self.potential_chosen_id})
                self.trace_unresolved(f"chosen_skipped_or_missing | {self.english_title} | tmdb={self.potential_chosen_id}")
                continue

            if alias_tmdb := self.tmdbFixAliasForTmdbId(self.potential_chosen_id, tmdb_fix_alias_by_tmdb):
                if str(alias_tmdb).lower() in self.skip_tokens:
                    intentional_skip_ids.add(row.get("id"))
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
            data = self.tmdbGet(f"movie/{tmdb_id}", {"append_to_response": "external_ids,videos"}, allow_missing=True)
            if not isinstance(data, dict) or not data.get("id"):
                raw_row = next((candidate for candidate in self.latest_snapshot_rows if candidate.get("id") == row.get("old_uuid")), None)
                if raw_row:
                    identity_key = identity_key_by_row_id.get(self.clean_str(raw_row.get("id")), "")
                    self.protectUnresolvedSnapshot([raw_row], category="comingsoons", identity_key=identity_key)
                self.trace_event("enrich", "dropped", "no_details", key=str(row.get("old_uuid") or ""), payload={"title": row.get("english_title"), "title_norm": self.normalizeTitle(row.get("english_title") or ""), "chosen_tmdb": tmdb_id})
                self.trace_unresolved(f"enrich_invalid_details | {row.get('english_title')} | tmdb={tmdb_id}")
                continue
            external_ids = data.get("external_ids") or {}
            new_row = dict(row)

            genres = ["Sci-Fi" if genre["name"] == "Science Fiction" else genre["name"] for genre in (data.get("genres") or []) if genre.get("name")][:3]
            trailer = next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Trailer" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None) or next((v for v in ((data.get("videos") or {}).get("results") or []) if v.get("type") == "Teaser" and v.get("site") == "YouTube" and v.get("key") and v.get("iso_639_1") == "en"), None)

            new_row["english_title"] = data["title"].strip() if data.get("title") else new_row.get("english_title")
            new_row["runtime"] = data["runtime"] if data.get("runtime") else new_row.get("runtime")
            new_row["popularity"] = data["popularity"] if data.get("popularity") is not None else new_row.get("popularity")
            new_row["imdb_id"] = external_ids.get("imdb_id") or new_row.get("imdb_id")
            new_row["en_poster"] = "https://image.tmdb.org/t/p/w342" + data["poster_path"] if data.get("poster_path") else new_row.get("en_poster")
            new_row["backdrop"] = "https://image.tmdb.org/t/p/w1280" + data["backdrop_path"] if data.get("backdrop_path") else new_row.get("backdrop")
            new_row["genres"] = genres or new_row.get("genres")
            new_row["en_trailer"] = trailer.get("key") if trailer else new_row.get("en_trailer")
            new_row["release_year"] = data["release_date"][:4] if data.get("release_date") else new_row.get("release_year")
            new_row["alt_options"] = new_row.get("alt_options") or []

            self.updates.append(new_row)
            self.trace_event("enrich", "mapped", "enriched", key=str(new_row.get("old_uuid") or ""), payload={"title": new_row.get("english_title"), "title_norm": self.normalizeTitle(new_row.get("english_title") or ""), "chosen_tmdb": tmdb_id})

        enriched_ids = {row["tmdb_id"] for row in self.updates}
        self.processed_ids = {row["old_uuid"] for row in self.non_deduplicated_updates if row.get("tmdb_id") in enriched_ids} | intentional_skip_ids
        processed_id_keys = {self.clean_str(row_id).strip() for row_id in self.processed_ids if self.clean_str(row_id).strip()}
        tmdb_id_by_raw_id = {
            self.clean_str(row.get("old_uuid")).strip(): self.clean_int(row.get("tmdb_id"))
            for row in self.non_deduplicated_updates
            if self.clean_str(row.get("old_uuid")).strip()
        }
        for cinema in sorted(eligible_cinemas):
            snapshot_id = snapshot_ids_by_cinema.get(cinema)
            if not snapshot_id or snapshot_id not in self._publication_claims:
                continue
            source_rows = rows_by_cinema.get(cinema, [])
            source_row_ids = {self.clean_str(row.get("id")).strip() for row in source_rows if self.clean_str(row.get("id")).strip()}
            source_tmdb_ids = {tmdb_id_by_raw_id[row_id] for row_id in source_row_ids if tmdb_id_by_raw_id.get(row_id)}
            raw_ids_to_mark = tuple(sorted(source_row_ids & processed_id_keys))
            prepared_movies = tuple(
                dict(row) for row in self.updates
                if self.clean_int(row.get("tmdb_id")) in source_tmdb_ids
            )
            self.prepared_publications.append(PreparedPublication(
                category="comingsoons",
                snapshot_id=snapshot_id,
                run_id=int(self.run_id),
                input_fingerprint=self._publication_claims[snapshot_id]["input_fingerprint"],
                movies=prepared_movies,
                raw_row_ids_to_mark=raw_ids_to_mark,
                unresolved_group_keys=tuple(sorted(self.unresolved_identity_keys_by_snapshot.get(snapshot_id, set()))),
                source_complete=True,
            ))

        for snapshot_id in claimed_snapshot_ids:
            unresolved = bool(self.unresolved_identity_keys_by_snapshot.get(snapshot_id))
            self.advanceSnapshotPublication(snapshot_id, "prepared", has_unresolved=unresolved)
        needs_movie_write = bool(legacy_cinemas) or any(
            not self.snapshotPublicationReached(snapshot_id, "movies_written")
            for snapshot_id in claimed_snapshot_ids
        )
        pre_upsert_count = len(self.updates)
        if needs_movie_write:
            self.upsertUpdates(self.MOVING_TO_TABLE_NAME)
            self.trace_event("write", "mapped", "upserted", key=self.MOVING_TO_TABLE_NAME, payload={"title": "", "title_norm": "", "chosen_tmdb": ""})
            self.trace_write_action(f"upsertUpdates({self.MOVING_TO_TABLE_NAME}) rows={pre_upsert_count}")
        else:
            self.updates = []
        movie_codes_by_tmdb = self.ensureMovieCodesForTable(self.MOVING_TO_TABLE_NAME)
        self.trace_write_action(f"ensureMovieCodes(movieCodes) rows={len(movie_codes_by_tmdb)}")
        for snapshot_id in claimed_snapshot_ids:
            self.advanceSnapshotPublication(snapshot_id, "movies_written")
        if self.processed_ids:
            ids = list(self.processed_ids)
            for i in range(0, len(ids), 200):
                chunk = ids[i : i + 200]
                self.supabase.table(self.MAIN_TABLE_NAME).update({"added": True}).in_("id", chunk).execute()
            self.trace_event("write", "mapped", "marked_added", key=self.MAIN_TABLE_NAME, payload={"title": "", "title_norm": "", "chosen_tmdb": ""})
            self.trace_write_action(f"mark_added({self.MAIN_TABLE_NAME}) rows={len(ids)}")
        self.dedupeFinalSoons(self.MOVING_TO_TABLE_NAME)
        self.trace_write_action(f"dedupeFinalSoons({self.MOVING_TO_TABLE_NAME})")

        for snapshot_id in claimed_snapshot_ids:
            unresolved = bool(self.unresolved_identity_keys_by_snapshot.get(snapshot_id))
            self.advanceSnapshotPublication(snapshot_id, "published", has_unresolved=unresolved)

        clear_old_entries("soons")
        dedupe_all_soons(dry_run=False)
