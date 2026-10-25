from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from html import escape
from typing import Any, Callable, Iterable
from uuid import uuid4
import hashlib
import json
import os
import unicodedata

import requests
from supabase import create_client

from backend.notifications.letterboxd_public import (
    LetterboxdFilm,
    LetterboxdSourceError,
    fetch_letterboxd_source,
)
from backend.notifications.ticket_alerts import (
    JERUSALEM_TIME_ZONE,
    ALERT_FILTER_OPTIONS,
    RenderedEmail,
    TicketAlertConfig,
    _format_showtime,
    _friendly_date,
    _jerusalem_now,
    _parse_date,
    _safe_header,
    _text,
    get_canonical_app_email,
    is_future_showtime,
    matches_ticket_alert_criteria,
    resolve_ticket_alert_criteria,
    send_resend_email,
    valid_ticket_href,
)

SOURCES_TABLE = "letterboxd_sources"
SOURCE_FILMS_TABLE = "letterboxd_source_films"
EVENT_ALERTS_TABLE = "letterboxd_event_alerts"
SHOWTIMES_TABLE = "finalShowtimes"
NOW_PLAYING_TABLE = "finalMovies"
COMING_SOON_TABLE = "finalSoons"
PREFERENCES_TABLE = "ticket_alert_preferences"
TICKET_SUBSCRIPTIONS_TABLE = "ticket_alert_subscriptions"
DEFAULT_FILTERS = {group: [] for group in ALERT_FILTER_OPTIONS}


@dataclass(frozen=True)
class LetterboxdEvent:
    user_id: str
    tmdb_id: int
    event_key: str
    event_type: str
    payload: dict[str, Any]


@dataclass(frozen=True)
class LetterboxdDeliveryBatch:
    user_id: str
    delivery_id: str
    events: tuple[dict[str, Any], ...]


@dataclass(frozen=True)
class LetterboxdDispatchSummary:
    sources_synced: int
    sources_failed: int
    active_titles: int
    emails_sent: int
    events_notified: int


def _year(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if 1870 <= parsed <= 2200 else None


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _normalize_title(value: Any) -> str:
    normalized = unicodedata.normalize("NFKD", _text(value)).casefold()
    return "".join(
        character
        for character in normalized
        if not unicodedata.combining(character) and character.isalnum()
    )


def resolve_local_movie_ids(
    films: Iterable[LetterboxdFilm], candidates: Iterable[dict[str, Any]]
) -> dict[str, int | None]:
    by_title_year: dict[tuple[str, int], set[int]] = {}
    for candidate in candidates:
        title = _normalize_title(candidate.get("english_title"))
        release_year = _year(candidate.get("release_year"))
        if release_year is None:
            release_year = _year(_text(candidate.get("release_date"))[:4])
        try:
            tmdb_id = int(candidate.get("tmdb_id"))
        except (TypeError, ValueError):
            continue
        if not title or release_year is None or tmdb_id <= 0:
            continue
        by_title_year.setdefault((title, release_year), set()).add(tmdb_id)

    resolved: dict[str, int | None] = {}
    for film in films:
        title = _normalize_title(film.title)
        key = (title, film.release_year) if title and film.release_year else None
        matches = by_title_year.get(key, set()) if key else set()
        resolved[film.slug] = next(iter(matches)) if len(matches) == 1 else None
    return resolved


def _event_key(event_type: str, tmdb_id: int, payload: dict[str, Any]) -> str:
    stable = {
        "tmdb_id": tmdb_id,
        "type": event_type,
        **{
            key: payload.get(key)
            for key in (
                "release_date",
                "screening_city",
                "cinema",
                "date_of_showing",
                "showtime",
                "ticket_href",
            )
        },
    }
    canonical = json.dumps(stable, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _safe_event_title(value: Any) -> str:
    return (_text(value) or "Untitled movie")[:200]


def collect_current_events(
    user_ids: Iterable[str],
    pairs: dict[str, set[int]],
    *,
    local_dates: Iterable[dict[str, Any]],
    showtimes: Iterable[dict[str, Any]],
    movie_titles: dict[int, str],
    preferences: Iterable[dict[str, Any]],
    subscriptions: Iterable[dict[str, Any]],
    now: datetime,
    match_criteria: bool,
) -> list[LetterboxdEvent]:
    current = _jerusalem_now(now)
    today = current.date()
    defaults_by_user = {
        _text(row.get("user_id")): {
            "cities": row.get("cities"),
            "filters": row.get("filter_exclusions") or DEFAULT_FILTERS,
        }
        for row in preferences
        if _text(row.get("user_id"))
    }
    overrides_by_pair = {
        (_text(row.get("user_id")), tmdb_id): row.get("criteria_overrides") or {}
        for row in subscriptions
        if _text(row.get("user_id"))
        and (tmdb_id := _positive_int(row.get("tmdb_id"))) is not None
    }
    events: list[LetterboxdEvent] = []

    deduped_dates: dict[int, dict[str, Any]] = {}
    for row in local_dates:
        try:
            tmdb_id = int(row.get("tmdb_id"))
        except (TypeError, ValueError):
            continue
        release_date = _text(row.get("release_date"))
        parsed_date = _parse_date(release_date)
        if parsed_date is None or parsed_date < today:
            continue
        existing = deduped_dates.get(tmdb_id)
        if existing is None or release_date < _text(existing.get("release_date")):
            deduped_dates[tmdb_id] = row

    for user_id in user_ids:
        user_pairs = pairs.get(user_id, set())
        for tmdb_id in sorted(user_pairs):
            row = deduped_dates.get(tmdb_id)
            if row is None:
                continue
            release_date = _text(row.get("release_date"))
            payload = {
                "title": _safe_event_title(row.get("english_title") or movie_titles.get(tmdb_id)),
                "release_date": release_date,
            }
            events.append(
                LetterboxdEvent(
                    user_id,
                    tmdb_id,
                    _event_key("coming_soon", tmdb_id, payload),
                    "coming_soon",
                    payload,
                )
            )

    for row in showtimes:
        try:
            tmdb_id = int(row.get("tmdb_id"))
        except (TypeError, ValueError):
            continue
        city = _text(row.get("screening_city"))
        cinema_date = _text(row.get("date_of_showing"))
        showtime = _format_showtime(row.get("showtime"))
        cinema = _text(row.get("cinema")) or "Cinema"
        ticket_href = valid_ticket_href(row)
        if not (city and cinema_date and showtime and ticket_href):
            continue
        if not is_future_showtime(cinema_date, showtime, current):
            continue
        title = _safe_event_title(row.get("english_title") or movie_titles.get(tmdb_id))
        for user_id in user_ids:
            if tmdb_id not in pairs.get(user_id, set()):
                continue
            if match_criteria:
                defaults = defaults_by_user.get(
                    user_id, {"cities": None, "filters": DEFAULT_FILTERS}
                )
                criteria = resolve_ticket_alert_criteria(
                    defaults, overrides_by_pair.get((user_id, tmdb_id), {})
                )
                if not matches_ticket_alert_criteria(row, criteria):
                    continue
            payload = {
                "title": title,
                "screening_city": city,
                "cinema": cinema,
                "date_of_showing": cinema_date,
                "showtime": showtime,
                "ticket_href": ticket_href,
            }
            events.append(
                LetterboxdEvent(
                    user_id,
                    tmdb_id,
                    _event_key("showtime", tmdb_id, payload),
                    "showtime",
                    payload,
                )
            )

    by_key: dict[tuple[str, str], LetterboxdEvent] = {}
    for event in events:
        by_key[(event.user_id, event.event_key)] = event
    return sorted(
        by_key.values(),
        key=lambda event: (event.user_id, event.tmdb_id, event.event_type, event.event_key),
    )


def render_letterboxd_event_email(events: tuple[dict[str, Any], ...]) -> RenderedEmail:
    if not events:
        raise ValueError("A Letterboxd update email must contain at least one event.")
    normalized: list[tuple[str, dict[str, Any]]] = []
    for row in events:
        event_type = _text(row.get("event_type"))
        payload = row.get("event_payload")
        if event_type not in {"coming_soon", "showtime"} or not isinstance(payload, dict):
            raise ValueError("A Letterboxd event snapshot is invalid.")
        normalized.append((event_type, payload))
    normalized.sort(
        key=lambda pair: (
            _text(pair[1].get("date_of_showing") or pair[1].get("release_date")),
            _text(pair[1].get("title")).casefold(),
            pair[0],
        )
    )
    subject = (
        "New cinema updates for your Letterboxd films"
        if len(normalized) == 1
        else f"{len(normalized)} new cinema updates for your Letterboxd films"
    )
    html_items: list[str] = []
    text_items: list[str] = []
    for event_type, payload in normalized:
        title = _safe_event_title(payload.get("title"))
        if event_type == "coming_soon":
            release_date = _text(payload.get("release_date"))
            html_items.append(
                f"<li style=\"margin:0 0 16px;\"><strong>{escape(title)}</strong><br>"
                f"<span>Coming Soon in Israel: {escape(_friendly_date(release_date))}</span></li>"
            )
            text_items.append(
                f"- {title} — Coming Soon in Israel: {_friendly_date(release_date)}"
            )
            continue
        city = _text(payload.get("screening_city"))
        cinema = _text(payload.get("cinema"))
        showing_date = _text(payload.get("date_of_showing"))
        showtime = _text(payload.get("showtime"))
        href = valid_ticket_href({"english_href": payload.get("ticket_href")})
        if not href:
            raise ValueError("A Letterboxd showtime event has no ticket link.")
        detail = f"{city} · {_friendly_date(showing_date)} at {showtime}"
        html_items.append(
            f"<li style=\"margin:0 0 16px;\"><strong>{escape(title)}</strong><br>"
            f"<span>{escape(detail)} · {escape(cinema)}</span><br>"
            f"<a href=\"{escape(href, quote=True)}\">Tickets</a></li>"
        )
        text_items.append(f"- {title} — {detail} · {cinema}\n  {href}")

    html_body = "".join(
        [
            '<!doctype html><html><body style="margin:0;background:#f7f4fa;color:#211a29;font-family:Arial,sans-serif;">',
            '<div style="max-width:600px;margin:0 auto;padding:32px 22px;">',
            '<div style="background:#ffffff;border:1px solid #e5dcec;border-radius:18px;padding:28px;">',
            '<p style="margin:0 0 8px;color:#7a3db8;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Kartiseret · Letterboxd</p>',
            '<h1 style="margin:0 0 20px;font-size:25px;line-height:1.2;">New cinema updates</h1>',
            '<p style="margin:0 0 22px;line-height:1.55;">New Coming Soon dates or eligible future showtimes were found for films in your public Letterboxd sources.</p>',
            f'<ul style="margin:0;padding-left:22px;">{"".join(html_items)}</ul>',
            '<p style="margin:24px 0 0;color:#685f72;font-size:13px;line-height:1.5;">These updates are based on public sources you asked Kartiseret to track.</p>',
            "</div></div></body></html>",
        ]
    )
    text_body = "\n\n".join(
        [
            "Kartiseret — New cinema updates",
            "New Coming Soon dates or eligible future showtimes were found for films in your public Letterboxd sources.",
            "\n".join(text_items),
            "These updates are based on public sources you asked Kartiseret to track.",
        ]
    )
    return RenderedEmail(subject, html_body, text_body)


class SupabaseLetterboxdRepository:
    def __init__(self, supabase_client: Any, *, recipient_api_url: str = "", internal_api_secret: str = "", http_client: Any = requests):
        self.supabase = supabase_client
        self.recipient_api_url = recipient_api_url
        self.internal_api_secret = internal_api_secret
        self.http_client = http_client
        self._recipient_cache: dict[str, str] = {}

    @staticmethod
    def _collect_pages(query_for_range: Callable[[int, int], Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            response = query_for_range(start, start + 499).execute()
            page = list(response.data or [])
            rows.extend(row for row in page if isinstance(row, dict))
            if len(page) < 500:
                return rows
            start += 500

    def load_sources(self) -> list[dict[str, Any]]:
        return self._collect_pages(
            lambda start, end: self.supabase.table(SOURCES_TABLE)
            .select("id,user_id,source_url,source_type,created_at")
            .order("created_at")
            .order("id")
            .range(start, end)
        )

    def mark_source_attempt(self, source_id: str, attempted_at: datetime) -> None:
        self.supabase.table(SOURCES_TABLE).update(
            {"last_sync_attempt_at": attempted_at.isoformat(), "last_sync_error": None}
        ).eq("id", source_id).execute()

    def mark_source_failure(self, source_id: str, error: str) -> None:
        safe_error = _text(error)[:500] or "Letterboxd source sync failed."
        self.supabase.table(SOURCES_TABLE).update(
            {"last_sync_error": safe_error}
        ).eq("id", source_id).execute()

    def mark_source_success(
        self,
        source_id: str,
        synced_at: datetime,
        film_count: int,
        matched_count: int,
    ) -> None:
        self.supabase.table(SOURCES_TABLE).update(
            {
                "last_successful_sync_at": synced_at.isoformat(),
                "last_sync_error": None,
                "film_count": film_count,
                "matched_film_count": matched_count,
            }
        ).eq("id", source_id).execute()

    def load_source_films(self, source_id: str) -> list[dict[str, Any]]:
        return self._collect_pages(
            lambda start, end: self.supabase.table(SOURCE_FILMS_TABLE)
            .select(
                "source_id,user_id,letterboxd_slug,title,release_year,tmdb_id,first_seen_at,last_seen_at,removed_at,needs_baseline"
            )
            .eq("source_id", source_id)
            .order("letterboxd_slug")
            .range(start, end)
        )

    def load_local_movie_candidates(self) -> list[dict[str, Any]]:
        movies = self._collect_pages(
            lambda start, end: self.supabase.table(NOW_PLAYING_TABLE)
            .select("tmdb_id,english_title,release_year")
            .order("tmdb_id")
            .range(start, end)
        )
        soons = self._collect_pages(
            lambda start, end: self.supabase.table(COMING_SOON_TABLE)
            .select("tmdb_id,english_title,release_year,release_date")
            .eq("solo_update", False)
            .order("tmdb_id")
            .order("release_date")
            .range(start, end)
        )
        return movies + soons

    def sync_source_films(
        self,
        source: dict[str, Any],
        films: tuple[LetterboxdFilm, ...],
        resolved_ids: dict[str, int | None],
        synced_at: datetime,
    ) -> int:
        source_id = _text(source.get("id"))
        user_id = _text(source.get("user_id"))
        previous = {
            _text(row.get("letterboxd_slug")): row
            for row in self.load_source_films(source_id)
        }
        now_text = synced_at.isoformat()
        rows: list[dict[str, Any]] = []
        for film in films:
            existing = previous.get(film.slug)
            was_active = existing is not None and existing.get("removed_at") is None
            tmdb_id = resolved_ids.get(film.slug)
            if tmdb_id is None and existing is not None:
                try:
                    tmdb_id = int(existing.get("tmdb_id")) if existing.get("tmdb_id") else None
                except (TypeError, ValueError):
                    tmdb_id = None
            rows.append(
                {
                    "source_id": source_id,
                    "user_id": user_id,
                    "letterboxd_slug": film.slug,
                    "title": film.title,
                    "release_year": film.release_year,
                    "tmdb_id": tmdb_id,
                    "first_seen_at": (
                        existing.get("first_seen_at") if was_active else now_text
                    ),
                    "last_seen_at": now_text,
                    "removed_at": None,
                    "needs_baseline": (
                        bool(existing.get("needs_baseline"))
                        if was_active
                        else tmdb_id is not None
                    ),
                }
            )
        for start in range(0, len(rows), 500):
            self.supabase.table(SOURCE_FILMS_TABLE).upsert(
                rows[start : start + 500],
                on_conflict="source_id,letterboxd_slug",
            ).execute()
        self.supabase.table(SOURCE_FILMS_TABLE).update(
            {"removed_at": now_text}
        ).eq("source_id", source_id).is_("removed_at", "null").lt(
            "last_seen_at", now_text
        ).execute()
        return sum(1 for row in rows if row["tmdb_id"] is not None)

    def load_active_source_films(self) -> list[dict[str, Any]]:
        return self._collect_pages(
            lambda start, end: self.supabase.table(SOURCE_FILMS_TABLE)
            .select(
                "source_id,user_id,letterboxd_slug,title,release_year,tmdb_id,first_seen_at,needs_baseline"
            )
            .is_("removed_at", "null")
            .order("user_id")
            .order("tmdb_id")
            .range(start, end)
        )

    def set_source_film_tmdb_id(
        self, row: dict[str, Any], tmdb_id: int
    ) -> None:
        self.supabase.table(SOURCE_FILMS_TABLE).update(
            {"tmdb_id": tmdb_id}
        ).eq("source_id", row["source_id"]).eq(
            "letterboxd_slug", row["letterboxd_slug"]
        ).is_("tmdb_id", "null").is_("removed_at", "null").execute()

    def clear_baseline(self, rows: Iterable[dict[str, Any]]) -> None:
        for row in rows:
            self.supabase.table(SOURCE_FILMS_TABLE).update(
                {"needs_baseline": False}
            ).eq("source_id", row["source_id"]).eq(
                "letterboxd_slug", row["letterboxd_slug"]
            ).is_("removed_at", "null").execute()

    def load_local_events(
        self, tmdb_ids: list[int], today: date
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[int, str]]:
        dates: list[dict[str, Any]] = []
        showtimes: list[dict[str, Any]] = []
        movie_titles: dict[int, str] = {}
        for start in range(0, len(tmdb_ids), 150):
            chunk = tmdb_ids[start : start + 150]
            movies = self._collect_pages(
                lambda page_start, page_end: self.supabase.table(NOW_PLAYING_TABLE)
                .select("tmdb_id,english_title")
                .in_("tmdb_id", chunk)
                .range(page_start, page_end)
            )
            for row in movies:
                try:
                    movie_titles.setdefault(int(row["tmdb_id"]), _safe_event_title(row.get("english_title")))
                except (KeyError, TypeError, ValueError):
                    continue
            dates.extend(
                self._collect_pages(
                    lambda page_start, page_end: self.supabase.table(COMING_SOON_TABLE)
                    .select("tmdb_id,english_title,release_date")
                    .in_("tmdb_id", chunk)
                    .eq("solo_update", False)
                    .gte("release_date", today.isoformat())
                    .order("release_date")
                    .range(page_start, page_end)
                )
            )
            showtimes.extend(
                self._collect_pages(
                    lambda page_start, page_end: self.supabase.table(SHOWTIMES_TABLE)
                    .select(
                        "tmdb_id,english_title,screening_city,cinema,date_of_showing,showtime,english_href,hebrew_href,screening_type,screening_tech,dub_language"
                    )
                    .in_("tmdb_id", chunk)
                    .gte("date_of_showing", today.isoformat())
                    .order("date_of_showing")
                    .order("showtime")
                    .range(page_start, page_end)
                )
            )
        return dates, showtimes, movie_titles

    def load_criteria(
        self, user_ids: list[str], tmdb_ids: list[int]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        preferences = self._collect_pages(
            lambda start, end: self.supabase.table(PREFERENCES_TABLE)
            .select("user_id,cities,filter_exclusions,notification_mode")
            .in_("user_id", user_ids)
            .range(start, end)
        ) if user_ids else []
        subscriptions = self._collect_pages(
            lambda start, end: self.supabase.table(TICKET_SUBSCRIPTIONS_TABLE)
            .select("user_id,tmdb_id,criteria_overrides")
            .in_("user_id", user_ids)
            .in_("tmdb_id", tmdb_ids)
            .range(start, end)
        ) if user_ids and tmdb_ids else []
        return preferences, subscriptions

    def insert_events(self, events: Iterable[LetterboxdEvent], status: str) -> None:
        rows = [
            {
                "user_id": event.user_id,
                "tmdb_id": event.tmdb_id,
                "event_key": event.event_key,
                "event_type": event.event_type,
                "event_payload": event.payload,
                "status": status,
            }
            for event in events
        ]
        for start in range(0, len(rows), 500):
            self.supabase.table(EVENT_ALERTS_TABLE).upsert(
                rows[start : start + 500],
                on_conflict="user_id,event_key",
                ignore_duplicates=True,
            ).execute()

    def load_pending_events(self) -> list[dict[str, Any]]:
        return self._collect_pages(
            lambda start, end: self.supabase.table(EVENT_ALERTS_TABLE)
            .select(
                "id,user_id,tmdb_id,event_key,event_type,event_payload,status,created_at,delivery_id,delivery_attempts"
            )
            .eq("status", "pending")
            .is_("notified_at", "null")
            .order("created_at")
            .order("user_id")
            .range(start, end)
        )

    @staticmethod
    def _response_rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None)
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        return []

    def claim_delivery(
        self, user_id: str, delivery_id: str, rows: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        claimed: list[dict[str, Any]] = []
        for start in range(0, len(rows), 200):
            ids = [row["id"] for row in rows[start : start + 200]]
            response = (
                self.supabase.table(EVENT_ALERTS_TABLE)
                .update({"delivery_id": delivery_id, "last_delivery_error": None}, returning="representation")
                .in_("id", ids)
                .eq("user_id", user_id)
                .eq("status", "pending")
                .is_("delivery_id", "null")
                .is_("notified_at", "null")
                .execute()
            )
            claimed.extend(self._response_rows(response))
        return claimed

    def record_attempt(self, user_id: str, delivery_id: str) -> None:
        rows = self._response_rows(
            self.supabase.table(EVENT_ALERTS_TABLE)
            .select("id,delivery_attempts")
            .eq("user_id", user_id)
            .eq("delivery_id", delivery_id)
            .eq("status", "pending")
            .is_("notified_at", "null")
            .execute()
        )
        if not rows:
            raise RuntimeError("The Letterboxd event delivery is no longer pending.")
        attempted_at = datetime.now(JERUSALEM_TIME_ZONE).isoformat()
        updated = 0
        for row in rows:
            attempts = int(row.get("delivery_attempts") or 0)
            response = (
                self.supabase.table(EVENT_ALERTS_TABLE)
                .update(
                    {
                        "delivery_attempts": attempts + 1,
                        "last_delivery_attempt_at": attempted_at,
                        "last_delivery_error": None,
                    },
                    returning="representation",
                )
                .eq("id", row["id"])
                .eq("user_id", user_id)
                .eq("delivery_id", delivery_id)
                .eq("status", "pending")
                .eq("delivery_attempts", attempts)
                .is_("notified_at", "null")
                .execute()
            )
            updated += len(self._response_rows(response))
        if updated != len(rows):
            raise RuntimeError("Could not record each Letterboxd email attempt.")

    def canonical_email(self, user_id: str) -> str:
        if user_id not in self._recipient_cache:
            self._recipient_cache[user_id] = get_canonical_app_email(
                self.http_client,
                base_url=self.recipient_api_url,
                secret=self.internal_api_secret,
                user_id=user_id,
            )
        return self._recipient_cache[user_id]

    def mark_success(
        self,
        user_id: str,
        delivery_id: str,
        resend_email_id: str,
        delivered_at: datetime,
    ) -> None:
        self.supabase.table(EVENT_ALERTS_TABLE).update(
            {
                "status": "sent",
                "notified_at": delivered_at.isoformat(),
                "resend_email_id": resend_email_id,
                "last_delivery_error": None,
            }
        ).eq("user_id", user_id).eq("delivery_id", delivery_id).eq(
            "status", "pending"
        ).is_("notified_at", "null").execute()

    def mark_failure(self, user_id: str, delivery_id: str, error: str) -> None:
        safe_error = _text(error)[:2_000] or "Unknown Letterboxd alert failure"
        self.supabase.table(EVENT_ALERTS_TABLE).update(
            {"last_delivery_error": safe_error}
        ).eq("user_id", user_id).eq("delivery_id", delivery_id).eq(
            "status", "pending"
        ).is_("notified_at", "null").execute()


class LetterboxdSourceDispatcher:
    driver = None

    def __init__(
        self,
        run_id: int,
        *,
        repository: Any | None = None,
        http_client: Any = requests,
        config: TicketAlertConfig | None = None,
        now_factory: Callable[[], datetime] | None = None,
        delivery_id_factory: Callable[[], Any] = uuid4,
        request_context: Any = None,
    ):
        self.run_id = run_id
        self.http_client = http_client
        self.config = config or TicketAlertConfig.from_environment()
        self.now_factory = now_factory or (lambda: datetime.now(JERUSALEM_TIME_ZONE))
        self.delivery_id_factory = delivery_id_factory
        if repository is None:
            supabase_url = os.environ.get("SUPABASE_URL", "").strip()
            service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
            if not supabase_url or not service_role_key:
                raise RuntimeError(
                    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Letterboxd source sync."
                )
            repository = SupabaseLetterboxdRepository(
                create_client(supabase_url, service_role_key),
                recipient_api_url=self.config.recipient_api_url,
                internal_api_secret=self.config.internal_api_secret,
                http_client=self.http_client,
            )
        self.repository = repository

    def _retry_batches(self, rows: list[dict[str, Any]]) -> list[LetterboxdDeliveryBatch]:
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in rows:
            user_id = _text(row.get("user_id"))
            delivery_id = _text(row.get("delivery_id"))
            if user_id and delivery_id:
                groups.setdefault((user_id, delivery_id), []).append(row)
        earliest: dict[str, tuple[str, list[dict[str, Any]]]] = {}
        for (user_id, delivery_id), grouped in groups.items():
            created_at = min(_text(row.get("created_at")) for row in grouped)
            existing = earliest.get(user_id)
            if existing is None or created_at < min(
                _text(row.get("created_at")) for row in existing[1]
            ):
                earliest[user_id] = (delivery_id, grouped)
        return [
            LetterboxdDeliveryBatch(user_id, delivery_id, tuple(grouped))
            for user_id, (delivery_id, grouped) in sorted(earliest.items())
        ]

    def _new_batches(
        self, rows: list[dict[str, Any]], retry_users: set[str]
    ) -> list[LetterboxdDeliveryBatch]:
        by_user: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            user_id = _text(row.get("user_id"))
            if user_id and not _text(row.get("delivery_id")) and user_id not in retry_users:
                by_user.setdefault(user_id, []).append(row)
        batches: list[LetterboxdDeliveryBatch] = []
        for user_id, pending in sorted(by_user.items()):
            delivery_id = str(self.delivery_id_factory())
            claimed = self.repository.claim_delivery(user_id, delivery_id, pending)
            if claimed:
                batches.append(LetterboxdDeliveryBatch(user_id, delivery_id, tuple(claimed)))
        return batches

    def _sync_sources(self, sources: list[dict[str, Any]], now: datetime) -> tuple[int, int]:
        synced = failed = 0
        candidates = self.repository.load_local_movie_candidates() if sources else []
        for source in sources:
            source_id = _text(source.get("id"))
            self.repository.mark_source_attempt(source_id, now)
            try:
                films = fetch_letterboxd_source(
                    _text(source.get("source_url")), http_client=self.http_client
                )
                resolved = resolve_local_movie_ids(films, candidates)
                matched = self.repository.sync_source_films(
                    source, films, resolved, now
                )
                self.repository.mark_source_success(
                    source_id, now, len(films), matched
                )
                synced += 1
            except LetterboxdSourceError as error:
                self.repository.mark_source_failure(source_id, str(error))
                failed += 1
            except Exception as error:
                # Do not persist response bodies, headers, source cookies, or stack traces.
                self.repository.mark_source_failure(
                    source_id, f"Source sync failed ({type(error).__name__})."
                )
                failed += 1
        return synced, failed

    def _match_unresolved_films(self) -> list[dict[str, Any]]:
        active = self.repository.load_active_source_films()
        unresolved = [row for row in active if not row.get("tmdb_id")]
        if not unresolved:
            return active
        candidates = self.repository.load_local_movie_candidates()
        films = [
            LetterboxdFilm(
                _text(row.get("letterboxd_slug")),
                _text(row.get("title")),
                _year(row.get("release_year")),
            )
            for row in unresolved
        ]
        resolved_by_slug = resolve_local_movie_ids(films, candidates)
        for row in unresolved:
            resolved = resolved_by_slug.get(_text(row.get("letterboxd_slug")))
            if resolved:
                self.repository.set_source_film_tmdb_id(row, resolved)
                row["tmdb_id"] = resolved
        return active

    def _collect_events(
        self,
        active: list[dict[str, Any]],
        now: datetime,
        *,
        match_criteria: bool,
    ) -> list[LetterboxdEvent]:
        pairs: dict[str, set[int]] = {}
        for row in active:
            if row.get("tmdb_id") is None:
                continue
            try:
                tmdb_id = int(row["tmdb_id"])
            except (TypeError, ValueError):
                continue
            if tmdb_id > 0:
                pairs.setdefault(_text(row.get("user_id")), set()).add(tmdb_id)
        pairs.pop("", None)
        ids = sorted({tmdb_id for title_ids in pairs.values() for tmdb_id in title_ids})
        if not ids:
            return []
        dates, showtimes, movie_titles = self.repository.load_local_events(
            ids, _jerusalem_now(now).date()
        )
        user_ids = sorted(pairs)
        preferences, subscriptions = self.repository.load_criteria(user_ids, ids)
        return collect_current_events(
            user_ids,
            pairs,
            local_dates=dates,
            showtimes=showtimes,
            movie_titles=movie_titles,
            preferences=preferences,
            subscriptions=subscriptions,
            now=now,
            match_criteria=match_criteria,
        )

    def dispatch(self) -> LetterboxdDispatchSummary:
        now = _jerusalem_now(self.now_factory())
        sources = self.repository.load_sources()
        synced, failed = self._sync_sources(sources, now)
        active = self._match_unresolved_films()
        needs_baseline = [row for row in active if bool(row.get("needs_baseline")) and row.get("tmdb_id")]
        if needs_baseline:
            self.repository.insert_events(
                self._collect_events(needs_baseline, now, match_criteria=False),
                "suppressed",
            )
            self.repository.clear_baseline(needs_baseline)

        self.repository.insert_events(
            self._collect_events(active, now, match_criteria=True), "pending"
        )
        pending = self.repository.load_pending_events()
        retries = self._retry_batches(pending)
        retry_users = {batch.user_id for batch in retries}
        batches = retries + self._new_batches(pending, retry_users)
        emails_sent = events_notified = 0
        failures: list[str] = []
        for batch in batches:
            try:
                self.repository.record_attempt(batch.user_id, batch.delivery_id)
                email = render_letterboxd_event_email(batch.events)
                recipient = self.repository.canonical_email(batch.user_id)
                resend_id = send_resend_email(
                    self.http_client,
                    api_key=self.config.resend_api_key,
                    from_email=self.config.from_email,
                    to_email=recipient,
                    delivery_id=batch.delivery_id,
                    email=email,
                    idempotency_prefix="letterboxd-event-alert",
                )
                self.repository.mark_success(
                    batch.user_id, batch.delivery_id, resend_id, now
                )
                emails_sent += 1
                events_notified += len(batch.events)
            except Exception as error:
                message = f"{type(error).__name__}: {_text(error)}"
                try:
                    self.repository.mark_failure(batch.user_id, batch.delivery_id, message)
                except Exception as mark_error:
                    message += f"; could not record failure ({type(mark_error).__name__})"
                failures.append(f"{batch.delivery_id}: {message}")
        if failures:
            raise RuntimeError(
                f"Letterboxd event delivery failed for {len(failures)} batch(es): "
                + " | ".join(failures)
            )
        pairs = {
            (_text(row.get("user_id")), _text(row.get("tmdb_id")))
            for row in active
            if row.get("tmdb_id") is not None
        }
        return LetterboxdDispatchSummary(
            sources_synced=synced,
            sources_failed=failed,
            active_titles=len(pairs),
            emails_sent=emails_sent,
            events_notified=events_notified,
        )

    def dataRun(self) -> None:
        summary = self.dispatch()
        print(
            "Letterboxd source alerts: "
            f"synced={summary.sources_synced}, failed={summary.sources_failed}, "
            f"titles={summary.active_titles}, emails={summary.emails_sent}, "
            f"events={summary.events_notified}",
            flush=True,
        )
