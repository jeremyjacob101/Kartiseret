"""First-availability notifications shared by manual and Letterboxd watches.

Catalog collection is read-only. PostgreSQL serializes scope creation and batch
claims; delivery snapshots stay unchanged across Resend retries.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from html import escape
import os
from typing import Any
from uuid import uuid4

import requests
from supabase import create_client

from backend.notifications.letterboxd_alerts import (
    LetterboxdSourceDispatcher,
    SupabaseLetterboxdRepository,
    collect_current_events,
)
from backend.notifications.ticket_alerts import (
    CITY_CODE_BY_NAME,
    SHOWTIME_DAY_CUTOFF_MINUTES,
    RenderedEmail,
    TicketAlertConfig,
    _friendly_date,
    _jerusalem_now,
    _text,
    resolve_ticket_alert_criteria,
    send_resend_email,
    valid_ticket_href,
    get_cinema_date,
)


def _screening_order(payload: dict[str, Any]) -> tuple:
    hour, minute = map(int, payload["showtime"].split(":"))
    minutes = hour * 60 + minute
    if minutes < SHOWTIME_DAY_CUTOFF_MINUTES:
        minutes += 24 * 60
    return (
        payload["date_of_showing"],
        minutes,
        payload["screening_city"],
        payload["cinema"],
        payload["ticket_href"],
    )


def collect_first_availability(
    *,
    pairs: dict[str, set[int]],
    date_pairs: set[tuple[str, int]],
    ticket_pairs: set[tuple[str, int]],
    local_dates: list,
    showtimes: list,
    movie_titles: dict,
    preferences: list,
    subscriptions: list,
    locations: dict[str, str],
    now: datetime,
) -> list[dict[str, Any]]:
    defaults = {row["user_id"]: row for row in preferences}
    overrides = {
        (row["user_id"], int(row["tmdb_id"])): row.get("criteria_overrides") or {}
        for row in subscriptions
    }
    effective = {}
    for user, ids in pairs.items():
        account = defaults.get(user, {})
        for movie in ids:
            effective[user, movie] = resolve_ticket_alert_criteria(
                {
                    "cities": account.get("cities"),
                    "notificationMode": account.get(
                        "notification_mode", "first_any_city"
                    ),
                    "filters": account.get("filter_exclusions") or {},
                },
                overrides.get((user, movie), {}),
                locations.get(user, "Jerusalem"),
            )
    # The existing parser and showtime filter definitions remain the common
    # source of truth. Only the first matching availability becomes a scope.
    dates_by_movie, showtimes_by_movie = defaultdict(list), defaultdict(list)
    for row in local_dates:
        dates_by_movie[int(row["tmdb_id"])].append(row)
    for row in showtimes:
        showtimes_by_movie[int(row["tmdb_id"])].append(row)
    candidates = []
    for (user, movie), criteria in effective.items():
        events = collect_current_events(
            [user],
            {user: {movie}},
            local_dates=dates_by_movie[movie],
            showtimes=showtimes_by_movie[movie],
            movie_titles=movie_titles,
            preferences=[
                {
                    "user_id": user,
                    "cities": criteria["cities"],
                    "filter_exclusions": criteria["filters"],
                }
            ],
            subscriptions=[],
            now=now,
            match_criteria=True,
        )
        first_by_city = {}
        for event in events:
            if event.event_type == "coming_soon":
                if (user, movie) in date_pairs:
                    candidates.append(
                        {
                            "user_id": user,
                            "tmdb_id": movie,
                            "event_type": "coming_soon",
                            "scope_city": "",
                            "event_payload": event.payload,
                            "status": "pending",
                        }
                    )
            elif (user, movie) in ticket_pairs:
                city = event.payload["screening_city"]
                previous = first_by_city.get(city)
                if previous is None or _screening_order(
                    event.payload
                ) < _screening_order(previous):
                    first_by_city[city] = event.payload
        # Keep every city's earliest candidate for the transactional queue. It
        # handles completed scopes and selects one in any-city mode atomically.
        for payload in sorted(first_by_city.values(), key=_screening_order):
            candidates.append(
                {
                    "user_id": user,
                    "tmdb_id": movie,
                    "event_type": "showtime",
                    "scope_city": payload["screening_city"],
                    "event_payload": payload,
                    "notification_mode": criteria["notificationMode"],
                    "status": "pending",
                }
            )
    return candidates


def render_movie_notification_email(events: list[dict]) -> RenderedEmail:
    if not events:
        raise ValueError("A notification email must contain at least one film.")
    sections = defaultdict(dict)
    for event in events:
        kind = event["event_type"]
        if kind not in ("coming_soon", "showtime"):
            raise ValueError("Unknown notification type.")
        movie = str(event["tmdb_id"])
        sections[kind].setdefault(movie, []).append(event["event_payload"])
    titles = {
        "coming_soon": "Coming Soon dates announced",
        "showtime": "Tickets now available",
    }
    counts = {kind: len(films) for kind, films in sections.items()}
    subject_parts = []
    if counts.get("coming_soon"):
        n = counts["coming_soon"]
        subject_parts.append(f"{n} Coming Soon date" + ("s" if n != 1 else ""))
    if counts.get("showtime"):
        n = counts["showtime"]
        subject_parts.append(f"Tickets for {n} film" + ("s" if n != 1 else ""))
    html_sections, text_sections = [], []
    for kind in ("coming_soon", "showtime"):
        films = sections.get(kind, {})
        if not films:
            continue
        count = len(films)
        heading = f"{titles[kind]} · {count} film" + ("s" if count != 1 else "")
        html_items, text_items = [], []
        for payloads in sorted(
            films.values(), key=lambda items: _text(items[0].get("title")).casefold()
        ):
            title = _text(payloads[0].get("title")) or "Untitled movie"
            details_html, details_text = [], []
            for payload in sorted(
                payloads, key=lambda item: item.get("screening_city", "")
            ):
                if kind == "coming_soon":
                    detail = "Israeli cinema date: " + _friendly_date(
                        payload["release_date"]
                    )
                    details_html.append(escape(detail))
                    details_text.append(detail)
                else:
                    href = valid_ticket_href(
                        {"english_href": payload.get("ticket_href")}
                    )
                    if not href:
                        raise ValueError(
                            "A ticket notification requires a valid ticket link."
                        )
                    detail = (
                        f"{payload['screening_city']} · {_friendly_date(payload['date_of_showing'])} "
                        f"at {payload['showtime']} · {payload['cinema']}"
                    )
                    details_html.append(
                        f'{escape(detail)} · <a href="{escape(href, quote=True)}">Tickets</a>'
                    )
                    details_text.append(f"{detail}\n  {href}")
            html_items.append(
                f"<li><strong>{escape(title)}</strong><br>"
                + "<br>".join(details_html)
                + "</li>"
            )
            text_items.append(f"- {title}\n  " + "\n  ".join(details_text))
        html_sections.append(
            f"<h2>{escape(heading)}</h2><ul>" + "".join(html_items) + "</ul>"
        )
        text_sections.append(heading + "\n\n" + "\n\n".join(text_items))
    return RenderedEmail(
        subject=" · ".join(subject_parts),
        html='<!doctype html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:32px auto;padding:20px">'
        "<h1>Kartiseret cinema updates</h1>"
        + "".join(html_sections)
        + "<p>Based on your watched films, selected cities, and notification settings.</p></body></html>",
        text="Kartiseret cinema updates\n\n" + "\n\n".join(text_sections),
    )


class SupabaseMovieNotificationRepository(SupabaseLetterboxdRepository):
    def load_watches(self):
        tickets = self._collect_pages(
            lambda start, end: self.supabase.table("ticket_alert_subscriptions")
            .select("user_id,tmdb_id,criteria_overrides,baseline_cities")
            .order("user_id")
            .order("tmdb_id")
            .range(start, end)
        )
        dates = self._collect_pages(
            lambda start, end: self.supabase.table("coming_soon_date_watches")
            .select("user_id,tmdb_id")
            .order("user_id")
            .order("tmdb_id")
            .range(start, end)
        )
        return tickets, dates

    def load_locations(self, users):
        rows = []
        for start in range(0, len(users), 150):
            rows.extend(
                self._collect_pages(
                    lambda a, b: self.supabase.table("userPreferences")
                    .select("user_id,location")
                    .in_("user_id", users[start : start + 150])
                    .order("user_id")
                    .range(a, b)
                )
            )
        return {
            row["user_id"]: (
                row["location"]
                if row.get("location") in CITY_CODE_BY_NAME
                else "Jerusalem"
            )
            for row in rows
        }

    def queue(self, candidates):
        self.supabase.rpc(
            "queue_movie_notifications", {"p_candidates": candidates}
        ).execute()

    def pending_users(self):
        rows = self._collect_pages(
            lambda a, b: self.supabase.table("movie_notification_events")
            .select("user_id,id")
            .eq("status", "pending")
            .order("user_id")
            .order("id")
            .range(a, b)
        )
        return sorted({row["user_id"] for row in rows})

    def claim(self, user, delivery_id):
        response = self.supabase.rpc(
            "claim_movie_notification_delivery",
            {"p_user": user, "p_delivery": delivery_id},
        ).execute()
        rows = self._response_rows(response)
        return rows[0] if rows else None

    def attempt(self, batch, snapshot):
        rows = self._response_rows(
            self.supabase.rpc(
                "start_movie_notification_delivery",
                {"p_delivery": batch["id"], "p_snapshot": snapshot},
            ).execute()
        )
        return rows[0]["email_snapshot"] if rows else None

    def complete(self, batch, resend_id):
        self.supabase.rpc(
            "complete_movie_notification_delivery",
            {"p_delivery": batch["id"], "p_resend_id": resend_id},
        ).execute()

    def fail(self, batch, error):
        self.supabase.table("movie_notification_deliveries").update(
            {"last_error": str(error)[:2000]}
        ).eq("id", batch["id"]).eq("status", "pending").execute()


@dataclass(frozen=True)
class MovieNotificationSummary:
    sources_synced: int
    sources_failed: int
    emails_sent: int
    events_notified: int


class MovieNotificationDispatcher(LetterboxdSourceDispatcher):
    def __init__(
        self,
        run_id=None,
        *,
        repository=None,
        http_client=requests,
        config=None,
        now_factory=None,
        delivery_id_factory=uuid4,
        request_context=None,
    ):
        config = config or TicketAlertConfig.from_environment()
        if repository is None:
            url, key = os.environ.get("SUPABASE_URL"), os.environ.get(
                "SUPABASE_SERVICE_ROLE_KEY"
            )
            if not url or not key:
                raise RuntimeError(
                    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for notifications."
                )
            repository = SupabaseMovieNotificationRepository(
                create_client(url, key),
                recipient_api_url=config.recipient_api_url,
                internal_api_secret=config.internal_api_secret,
                http_client=http_client,
            )
        super().__init__(
            run_id,
            repository=repository,
            http_client=http_client,
            config=config,
            now_factory=now_factory,
            delivery_id_factory=delivery_id_factory,
            request_context=request_context,
        )

    def dispatch(self):
        now = _jerusalem_now(self.now_factory())
        synced, failed = self._sync_sources(self.repository.load_sources(), now)
        active = self._match_unresolved_films()
        tickets, dates = self.repository.load_watches()
        ticket_pairs = {(r["user_id"], int(r["tmdb_id"])) for r in tickets}
        date_pairs = {(r["user_id"], int(r["tmdb_id"])) for r in dates}
        manual_tickets, manual_dates = set(ticket_pairs), set(date_pairs)
        baseline, established = set(), set()
        for row in active:
            if not row.get("tmdb_id"):
                continue
            pair = (row["user_id"], int(row["tmdb_id"]))
            ticket_pairs.add(pair)
            date_pairs.add(pair)
            (baseline if row.get("needs_baseline") else established).add(pair)
        pairs = defaultdict(set)
        for user, movie in ticket_pairs | date_pairs:
            pairs[user].add(movie)
        ids = sorted({movie for movies in pairs.values() for movie in movies})
        local_dates, showtimes, titles = (
            self.repository.load_local_events(ids, get_cinema_date(now))
            if ids
            else ([], [], {})
        )
        preferences, subscriptions = (
            self.repository.load_criteria(sorted(pairs), ids) if ids else ([], [])
        )
        locations = self.repository.load_locations(sorted(pairs)) if pairs else {}
        candidates = collect_first_availability(
            pairs=pairs,
            date_pairs=date_pairs,
            ticket_pairs=ticket_pairs,
            local_dates=local_dates,
            showtimes=showtimes,
            movie_titles=titles,
            preferences=preferences,
            subscriptions=subscriptions,
            locations=locations,
            now=now,
        )
        manual_baselines = {
            (row["user_id"], int(row["tmdb_id"])): set(row.get("baseline_cities") or [])
            for row in tickets
        }
        for event in candidates:
            pair = (event["user_id"], event["tmdb_id"])
            manual = (
                manual_tickets if event["event_type"] == "showtime" else manual_dates
            )
            if pair in baseline and pair not in established and pair not in manual:
                event["status"] = "suppressed"
            if event["event_type"] == "showtime" and event[
                "scope_city"
            ] in manual_baselines.get(pair, set()):
                event["status"] = "suppressed"
        self.repository.queue(candidates)
        self.repository.clear_baseline(
            [row for row in active if row.get("needs_baseline") and row.get("tmdb_id")]
        )
        sent = notified = 0
        failures = []
        for user in self.repository.pending_users():
            batch = self.repository.claim(user, str(self.delivery_id_factory()))
            if batch is None:
                continue
            try:
                snapshot = batch.get("email_snapshot")
                if snapshot is None:
                    email = render_movie_notification_email(batch["events"])
                    snapshot = {
                        "subject": email.subject,
                        "html": email.html,
                        "text": email.text,
                        "recipient": self.repository.canonical_email(user),
                        "from": self.config.from_email,
                    }
                snapshot = self.repository.attempt(batch, snapshot)
                if snapshot is None:
                    continue
                email = RenderedEmail(
                    snapshot["subject"], snapshot["html"], snapshot["text"]
                )
                resend_id = send_resend_email(
                    self.http_client,
                    api_key=self.config.resend_api_key,
                    from_email=snapshot["from"],
                    to_email=snapshot["recipient"],
                    delivery_id=batch["id"],
                    email=email,
                    idempotency_prefix="movie-notification",
                )
                self.repository.complete(batch, resend_id)
                sent += 1
                notified += len(batch["events"])
            except Exception as error:
                self.repository.fail(batch, error)
                failures.append(
                    f"{batch['id']}: {type(error).__name__}: {_text(error)}"
                )
        if failures:
            raise RuntimeError(
                "Movie notification delivery failed: " + " | ".join(failures)
            )
        return MovieNotificationSummary(synced, failed, sent, notified)

    def dataRun(self):
        result = self.dispatch()
        print(
            f"Movie notifications: {result.emails_sent} emails, {result.events_notified} first-availability updates; "
            f"{result.sources_synced} sources synced, {result.sources_failed} sources failed."
        )
