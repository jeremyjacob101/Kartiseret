"""Fail-closed Supabase database-size guard for the scraper pipeline."""

from __future__ import annotations

import os

from backend.dataflow.utils.PublicationWorkspace import create_client


DATABASE_HIGH_WATER_BYTES = 350_000_000
PRESSURE_RETENTION_TIERS = (
    {"showtimes_days_ago": 2, "soons_days_ago": 14, "theques_days_ago": 5},
    {"showtimes_days_ago": 1, "soons_days_ago": 7, "theques_days_ago": 2},
)


class SupabaseStorageGuardError(RuntimeError):
    """The pipeline cannot safely continue with an unverified/full database."""


def _supabase_client():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise SupabaseStorageGuardError("Selected target Supabase credentials are incomplete.")
    return create_client(url, key)


def _size_from_rpc(data) -> int:
    if isinstance(data, list):
        if len(data) != 1:
            raise ValueError("size RPC returned an unexpected row count")
        data = data[0]
    if isinstance(data, dict):
        for key in ("get_database_size_bytes", "database_size_bytes", "size_bytes", "bytes"):
            if key in data:
                data = data[key]
                break
    if type(data) is not int or data < 0:
        raise ValueError("size RPC returned an invalid byte count")
    return data


def measure_database_size_bytes(client=None) -> int:
    """Read the current database size through the service-role-only RPC."""
    try:
        selected_client = client if client is not None else _supabase_client()
        response = selected_client.rpc("get_database_size_bytes", {}).execute()
        return _size_from_rpc(getattr(response, "data", None))
    except Exception as error:
        if isinstance(error, SupabaseStorageGuardError):
            raise
        raise SupabaseStorageGuardError(
            "Supabase database size could not be verified; new writes are blocked."
        ) from error


def _run_existing_supabase_cleanup(*, apply: bool, lease_guard=None) -> dict[str, object]:
    from backend.utils.supabase.clear_old_entries import clear_old_entries
    from backend.utils.supabase.clear_orphan_final_movies import clear_orphan_final_movies
    from backend.utils.supabase.clear_orphan_final_theque_movies import clear_orphan_final_theque_movies

    return {
        "old_entries": clear_old_entries(apply=apply, lease_guard=lease_guard),
        "orphan_final_movies": clear_orphan_final_movies(apply=apply, lease_guard=lease_guard),
        "orphan_final_theque_movies": clear_orphan_final_theque_movies(
            apply=apply, lease_guard=lease_guard
        ),
    }


def enforce_database_size_limit(
    client=None,
    *,
    apply: bool,
    lease_guard=None,
    existing_cleanup_done: bool = False,
    limit_bytes: int = DATABASE_HIGH_WATER_BYTES,
) -> dict[str, object]:
    """Run standard and escalating processed-row cleanup when above the cap.

    ``existing_cleanup_done`` is used by shared cleanup, which already ran the
    normal age and orphan sweeps. During an upload, the normal Supabase sweep is
    performed here before the shorter pressure-retention tiers.
    """
    if type(limit_bytes) is not int or limit_bytes <= 0:
        raise ValueError("Supabase database-size limit must be a positive integer")

    before_bytes = measure_database_size_bytes(client)
    report: dict[str, object] = {
        "limit_bytes": limit_bytes,
        "before_bytes": before_bytes,
        "after_bytes": before_bytes,
        "blocked": before_bytes >= limit_bytes,
        "stages": [],
    }
    if before_bytes < limit_bytes:
        return report

    if lease_guard is None:
        report["reason"] = "Database is at or above the limit and cleanup has no active target lease."
        return report

    from backend.utils.log.shared_cleanup import verify_lease
    verify_lease(lease_guard)

    if not existing_cleanup_done:
        report["existing_cleanup"] = _run_existing_supabase_cleanup(
            apply=apply, lease_guard=lease_guard
        )

    current_bytes = measure_database_size_bytes(client)
    report["after_existing_cleanup_bytes"] = current_bytes
    if current_bytes < limit_bytes:
        report["after_bytes"] = current_bytes
        report["blocked"] = False
        return report

    from backend.utils.supabase.clear_old_entries import clear_processed_raw_entries

    stages = report["stages"]
    for index, retention_days in enumerate(PRESSURE_RETENTION_TIERS, start=1):
        verify_lease(lease_guard)
        counts = clear_processed_raw_entries(
            **retention_days,
            apply=apply,
            lease_guard=lease_guard,
            client=client,
        )
        current_bytes = measure_database_size_bytes(client)
        stage = {
            "tier": index,
            "retention_days": dict(retention_days),
            "eligible_or_deleted": counts,
            "database_bytes_after": current_bytes,
        }
        stages.append(stage)
        report["after_bytes"] = current_bytes
        if current_bytes < limit_bytes:
            report["blocked"] = False
            return report

    report["blocked"] = current_bytes >= limit_bytes
    if report["blocked"]:
        report["reason"] = (
            "Supabase remains at or above the database-size limit after both "
            "processed-row retention passes; new writes and publication are blocked."
        )
    return report


def ensure_scrape_upload_allowed(client, *, lease_guard=None, apply: bool = True) -> dict[str, object] | None:
    """Check capacity immediately before a raw scrape insert batch."""
    if lease_guard is None:
        # Production scrape uploads run only after run_logging has installed
        # the target lease; standalone test and inspection helpers do not.
        return None
    from backend.utils.log.shared_cleanup import verify_lease
    verify_lease(lease_guard)
    report = enforce_database_size_limit(
        client, apply=apply, lease_guard=lease_guard, existing_cleanup_done=False
    )
    if report["blocked"]:
        raise SupabaseStorageGuardError(str(report.get("reason") or (
            f"Supabase database size is {report['after_bytes']} bytes; "
            f"the {report['limit_bytes']}-byte write limit was reached."
        )))
    return report


def ensure_publication_allowed(client, *, lease_guard=None) -> dict[str, int] | None:
    """Fence an already-prepared publication without deleting its inputs."""
    if lease_guard is None:
        return None
    from backend.utils.log.shared_cleanup import verify_lease
    verify_lease(lease_guard)
    size_bytes = measure_database_size_bytes(client)
    if size_bytes >= DATABASE_HIGH_WATER_BYTES:
        raise SupabaseStorageGuardError(
            f"Supabase database size is {size_bytes} bytes, at or above the "
            f"{DATABASE_HIGH_WATER_BYTES}-byte limit. This prepared publication "
            "was stopped without pruning its input snapshots; run cleanup and start a fresh run."
        )
    return {"database_bytes": size_bytes, "limit_bytes": DATABASE_HIGH_WATER_BYTES}
