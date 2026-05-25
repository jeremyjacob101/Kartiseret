from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import os
import pathlib

ARTIFACT_ROOT = pathlib.Path("backend/utils/log/logger_artifacts")


def _clean_name(value: str) -> str:
    return (value or "Unknown").replace(" ", "_").strip()


def build_summary_path(run_id: int, item_name: str, attempt: int, successful: bool) -> pathlib.Path:
    bucket = "successful" if successful else "unsuccessful"
    directory = ARTIFACT_ROOT / str(run_id) / bucket
    filename = f"{_clean_name(item_name)}-{int(attempt)}-summary.txt"
    return directory / filename


def _iso_utc(ts: float | None) -> str:
    if ts is None:
        return ""
    return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()


def _render_header(summary: dict) -> list[str]:
    return [
        "- - -",
        "DATAFLOW SUMMARY",
        "- - -",
        f"Name: {summary.get('name') or ''}",
        f"Run ID: {summary.get('run_id') or ''}",
        f"Attempt: {summary.get('attempt') or ''}",
        f"Result: {'SUCCESS' if summary.get('successful') else 'FAILED'}",
        f"Started (UTC): {_iso_utc(summary.get('started_at'))}",
        f"Finished (UTC): {_iso_utc(summary.get('finished_at'))}",
        f"Duration Seconds: {summary.get('duration_seconds') if summary.get('duration_seconds') is not None else ''}",
        f"Generated At (UTC): {datetime.now(timezone.utc).isoformat()}",
    ]


def _render_summary_counts(summary: dict) -> list[str]:
    lines = ["", "SUMMARY COUNTS"]
    counts = summary.get("summary_counts") or {}
    if not counts:
        lines.append("- (none)")
        return lines
    for key in sorted(counts.keys()):
        lines.append(f"- {key}: {counts[key]}")
    return lines


def _render_stage_breakdown(summary: dict) -> list[str]:
    lines = ["", "STAGE BREAKDOWN"]
    stage_counts = summary.get("stage_breakdown") or {}
    if not stage_counts:
        lines.append("- (none)")
        return lines
    for key in sorted(stage_counts.keys()):
        lines.append(f"- {key}: {stage_counts[key]}")
    return lines


def _render_coming_soon_details(summary: dict) -> list[str]:
    lines = ["", "COMING SOONS DETAILS"]
    raw = summary.get("coming_soon_details") or []
    if not raw:
        lines.append("- (none)")
        return lines

    collapsed: dict[tuple, int] = defaultdict(int)
    first_event: dict[tuple, dict] = {}
    for row in raw:
        if not isinstance(row, dict):
            continue
        dedupe_key = (
            row.get("title_norm") or "",
            row.get("stage") or "",
            row.get("status") or "",
            row.get("reason") or "",
            row.get("chosen_tmdb") or "",
        )
        collapsed[dedupe_key] += 1
        if dedupe_key not in first_event:
            first_event[dedupe_key] = row

    if not collapsed:
        lines.append("- (none)")
        return lines

    for dedupe_key in sorted(collapsed.keys()):
        event = first_event[dedupe_key]
        count = collapsed[dedupe_key]
        line = (
            f"- [{event.get('status') or ''}] {event.get('stage') or ''} | "
            f"title={event.get('title') or ''} | key={event.get('key') or ''} | "
            f"reason={event.get('reason') or ''} | tmdb={event.get('chosen_tmdb') or ''}"
        )
        if count > 1:
            line += f" x{count}"
        lines.append(line)
    return lines


def _render_now_playing_groups(summary: dict) -> list[str]:
    lines = ["", "NOW PLAYING GROUP DETAILS"]
    groups = summary.get("now_playing_groups") or []
    if not groups:
        lines.append("- (none)")
        return lines

    for row in groups:
        if not isinstance(row, dict):
            continue
        lines.append(
            f"- key={row.get('key') or ''} | status={row.get('status') or ''} | "
            f"reason={row.get('reason') or ''} | rep_title={row.get('representative_title') or ''} | "
            f"rows={row.get('row_count') or 0} | parsed_year={row.get('parsed_year') or ''} | "
            f"candidates={row.get('candidate_count') or 0} | chosen_tmdb={row.get('chosen_tmdb') or ''} | "
            f"path={row.get('chosen_path') or ''}"
        )
    if len(lines) == 1:
        lines.append("- (none)")
    return lines


def _render_simple_list(summary: dict, key: str, title: str) -> list[str]:
    lines = ["", title]
    items = summary.get(key) or []
    if not items:
        lines.append("- (none)")
        return lines
    for item in items:
        lines.append(f"- {item}")
    return lines


def render_summary_text(summary: dict) -> str:
    lines: list[str] = []
    lines.extend(_render_header(summary))
    lines.extend(_render_summary_counts(summary))
    lines.extend(_render_stage_breakdown(summary))
    lines.extend(_render_coming_soon_details(summary))
    lines.extend(_render_now_playing_groups(summary))
    lines.extend(_render_simple_list(summary, "unresolved_or_dropped", "UNRESOLVED / DROPPED ITEMS"))
    lines.extend(_render_simple_list(summary, "write_or_dedupe_actions", "WRITE/DEDUPE ACTIONS"))
    lines.extend(_render_simple_list(summary, "notes", "NOTES"))
    return "\n".join(lines).strip() + "\n"


def _atomic_write(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as handle:
        handle.write(content)
    os.replace(tmp_path, path)


def write_dataflow_summary(summary: dict, *, successful: bool) -> str | None:
    try:
        run_id = int(summary.get("run_id"))
        name = str(summary.get("name") or "Unknown")
        attempt = int(summary.get("attempt") or 1)
        path = build_summary_path(run_id, name, attempt, successful)
        body = render_summary_text(summary)
        _atomic_write(path, body)
        return str(path)
    except Exception:
        return None
