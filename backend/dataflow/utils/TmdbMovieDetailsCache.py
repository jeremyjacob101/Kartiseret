"""Durable cache for validated TMDb movie-detail responses."""

from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
from threading import RLock
from zoneinfo import ZoneInfo
import os


TMDB_DETAILS_CACHE_TABLE = "tmdb_movie_details_cache"
TMDB_DETAILS_CACHE_FORMAT_VERSION = 1
TMDB_DETAILS_RESPONSE_PROFILE = "en-US:external_ids,credits,videos:v1"
TMDB_ARCHIVE_TIMEZONE = ZoneInfo("Asia/Jerusalem")


def archive_cutoff_year(now: datetime | None = None) -> int:
    """The oldest movie year treated as an archive in the Israel calendar."""
    supplied_now = now or datetime.now(timezone.utc)
    if supplied_now.tzinfo is None:
        supplied_now = supplied_now.replace(tzinfo=TMDB_ARCHIVE_TIMEZONE)
    local_now = supplied_now.astimezone(TMDB_ARCHIVE_TIMEZONE)
    return local_now.year - 3


def movie_release_year(release_date) -> int | None:
    try:
        parsed = date.fromisoformat(str(release_date or ""))
    except (TypeError, ValueError):
        return None
    return parsed.year


def is_archived_release(release_date, *, now: datetime | None = None) -> bool:
    year = movie_release_year(release_date)
    return year is not None and year <= archive_cutoff_year(now)


def validate_movie_details(payload, tmdb_id: int) -> dict | None:
    """Return a detached, complete canonical details object or None."""
    if not isinstance(payload, dict) or payload.get("success") is False:
        return None
    if isinstance(payload.get("id"), bool):
        return None
    try:
        payload_id = int(payload.get("id"))
    except (TypeError, ValueError, OverflowError):
        return None
    if payload_id != int(tmdb_id):
        return None
    if not isinstance(payload.get("title"), str) or not payload["title"].strip():
        return None
    if not isinstance(payload.get("original_title"), str) or not payload["original_title"].strip():
        return None
    release_date = payload.get("release_date")
    if release_date not in (None, ""):
        if not isinstance(release_date, str):
            return None
        try:
            date.fromisoformat(release_date)
        except ValueError:
            return None
    if not isinstance(payload.get("external_ids"), dict):
        return None
    credits = payload.get("credits")
    if not isinstance(credits, dict) or not isinstance(credits.get("crew"), list):
        return None
    videos = payload.get("videos")
    if not isinstance(videos, dict) or not isinstance(videos.get("results"), list):
        return None
    if any(not isinstance(row, dict) for row in credits["crew"] + videos["results"]):
        return None
    return deepcopy(payload)


class TmdbMovieDetailsCache:
    """Service-role-only durable cache, independent of catalog publications."""

    def __init__(self, client=None):
        self._client = client
        self._client_lock = RLock()

    def _get_client(self):
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is None:
                url = os.environ.get("SUPABASE_URL", "").strip()
                key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
                if not url or not key:
                    raise RuntimeError("TMDb detail cache credentials are unavailable")
                from backend.utils.log.job_lease import create_client

                self._client = create_client(url, key)
        return self._client

    def read_many(self, tmdb_ids: list[int]) -> dict[int, dict]:
        ids_set = set()
        for value in tmdb_ids:
            try:
                parsed = int(value)
            except (TypeError, ValueError, OverflowError):
                continue
            if parsed > 0:
                ids_set.add(parsed)
        ids = sorted(ids_set)
        found: dict[int, dict] = {}
        client = self._get_client()
        for start in range(0, len(ids), 200):
            response = (
                client.table(self.table_name)
                .select("tmdb_id,response_profile,payload,original_release_date,fetched_at,cache_format_version")
                .in_("tmdb_id", ids[start : start + 200])
                .execute()
            )
            for row in response.data or []:
                if isinstance(row.get("tmdb_id"), bool):
                    continue
                try:
                    tmdb_id = int(row.get("tmdb_id"))
                except (TypeError, ValueError, OverflowError):
                    continue
                if row.get("response_profile") != TMDB_DETAILS_RESPONSE_PROFILE:
                    continue
                if row.get("cache_format_version") != TMDB_DETAILS_CACHE_FORMAT_VERSION:
                    continue
                payload = validate_movie_details(row.get("payload"), tmdb_id)
                if payload is None:
                    continue
                payload_release_date = payload.get("release_date") or None
                stored_release_date = row.get("original_release_date") or None
                if stored_release_date != payload_release_date:
                    continue
                if stored_release_date:
                    try:
                        date.fromisoformat(str(stored_release_date))
                    except (TypeError, ValueError):
                        continue
                fetched_at = row.get("fetched_at")
                if not isinstance(fetched_at, str):
                    continue
                try:
                    parsed_fetched_at = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
                except ValueError:
                    continue
                if parsed_fetched_at.tzinfo is None:
                    continue
                found[tmdb_id] = {
                    "payload": payload,
                    "original_release_date": stored_release_date,
                    "fetched_at": fetched_at,
                    "response_profile": row.get("response_profile"),
                    "cache_format_version": row.get("cache_format_version"),
                }
        return found

    def write(self, tmdb_id: int, payload: dict, *, fetched_at: str | None = None) -> dict:
        valid = validate_movie_details(payload, tmdb_id)
        if valid is None:
            raise ValueError("Refusing to cache an incomplete TMDb details response")
        release_date = valid.get("release_date") or None
        if release_date:
            date.fromisoformat(str(release_date))
        timestamp = fetched_at or datetime.now(timezone.utc).isoformat()
        row = {
            "tmdb_id": int(tmdb_id),
            "response_profile": TMDB_DETAILS_RESPONSE_PROFILE,
            "payload": valid,
            "original_release_date": release_date,
            "fetched_at": timestamp,
            "cache_format_version": TMDB_DETAILS_CACHE_FORMAT_VERSION,
        }
        self._get_client().table(self.table_name).upsert(row, on_conflict="tmdb_id").execute()
        return row

    table_name = TMDB_DETAILS_CACHE_TABLE
