from dotenv import load_dotenv

load_dotenv()

from datetime import date, timedelta
import argparse
import json
import time
from inspect import signature
from backend.dataflow.utils.PublicationWorkspace import create_client, maintenance_publication
import os
from backend.config.target_environment import PROFILE_KEYS, resolve_target_environment
from backend.utils.supabase.snapshot_manifests import reconcile_snapshot_row_counts

ALL_SHOWTIMES_CUTOFF_DAYS_AGO = 5
ALL_SOONS_CUTOFF_DAYS_AGO = 31
ALL_THEQUES_CUTOFF_DAYS_AGO = 10
FINAL_SHOWTIMES_CUTOFF_DAYS_AGO = 1
FINAL_SOONS_CUTOFF_DAYS_AGO = 0
FINAL_THEQUES_CUTOFF_DAYS_AGO = 1
DELETE_CHUNK_SIZE = 200
SNAPSHOT_TABLES = {"allShowtimes", "allSoons", "allTheques"}


def delete_entries_on_or_before(sb, table_name, date_column, cutoff, *, apply=True, lease_guard=None):
    from backend.dataflow.utils.PublicationWorkspace import _active

    workspace = _active.get()
    include_null = table_name in {"allShowtimes", "finalShowtimes"} and date_column == "date_of_showing"

    if table_name in SNAPSHOT_TABLES:
        if workspace is not None and sb is workspace:
            manifests = {
                str(row.get("snapshot_id")): row
                for row in workspace.table("pipeline_scrape_snapshots")
                .select("snapshot_id,table_name,status,run_id")
                .execute().data
                if row.get("snapshot_id")
            }
            checkpoints = {
                str(row.get("snapshot_id")): row
                for row in workspace.table("pipeline_publication_checkpoints")
                .select("snapshot_id,phase,has_unresolved")
                .execute().data
                if row.get("snapshot_id")
            }
            current_run_id = int(workspace.run_id)
            rows = workspace.table(table_name).select(
                f"id,snapshot_id,run_id,cleaned,added,{date_column}"
            ).lte(date_column, cutoff, include_null=include_null).order("id").execute().data or []
            safe_ids = []
            affected_snapshots = set()
            for row in rows:
                # Malformed legacy rows can lack both a snapshot and publication flags.
                legacy_undated = include_null and row.get(date_column) is None and not row.get("snapshot_id")
                if not legacy_undated and (row.get("cleaned") is not True or row.get("added") is not True):
                    continue
                row_run_id = row.get("run_id")
                if row_run_id is not None and int(row_run_id) == current_run_id:
                    continue
                snapshot_id = row.get("snapshot_id")
                if snapshot_id:
                    key = str(snapshot_id)
                    manifest = manifests.get(key)
                    checkpoint = checkpoints.get(key)
                    if not manifest or manifest.get("table_name") != table_name or manifest.get("status") != "complete":
                        continue
                    if checkpoint and (
                        checkpoint.get("phase") != "published"
                        or checkpoint.get("has_unresolved") is True
                    ):
                        continue
                    affected_snapshots.add(key)
                if row.get("id"):
                    safe_ids.append(row["id"])

            if not apply:
                return len(safe_ids)

            from backend.utils.log.shared_cleanup import verify_lease

            deleted_count = 0
            for start in range(0, len(safe_ids), DELETE_CHUNK_SIZE):
                verify_lease(lease_guard)
                ids = safe_ids[start:start + DELETE_CHUNK_SIZE]
                response = workspace.table(table_name).delete().in_("id", ids).execute()
                deleted_count += len(response.data or [])
            reconcile_snapshot_row_counts(workspace, table_name, affected_snapshots)
            return deleted_count

    deleted_count = 0
    affected_snapshots = set()
    select_columns = "id,snapshot_id" if table_name in SNAPSHOT_TABLES else "id"
    offset = 0

    while True:
        if lease_guard:
            lease_guard()
        start = 0 if apply else offset
        query = sb.table(table_name).select(select_columns)
        if include_null and workspace is not None and sb is workspace:
            query = query.lte(date_column, cutoff, include_null=True)
        elif include_null:
            query = query.or_(f"{date_column}.lte.{cutoff},{date_column}.is.null")
        else:
            query = query.lte(date_column, cutoff)
        rows = query.order("id").range(start, start + DELETE_CHUNK_SIZE - 1).execute().data or []
        row_ids = [row.get("id") for row in rows if row.get("id")]
        if not row_ids:
            if apply:
                reconcile_snapshot_row_counts(sb, table_name, affected_snapshots)
            return deleted_count

        affected_snapshots.update(row.get("snapshot_id") for row in rows if row.get("snapshot_id"))
        if apply:
            from backend.utils.log.shared_cleanup import verify_lease
            verify_lease(lease_guard)
            sb.table(table_name).delete().in_("id", row_ids).execute()
        deleted_count += len(row_ids)
        if not apply:
            offset += len(rows)
            if len(rows) < DELETE_CHUNK_SIZE:
                return deleted_count


def _clear_old_entries(category=None, showtimes_days_ago=ALL_SHOWTIMES_CUTOFF_DAYS_AGO, soons_days_ago=ALL_SOONS_CUTOFF_DAYS_AGO, theques_days_ago=ALL_THEQUES_CUTOFF_DAYS_AGO, final_showtimes_days_ago=FINAL_SHOWTIMES_CUTOFF_DAYS_AGO, final_soons_days_ago=FINAL_SOONS_CUTOFF_DAYS_AGO, final_theques_days_ago=FINAL_THEQUES_CUTOFF_DAYS_AGO, apply=True, lease_guard=None):
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    counts = {}

    if category in (None, "nowplayings"):
        all_showtimes_cutoff = (date.today() - timedelta(days=showtimes_days_ago)).isoformat()
        final_showtimes_cutoff = (date.today() - timedelta(days=final_showtimes_days_ago)).isoformat()
        all_showtimes_deleted = delete_entries_on_or_before(sb, "allShowtimes", "date_of_showing", all_showtimes_cutoff, apply=apply, lease_guard=lease_guard)
        final_showtimes_deleted = delete_entries_on_or_before(sb, "finalShowtimes", "date_of_showing", final_showtimes_cutoff, apply=apply, lease_guard=lease_guard)
        counts.update(allShowtimes=all_showtimes_deleted, finalShowtimes=final_showtimes_deleted)
        # print(f"Deleted {all_showtimes_deleted} old allShowtimes rows on or before {all_showtimes_cutoff}.")
        # print(f"Deleted {final_showtimes_deleted} old finalShowtimes rows on or before {final_showtimes_cutoff}.")

    if category in (None, "soons"):
        all_soons_cutoff = (date.today() - timedelta(days=soons_days_ago)).isoformat()
        final_soons_cutoff = (date.today() - timedelta(days=final_soons_days_ago)).isoformat()
        all_soons_deleted = delete_entries_on_or_before(sb, "allSoons", "release_date", all_soons_cutoff, apply=apply, lease_guard=lease_guard)
        final_soons_deleted = delete_entries_on_or_before(sb, "finalSoons", "release_date", final_soons_cutoff, apply=apply, lease_guard=lease_guard)
        counts.update(allSoons=all_soons_deleted, finalSoons=final_soons_deleted)
        # print(f"Deleted {all_soons_deleted} old allSoons rows on or before {all_soons_cutoff}.")
        # print(f"Deleted {final_soons_deleted} old finalSoons rows on or before {final_soons_cutoff}.")

    if category in (None, "cinematheques"):
        all_theques_cutoff = (date.today() - timedelta(days=theques_days_ago)).isoformat()
        final_theques_cutoff = (date.today() - timedelta(days=final_theques_days_ago)).isoformat()
        all_theques_deleted = delete_entries_on_or_before(sb, "allTheques", "date_of_showing", all_theques_cutoff, apply=apply, lease_guard=lease_guard)
        final_theques_deleted = delete_entries_on_or_before(sb, "finalTheques", "date_of_showing", final_theques_cutoff, apply=apply, lease_guard=lease_guard)
        counts.update(allTheques=all_theques_deleted, finalTheques=final_theques_deleted)
        # print(f"Deleted {all_theques_deleted} old allTheques rows on or before {all_theques_cutoff}.")
        # print(f"Deleted {final_theques_deleted} old finalTheques rows on or before {final_theques_cutoff}.")


    return counts


_CLEANUP_SIGNATURE = signature(_clear_old_entries)


def _retire_table(sb, table, cutoff, *, apply, lease_guard):
    from backend.utils.log.shared_cleanup import verify_lease
    from backend.utils.log.cloudflare_storage import redact_secrets
    total = 0
    batch = 0
    while True:
        verify_lease(lease_guard)
        batch += 1
        started = time.monotonic()
        print("cleanup_metric=" + json.dumps({"event": "retention_batch_start", "table": table,
              "cutoff": cutoff, "apply": apply, "batch": batch}), flush=True)
        try:
            result = sb.rpc("retire_expired_rows", {"p_table": table, "p_cutoff": cutoff,
                            "p_apply": apply, "p_batch_size": DELETE_CHUNK_SIZE}).execute().data
            if (not isinstance(result, dict) or result.get("table") != table
                    or type(result.get("eligible")) is not int or result["eligible"] < 0
                    or type(result.get("deleted")) is not int
                    or not 0 <= result["deleted"] <= DELETE_CHUNK_SIZE
                    or type(result.get("has_more")) is not bool
                    or (not apply and (result["deleted"] or result["has_more"]))
                    or (apply and result["has_more"] != (result["deleted"] == DELETE_CHUNK_SIZE))):
                raise RuntimeError("Retention RPC returned an invalid result; outcome must be reconciled")
        except Exception as error:
            print("cleanup_metric=" + json.dumps({"event": "retention_batch_failed", "table": table,
                  "batch": batch, "seconds": round(time.monotonic()-started, 3),
                  "error_type": type(error).__name__, "error": redact_secrets(str(error))[:1000],
                  "outcome": "unknown" if apply else "read_failed"}), flush=True)
            raise
        total += result["deleted"] if apply else result["eligible"]
        print("cleanup_metric=" + json.dumps({"event": "retention_batch_complete", "table": table,
              "batch": batch, "seconds": round(time.monotonic()-started, 3),
              "deleted": result["deleted"], "eligible": result["eligible"], "total": total}), flush=True)
        if not result["has_more"]:
            return total


def clear_old_entries(*args, apply=True, lease_guard=None, **kwargs):
    from backend.dataflow.utils.PublicationWorkspace import _active
    bound = _CLEANUP_SIGNATURE.bind(*args, **kwargs)
    bound.apply_defaults()
    arguments = bound.arguments
    selected = arguments.pop("category")
    arguments.pop("apply")
    arguments.pop("lease_guard")
    categories = {"nowplayings": "nowplayings", "soons": "comingsoons", "cinematheques": "cinematheques"}
    if selected is not None and selected not in categories:
        raise ValueError("Unsupported cleanup category")
    counts = {}
    if _active.get() is not None:
        # Inside a scrape publication, keep changes in its existing transaction.
        for name, category in categories.items():
            if selected is None or selected == name:
                with maintenance_publication(category):
                    counts.update(_clear_old_entries(category=name, apply=apply, lease_guard=lease_guard, **arguments))
        return counts
    sb = create_client(os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    scopes = {
        "nowplayings": (("allShowtimes", "showtimes_days_ago"), ("finalShowtimes", "final_showtimes_days_ago")),
        "soons": (("allSoons", "soons_days_ago"), ("finalSoons", "final_soons_days_ago")),
        "cinematheques": (("allTheques", "theques_days_ago"), ("finalTheques", "final_theques_days_ago")),
    }
    today = date.today()
    for name, tables in scopes.items():
        if selected is not None and selected != name:
            continue
        for table, age_key in tables:
            age = arguments[age_key]
            if type(age) is not int or age < 0:
                raise ValueError("Retention ages must be non-negative integer days")
            cutoff = (today-timedelta(days=age)).isoformat()
            counts[table] = _retire_table(sb, table, cutoff, apply=apply, lease_guard=lease_guard)
    return counts


def clear_processed_raw_entries(
    *,
    showtimes_days_ago: int,
    soons_days_ago: int,
    theques_days_ago: int,
    apply: bool = True,
    lease_guard=None,
    client=None,
) -> dict[str, int]:
    """Retire only processed raw scrape rows at the supplied age cutoffs.

    The database RPC additionally fences active runs, incomplete snapshots, and
    publication checkpoints that still need raw input. Keeping the RPC as the
    deletion boundary preserves its row-count repair transaction.
    """
    ages = {
        "allShowtimes": showtimes_days_ago,
        "allSoons": soons_days_ago,
        "allTheques": theques_days_ago,
    }
    for age in (showtimes_days_ago, soons_days_ago, theques_days_ago):
        if type(age) is not int or age < 0:
            raise ValueError("Retention ages must be non-negative integer days")

    sb = client if client is not None else create_client(
        os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    today = date.today()
    counts = {}
    for table, age in ages.items():
        cutoff = (today - timedelta(days=age)).isoformat()
        counts[table] = _retire_table(
            sb, table, cutoff, apply=apply, lease_guard=lease_guard
        )
    return counts


def main():
    parser = argparse.ArgumentParser(description="Run the legacy old-entry sweep under the shared target lease.")
    parser.add_argument("--target", choices=("development", "production"), default=os.environ.get("KARTISERET_TARGET"), required=not bool(os.environ.get("KARTISERET_TARGET")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    selected = resolve_target_environment(args.target, os.environ)
    for key in PROFILE_KEYS:
        os.environ.pop(key, None)
    os.environ.update(selected)
    from backend.utils.log.shared_cleanup import lease_renewal_callback, maintenance_lease
    with maintenance_lease(skip_if_busy=False) as (store, token):
        guard = lease_renewal_callback(store, token)
        print(json.dumps(clear_old_entries(apply=not args.dry_run, lease_guard=guard), sort_keys=True))


if __name__ == "__main__":
    from backend.utils.log.job_lease import run_cli
    raise SystemExit(run_cli(main, "backend.utils.supabase.clear_old_entries"))
