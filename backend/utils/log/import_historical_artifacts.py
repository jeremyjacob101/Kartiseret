"""Manually import legacy Git-tracked run artifacts, newest completed runs first.

This tool is deliberately opt-in and never schedules its own continuation.
The default is a read-only plan; pass --apply to write to the selected D1/R2
environment. Every row and file is idempotent, so a later manual invocation
can safely skip already-imported material and continue after an operator review.
"""

from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
from zoneinfo import ZoneInfo

if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.utils.log.cloudflare_storage import redact_secrets
from backend.utils.log.run_storage import RunArtifactStore, optimize_screenshot


DEFAULT_ARTIFACTS_ROOT = Path("backend/utils/log/logger_artifacts")
DEFAULT_CRON_ROOT = Path("backend/config/cron")
MAX_IMPORT_LOOKBACK_DAYS = 36500
DEFAULT_D1_WRITE_BUDGET = 20_000
MAX_D1_WRITE_BUDGET = 60_000
# The current schema writes one table row and two secondary-index rows per
# scraped row. Reserve an extra write per row/artifact/run so modest schema
# additions cannot consume the free-plan daily budget unexpectedly.
CONSERVATIVE_ROW_WRITE_ESTIMATE = 4
CONSERVATIVE_ARTIFACT_WRITE_ESTIMATE = 4
CONSERVATIVE_RUN_WRITE_ESTIMATE = 3
MAX_FILE_BYTES = 50 * 1024 * 1024
RUN_DIRECTORY_RE = re.compile(r"^\d+$")
ATTEMPT_RE = re.compile(r"-(?P<attempt>\d+)(?:-gathering_info)?\.csv\Z")
CRON_DATE_RE = re.compile(
    r"cron_(?P<schedule>daily|weekly)_(?P<date>\d{4}-\d{2}-\d{2})_"
    r"(?P<hour>\d{2})-(?P<minute>\d{2})-(?P<second>\d{2})"
)


def _run_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("Asia/Jerusalem"))
    return parsed.astimezone(timezone.utc)


def _status(run: dict) -> str:
    if run.get("running_now") is True:
        return "running"
    successful = run.get("successful")
    return "successful" if successful is True else "failed" if successful is False else "unconfirmed"


def _match_cron_run(path: Path, run_logs: list[dict]) -> tuple[dict, datetime] | None:
    """Associate a dated local cron transcript with one Supabase run."""
    match = CRON_DATE_RE.search(path.name)
    if not match:
        return None
    try:
        local_started = datetime(
            *map(int, match.group("date").split("-")),
            int(match.group("hour")), int(match.group("minute")), int(match.group("second")),
            tzinfo=ZoneInfo("Asia/Jerusalem"),
        ).astimezone(timezone.utc)
    except ValueError:
        return None
    expected_source = f"JJ_INTEL_MAC_{match.group('schedule').upper()}_RUN"
    possible = []
    for run in run_logs:
        timestamp = _run_time(run.get("date_created"))
        if timestamp is None:
            continue
        run_source = str(run.get("run_from") or "")
        if run_source and run_source != expected_source:
            continue
        delay = (timestamp - local_started).total_seconds()
        # The local filename is generated just before the runner allocates its
        # Supabase ID. A small negative skew is allowed for clock differences.
        if -60 <= delay <= 30 * 60:
            possible.append((delay, run, timestamp))
    if not possible:
        return None
    possible.sort(key=lambda item: item[0])
    if len(possible) > 1 and possible[0][0] == possible[1][0]:
        return None
    _delay, run, timestamp = possible[0]
    return run, timestamp


def _csv_identity(path: Path) -> tuple[str, int]:
    if path.name.endswith("-gathering_info.csv"):
        scraper = path.name.split("-ThreadPoolExecutor", 1)[0]
        return scraper or "HistoricalGatheringInfo", 1
    match = ATTEMPT_RE.search(path.name)
    if match:
        scraper = path.name[:match.start()]
        if scraper.endswith("-ThreadPoolExecutor"):
            scraper = scraper.removesuffix("-ThreadPoolExecutor")
        # Captured browser/thread names are not stable scraper identifiers.
        if "-ThreadPoolExecutor" in scraper:
            scraper = scraper.split("-ThreadPoolExecutor", 1)[0]
        return scraper or "HistoricalCSV", int(match.group("attempt"))
    return path.stem or "HistoricalCSV", 1


def _csv_rows(path: Path, run_id: int) -> list[dict]:
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError("file exceeds the 50 MiB import safety limit")
    output = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row")
        if len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("CSV has duplicate header names")
        for line_number, raw in enumerate(reader, start=2):
            row = {str(key): value for key, value in raw.items() if key is not None and key}
            if raw.get(None):
                row["_extra_csv_values"] = raw[None]
            source_run_id = str(row.get("run_id") or "").strip()
            if source_run_id and source_run_id != str(run_id):
                raise ValueError(f"row {line_number} has run_id {source_run_id}, expected {run_id}")
            row["run_id"] = str(run_id)
            output.append(row)
    return output


def _historical_text_metadata(path: Path, text: str, outcome: str) -> dict:
    metadata = {"legacy_path": path.as_posix(), "outcome": outcome}
    fields = {"Name": "item_name", "URL": "url", "Exception": "error_message",
              "Call Chain": "call_chain", "Selector": "selector"}
    for line in text.splitlines():
        key, sep, value = line.partition(": ")
        if sep and key in fields and fields[key] not in metadata:
            metadata[fields[key]] = value
    if metadata.get("error_message"):
        error_type, separator, _message = metadata["error_message"].partition(" - ")
        if separator:
            metadata["exception_type"] = error_type
    if path.suffix.lower() == ".json":
        try:
            document = json.loads(text)
            if isinstance(document, dict) and document.get("publication_id"):
                metadata.update({key: document[key] for key in ("publication_id", "category", "fingerprint", "part_count") if key in document})
        except ValueError:
            pass
    match = re.search(r"-(\d+)(?:-summary)?\.(?:txt|log)$", path.name)
    if match:
        metadata["attempt"] = int(match.group(1))
    summary_match = re.match(r"(.+)-(\d+)-summary\.txt\Z", path.name)
    if summary_match:
        metadata.update(name=summary_match.group(1), attempt=int(summary_match.group(2)),
                        successful=outcome == "successful", publication_pending=outcome == "prepared")
    return metadata


def scan_import_candidates(
    *,
    run_logs: list[dict],
    artifacts_root: Path = DEFAULT_ARTIFACTS_ROOT,
    cron_root: Path = DEFAULT_CRON_ROOT,
    as_of: datetime | None = None,
    lookback_days: int = MAX_IMPORT_LOOKBACK_DAYS,
) -> tuple[list[dict], list[dict]]:
    if lookback_days < 1 or lookback_days > MAX_IMPORT_LOOKBACK_DAYS:
        raise ValueError("Historical import lookback must be between 1 and 36500 days.")
    as_of = as_of or datetime.now(timezone.utc)
    if as_of.tzinfo is None:
        raise ValueError("as_of must be timezone-aware")
    as_of = as_of.astimezone(timezone.utc)
    cutoff = as_of - timedelta(days=lookback_days)
    by_id = {
        str(item.get("run_id")): item
        for item in run_logs
        if isinstance(item, dict) and item.get("run_id") is not None
    }
    candidates: list[dict] = []
    unresolved: list[dict] = []

    if artifacts_root.exists():
        for run_directory in artifacts_root.iterdir():
            if not run_directory.is_dir() or not RUN_DIRECTORY_RE.fullmatch(run_directory.name):
                continue
            run_id = int(run_directory.name)
            run = by_id.get(str(run_id))
            timestamp = _run_time(run.get("date_created")) if run else None
            if not timestamp:
                unresolved.append({"path": run_directory.as_posix(), "reason": "run_id_or_timestamp_not_in_utilRunLogs"})
                continue
            if timestamp < cutoff or timestamp > as_of:
                continue
            if run.get("running_now") is not False:
                unresolved.append({"path": run_directory.as_posix(), "reason": "run_is_running_or_not_confirmed_complete"})
                continue
            status = _status(run)
            files = sorted(
                (path for path in run_directory.rglob("*") if path.is_file() and not path.is_symlink()),
                key=lambda path: path.as_posix(),
            )
            for path in files:
                if path.name == ".job_ok" or path.name == ".last_run_id":
                    continue
                relative = path.relative_to(run_directory)
                group = relative.parts[0] if len(relative.parts) > 1 else ""
                outcome = "successful" if group == "successful" else "unsuccessful" if group == "unsuccessful" else "unconfirmed"
                if path.suffix.lower() == ".csv" and path.name.endswith("-gathering_info.csv"):
                    candidates.append({
                        "kind": "gathering_csv", "path": path, "run_id": run_id,
                        "run": run, "run_time": timestamp, "run_status": status,
                        "outcome": outcome,
                    })
                elif path.suffix.lower() == ".csv":
                    if group not in {"successful", "unsuccessful"}:
                        unresolved.append({"path": path.as_posix(), "reason": "CSV_has_no_explicit_attempt_outcome"})
                        continue
                    candidates.append({
                        "kind": "csv", "path": path, "run_id": run_id,
                        "run": run, "run_time": timestamp, "run_status": status,
                        "outcome": outcome,
                    })
                elif path.suffix.lower() in {".txt", ".json", ".md", ".log"}:
                    candidates.append({
                        "kind": "text", "path": path, "run_id": run_id,
                        "run": run, "run_time": timestamp, "run_status": status,
                        "outcome": outcome,
                    })
                elif path.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}:
                    candidates.append({
                        "kind": "image", "path": path, "run_id": run_id,
                        "run": run, "run_time": timestamp, "run_status": status,
                        "outcome": outcome,
                    })
                else:
                    unresolved.append({"path": path.as_posix(), "reason": "unsupported_file_type"})

    if cron_root.exists():
        for path in cron_root.rglob("*.log"):
            if not path.is_file() or path.is_symlink():
                continue
            match = CRON_DATE_RE.search(path.name)
            if not match:
                unresolved.append({"path": path.as_posix(), "reason": "cron_log_has_no_parseable_run_date"})
                continue
            association = _match_cron_run(path, run_logs)
            if association is None:
                unresolved.append({"path": path.as_posix(), "reason": "cron_log_run_id_could_not_be_determined"})
                continue
            run, timestamp = association
            if cutoff <= timestamp <= as_of:
                candidates.append({
                    "kind": "text", "path": path, "run_id": int(run["run_id"]),
                    "run": run, "run_time": timestamp, "run_status": _status(run),
                    "outcome": "unsuccessful" if "failed" in path.name.lower() else "successful",
                    "artifact_type": "cron_output",
                })

    for item in candidates:
        path = item["path"]
        if path.is_relative_to(artifacts_root):
            item["source_key"] = "logger_artifacts/" + path.relative_to(artifacts_root).as_posix()
        else:
            item["source_key"] = "cron/" + path.relative_to(cron_root).as_posix()
    candidates.sort(key=lambda item: (item["run_time"], item["source_key"]), reverse=True)
    return candidates, unresolved


def _run_record(candidate: dict, target: str) -> dict:
    run = candidate["run"] or {}
    started = candidate["run_time"].isoformat()
    return {
        "run_id": candidate["run_id"], "target": target,
        "run_from": run.get("run_from") or "historical_import",
        "status": candidate["run_status"], "started_at": started,
        "finished_at": started if run.get("running_now") is False else None,
        "total_time": run.get("total_time"),
        "selected_runners": run.get("selected_runners") or [],
        # Protect a freshly imported old run from cleanup while its files are published.
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def import_candidates(
    *, store: RunArtifactStore, candidates: list[dict], target: str,
    write_budget: int = DEFAULT_D1_WRITE_BUDGET, dry_run: bool = False, size_check=None,
) -> dict:
    if write_budget < 1 or write_budget > MAX_D1_WRITE_BUDGET:
        raise ValueError(f"write_budget must be between 1 and {MAX_D1_WRITE_BUDGET} writes")
    result = {
        "candidate_count": len(candidates), "imported_runs": 0, "imported_csv_files": 0,
        "imported_rows": 0, "imported_artifacts": 0, "d1_rows_written": 0,
        "skipped_due_to_budget": [], "unresolved_files": [], "dry_run": dry_run,
        "write_budget": write_budget, "imported_files": [], "write_outcome_unknown": False,
    }
    if dry_run:
        return result

    inserted_runs: set[int] = set()
    for index, candidate in enumerate(candidates):
        run_id = candidate["run_id"]
        path = candidate["path"]
        source_key = candidate.get("source_key") or path.as_posix()
        try:
            prepared_rows = _csv_rows(path, int(run_id)) if candidate["kind"] in {"csv", "gathering_csv"} else None
            prepared_bytes = None
            prepared_text = None
            if candidate["kind"] == "image":
                if path.stat().st_size > MAX_FILE_BYTES:
                    raise ValueError("file exceeds the 50 MiB import safety limit")
                prepared_bytes = path.read_bytes()
            elif candidate["kind"] == "text":
                if path.stat().st_size > MAX_FILE_BYTES:
                    raise ValueError("file exceeds the 50 MiB import safety limit")
                prepared_text = redact_secrets(path.read_text(encoding="utf-8", errors="replace"))
        except Exception as error:
            result["unresolved_files"].append({"path": path.as_posix(), "reason": type(error).__name__})
            continue

        expected = (
            len(prepared_rows or []) * CONSERVATIVE_ROW_WRITE_ESTIMATE
            if prepared_rows is not None else CONSERVATIVE_ARTIFACT_WRITE_ESTIMATE
        )
        if prepared_text is not None:
            expected *= max(1, (len(json.dumps(prepared_text).encode("utf-8")) + 599_999) // 600_000)
        run_number = int(run_id) if run_id is not None else None
        run_writes_estimate = (
            CONSERVATIVE_RUN_WRITE_ESTIMATE
            if run_number is not None and run_number not in inserted_runs else 0
        )
        if result["d1_rows_written"] + expected + run_writes_estimate > write_budget:
            result["skipped_due_to_budget"] = [item["path"].as_posix() for item in candidates[index:]]
            break

        try:
            if run_number is not None and run_number not in inserted_runs:
                result["d1_rows_written"] += store.insert_imported_run(_run_record(candidate, target))
                if getattr(store, "_last_imported_run_changed", 1):
                    result["imported_runs"] += 1
                inserted_runs.add(run_number)
            original_date = candidate["run_time"].isoformat()
            if candidate["kind"] == "csv":
                scraper, attempt = _csv_identity(path)
                for start in range(0, len(prepared_rows or []), 25):
                    batch = [{**row, "_legacy_path": source_key} for row in prepared_rows[start:start + 25]]
                    result["d1_rows_written"] += store.save_scraped_rows(
                        run_id=run_number, scraper=scraper, attempt=attempt,
                        successful=candidate["outcome"] == "successful", rows=batch,
                        insert_only=True, batch_size=25, row_order_start=start, identity_namespace=source_key,
                    )
                    result["imported_rows"] += getattr(store, "_last_scraped_rows_changed", len(batch))
                result["imported_csv_files"] += 1
            elif candidate["kind"] == "image":
                content = prepared_bytes or b""
                if path.suffix.lower() == ".png":
                    upload, image_type, compression = optimize_screenshot(content)
                else:
                    image_type = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(path.suffix.lower(), "application/octet-stream")
                    upload, compression = content, {}
                artifact = store.save_file_artifact(
                    run_id=run_number, artifact_type="historical_screenshot", name=source_key,
                    content=upload, content_type=image_type,
                    metadata={"legacy_path": path.as_posix(), "outcome": candidate["outcome"], **compression},
                    created_at=original_date, compress_screenshot=False,
                )
                result["d1_rows_written"] += artifact.get("d1_rows_written", 0)
                if getattr(store, "_last_artifact_rows_changed", 1):
                    result["imported_artifacts"] += 1
            elif candidate["kind"] == "gathering_csv":
                scraper, _attempt = _csv_identity(path)
                result["d1_rows_written"] += store.save_gathering_rows(
                    run_id=run_number, scraper=scraper, source_file=source_key, rows=prepared_rows or [],
                )
                result["imported_rows"] += getattr(store, "_last_gathering_rows_changed", len(prepared_rows or []))
                result["imported_csv_files"] += 1
            else:
                artifact_type = candidate.get("artifact_type") or (
                    "dataflow_summary" if path.name.endswith("-summary.txt") else
                    "publication_receipt" if path.name.startswith("publication_") and path.suffix.lower() == ".json" else
                    "historical_log"
                )
                writes = store.save_text_artifact(
                    run_id=run_number, artifact_type=artifact_type, name=path.name,
                    text=prepared_text or "", metadata=_historical_text_metadata(path, prepared_text or "", candidate["outcome"]),
                    created_at=original_date, identity_namespace=source_key,
                )
                result["d1_rows_written"] += writes
                if getattr(store, "_last_artifact_rows_changed", 1):
                    result["imported_artifacts"] += 1
            result["imported_files"].append(path.as_posix())
        except Exception as error:
            result["unresolved_files"].append({"path": path.as_posix(), "reason": type(error).__name__})
            result["write_outcome_unknown"] = True
            result["skipped_due_to_budget"] = [item["path"].as_posix() for item in candidates[index + 1:]]
            break
        if size_check is not None:
            try:
                size = size_check()
                if size >= 350_000_000:
                    raise RuntimeError("D1 storage reached the cleanup threshold")
            except Exception as error:
                result["stop_reason"] = f"storage_check:{type(error).__name__}"
                result["skipped_due_to_budget"] = [item["path"].as_posix() for item in candidates[index + 1:]]
                break
    return result


def _read_recent_util_run_logs(target: str, since: datetime) -> list[dict]:
    from dotenv import load_dotenv
    from supabase import create_client
    from backend.config.target_environment import resolve_target_environment

    load_dotenv()
    selected = resolve_target_environment(target, os.environ)
    os.environ.update(selected)
    client = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
    utc_since = since.astimezone(timezone.utc).isoformat()
    output: list[dict] = []
    start = 0
    while True:
        page = client.table("utilRunLogs").select(
            "run_id,date_created,running_now,successful,run_from,total_time,selected_runners"
        ).gte("date_created", utc_since).order("date_created").range(start, start + 499).execute().data or []
        output.extend(page)
        if len(page) < 500:
            break
        start += 500
    return output


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), required=True)
    parser.add_argument("--artifacts-root", type=Path, default=DEFAULT_ARTIFACTS_ROOT)
    parser.add_argument("--cron-root", type=Path, default=DEFAULT_CRON_ROOT)
    parser.add_argument("--lookback-days", type=int, choices=range(1, MAX_IMPORT_LOOKBACK_DAYS + 1), default=3650, metavar="DAYS")
    parser.add_argument("--write-budget", type=int, choices=range(1, MAX_D1_WRITE_BUDGET + 1), default=DEFAULT_D1_WRITE_BUDGET, metavar="WRITES")
    parser.add_argument("--account-writes-used", type=int, help="Current account-wide UTC-day D1 row writes from Cloudflare metrics; required with --apply")
    parser.add_argument("--apply", action="store_true", help="Write to the selected D1 database and private artifact bucket; default is a plan only")
    parser.add_argument("--as-of", help="Timezone-aware ISO timestamp for reproducible dry-runs")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    as_of = datetime.fromisoformat(args.as_of.replace("Z", "+00:00")) if args.as_of else datetime.now(timezone.utc)
    if as_of.tzinfo is None:
        raise ValueError("--as-of must include a timezone")
    cutoff = as_of.astimezone(timezone.utc) - timedelta(days=args.lookback_days)
    run_logs = _read_recent_util_run_logs(args.target, cutoff)
    candidates, unresolved = scan_import_candidates(
        run_logs=run_logs, artifacts_root=args.artifacts_root, cron_root=args.cron_root,
        as_of=as_of, lookback_days=args.lookback_days,
    )
    if args.apply:
        if args.account_writes_used is None or args.account_writes_used < 0:
            raise ValueError("--apply requires the current account-wide --account-writes-used from Cloudflare metrics")
        safe_budget = max(0, min(MAX_D1_WRITE_BUDGET, 100_000 - 40_000 - args.account_writes_used))
        if not safe_budget:
            raise ValueError("No D1 write capacity remains after reserving 40,000 writes for normal work")
        from dotenv import load_dotenv
        from backend.config.target_environment import resolve_target_environment
        load_dotenv()
        os.environ.update(resolve_target_environment(args.target, os.environ))
        store = RunArtifactStore()
        store.ensure_schema()
        store.check_storage()
        lease = store.acquire_run_lease()
        try:
            summary = import_candidates(
                store=store, candidates=candidates, target=args.target,
                write_budget=min(args.write_budget, safe_budget), dry_run=False,
                size_check=store.d1.measure_database_size,
            )
        finally:
            store.release_run_lease(token=lease)
    else:
        summary = {
            "candidate_count": len(candidates), "imported_runs": 0,
            "imported_csv_files": 0, "imported_rows": 0,
            "imported_artifacts": 0, "d1_rows_written": 0,
            "skipped_due_to_budget": [], "unresolved_files": [],
            "dry_run": True, "write_budget": args.write_budget,
        }
    summary.update({
        "target": args.target,
        "window_start": cutoff.isoformat(),
        "as_of": as_of.astimezone(timezone.utc).isoformat(),
        "unresolved_run_or_date_files": unresolved,
        "candidate_paths": [candidate["path"].as_posix() for candidate in candidates],
        "mode": "apply" if args.apply else "dry_run",
    })
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not summary.get("unresolved_files") and not summary.get("stop_reason") else 2


if __name__ == "__main__":
    raise SystemExit(main())
