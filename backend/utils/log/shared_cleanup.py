"""Cross-run, target-isolated cleanup guarded by the shared D1 lease.

The CLI defaults to dry-run. Pipeline startup also defaults to dry-run until
KARTISERET_SHARED_CLEANUP_APPLY=true is explicitly configured after rollout
verification. D1 size retention keeps its existing independent safeguards.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import time

from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.utils.log.cloudflare_storage import CloudflareStorageError, recovery_root
from backend.utils.log.run_storage import RunArtifactStore


RUN_OBJECT_KEY_RE = re.compile(r"^runs/(\d{4}-\d{2}-\d{2})/(\d+)/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
R2_DELETE_BATCH = 500
PUBLICATION_DELETE_BATCH = 100
CATALOG_SCAN_CATEGORIES = ("nowplayings", "soons", "cinematheques")


def lease_renewal_callback(store: RunArtifactStore, token: str, *, interval_seconds: float = 60.0):
    """Renew a target lease periodically without one D1 write per catalog row."""
    if interval_seconds <= 0:
        raise ValueError("Lease renewal interval must be positive")
    last_renewal = time.monotonic() - interval_seconds

    def renew_or_fail() -> None:
        from backend.utils.log.cloudflare_storage import LeaseLostError
        try:
            store.renew_run_lease(token)
        except Exception as error:
            raise LeaseLostError("Target lease lost or ownership could not be confirmed; job stopped") from error

    def renew() -> None:
        nonlocal last_renewal
        current = time.monotonic()
        if current - last_renewal >= interval_seconds:
            renew_or_fail()
            last_renewal = current

    def verify() -> None:
        nonlocal last_renewal
        renew_or_fail()
        last_renewal = time.monotonic()

    renew.verify = verify
    return renew


def verify_lease(guard) -> None:
    if guard:
        getattr(guard, "verify", guard)()


def cleanup_abandoned_publications(client, *, apply: bool, lease_guard=None) -> dict[str, int]:
    """Inspect or prune inactive prepared publications under the target lease."""
    eligible: int | None = None
    deleted = 0
    while True:
        verify_lease(lease_guard)
        response = client.rpc(
            "prune_abandoned_publications", {"p_apply": apply}
        ).execute()
        result = getattr(response, "data", None)
        if (
            not isinstance(result, dict)
            or isinstance(result.get("eligible"), bool)
            or not isinstance(result.get("eligible"), int)
            or isinstance(result.get("deleted"), bool)
            or not isinstance(result.get("deleted"), int)
            or result["eligible"] < 0
            or not 0 <= result["deleted"] <= PUBLICATION_DELETE_BATCH
        ):
            raise RuntimeError("Publication cleanup returned an invalid result")
        if eligible is None:
            eligible = result["eligible"]
        batch_deleted = result["deleted"]
        deleted += batch_deleted
        if not apply or batch_deleted == 0 or result["eligible"] <= batch_deleted:
            break
    return {"eligible": eligible or 0, "deleted": deleted}


def current_run_lease_guard():
    """Return a throttled renewer when called inside the active pipeline run."""
    try:
        from backend.utils.log import run_logging

        store = run_logging.CURRENT_RUN_STORE
        token = run_logging.CURRENT_RUN_LEASE_TOKEN
    except Exception:
        return None
    if store is None or not token:
        return None
    return lease_renewal_callback(store, token)


def _cleanup_apply_from_environment() -> bool:
    raw = os.environ.get("KARTISERET_SHARED_CLEANUP_APPLY", "false").strip().lower()
    if raw not in {"true", "false"}:
        raise ValueError("KARTISERET_SHARED_CLEANUP_APPLY must be 'true' or 'false'")
    return raw == "true"


def _print_r2_budget_summary() -> None:
    try:
        from backend.utils.log.r2_budget import R2Budget

        budget = R2Budget.from_environment()
        if budget is not None:
            usage = budget.snapshot()
            print(
                "R2 job budget: "
                f"Class A {usage['class_a']}/{budget.class_a_limit}, "
                f"Class B {usage['class_b']}/{budget.class_b_limit}, "
                f"tripped={usage['tripped'] or 'no'}"
            )
            from backend.utils.log.r2_storage_guard import storage_summary
            storage = storage_summary()
            if storage is not None:
                print("R2 storage guard: " + json.dumps(storage, sort_keys=True))
    except Exception as error:
        print(f"R2 job budget summary unavailable ({type(error).__name__}).", file=sys.stderr)


@contextmanager
def maintenance_lease(*, skip_if_busy: bool = False):
    """Give standalone maintenance a fresh R2 budget and the target's D1 lease."""
    from backend.utils.log.r2_budget import initialize_job_budget

    initialize_job_budget()
    try:
        store = RunArtifactStore()
        store.ensure_schema()
        try:
            token = store.acquire_run_lease()
        except CloudflareStorageError as error:
            if skip_if_busy and "Another scraper run holds" in str(error):
                yield None
                return
            raise
        try:
            from backend.utils.log.job_lease import reconcile_predecessor
            reconcile_predecessor(store)
            from backend.utils.log.r2_storage_guard import initialize_storage_guard
            initialize_storage_guard(store)
            yield store, token
        finally:
            store.release_run_lease(token=token)
    finally:
        _print_r2_budget_summary()


def _supabase_client():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError("Selected target Supabase credentials are incomplete")
    from backend.utils.log.job_lease import create_client

    return create_client(url, key)


def _strict_d1_rows(result, description: str) -> list[dict]:
    """Reject filtered or malformed D1 row payloads before reference cleanup."""
    raw_rows = result.raw.get("results") if isinstance(result.raw, dict) else None
    if (
        not isinstance(raw_rows, list)
        or any(not isinstance(row, dict) for row in raw_rows)
        or len(raw_rows) != len(result.rows)
    ):
        raise CloudflareStorageError(f"D1 {description} scan is incomplete or malformed")
    return raw_rows


def _scan_run_states(store: RunArtifactStore, *, lease_guard=None) -> dict[int, str]:
    states: dict[int, str] = {}
    cursor = 0
    while True:
        if lease_guard:
            lease_guard()
        result = store.d1.execute(
            "SELECT run_id, status FROM run_logs WHERE run_id > ? ORDER BY run_id LIMIT 500",
            (cursor,),
        )
        rows = _strict_d1_rows(result, "run-state")
        for row in rows:
            try:
                if isinstance(row.get("run_id"), bool):
                    raise ValueError("boolean run id")
                run_id = int(row["run_id"])
                status = row["status"]
            except (KeyError, TypeError, ValueError) as error:
                raise CloudflareStorageError("D1 run-state scan is incomplete or malformed") from error
            if run_id <= cursor or status not in {"running", "successful", "failed", "unconfirmed"}:
                raise CloudflareStorageError("D1 run-state scan is incomplete or malformed")
            states[run_id] = status
            cursor = run_id
        if len(rows) < 500:
            return states


def _scan_artifact_references(store: RunArtifactStore, *, lease_guard=None) -> set[str]:
    keys: set[str] = set()
    cursor = ""
    while True:
        if lease_guard:
            lease_guard()
        result = store.d1.execute(
            "SELECT artifact_id, run_id, object_key FROM artifacts "
            "WHERE artifact_id > ? ORDER BY artifact_id LIMIT 500",
            (cursor,),
        )
        rows = _strict_d1_rows(result, "artifact-reference")
        for row in rows:
            try:
                artifact_id = row["artifact_id"]
                object_key = row["object_key"] or ""
                run_id = row["run_id"]
            except (AttributeError, KeyError) as error:
                raise CloudflareStorageError("D1 artifact-reference scan is incomplete or malformed") from error
            if not isinstance(artifact_id, str) or artifact_id <= cursor:
                raise CloudflareStorageError("D1 artifact-reference scan is incomplete or malformed")
            cursor = artifact_id
            if not object_key:
                continue
            if not isinstance(object_key, str):
                raise CloudflareStorageError("D1 artifact-reference scan contains a malformed object key")
            match = RUN_OBJECT_KEY_RE.fullmatch(object_key)
            try:
                row_run_id = int(run_id)
            except (TypeError, ValueError) as error:
                raise CloudflareStorageError("D1 artifact-reference scan has an unknown run owner") from error
            if not match or int(match.group(2)) != row_run_id:
                raise CloudflareStorageError("D1 artifact-reference scan contains an invalid R2 key")
            keys.add(object_key)
        if len(rows) < 500:
            return keys


def _recoverable_run_ids() -> set[int]:
    """Find locally spooled run output; unreadable recovery state blocks deletion."""
    root = recovery_root()
    try:
        root.stat()
    except FileNotFoundError:
        return set()
    except OSError as error:
        raise CloudflareStorageError("Recovery state could not be inspected; screenshot deletion was skipped") from error
    recoverable: set[int] = set()
    relevant = {"file_artifacts", "text_artifacts", "diagnostics", "run_finalization", "scraped_rows", "scraped_snapshots", "gathering_rows"}
    for kind in relevant:
        directory = root / kind
        try:
            entries = list(directory.iterdir())
        except FileNotFoundError:
            continue
        except OSError as error:
            raise CloudflareStorageError("Recovery state could not be inspected; screenshot deletion was skipped") from error
        for path in entries:
            if path.suffix != ".json":
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise CloudflareStorageError("A recovery envelope could not be inspected; screenshot deletion was skipped") from error
            raw_id = payload.get("run_id") if isinstance(payload, dict) else None
            if raw_id is None:
                match = re.match(r"(\d+)(?:-|$)", path.stem)
                raw_id = match.group(1) if match else None
            try:
                recoverable.add(int(raw_id))
            except (TypeError, ValueError) as error:
                raise CloudflareStorageError("A recovery envelope has unknown run ownership; screenshot deletion was skipped") from error
    return recoverable


def cleanup_orphan_run_artifacts(
    store: RunArtifactStore,
    *,
    apply: bool,
    grace_days: int = 30,
    max_deletes: int = R2_DELETE_BATCH,
    lease_guard=None,
    retain_object=None,
) -> dict[str, object]:
    """Delete only old, unreferenced objects belonging to confirmed successful runs."""
    if grace_days < 0 or max_deletes < 1:
        raise ValueError("Artifact grace period and deletion bound must be non-negative/positive")
    states = _scan_run_states(store, lease_guard=lease_guard)
    referenced = _scan_artifact_references(store, lease_guard=lease_guard)
    recoverable = _recoverable_run_ids()
    client = store.r2
    if client is None:
        from backend.utils.log.run_storage import _r2_client

        client = _r2_client()
    cutoff = datetime.now(timezone.utc) - timedelta(days=grace_days)
    eligible = 0
    candidates: list[str] = []
    for page in client.get_paginator("list_objects_v2").paginate(Bucket=store.bucket, Prefix="runs/"):
        if lease_guard:
            lease_guard()
        contents = page.get("Contents", [])
        if not isinstance(contents, list):
            raise CloudflareStorageError("R2 run-artifact listing is malformed; no orphan deletion was attempted")
        for item in contents:
            if not isinstance(item, dict):
                raise CloudflareStorageError("R2 run-artifact listing is malformed; no orphan deletion was attempted")
            key, modified = item.get("Key"), item.get("LastModified")
            if not isinstance(key, str) or not key.startswith("runs/") or not isinstance(modified, datetime):
                raise CloudflareStorageError("R2 run-artifact listing is incomplete; no orphan deletion was attempted")
            match = RUN_OBJECT_KEY_RE.fullmatch(key)
            if not match:
                # Unknown ownership/recovery state is retained.
                continue
            if modified.tzinfo is None:
                modified = modified.replace(tzinfo=timezone.utc)
            snapshot_object = "/scraped_snapshots/" in key
            if snapshot_object:
                completion = store.d1.execute(
                    "SELECT finished_at FROM run_logs WHERE run_id = ? AND status IN ('successful','failed')",
                    (int(match.group(2)),),
                ).rows
                if len(completion) != 1 or not completion[0].get("finished_at"):
                    continue
                try:
                    archived = datetime.fromisoformat(completion[0]["finished_at"])
                    if archived.tzinfo is None:
                        archived = archived.replace(tzinfo=timezone.utc)
                except ValueError as error:
                    raise CloudflareStorageError("Scrape snapshot owner has an invalid completion time") from error
                if archived > cutoff:
                    continue
            elif modified > cutoff:
                continue
            if key in referenced or (retain_object and retain_object(key)):
                continue
            run_id = int(match.group(2))
            allowed_states = {"successful", "failed"} if snapshot_object else {"successful"}
            if states.get(run_id) not in allowed_states or run_id in recoverable:
                continue
            eligible += 1
            if len(candidates) < max_deletes:
                candidates.append(key)
    deleted = 0
    if apply and candidates:
        verify_lease(lease_guard)
        response = client.delete_objects(
            Bucket=store.bucket,
            Delete={"Objects": [{"Key": key} for key in candidates], "Quiet": True},
        )
        if response.get("Errors"):
            raise CloudflareStorageError("R2 run-artifact cleanup did not confirm every deletion")
        deleted = len(candidates)
    return {
        "referenced_objects": len(referenced),
        "eligible_objects": eligible,
        "deletion_batch": len(candidates),
        "sample_keys": candidates[:20],
        "deleted": deleted,
    }


def cleanup_r2_storage(store, *, apply, lease_guard, artwork=None, pins=None):
    """One bounded safe R2 sweep, also usable when a watermark is reached."""
    from backend.dataflow.utils.ArtworkStorage import ArtworkStorage
    from backend.dataflow.backfill_catalog_artwork import run_cleanup as cleanup_artwork
    from backend.dataflow.social_previews import cleanup_social_previews
    from backend.utils.log.r2_storage_guard import retains

    artwork = artwork or ArtworkStorage.from_environment()
    if artwork is None:
        raise RuntimeError("Selected target artwork R2 credentials are required for cleanup")
    report = {}
    artwork_pin = {"retain_object": lambda key: retains(pins, artwork.bucket, key)} if pins is not None else {}
    artifact_pin = {"retain_object": lambda key: retains(pins, store.bucket, key)} if pins is not None else {}
    report["artwork"] = cleanup_artwork(_supabase_client(), artwork, apply=apply, lease_guard=lease_guard, **artwork_pin)
    if lease_guard:
        lease_guard()
    report["social_previews"] = cleanup_social_previews(_supabase_client(), artwork, apply=apply, lease_guard=lease_guard, **artwork_pin)
    if lease_guard:
        lease_guard()
    report["scraped_snapshots"] = cleanup_scraped_snapshots(
        store, apply=apply, lease_guard=lease_guard,
        retain_object=(lambda key: retains(pins, store.bucket, key)) if pins is not None else None,
    )
    if lease_guard:
        lease_guard()
    report["run_artifacts"] = cleanup_orphan_run_artifacts(store, apply=apply, lease_guard=lease_guard, **artifact_pin)
    if lease_guard:
        lease_guard()
    return report


def cleanup_scraped_snapshots(store, *, apply, lease_guard=None, retain_object=None, grace_days=30, max_deletes=500):
    """Expire snapshots 30 days after confirmed completion of their owning run."""
    from datetime import datetime, timedelta, timezone

    if grace_days < 0 or max_deletes < 1:
        raise ValueError("Snapshot grace period and deletion bound must be non-negative/positive")
    recoverable = _recoverable_run_ids()
    cutoff = datetime.now(timezone.utc) - timedelta(days=grace_days)
    rows = []
    offset = 0
    page_size = 500
    while True:
        page = store.d1.execute(
            "SELECT a.artifact_id, a.run_id, a.object_key, a.metadata_json, "
            "r.status, r.finished_at FROM artifacts a JOIN run_logs r ON r.run_id = a.run_id "
            "WHERE a.artifact_type = ? ORDER BY a.created_at, a.artifact_id LIMIT ? OFFSET ?",
            ("scraped_snapshot", page_size, offset),
        ).rows
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += len(page)
    eligible = []
    eligible_count = eligible_bytes = total_bytes = 0
    protected = 0
    blocked_reasons = {"run_unresolved": 0, "missing_completion_time": 0,
                       "within_retention": 0, "job_pinned": 0}
    for row in rows:
        if lease_guard:
            lease_guard()
        try:
            metadata = json.loads(row["metadata_json"])
            raw_size_bytes = metadata.get("size_bytes")
        except (KeyError, TypeError, ValueError) as error:
            raise CloudflareStorageError("A scrape snapshot has invalid catalog size metadata") from error
        if (not isinstance(metadata, dict) or isinstance(raw_size_bytes, bool)
                or not isinstance(raw_size_bytes, int) or raw_size_bytes < 0):
            raise CloudflareStorageError("A scrape snapshot has invalid catalog size metadata")
        size_bytes = raw_size_bytes
        total_bytes += size_bytes
        if row.get("status") not in {"successful", "failed"} or int(row["run_id"]) in recoverable:
            protected += 1
            blocked_reasons["run_unresolved"] += 1
            continue
        finished_at = row.get("finished_at")
        if not finished_at:
            # A completed status without its completion timestamp is not enough
            # evidence to start the 30-day retention clock.
            protected += 1
            blocked_reasons["missing_completion_time"] += 1
            continue
        try:
            anchor = datetime.fromisoformat(finished_at)
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=timezone.utc)
        except (TypeError, ValueError) as error:
            raise CloudflareStorageError("A scrape snapshot has no reliable completed-run age") from error
        if anchor > cutoff:
            blocked_reasons["within_retention"] += 1
            continue
        if retain_object and retain_object(row["object_key"]):
            blocked_reasons["job_pinned"] += 1
            continue
        eligible_count += 1
        eligible_bytes += size_bytes
        if len(eligible) < max_deletes:
            eligible.append({**row, "size_bytes": size_bytes})
    deleted = 0
    deleted_bytes = 0
    if apply:
        client = store.r2
        if client is None:
            from backend.utils.log.run_storage import _r2_client
            client = _r2_client()
        for row in eligible:
            if lease_guard:
                lease_guard()
            try:
                client.delete_object(Bucket=store.bucket, Key=row["object_key"])
            except Exception as error:
                raise CloudflareStorageError("Expired scrape snapshot deletion was not confirmed; catalog retained.") from error
            if lease_guard:
                lease_guard()
            result = store.d1.execute(
                "DELETE FROM artifacts WHERE artifact_id = ? AND artifact_type = ? AND object_key = ?",
                (row["artifact_id"], "scraped_snapshot", row["object_key"]),
            )
            if result.changes != 1:
                raise CloudflareStorageError("Deleted scrape snapshot catalog reference could not be confirmed.")
            deleted += 1
            deleted_bytes += row["size_bytes"]
    return {
        "eligible": eligible_count, "eligible_bytes": eligible_bytes,
        "deletion_batch": len(eligible), "deleted": deleted,
        "deleted_bytes": deleted_bytes, "retained": len(rows) - deleted,
        "retained_bytes": total_bytes - deleted_bytes, "protected": protected,
        "blocked_reasons": blocked_reasons, "scanned": len(rows),
        "scan_limited": False,
    }


def run_shared_cleanup(
    store: RunArtifactStore,
    *,
    lease_token: str,
    target: str,
    apply: bool,
    now: datetime | None = None,
    force: bool = False,
) -> dict[str, object]:
    """Run all target-scoped cleanup in a stable order under one D1 lease."""
    if target not in {"development", "production"}:
        raise ValueError("Shared cleanup requires an explicit development or production target")
    from backend.dataflow.utils.ArtworkStorage import ArtworkStorage

    # Validate every required client before any Supabase or retention mutation.
    artwork = ArtworkStorage.from_environment()
    if artwork is None:
        raise RuntimeError("Selected target artwork R2 credentials are required for shared cleanup")
    now = now or datetime.now(timezone.utc)
    day = now.date().isoformat()
    state = store.cleanup_state()

    renew = lease_renewal_callback(store, lease_token)

    report: dict = {
        "target": target,
        "mode": "apply" if apply else "dry-run",
        "day_utc": day,
    }
    # Preserve the existing D1 350/300 MB retention checks before and after.
    report["d1_before"] = store.check_storage(lease_token=lease_token)
    renew()
    if not force:
        if state.get("last_successful_cleanup_day") == day:
            report["skipped"] = "already-cleaned-today"
            return report
        if not apply and state.get("last_dry_run_day") == day:
            report["skipped"] = "dry-run-already-completed-today"
            return report

    from backend.utils.supabase.clear_old_entries import clear_old_entries
    from backend.utils.supabase.clear_orphan_final_movies import clear_orphan_final_movies
    from backend.utils.supabase.clear_orphan_final_theque_movies import clear_orphan_final_theque_movies

    report["supabase_old_entries"] = clear_old_entries(apply=apply, lease_guard=renew)
    renew()
    report["orphan_final_movies"] = clear_orphan_final_movies(apply=apply, lease_guard=renew)
    renew()
    report["orphan_final_theque_movies"] = clear_orphan_final_theque_movies(apply=apply, lease_guard=renew)
    renew()

    report.update(cleanup_r2_storage(store, apply=apply, lease_guard=renew, artwork=artwork))
    report["d1_after"] = store.check_storage(lease_token=lease_token)
    store.mark_cleanup_attempt(day, successful=apply)
    return report


def run_pipeline_preflight(store: RunArtifactStore, *, lease_token: str) -> dict:
    """Run daily cleanup before a scrape/dataflow/Everything/realtime run."""
    from backend.utils.log.r2_budget import initialize_job_budget

    initialize_job_budget()
    target = os.environ.get("KARTISERET_TARGET", "").strip()
    if target not in {"development", "production"}:
        raise RuntimeError("KARTISERET_TARGET must select development or production before cleanup")
    # Revalidate target pairing before the cleanup code creates clients or mutates data.
    resolve_target_environment(target, os.environ)
    apply = _cleanup_apply_from_environment()
    from rich.console import Console
    from backend.utils.console.stage_progress import format_bytes, render_key_value_table, run_timed_stage

    console = Console()

    def preflight() -> dict:
        result = run_shared_cleanup(store, lease_token=lease_token, target=target, apply=apply)
        from backend.utils.log.r2_storage_guard import initialize_storage_guard

        guard = initialize_storage_guard(store)
        # A daily sweep that just ran already attempted the same bounded cleanup.
        # A skipped daily scan must not suppress pressure-triggered cleanup.
        guard.reserve(upload=False, allow_cleanup=bool(result.get("skipped")))
        result["r2_storage"] = guard.summary()
        return result

    result = run_timed_stage(
        "SharedCleanupPreflight",
        "Shared cleanup preflight",
        preflight,
        console,
        record_when=lambda value: not value.get("skipped"),
        outcome_for=lambda value: f"Skipped: {value['skipped']}" if value.get("skipped") else "Complete",
    )

    def summary_rows() -> list[tuple[str, str]]:
        rows = [
            ("Target", target),
            ("Mode", result.get("mode", "—")),
            ("Status", f"Skipped: {result['skipped']}" if result.get("skipped") else "Complete"),
        ]
        for label, key in (("D1 before", "d1_before"), ("D1 after", "d1_after")):
            d1 = result.get(key)
            if isinstance(d1, dict) and "size" in d1:
                rows.append((label, format_bytes(d1.get("size"))))
        guard = result.get("r2_storage")
        if isinstance(guard, dict):
            estimated = format_bytes(guard.get("estimated_bytes"))
            high = format_bytes(guard.get("high_bytes"))
            low = format_bytes(guard.get("low_bytes"))
            rows.append(("R2 storage guard", f"{estimated} estimated · high {high} · low {low}"))
            if guard.get("blocked"):
                rows.append(("R2 guard status", guard["blocked"]))
        for key in ("supabase_old_entries", "orphan_final_movies", "orphan_final_theque_movies", "artwork", "social_previews", "scraped_snapshots", "run_artifacts"):
            value = result.get(key)
            label = key.replace("_", " ").title()
            if isinstance(value, int) and not isinstance(value, bool):
                rows.append((label, f"{value} removed"))
                continue
            if not isinstance(value, dict):
                continue
            eligible = value.get("eligible", value.get("eligible_objects", value.get("eligible_count")))
            removed = value.get("deleted", value.get("deleted_count", value.get("removed")))
            if eligible is not None or removed is not None:
                rows.append((label, f"{eligible if eligible is not None else '—'} eligible · {removed if removed is not None else 0} removed"))
                continue
            counts = [
                f"{name} {count}"
                for name, count in value.items()
                if isinstance(count, int) and not isinstance(count, bool)
            ]
            if counts:
                rows.append((label, " · ".join(counts)))
        return rows

    render_key_value_table("Shared cleanup", summary_rows(), console)
    return result


def _load_target(target: str) -> None:
    selected = resolve_target_environment(target, os.environ)
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("development", "production"), default=os.environ.get("KARTISERET_TARGET"))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Apply Supabase and R2 deletions")
    mode.add_argument("--dry-run", action="store_true", help="Report cleanup candidates without deleting")
    parser.add_argument("--validate-only", action="store_true", help="Validate selected target credentials and read-only access before cleanup")
    parser.add_argument("--force", action="store_true", help="Ignore this target's once-per-day cleanup marker")
    parser.add_argument("--publications-only", action="store_true", help="Run only abandoned publication cleanup under the target lease")
    args = parser.parse_args(argv)
    if not args.target:
        parser.error("select --target development or --target production")
    if args.publications_only and args.force:
        parser.error("--force does not apply to --publications-only")
    _load_target(args.target)
    apply = args.apply or (not args.dry_run and _cleanup_apply_from_environment())
    if args.validate_only:
        from backend.dataflow.utils.ArtworkStorage import ArtworkStorage
        from backend.utils.log.cloudflare_storage import D1Client
        from backend.utils.log.run_storage import _r2_client

        artwork = ArtworkStorage.from_environment()
        if artwork is None:
            raise RuntimeError("Selected target artwork R2 credentials are required")
        store = RunArtifactStore()
        # Read-only access checks run for both targets before either cleanup job
        # can mutate anything. Empty listings also verify the selected buckets.
        d1_result = D1Client.from_environment().execute("SELECT 1 AS cleanup_validation")
        if not d1_result.rows or d1_result.rows[0].get("cleanup_validation") != 1:
            raise RuntimeError("Selected D1 database did not confirm the validation query")
        client = _supabase_client()
        client.table("utilRunLogs").select("run_id").limit(1).execute()
        publication_cleanup = None
        if args.publications_only:
            publication_cleanup = cleanup_abandoned_publications(client, apply=False)
        artwork.client.list_objects_v2(Bucket=artwork.bucket, MaxKeys=1)
        run_client = _r2_client()
        run_client.list_objects_v2(Bucket=store.bucket, MaxKeys=1)
        result = {"target": args.target, "validated": True, "mode": "apply" if apply else "dry-run"}
        if publication_cleanup is not None:
            result["publications"] = publication_cleanup
        print(json.dumps(result, sort_keys=True))
        _print_r2_budget_summary()
        return 0

    if args.publications_only:
        with maintenance_lease(skip_if_busy=True) as lease:
            if lease is None:
                print(json.dumps({"target": args.target, "skipped": "another-job-holds-target-lease"}))
                return 0
            store, token = lease
            result = cleanup_abandoned_publications(
                _supabase_client(),
                apply=apply,
                lease_guard=lease_renewal_callback(store, token),
            )
            print(json.dumps({
                "target": args.target,
                "mode": "apply" if apply else "dry-run",
                "publications": result,
            }, sort_keys=True))
        return 0

    with maintenance_lease(skip_if_busy=True) as lease:
        if lease is None:
            print(json.dumps({"target": args.target, "skipped": "another-job-holds-target-lease"}))
            return 0
        store, token = lease
        report = run_shared_cleanup(
            store, lease_token=token, target=args.target, apply=apply, force=args.force,
        )
        print(json.dumps(report, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    from backend.utils.log.job_lease import run_cli
    raise SystemExit(run_cli(main, "backend.utils.log.shared_cleanup"))
