from __future__ import annotations

from collections import defaultdict
import time

from backend.utils.log.dataflow_summary_logging import write_dataflow_summary


class DataflowSummaryHelpers:
    def init_dataflow_summary_state(self):
        self.summaryStartTime = time.time()
        self.summaryEnabled = self.__class__.__name__ in {"ComingSoonsTmdb", "NowPlayingsTmdb"}
        self.summaryCounts = defaultdict(int)
        self.summaryStageBreakdown = defaultdict(int)
        self.summaryComingSoonDetails = []
        self.summaryNowPlayingGroups = []
        self.summaryUnresolvedOrDropped = []
        self.summaryWriteOrDedupeActions = []
        self.summaryNotes = []
        self.summaryFlushed = False

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
            summary = {
                "name": self.__class__.__name__,
                "run_id": self.run_id,
                "attempt": getattr(self, "_artifact_attempt", 1) or 1,
                "successful": bool(successful),
                "started_at": started_at,
                "finished_at": finished_at,
                "duration_seconds": round(duration, 4),
                "summary_counts": dict(getattr(self, "summaryCounts", {}) or {}),
                "stage_breakdown": dict(getattr(self, "summaryStageBreakdown", {}) or {}),
                "coming_soon_details": list(getattr(self, "summaryComingSoonDetails", []) or []),
                "now_playing_groups": list(getattr(self, "summaryNowPlayingGroups", []) or []),
                "unresolved_or_dropped": list(getattr(self, "summaryUnresolvedOrDropped", []) or []),
                "write_or_dedupe_actions": list(getattr(self, "summaryWriteOrDedupeActions", []) or []),
                "notes": list(getattr(self, "summaryNotes", []) or []),
            }
            if not successful:
                summary["notes"].append("Partial summary written from failure path before retry/re-raise.")
            write_dataflow_summary(summary, successful=bool(successful))
        except Exception:
            pass
        finally:
            self.summaryFlushed = True
