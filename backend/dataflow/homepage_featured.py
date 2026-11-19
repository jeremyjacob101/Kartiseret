"""Store one deterministic homepage movie candidate lineup per Israel week."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from backend.dataflow.backfill_catalog_artwork import each_row

LOGGER = logging.getLogger(__name__)
ISRAEL_TIME_ZONE = ZoneInfo("Asia/Jerusalem")
LINEUP_LIMIT = 40


def israel_week_start(now: datetime | None = None) -> str:
    current_date = (now or datetime.now(timezone.utc)).astimezone(ISRAEL_TIME_ZONE).date()
    days_since_thursday = (current_date.weekday() - 3) % 7
    return (current_date.fromordinal(current_date.toordinal() - days_since_thursday)).isoformat()


def _usable(row: dict) -> bool:
    return (
        bool(row.get("tmdb_id"))
        and row.get("solo_update") is not True
        and bool(row.get("en_poster") or row.get("backdrop"))
    )


def choose_weekly_candidates(
    now_playing_rows: list[dict],
    coming_soon_rows: list[dict],
    current_year: int,
) -> tuple[list[int], list[int]]:
    now_playing = [row for row in now_playing_rows if _usable(row)]
    now_playing.sort(
        key=lambda row: (
            -(int(row.get("release_year") or 0)),
            -(float(row.get("popularity") or 0)),
            int(row["tmdb_id"]),
        )
    )
    recent = [
        row for row in now_playing
        if int(row.get("release_year") or 0) >= current_year - 2
    ]
    recent.sort(
        key=lambda row: (
            -(float(row.get("popularity") or 0)),
            int(row["tmdb_id"]),
        )
    )
    # Keep a full reserve list even when a quiet week has fewer recent releases.
    ordered_now = recent + [row for row in now_playing if row not in recent]

    upcoming = [row for row in coming_soon_rows if _usable(row)]
    upcoming.sort(
        key=lambda row: (
            str(row.get("release_date") or "9999-12-31"),
            -(float(row.get("popularity") or 0)),
            int(row["tmdb_id"]),
        )
    )
    return (
        list(dict.fromkeys(int(row["tmdb_id"]) for row in ordered_now))[:LINEUP_LIMIT],
        list(dict.fromkeys(int(row["tmdb_id"]) for row in upcoming))[:LINEUP_LIMIT],
    )


def refresh_weekly_homepage_lineup(
    client,
    now: datetime | None = None,
    lease_guard=None,
) -> dict[str, int | str]:
    now = now or datetime.now(timezone.utc)
    current_year = now.astimezone(ISRAEL_TIME_ZONE).year
    now_playing_rows = list(each_row(
        client,
        "finalMovies",
        "tmdb_id,release_year,popularity,en_poster,backdrop,solo_update",
        lease_guard=lease_guard,
    ))
    coming_soon_rows = list(each_row(
        client,
        "finalSoons",
        "tmdb_id,release_date,popularity,en_poster,backdrop,solo_update",
        lease_guard=lease_guard,
    ))
    now_playing_ids, coming_soon_ids = choose_weekly_candidates(
        now_playing_rows, coming_soon_rows, current_year
    )
    if not now_playing_ids and not coming_soon_ids:
        raise RuntimeError("The published catalog has no eligible homepage movies")

    week_start = israel_week_start(now)
    client.table("homepage_featured_weekly_lineups").upsert(
        {
            "week_start": week_start,
            "now_playing_ids": now_playing_ids,
            "coming_soon_ids": coming_soon_ids,
            "generated_at": now.isoformat(),
        },
        on_conflict="week_start",
        ignore_duplicates=True,
    ).execute()
    return {
        "week_start": week_start,
        "now_playing": len(now_playing_ids),
        "coming_soon": len(coming_soon_ids),
    }


def refresh_configured_homepage_lineup() -> dict[str, int | str] | None:
    """Best-effort after-publication hook, retried by the next successful run."""
    try:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not supabase_url or not service_key:
            LOGGER.info("Skipping homepage lineup because Supabase credentials are unavailable")
            return None
        from backend.utils.log.job_lease import create_client
        from backend.utils.log.shared_cleanup import current_run_lease_guard

        lease_guard = current_run_lease_guard()
        if lease_guard:
            lease_guard()
        result = refresh_weekly_homepage_lineup(
            create_client(supabase_url, service_key),
            lease_guard=lease_guard,
        )
        LOGGER.info("Homepage weekly lineup refreshed: %s", result)
        return result
    except Exception as error:
        LOGGER.warning("Homepage weekly lineup refresh was skipped after an error (%s)", type(error).__name__)
        return None
