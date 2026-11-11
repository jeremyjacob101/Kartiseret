from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import json
import time
from contextlib import nullcontext

from backend.utils.log.dataflow_summary_logging import write_dataflow_summary


class DataflowSummaryHelpers:
    def init_dataflow_summary_state(self):
        self.summaryStartTime = time.time()
        self.summaryEnabled = self.__class__.__name__ in {"CinemathequesTmdb", "ComingSoonsTmdb", "NowPlayingsTmdb", "CinemathequesUpdate", "ComingSoonsUpdate", "NowPlayingsUpdate"}
        self.summaryCounts = defaultdict(int)
        self.summaryStageBreakdown = defaultdict(int)
        self.summaryComingSoonDetails = []
        self.summaryCinemathequeGroups = []
        self.summaryNowPlayingGroups = []
        self.summaryUnresolvedOrDropped = []
        self.summaryWriteOrDedupeActions = []
        self.summaryNotes = []
        self.summaryTmdbEvidence = []
        self.summaryFlushed = False
        self._tmdb_current_match_evidence = None

    def beginTmdbMatchEvidence(self, identity_key, rows, *, input_fingerprint=""):
        if not getattr(self, "summaryEnabled", False):
            return
        from backend.dataflow.utils.PipelineCheckpoints import stable_fingerprint

        categories = {
            "ComingSoonsTmdb": "comingsoons",
            "NowPlayingsTmdb": "nowplayings",
            "CinemathequesTmdb": "cinematheques",
        }
        aggregate = {}
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            source = {
                "row_id": str(row.get("id") or ""),
                "snapshot_id": str(row.get("snapshot_id") or ""),
                "source_run_id": str(row.get("run_id") or ""),
                "source": str(row.get("_checkpoint_source") or row.get("cinema") or ""),
                "cinema": str(row.get("cinema") or ""),
                "title": str(row.get("english_title") or "").strip(),
                "normalized_title": self.normalizeTitle(row.get("english_title") or ""),
                "hebrew_title": str(row.get("hebrew_title") or "").strip(),
                "release_year": self.clean_int(row.get("release_year")),
                "scheduled_release_date": self.clean_date(row.get("release_date")),
                "director": str(row.get("directed_by") or "").strip(),
                "runtime": self.clean_int(row.get("runtime")),
            }
            identity = tuple(source.values())
            found = aggregate.get(identity)
            if found is None:
                found = aggregate[identity] = {**source, "row_count": 0}
            found["row_count"] += 1
        source_rows = sorted(aggregate.values(), key=lambda item: (item["source"], item["title"], item["release_year"] or 0, item["row_id"]))
        from backend.utils.log.compact_matching import compact_sources
        fingerprint = input_fingerprint or stable_fingerprint(source_rows)
        source_rows = compact_sources(source_rows)
        self._tmdb_current_match_evidence = {
            "evidence_format_version": 1,
            "run_id": self.run_id,
            "attempt": getattr(self, "_artifact_attempt", 1) or 1,
            "category": categories.get(self.__class__.__name__, "unknown"),
            "dataflow": self.__class__.__name__,
            "identity_key": str(identity_key or ""),
            "input_fingerprint": fingerprint,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "source_rows": source_rows,
            "search_requests": [],
            "decisions": [],
        }

    def recordTmdbSearchResponse(self, params, response):
        current = getattr(self, "_tmdb_current_match_evidence", None)
        if current is None:
            return
        request_key = ("search/movie", tuple(sorted((params or {}).items())))
        with self._request_lock:
            event = deepcopy(self._request_context.tmdb_observations.get(request_key))
        results = response.get("results") if isinstance(response, dict) else []
        if not isinstance(results, list):
            results = []
        current["search_requests"].append({
            "query": str((params or {}).get("query") or ""),
            "primary_release_year": self.clean_int((params or {}).get("primary_release_year")),
            "page": self.clean_int((params or {}).get("page")) or 1,
            "result_count": len(results),
            "total_pages": self.clean_int(response.get("total_pages")) if isinstance(response, dict) else None,
            "result_ids": [self.clean_int(row.get("id")) for row in results if isinstance(row, dict) and self.clean_int(row.get("id"))],
            "results": [
                {
                    "tmdb_id": self.clean_int(row.get("id")),
                    "title": str(row.get("title") or "").strip() or None,
                    "original_title": str(row.get("original_title") or "").strip() or None,
                    "release_date": str(row.get("release_date") or "").strip() or None,
                    "position_on_page": position,
                }
                for position, row in enumerate(results, start=1)
                if isinstance(row, dict) and self.clean_int(row.get("id"))
            ],
            "attempted_at": (event or {}).get("attempted_at"),
            "checked_at": (event or {}).get("checked_at"),
            "outcome": (event or {}).get("outcome", "unobserved"),
        })

    def recordTmdbDetailFailure(self, path):
        from backend.dataflow.utils.DataflowRequests import TMDB_MOVIE_DETAILS_PARAMS

        current = getattr(self, "_tmdb_current_match_evidence", None)
        if current is None:
            return
        tmdb_id = self.clean_int(str(path or "").rsplit("/", 1)[-1])
        key = (str(path), tuple(sorted((TMDB_MOVIE_DETAILS_PARAMS.items())))
               if str(path).startswith("movie/") else ())
        with self._request_lock:
            event = deepcopy(self._request_context.tmdb_observations.get(key))
        failures = current.setdefault("detail_request_failures", [])
        failures.append({"tmdb_id": tmdb_id, "outcome": (event or {}).get("outcome", "failed"), "reason": (event or {}).get("reason", "request_failed"), "attempted_at": (event or {}).get("attempted_at")})

    def finishTmdbMatchEvidence(self, reason, status, chosen_tmdb=None, *, chosen_path=None, candidate_ids=None):
        current = getattr(self, "_tmdb_current_match_evidence", None)
        if current is None or current.get("finished_at"):
            return
        candidates = list(candidate_ids if candidate_ids is not None else getattr(self, "candidates", []) or [])
        details_by_id = getattr(self, "details", {}) or {}
        source_rows = current.get("source_rows", [])
        search_positions = defaultdict(list)
        search_results = defaultdict(list)
        for request in current.get("search_requests", []):
            for result in request.get("results", []):
                tmdb_id = result.get("tmdb_id")
                if not tmdb_id:
                    continue
                search_positions[tmdb_id].append({
                    "query": request.get("query"),
                    "primary_release_year": request.get("primary_release_year"),
                    "page": request.get("page"),
                    "position_on_page": result.get("position_on_page"),
                })
                search_results[tmdb_id].append(result)

        candidate_evidence = []
        for rank, raw_id in enumerate(candidates, start=1):
            tmdb_id = self.clean_int(raw_id)
            details = details_by_id.get(raw_id) or details_by_id.get(tmdb_id) or {}
            details = details if isinstance(details, dict) else {}
            credits = (details.get("credits") or {}).get("crew") or []
            directors = sorted({str(person.get("name") or "").strip() for person in credits if isinstance(person, dict) and person.get("job") == "Director" and person.get("name")})
            title = str(details.get("title") or "").strip()
            original_title = str(details.get("original_title") or "").strip()
            release_date = str(details.get("release_date") or "").strip() or None
            search_fallback = (search_results.get(tmdb_id) or [{}])[0]
            title = title or str(search_fallback.get("title") or "").strip()
            original_title = original_title or str(search_fallback.get("original_title") or "").strip()
            release_date = release_date or search_fallback.get("release_date")
            tmdb_year = self.clean_int(release_date[:4]) if release_date else None
            tmdb_runtime = self.clean_int(details.get("runtime"))
            from backend.dataflow.utils.TmdbMovieDetailsCache import validate_movie_details

            validation_missing = []
            if not details.get("id"):
                validation_missing.append("movie_details")
            else:
                if not isinstance(details.get("title"), str) or not details.get("title", "").strip():
                    validation_missing.append("title")
                if not isinstance(details.get("original_title"), str) or not details.get("original_title", "").strip():
                    validation_missing.append("original_title")
                if not isinstance(details.get("release_date"), str) or not details.get("release_date", "").strip():
                    validation_missing.append("release_date")
                if not isinstance(details.get("runtime"), (int, float)):
                    validation_missing.append("runtime")
                if not isinstance(details.get("external_ids"), dict):
                    validation_missing.append("external_ids")
                credits_section = details.get("credits")
                if not isinstance(credits_section, dict) or not isinstance(credits_section.get("crew"), list):
                    validation_missing.append("credits.crew")
                videos_section = details.get("videos")
                if not isinstance(videos_section, dict) or not isinstance(videos_section.get("results"), list):
                    validation_missing.append("videos.results")
            response_validation = {
                "canonical_profile_valid": validate_movie_details(details, tmdb_id) is not None,
                "missing_fields_or_sections": validation_missing,
                "empty_sections": [
                    name for name, value in (
                        ("external_ids", details.get("external_ids")),
                        ("credits.crew", (details.get("credits") or {}).get("crew") if isinstance(details.get("credits"), dict) else None),
                        ("videos.results", (details.get("videos") or {}).get("results") if isinstance(details.get("videos"), dict) else None),
                    ) if isinstance(value, (dict, list)) and not value
                ],
            }
            tmdb_names = {self.normalizeTitle(value) for value in (title, original_title) if value}
            comparisons = {"title": [], "year": [], "director": [], "runtime": []}
            for source in source_rows:
                title_key = source.get("normalized_title") or ""
                comparisons["title"].append({"source_row_id": source.get("row_id"), "signal": "agree" if title_key and title_key in tmdb_names else "conflict" if title_key and tmdb_names else "missing"})
                source_year = source.get("release_year")
                comparisons["year"].append({"source_row_id": source.get("row_id"), "source_year": source_year, "tmdb_year": tmdb_year, "signal": "missing" if source_year is None or tmdb_year is None else "agree" if source_year == tmdb_year else "conflict"})
                source_director = self.normalizeTitle(source.get("director") or "")
                tmdb_directors = {self.normalizeTitle(value) for value in directors}
                comparisons["director"].append({"source_row_id": source.get("row_id"), "signal": "missing" if not source_director or not tmdb_directors else "agree" if source_director in tmdb_directors else "conflict"})
                source_runtime = source.get("runtime")
                comparisons["runtime"].append({"source_row_id": source.get("row_id"), "source_runtime": source_runtime, "tmdb_runtime": tmdb_runtime, "difference_minutes": abs(source_runtime - tmdb_runtime) if source_runtime is not None and tmdb_runtime is not None else None, "signal": "missing" if source_runtime is None or tmdb_runtime is None else "agree" if source_runtime == tmdb_runtime else "conflict"})
            for values in comparisons.values():
                for comparison, source in zip(values, source_rows):
                    comparison["weight"] = source.get("comparison_weight", 1)
            candidate_evidence.append({
                "tmdb_id": tmdb_id,
                "search_rank": rank,
                "search_positions": search_positions.get(tmdb_id, []),
                "search_titles": search_results.get(tmdb_id, []),
                "title": title or None,
                "original_title": original_title or None,
                "original_release_date": release_date,
                "directors": directors,
                "runtime": tmdb_runtime,
                "details_available": bool(details.get("id")),
                "response_validation": response_validation,
                "detail_request": self._tmdbDetailRequestEvidence(tmdb_id),
                "comparisons": comparisons,
                "missing_evidence": [name for name, values in comparisons.items() if any(item["signal"] == "missing" for item in values)] + [f"details.{name}" for name in validation_missing],
                "conflicting_evidence": [name for name, values in comparisons.items() if any(item["signal"] == "conflict" for item in values)],
            })
        current.update({
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "status": str(status),
            "selection_reason": str(reason or ""),
            "chosen_path": str(chosen_path or reason or ""),
            "chosen_tmdb_id": self.clean_int(chosen_tmdb),
            "candidate_count": len(candidates),
            "candidates": candidate_evidence,
            "alternatives": [item["tmdb_id"] for item in candidate_evidence if item["tmdb_id"] and item["tmdb_id"] != self.clean_int(chosen_tmdb)][:10],
            "decisions": list(current.get("decisions", [])),
        })
        from backend.utils.log.compact_matching import compact_group
        self.summaryTmdbEvidence.append(compact_group(current))
        self._tmdb_current_match_evidence = None

    def _tmdbDetailRequestEvidence(self, tmdb_id):
        from backend.dataflow.utils.DataflowRequests import TMDB_MOVIE_DETAILS_PARAMS

        key = (f"movie/{tmdb_id}", tuple(sorted(TMDB_MOVIE_DETAILS_PARAMS.items())))
        with self._request_lock:
            event = deepcopy(self._request_context.tmdb_observations.get(key))
        if event is None:
            return {"outcome": "not_requested", "reason": "no_detail_observation"}
        source = event.get("source") or {}
        return {
            "outcome": event.get("outcome", "unknown"),
            "reason": event.get("reason", ""),
            "attempted_at": event.get("attempted_at"),
            "checked_at": event.get("checked_at"),
            "cached_fetched_at": source.get("fetched_at"),
        }

    def trace_event(self, stage: str, status: str, reason: str, key: str | None = None, payload: dict | None = None):
        if not getattr(self, "summaryEnabled", False):
            return
        try:
            stage_s = str(stage or "").strip() or "unknown_stage"
            status_s = str(status or "").strip() or "unknown_status"
            reason_s = str(reason or "").strip() or "unknown_reason"
            summary_key = f"{stage_s}|{status_s}|{reason_s}"
            self.summaryCounts[status_s] += 1
            self.summaryStageBreakdown[summary_key] += 1

            payload = payload or {}
            current_evidence = getattr(self, "_tmdb_current_match_evidence", None)
            if current_evidence is not None and stage_s in {"tmdb_choice", "tmdb_search", "row_filter", "group_filter"}:
                current_evidence.setdefault("decisions", []).append({
                    "stage": stage_s,
                    "status": status_s,
                    "reason": reason_s,
                    "chosen_tmdb_id": self.clean_int(payload.get("chosen_tmdb")),
                    "chosen_path": str(payload.get("chosen_path") or ""),
                    "at": datetime.now(timezone.utc).isoformat(),
                })
            if stage_s in {"tmdb_choice", "tmdb_search", "row_filter", "group_filter"}:
                # “mapped” can be provisional: alias remapping and other final
                # decisions may follow. Callers explicitly finish after the
                # complete match path; terminal non-mapped outcomes finish here.
                if status_s != "mapped":
                    self.finishTmdbMatchEvidence(
                        reason_s,
                        status_s,
                        payload.get("chosen_tmdb"),
                        chosen_path=payload.get("chosen_path"),
                    )
            if self.__class__.__name__ == "ComingSoonsTmdb":
                event = {
                    "stage": stage_s,
                    "status": status_s,
                    "reason": reason_s,
                    "key": key or payload.get("key") or "",
                    "title": payload.get("title") or "",
                    "title_norm": payload.get("title_norm") or "",
                    "chosen_tmdb": payload.get("chosen_tmdb") or "",
                }
                self.summaryComingSoonDetails.append(event)
            elif self.__class__.__name__ == "NowPlayingsTmdb":
                event = {
                    "key": key or payload.get("key") or "",
                    "status": status_s,
                    "reason": reason_s,
                    "representative_title": payload.get("representative_title") or "",
                    "row_count": payload.get("row_count") or 0,
                    "parsed_year": payload.get("parsed_year"),
                    "candidate_count": payload.get("candidate_count") or 0,
                    "chosen_tmdb": payload.get("chosen_tmdb") or "",
                    "chosen_path": payload.get("chosen_path") or "",
                }
                self.summaryNowPlayingGroups.append(event)
            elif self.__class__.__name__ == "CinemathequesTmdb":
                event = {
                    "key": key or payload.get("key") or "",
                    "status": status_s,
                    "reason": reason_s,
                    "representative_title": payload.get("representative_title") or "",
                    "row_count": payload.get("row_count") or 0,
                    "parsed_year": payload.get("parsed_year"),
                    "candidate_count": payload.get("candidate_count") or 0,
                    "chosen_tmdb": payload.get("chosen_tmdb") or "",
                    "chosen_path": payload.get("chosen_path") or "",
                }
                self.summaryCinemathequeGroups.append(event)
        except Exception:
            pass

    def trace_unresolved(self, text: str):
        if getattr(self, "summaryEnabled", False) and text:
            try:
                self.summaryUnresolvedOrDropped.append(str(text))
            except Exception:
                pass

    def trace_write_action(self, text: str):
        if getattr(self, "summaryEnabled", False) and text:
            try:
                self.summaryWriteOrDedupeActions.append(str(text))
            except Exception:
                pass

    def trace_note(self, text: str):
        if getattr(self, "summaryEnabled", False) and text:
            try:
                self.summaryNotes.append(str(text))
            except Exception:
                pass

    def flush_summary(self, successful: bool):
        if not getattr(self, "summaryEnabled", False) or getattr(self, "summaryFlushed", False):
            return

        try:
            finished_at = time.time()
            started_at = float(getattr(self, "summaryStartTime", finished_at))
            duration = max(0.0, finished_at - started_at)
            publication_pending = bool(
                successful
                and getattr(self, "_publication", None) is not None
                and not getattr(self, "_owns_publication", True)
            )
            summary = {
                "name": self.__class__.__name__,
                "run_id": self.run_id,
                "attempt": getattr(self, "_artifact_attempt", 1) or 1,
                "successful": bool(successful),
                "publication_pending": publication_pending,
                "started_at": started_at,
                "finished_at": finished_at,
                "duration_seconds": round(duration, 4),
                "provider_examples": dict(getattr(self, "providerOutcomeExamples", {}) or {}),
                "provider_outcomes": dict(getattr(self, "providerOutcomeCounts", {}) or {}),
                "summary_counts": dict(getattr(self, "summaryCounts", {}) or {}),
                "stage_breakdown": dict(getattr(self, "summaryStageBreakdown", {}) or {}),
                "coming_soon_details": list(getattr(self, "summaryComingSoonDetails", []) or []),
                "cinematheque_groups": list(getattr(self, "summaryCinemathequeGroups", []) or []),
                "now_playing_groups": list(getattr(self, "summaryNowPlayingGroups", []) or []),
                "unresolved_or_dropped": list(getattr(self, "summaryUnresolvedOrDropped", []) or []),
                "write_or_dedupe_actions": list(getattr(self, "summaryWriteOrDedupeActions", []) or []),
                "tmdb_metrics": DataflowSummaryHelpers._summaryTmdbMetrics(self),
                "notes": list(getattr(self, "summaryNotes", []) or []),
            }
            evidence = list(getattr(self, "summaryTmdbEvidence", []) or [])
            pending_evidence = getattr(self, "_tmdb_current_match_evidence", None)
            if pending_evidence is not None:
                self.finishTmdbMatchEvidence("no_terminal_match_event", "unresolved")
                evidence = list(getattr(self, "summaryTmdbEvidence", []) or [])
            if evidence:
                from backend.utils.log.run_storage import RunArtifactStore
                evidence_name = f"{self.__class__.__name__}-{summary['attempt']}-evidence"
                try:
                    RunArtifactStore().save_matching_summary({
                        "evidence_format_version": 2, "run_id": int(self.run_id),
                        "attempt": summary["attempt"], "dataflow": self.__class__.__name__,
                        "groups": evidence,
                    }, name=evidence_name)
                    summary["tmdb_evidence_artifact"] = f"d1://run_logs/{self.run_id}/tmdb_matching_evidence/{evidence_name}"
                    summary["tmdb_evidence_group_count"] = len(evidence)
                except Exception as error:
                    summary["notes"].append(f"tmdb_evidence_storage_failed | {type(error).__name__}")
            if not successful:
                summary["notes"].append("Partial summary written from failure path before retry/re-raise.")
            elif publication_pending:
                summary["notes"].append("Changes are staged; they are not live until category publication commits.")
            write_dataflow_summary(summary, successful=bool(successful))
        finally:
            self.summaryFlushed = True

    def _summaryTmdbMetrics(self):
        with getattr(self, "_request_lock", nullcontext()):
            metrics = dict(getattr(self, "_tmdb_metrics", {}) or {})
        archived_ids = metrics.pop("tmdb_archived_movie_ids", set())
        if isinstance(archived_ids, set):
            metrics["tmdb_archived_movie_count"] = len(archived_ids)
        metrics["scope"] = "shared_run_cumulative"
        return metrics
