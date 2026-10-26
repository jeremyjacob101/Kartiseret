"""Build a reviewed, idempotent release-date backfill from scrape artifacts.

The script is intentionally offline: a read-only database snapshot is exported
separately, then this program creates a report and guarded SQL for Supabase.
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import re
from pathlib import Path
from zoneinfo import ZoneInfo
import unicodedata


DEFAULT_ARTIFACT_ROOT = Path("backend/utils/log/logger_artifacts")
SOON_SOURCES = {"CCsoon", "HCsoon", "LCsoon", "MLsoon", "YPsoon"}
CSV_NAME = re.compile(r"(?P<source>CCsoon|HCsoon|LCsoon|MLsoon|YPsoon)-(?P<attempt>\d+)\.csv\Z")
SUMMARY_LINE = re.compile(r"^- \[(?P<status>[^\]]+)\] (?P<stage>[^|]+) \| title=(?P<tail>.*)\Z")


class BackfillInputError(ValueError):
    """The provided snapshot or artifacts cannot be interpreted safely."""


def normalize_english(title: object) -> str:
    if not isinstance(title, str):
        return ""
    normalized = unicodedata.normalize("NFKD", title)
    normalized = normalized.encode("ascii", "ignore").decode("ascii").lower()
    normalized = re.sub(r"[-–—:?!&]+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9 ]+", "", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def normalize_hebrew(title: object) -> str:
    if not isinstance(title, str):
        return ""
    normalized = unicodedata.normalize("NFKC", title).casefold()
    return "".join(
        character
        for character in normalized
        if unicodedata.category(character)[0] in {"L", "N"}
    )


def _positive_id(value: object) -> int | None:
    try:
        result = int(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def _iso_date(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def _as_utc(value: object, *, naive_timezone: timezone | None = None) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        if naive_timezone is None:
            return None
        parsed = parsed.replace(tzinfo=naive_timezone)
    return parsed.astimezone(timezone.utc)


def _parse_summary_event(line: str) -> dict | None:
    match = SUMMARY_LINE.match(line.strip())
    if not match:
        return None
    tail = match.group("tail")
    title, separator, remainder = tail.rpartition(" | key=")
    if not separator:
        return None
    key, reason_part, tmdb_part = remainder.partition(" | reason=")
    reason, separator, tmdb = tmdb_part.partition(" | tmdb=")
    if not reason_part or not separator:
        return None
    id_match = re.match(r"\s*(\d+)", tmdb)
    return {
        "status": match.group("status").strip(),
        "stage": match.group("stage").strip(),
        "title": title.strip(),
        "key": key.strip(),
        "reason": reason.strip(),
        "tmdb_id": _positive_id(id_match.group(1)) if id_match else None,
    }


def _summary_aliases(run_directory: Path) -> tuple[list[dict], list[str]]:
    aliases: list[dict] = []
    started_at: list[str] = []
    for path in sorted(run_directory.glob("*/*-summary.txt")):
        content = path.read_text(encoding="utf-8", errors="replace")
        started = re.search(r"^Started \(UTC\): (.+)\s*$", content, flags=re.MULTILINE)
        if started:
            started_at.append(started.group(1).strip())

    summary_directory = run_directory / "successful"
    for path in sorted(summary_directory.glob("ComingSoonsTmdb-*-summary.txt")):
        content = path.read_text(encoding="utf-8", errors="replace")
        result = re.search(r"^Result: SUCCESS\s*$", content, flags=re.MULTILINE)
        if not result:
            continue
        summary_hash = hashlib.sha256(path.read_bytes()).hexdigest()

        events = [event for line in content.splitlines() if (event := _parse_summary_event(line))]
        grouped: dict[str, list[dict]] = defaultdict(list)
        for event in events:
            if event["key"]:
                grouped[event["key"]].append(event)

        for key, key_events in grouped.items():
            final_ids = {
                event["tmdb_id"]
                for event in key_events
                if event["tmdb_id"]
                and (
                    (event["stage"] == "enrich" and event["status"] == "mapped" and event["reason"] == "enriched")
                    or (event["stage"] == "dedupe" and event["status"] == "merged" and event["reason"] == "deduped_into_tmdb")
                )
            }
            if len(final_ids) != 1:
                continue
            tmdb_id = next(iter(final_ids))
            for event in key_events:
                title = event["title"]
                english_key = normalize_english(title)
                if english_key:
                    aliases.append({
                        "tmdb_id": tmdb_id,
                        "title": title,
                        "normalized_title": english_key,
                        "source": "successful_tmdb_summary",
                        "artifact": path.as_posix(),
                        "artifact_sha256": summary_hash,
                        "line": None,
                        "identity_key": key,
                        "summary_stage": event["stage"],
                        "summary_status": event["status"],
                        "summary_reason": event["reason"],
                    })

    return aliases, started_at


def _snapshot_maps(snapshot: dict) -> tuple[dict, dict, dict, dict, dict, dict]:
    required = {"project_ref", "catalog_revision", "visible_movies", "movie_titles", "title_fixes", "release_dates", "run_logs"}
    missing = sorted(required - snapshot.keys())
    if missing:
        raise BackfillInputError(f"Snapshot is missing fields: {', '.join(missing)}")
    project_ref = snapshot.get("project_ref")
    revision = snapshot.get("catalog_revision")
    if not isinstance(project_ref, str) or not project_ref.strip():
        raise BackfillInputError("Snapshot project_ref must be a non-empty string")
    if not isinstance(revision, int) or revision < 0:
        raise BackfillInputError("Snapshot catalog_revision must be a non-negative integer")

    visible: dict[int, dict] = {}
    for row in snapshot["visible_movies"]:
        tmdb_id = _positive_id(row.get("tmdb_id"))
        title = row.get("english_title")
        if tmdb_id and isinstance(title, str):
            visible[tmdb_id] = {"tmdb_id": tmdb_id, "english_title": title}

    title_index: dict[tuple[str, str], set[int]] = defaultdict(set)
    title_records: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in snapshot["movie_titles"]:
        tmdb_id = _positive_id(row.get("tmdb_id"))
        title = row.get("title")
        language = row.get("language")
        if not tmdb_id or not isinstance(title, str):
            continue
        if language == "en":
            normalized = normalize_english(title)
        elif language == "he":
            normalized = normalize_hebrew(title)
        else:
            continue
        if normalized:
            title_index[(language, normalized)].add(tmdb_id)
            title_records[(language, normalized)].append({
                "source_tmdb_id": tmdb_id,
                "title": title,
                "language": language,
                "source": row.get("source"),
            })

    fixes: dict[str, set[int]] = defaultdict(set)
    fix_records: dict[str, list[dict]] = defaultdict(list)
    id_aliases: dict[int, set[int]] = defaultdict(set)
    for row in snapshot["title_fixes"]:
        tmdb_id = _positive_id(row.get("tmdb_id"))
        fixed_title = row.get("title_fix")
        if not tmdb_id or not isinstance(fixed_title, str) or not fixed_title.strip():
            continue
        source_id = _positive_id(fixed_title)
        if source_id:
            id_aliases[source_id].add(tmdb_id)
            fix_records[str(source_id)].append({
                "tmdb_id": tmdb_id,
                "title_fix": fixed_title,
                "source": "tableFixes",
                "kind": "numeric_tmdb_alias",
            })
        else:
            normalized = normalize_english(fixed_title)
            if normalized:
                fixes[normalized].add(tmdb_id)
                fix_records[normalized].append({
                    "tmdb_id": tmdb_id,
                    "title_fix": fixed_title,
                    "source": "tableFixes",
                    "kind": "title_override",
                })

    def canonical_ids(ids: set[int]) -> set[int]:
        result = set(ids)
        for _ in range(8):
            changed = False
            for tmdb_id in tuple(result):
                targets = id_aliases.get(tmdb_id, set())
                if targets and not targets.issubset(result):
                    result.remove(tmdb_id)
                    result.update(targets)
                    changed = True
            if not changed:
                break
        return result

    title_index = defaultdict(set, {key: canonical_ids(value) for key, value in title_index.items()})
    fixes = defaultdict(set, {key: canonical_ids(value) for key, value in fixes.items()})
    title_evidence: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for key, records in title_records.items():
        for record in records:
            for tmdb_id in sorted(canonical_ids({record["source_tmdb_id"]})):
                title_evidence[key].append({**record, "tmdb_id": tmdb_id})
        title_evidence[key] = sorted(
            {json.dumps(record, ensure_ascii=False, sort_keys=True): record for record in title_evidence[key]}.values(),
            key=lambda record: (record["tmdb_id"], record["source" or ""], record["title"]),
        )
    fix_evidence: dict[str, list[dict]] = defaultdict(list)
    for key, records in fix_records.items():
        for record in records:
            for tmdb_id in sorted(canonical_ids({record["tmdb_id"]})):
                fix_evidence[key].append({**record, "tmdb_id": tmdb_id})
        fix_evidence[key] = sorted(
            {json.dumps(record, ensure_ascii=False, sort_keys=True): record for record in fix_evidence[key]}.values(),
            key=lambda record: (record["tmdb_id"], record["title_fix"]),
        )
    return visible, title_index, fixes, canonical_ids, title_evidence, fix_evidence


def _run_times(snapshot: dict, run_directory: Path, summary_times: list[str]) -> list[datetime]:
    run_id = run_directory.name
    run_log_by_id = {str(row.get("run_id")): row for row in snapshot.get("run_logs", []) if isinstance(row, dict)}
    timestamps: list[datetime] = []
    run_log = run_log_by_id.get(run_id)
    if run_log:
        # utilRunLogs.date_created is a Jerusalem-local wall-clock timestamp.
        try:
            parsed = _as_utc(run_log.get("date_created"), naive_timezone=ZoneInfo("Asia/Jerusalem"))
        except Exception:
            parsed = None
        if parsed:
            timestamps.append(parsed)
    if not timestamps:
        timestamps.extend(value for item in summary_times if (value := _as_utc(item)))
    return timestamps


def build_report(
    snapshot: dict,
    artifacts_root: Path,
    *,
    as_of: datetime,
    lookback_days: int = 60,
) -> dict:
    if as_of.tzinfo is None:
        raise BackfillInputError("as_of must include a timezone")
    if lookback_days <= 0:
        raise BackfillInputError("lookback_days must be greater than zero")
    as_of = as_of.astimezone(timezone.utc)
    cutoff = as_of - timedelta(days=lookback_days)
    visible, title_index, fixes, _canonical_ids, title_evidence, fix_evidence = _snapshot_maps(snapshot)

    summary_aliases: list[dict] = []
    source_runs: dict[str, tuple[datetime, dict[str, Path]]] = {}
    run_success_by_id = {
        str(row.get("run_id")): row.get("successful")
        for row in snapshot.get("run_logs", [])
        if isinstance(row, dict)
    }
    excluded_runs: list[dict] = []
    malformed_files: list[dict] = []
    invalid_date_rows = 0
    files_used: dict[str, str] = {}
    for run_directory in sorted((path for path in artifacts_root.iterdir() if path.is_dir() and path.name.isdigit()), key=lambda path: int(path.name)):
        per_run_aliases, summary_times = _summary_aliases(run_directory)
        summary_aliases.extend(per_run_aliases)
        timestamps = _run_times(snapshot, run_directory, summary_times)
        if not timestamps:
            source_files = [path for path in (run_directory / "successful").glob("*.csv") if CSV_NAME.fullmatch(path.name)]
            if source_files:
                excluded_runs.append({"run_id": int(run_directory.name), "reason": "missing_run_timestamp"})
            continue
        observed_at = min(timestamps)
        if observed_at < cutoff or observed_at > as_of:
            continue

        selected_files: dict[str, tuple[int, Path]] = {}
        for path in (run_directory / "successful").glob("*.csv"):
            match = CSV_NAME.fullmatch(path.name)
            if not match:
                continue
            source = match.group("source")
            attempt = int(match.group("attempt"))
            if source not in selected_files or attempt > selected_files[source][0]:
                selected_files[source] = (attempt, path)
        source_runs[run_directory.name] = (observed_at, {source: path for source, (_, path) in selected_files.items()})

    historical_index: dict[str, set[int]] = defaultdict(set)
    historical_evidence: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for alias in summary_aliases:
        historical_index[alias["normalized_title"]].add(alias["tmdb_id"])
        historical_evidence[(alias["normalized_title"], alias["tmdb_id"])].append(alias)

    observations: dict[int, list[dict]] = defaultdict(list)
    ambiguous_observations: list[dict] = []
    unmatched_observations: list[dict] = []
    dated_row_count = 0
    for run_id_text, (observed_at, files) in source_runs.items():
        run_id = int(run_id_text)
        for source, path in sorted(files.items()):
            relative_path = path.as_posix()
            file_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            files_used[relative_path] = file_hash
            attempt = int(CSV_NAME.fullmatch(path.name).group("attempt"))  # type: ignore[union-attr]
            try:
                with path.open("r", encoding="utf-8-sig", newline="") as handle:
                    reader = csv.DictReader(handle)
                    headers = set(reader.fieldnames or [])
                    if not {"run_id", "release_date"}.issubset(headers):
                        raise BackfillInputError(f"{relative_path} is missing run_id or release_date columns")
                    for line_number, row in enumerate(reader, start=2):
                        row_run_id = _positive_id(row.get("run_id"))
                        if row_run_id != run_id:
                            malformed_files.append({"artifact": relative_path, "line": line_number, "reason": "run_id_mismatch"})
                            continue
                        release_date = _iso_date(row.get("release_date"))
                        if not release_date:
                            if (row.get("release_date") or "").strip():
                                invalid_date_rows += 1
                            continue
                        dated_row_count += 1
                        raw_titles = {
                            "en": row.get("english_title") or "",
                            "he": row.get("hebrew_title") or "",
                        }
                        normalized = {
                            "en": normalize_english(raw_titles["en"]),
                            "he": normalize_hebrew(raw_titles["he"]),
                        }
                        explicit_ids: set[int] = set()
                        for language in ("en", "he"):
                            key = normalized[language]
                            if key:
                                explicit_ids.update(fixes.get(key, set()) if language == "en" else set())
                        if explicit_ids:
                            candidate_ids = explicit_ids
                            match_method = "explicit_title_fix"
                            identity_evidence = [
                                item
                                for key in (normalized["en"],)
                                for item in fix_evidence.get(key, [])
                                if item["tmdb_id"] in candidate_ids
                            ]
                        else:
                            candidate_ids: set[int] = set()
                            match_methods: set[str] = set()
                            identity_evidence = []
                            for language in ("en", "he"):
                                key = normalized[language]
                                if not key:
                                    continue
                                ids = title_index.get((language, key), set())
                                if ids:
                                    candidate_ids.update(ids)
                                    match_methods.add(f"current_{language}_title_or_alias")
                                    identity_evidence.extend(
                                        item
                                        for item in title_evidence.get((language, key), [])
                                        if item["tmdb_id"] in ids
                                    )
                                if language == "en" and historical_index.get(key):
                                    candidate_ids.update(historical_index[key])
                                    match_methods.add("successful_tmdb_summary")
                            match_method = ",".join(sorted(match_methods))

                        evidence = {
                            "run_id": run_id,
                            "parent_run_successful": run_success_by_id.get(str(run_id)),
                            "observed_at": observed_at.isoformat(),
                            "source": source,
                            "attempt": attempt,
                            "release_date": release_date,
                            "english_title": raw_titles["en"],
                            "hebrew_title": raw_titles["he"],
                            "artifact": relative_path,
                            "artifact_sha256": file_hash,
                            "line": line_number,
                        }
                        if len(candidate_ids) != 1:
                            if len(candidate_ids) > 1:
                                ambiguous_observations.append({**evidence, "candidate_tmdb_ids": sorted(candidate_ids), "match_method": match_method})
                            else:
                                unmatched_observations.append(evidence)
                            continue

                        tmdb_id = next(iter(candidate_ids))
                        evidence["match_method"] = match_method
                        evidence["identity_evidence"] = sorted(
                            {json.dumps(item, ensure_ascii=False, sort_keys=True): item for item in identity_evidence}.values(),
                            key=lambda item: (
                                item.get("source") or "",
                                item.get("title") or item.get("title_fix") or "",
                            ),
                        )
                        evidence["summary_evidence"] = historical_evidence.get((normalized["en"], tmdb_id), [])
                        if tmdb_id in visible:
                            observations[tmdb_id].append(evidence)
            except UnicodeDecodeError as error:
                malformed_files.append({"artifact": relative_path, "reason": f"encoding_error: {error}"})

    stored_dates: dict[int, str] = {}
    for row in snapshot.get("release_dates", []):
        tmdb_id = _positive_id(row.get("tmdb_id"))
        release_date = _iso_date(str(row.get("local_release_date") or ""))
        if tmdb_id and release_date:
            stored_dates[tmdb_id] = release_date
    for row in snapshot.get("final_soon_dates", []):
        tmdb_id = _positive_id(row.get("tmdb_id"))
        release_date = _iso_date(str(row.get("release_date") or ""))
        if tmdb_id and release_date:
            # This is also the expected seed if the new table has not yet been migrated.
            stored_dates.setdefault(tmdb_id, release_date)

    ambiguous_by_movie: dict[int, list[dict]] = defaultdict(list)
    for row in ambiguous_observations:
        for tmdb_id in row["candidate_tmdb_ids"]:
            if tmdb_id in visible:
                ambiguous_by_movie[tmdb_id].append(row)

    movies: list[dict] = []
    for tmdb_id, movie in sorted(visible.items()):
        movie_observations = observations.get(tmdb_id, [])
        latest_observation_key = max(
            ((item["observed_at"], item["run_id"]) for item in movie_observations),
            default=None,
        )
        latest_run = latest_observation_key[1] if latest_observation_key else None
        latest = [
            item
            for item in movie_observations
            if (item["observed_at"], item["run_id"]) == latest_observation_key
        ] if latest_observation_key else []
        latest_dates = sorted({item["release_date"] for item in latest})
        base = {
            "tmdb_id": tmdb_id,
            "english_title": movie["english_title"],
            "stored_date": stored_dates.get(tmdb_id),
            "observation_count": len(movie_observations),
            "latest_run_id": latest_run,
            "latest_observations": latest,
        }
        if tmdb_id in stored_dates:
            movies.append({**base, "status": "already_has_date", "archive_dates": latest_dates})
        elif len(latest_dates) == 1:
            movies.append({**base, "status": "ready_to_insert", "proposed_date": latest_dates[0]})
        elif len(latest_dates) > 1:
            movies.append({**base, "status": "conflicting_latest_dates", "conflicting_dates": latest_dates})
        elif ambiguous_by_movie.get(tmdb_id):
            movies.append({**base, "status": "ambiguous_identity", "ambiguous_observations": ambiguous_by_movie[tmdb_id]})
        else:
            movies.append({**base, "status": "no_matching_history"})

    counts: dict[str, int] = defaultdict(int)
    for movie in movies:
        counts[movie["status"]] += 1
    eligible_parent_statuses = [run_success_by_id.get(run_id) for run_id in source_runs]
    snapshot_payload = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    artifact_root_relative = artifacts_root.as_posix()
    return {
        "format_version": 1,
        "project_ref": snapshot["project_ref"],
        "catalog_revision": snapshot["catalog_revision"],
        "snapshot_sha256": hashlib.sha256(snapshot_payload).hexdigest(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of": as_of.isoformat(),
        "lookback_days": lookback_days,
        "window_start": cutoff.isoformat(),
        "artifacts_root": artifact_root_relative,
        "input_summary": {
            "visible_movies": len(visible),
            "dated_scrape_observations": dated_row_count,
            "eligible_runs": len(source_runs),
            "eligible_parent_success_runs": sum(status is True for status in eligible_parent_statuses),
            "eligible_parent_failed_runs": sum(status is False for status in eligible_parent_statuses),
            "eligible_parent_status_unknown_runs": sum(status is None for status in eligible_parent_statuses),
            "files_used": len(files_used),
            "matched_current_movies": len(observations),
            "ambiguous_observations": len(ambiguous_observations),
            "unmatched_observations": len(unmatched_observations),
            "invalid_release_date_rows": invalid_date_rows,
            "excluded_runs": excluded_runs,
            "malformed_files_or_rows": malformed_files,
            "file_sha256": files_used,
        },
        "counts": dict(sorted(counts.items())),
        "movies": movies,
        "ambiguous_observations": ambiguous_observations,
        "unmatched_observation_samples": unmatched_observations[:500],
    }


def generate_apply_sql(report: dict) -> str:
    candidates = [movie for movie in report["movies"] if movie["status"] == "ready_to_insert"]
    header = (
        "-- Generated by backfill_movie_release_dates.py; review the JSON/CSV report first.\n"
        f"-- Target Supabase project: {report['project_ref']}\n"
        f"-- Source snapshot SHA-256: {report['snapshot_sha256']}\n"
        f"-- Required pipeline catalog revision: {report['catalog_revision']}\n"
    )
    if not candidates:
        return header + "-- No missing, unambiguous historical dates are eligible for insertion.\n"

    values = ",\n      ".join(
        f"({int(movie['tmdb_id'])}, DATE '{_iso_date(movie['proposed_date'])}')"
        for movie in sorted(candidates, key=lambda item: int(item["tmdb_id"]))
    )
    return header + f"""DO $movie_release_date_backfill$
DECLARE
  expected_revision bigint := {int(report['catalog_revision'])};
  current_revision bigint;
  expected_insert_count integer;
  actual_insert_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(candidate.tmdb_id::bigint)
  FROM (VALUES
      {values}
  ) AS candidate(tmdb_id, local_release_date)
  ORDER BY candidate.tmdb_id;

  SELECT revision INTO current_revision
  FROM public.pipeline_catalog_revision
  WHERE singleton
  FOR UPDATE;

  IF current_revision IS DISTINCT FROM expected_revision THEN
    RAISE EXCEPTION 'Backfill snapshot is stale: expected catalog revision %, found %', expected_revision, current_revision;
  END IF;

  SELECT count(*) INTO expected_insert_count
  FROM (VALUES
      {values}
  ) AS candidate(tmdb_id, local_release_date)
  JOIN public.\"finalMovies\" AS movie
    ON movie.tmdb_id = candidate.tmdb_id AND movie.solo_update = false
  LEFT JOIN public.movie_release_dates AS existing
    ON existing.tmdb_id = candidate.tmdb_id
  WHERE existing.tmdb_id IS NULL;

  INSERT INTO public.movie_release_dates (tmdb_id, local_release_date)
  SELECT candidate.tmdb_id, candidate.local_release_date
  FROM (VALUES
      {values}
  ) AS candidate(tmdb_id, local_release_date)
  JOIN public.\"finalMovies\" AS movie
    ON movie.tmdb_id = candidate.tmdb_id AND movie.solo_update = false
  LEFT JOIN public.movie_release_dates AS existing
    ON existing.tmdb_id = candidate.tmdb_id
  WHERE existing.tmdb_id IS NULL
  ORDER BY candidate.tmdb_id
  ON CONFLICT (tmdb_id) DO NOTHING;

  GET DIAGNOSTICS actual_insert_count = ROW_COUNT;
  IF actual_insert_count <> expected_insert_count THEN
    RAISE EXCEPTION 'Backfill inserted % dates; expected %', actual_insert_count, expected_insert_count;
  END IF;
END;
$movie_release_date_backfill$;
"""


def write_report(report: dict, output_directory: Path) -> None:
    output_directory.mkdir(parents=True, exist_ok=True)
    (output_directory / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (output_directory / "movies.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["tmdb_id", "english_title", "status", "stored_date", "proposed_date", "latest_run_id", "observation_count"])
        writer.writeheader()
        for movie in report["movies"]:
            writer.writerow({key: movie.get(key) for key in writer.fieldnames})
    (output_directory / "apply.sql").write_text(generate_apply_sql(report), encoding="utf-8")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, required=True, help="Read-only Supabase JSON snapshot")
    parser.add_argument("--artifacts-root", type=Path, default=DEFAULT_ARTIFACT_ROOT)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--as-of", help="Timezone-aware ISO timestamp; defaults to the current UTC time")
    parser.add_argument("--lookback-days", type=int, default=60)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    as_of = _as_utc(args.as_of) if args.as_of else datetime.now(timezone.utc)
    if as_of is None:
        raise BackfillInputError("--as-of must be a timezone-aware ISO timestamp")
    report = build_report(snapshot, args.artifacts_root, as_of=as_of, lookback_days=args.lookback_days)
    write_report(report, args.output_dir)
    summary_fields = (
        "visible_movies",
        "dated_scrape_observations",
        "eligible_runs",
        "eligible_parent_success_runs",
        "eligible_parent_failed_runs",
        "eligible_parent_status_unknown_runs",
        "files_used",
        "matched_current_movies",
        "ambiguous_observations",
        "unmatched_observations",
        "invalid_release_date_rows",
    )
    summary = {key: report["input_summary"][key] for key in summary_fields}
    print(json.dumps({"report": str(args.output_dir / "report.json"), "sql": str(args.output_dir / "apply.sql"), "counts": report["counts"], "input_summary": summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
