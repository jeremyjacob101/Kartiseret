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
from urllib.parse import urlsplit
from uuid import uuid4

import requests
from backend.utils.log.job_lease import create_client

from backend.notifications.letterboxd_alerts import (
    COMING_SOON_TABLE,
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
    build_movie_showtime_path,
    DEFAULT_SITE_URL,
    safe_site_url,
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


def _poster_url(value: Any) -> str | None:
    candidate = _text(value)
    if not candidate:
        return None
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or parsed.query
        or parsed.fragment
    ):
        return None
    if parsed.hostname == "image.tmdb.org" and parsed.path.startswith("/t/p/"):
        return candidate
    if parsed.hostname == "seret.site" and parsed.path.startswith(
        "/api/images/v1/poster/"
    ):
        return candidate
    return None


def _unsubscribe_url(value: str, *, allow_fragment: bool) -> str:
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Movie notification unsubscribe URLs must be safe HTTPS URLs.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("Movie notification unsubscribe URLs must be safe HTTPS URLs.") from exc
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or (parsed.fragment and not allow_fragment)
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError("Movie notification unsubscribe URLs must be safe HTTPS URLs.")
    return value


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
    movie_codes: dict[int, str] | None = None,
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
            movie_codes=movie_codes,
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


def render_movie_notification_email(
    events: list[dict],
    site_url: str = DEFAULT_SITE_URL,
    movie_codes: dict[int, str] | None = None,
    *,
    letterboxd_manage_url: str | None = None,
    one_click_unsubscribe_url: str | None = None,
) -> RenderedEmail:
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
    destination_origin = safe_site_url(site_url)
    for kind in ("coming_soon", "showtime"):
        films = sections.get(kind, {})
        if not films:
            continue
        count = len(films)
        heading = f"{titles[kind]} · {count} film" + ("s" if count != 1 else "")
        html_items, text_items = [], []
        for movie_id, payloads in sorted(
            films.items(), key=lambda item: _text(item[1][0].get("title")).casefold()
        ):
            title = _text(payloads[0].get("title")) or "Untitled movie"
            try:
                tmdb_id = int(movie_id)
            except (TypeError, ValueError):
                tmdb_id = 0
            fallback_movie_code = (movie_codes or {}).get(tmdb_id)
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
                    filter_mask = payload.get("filter_mask", 0)
                    movie_path = build_movie_showtime_path(
                        _text(payload.get("movie_code")) or fallback_movie_code,
                        _text(payload.get("screening_city")),
                        _text(payload.get("date_of_showing")),
                        filter_mask if isinstance(filter_mask, int) and not isinstance(filter_mask, bool) else 0,
                    )
                    movie_url = f"{destination_origin}{movie_path}"
                    details_html.append(
                        f'{escape(detail)} · <a href="{escape(movie_url, quote=True)}">View showtimes</a>'
                    )
                    details_text.append(f"{detail}\n  View showtimes: {movie_url}")
            poster_url = _poster_url(payloads[0].get("poster_url"))
            poster_cell = (
                '<td width="84" valign="top" style="padding:0 16px 0 0;">'
                f'<img src="{escape(poster_url, quote=True)}" width="84" height="126" '
                f'alt="{escape(title, quote=True)} poster" style="display:block;width:84px;'
                'height:126px;object-fit:cover;border:1px solid #e7e1d7;border-radius:7px;">'
                "</td>"
                if poster_url
                else '<td width="84" valign="top" style="padding:0 16px 0 0;">'
                '<div role="img" aria-label="Film poster unavailable" style="width:84px;'
                'height:126px;border:1px solid #e7e1d7;border-radius:7px;background:#f2eee7;'
                'color:#756d61;text-align:center;font-size:10px;line-height:126px;'
                'letter-spacing:1.4px;">KARTISERET</div></td>'
            )
            details_markup = "".join(
                f'<div style="margin:0 0 8px;color:#5e5a54;font-size:14px;line-height:1.5;">{detail}</div>'
                for detail in details_html
            )
            ticket_button = ""
            if kind == "showtime":
                first_payload = payloads[0]
                first_mask = first_payload.get("filter_mask", 0)
                first_path = build_movie_showtime_path(
                    _text(first_payload.get("movie_code")) or fallback_movie_code,
                    _text(first_payload.get("screening_city")),
                    _text(first_payload.get("date_of_showing")),
                    first_mask if isinstance(first_mask, int) and not isinstance(first_mask, bool) else 0,
                )
                first_movie_url = f"{destination_origin}{first_path}"
                ticket_button = (
                    '<a href="'
                    + escape(first_movie_url, quote=True)
                    + '" style="display:inline-block;margin-top:5px;padding:9px 14px;'
                    'border-radius:6px;background:#5f3b91;color:#ffffff;font-size:13px;'
                    'font-weight:700;line-height:1.2;text-decoration:none;">View showtimes</a>'
                )
            html_items.append(
                '<tr><td style="padding:0 0 12px;">'
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                'style="width:100%;border:1px solid #e8e1d7;border-radius:10px;'
                'background:#fffefa;"><tr>'
                + '<td style="padding:16px;">'
                + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
                + poster_cell
                + '<td valign="middle" style="font-family:Arial,sans-serif;">'
                + f'<div style="margin:0 0 8px;color:#24211e;font-size:17px;font-weight:700;line-height:1.3;">{escape(title)}</div>'
                + details_markup
                + ticket_button
                + "</td></tr></table>"
                + "</td></tr></table></td></tr>"
            )
            text_items.append(f"- {title}\n  " + "\n  ".join(details_text))
        html_sections.append(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="width:100%;margin:0 0 22px;">'
            '<tr><td style="padding:0 0 10px;border-bottom:1px solid #ebe5dc;">'
            f'<h2 style="margin:0;color:#302a22;font-size:17px;line-height:1.35;">{escape(heading)}</h2>'
            "</td></tr>"
            + "".join(html_items)
            + "</table>"
        )
        text_sections.append(heading + "\n\n" + "\n\n".join(text_items))
    total_films = sum(counts.values())
    preheader = (
        f"A new cinema update is here for {total_films} film"
        + ("s" if total_films != 1 else "")
        + "."
    )
    headers: dict[str, str] = {}
    if letterboxd_manage_url is not None or one_click_unsubscribe_url is not None:
        if not letterboxd_manage_url or not one_click_unsubscribe_url:
            raise ValueError("Both movie notification unsubscribe links are required.")
        letterboxd_manage_url = _unsubscribe_url(
            letterboxd_manage_url, allow_fragment=True
        )
        one_click_unsubscribe_url = _unsubscribe_url(
            one_click_unsubscribe_url, allow_fragment=False
        )
        safe_manage_url = escape(letterboxd_manage_url, quote=True)
        unsubscribe_footer = (
            '<p style="margin:0 0 9px;color:#5f3b91;font-size:12px;line-height:1.6;">'
            f'<a href="{safe_manage_url}" style="color:#5f3b91;font-weight:700;">'
            "Manage Letterboxd list alerts</a></p>"
            '<p style="margin:0;color:#6f685e;font-size:11px;line-height:1.6;">'
            "Use your email app’s unsubscribe control to stop all current movie alerts, "
            "including connected Letterboxd lists and individual movie watches.</p>"
        )
        footer_text = (
            "Manage Letterboxd list alerts:\n"
            f"{letterboxd_manage_url}\n\n"
            "Use your email app's unsubscribe control to stop all current movie alerts, "
            "including connected Letterboxd lists and individual movie watches."
        )
        headers = {
            "List-Unsubscribe": f"<{one_click_unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
    else:
        unsubscribe_footer = (
            '<p style="margin:16px 0 0;color:#827b71;font-size:12px;line-height:1.6;">'
            "A one-time note from Kartiseret. You will not receive another email for these films.</p>"
        )
        footer_text = ""
    return RenderedEmail(
        subject=" · ".join(subject_parts),
        html="".join(
            [
                '<!doctype html><html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1">'
                "<title>Kartiseret cinema updates</title></head>",
                '<body style="margin:0;padding:0;background:#f3f0ea;color:#26221e;'
                'font-family:Arial,Helvetica,sans-serif;">',
                f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader)}</div>',
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                'style="width:100%;background:#f3f0ea;"><tr><td align="center" style="padding:32px 16px;">',
                '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
                'style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e5dfd5;'
                'border-radius:14px;overflow:hidden;">',
                '<tr><td style="height:5px;background:#c7a35c;font-size:0;line-height:0;">&nbsp;</td></tr>',
                '<tr><td align="center" style="padding:28px 30px 22px;">',
                '<div style="margin:0;color:#5f3b91;font-size:13px;font-weight:700;'
                'letter-spacing:2px;line-height:1.4;">KARTISERET</div>',
                '<h1 style="margin:12px 0 8px;color:#24211e;font-size:25px;line-height:1.25;">Cinema, closer to home</h1>',
                '<p style="margin:0;color:#716b62;font-size:14px;line-height:1.5;">Your latest film updates</p>',
                '</td></tr>',
                '<tr><td style="padding:0 30px 6px;">',
                '<div style="padding:15px 17px;border:1px solid #ede6d9;border-radius:9px;'
                'background:#faf8f4;color:#514b43;font-size:14px;line-height:1.55;text-align:center;">',
                'Based on your watched films, selected cities, and notification settings.',
                '</div></td></tr>',
                '<tr><td style="padding:22px 30px 8px;">',
                "".join(html_sections),
                '</td></tr>',
                '<tr><td align="center" style="padding:8px 30px 26px;border-top:1px solid #eee9e1;">',
                unsubscribe_footer,
                '</td></tr></table></td></tr></table></body></html>',
            ]
        ),
        text=(
            "Kartiseret cinema updates\n\n"
            + "\n\n".join(text_sections)
            + ("\n\n" + footer_text if footer_text else "")
        ),
        headers=headers,
    )


def create_movie_notification_unsubscribe_urls(
    http_client: Any,
    *,
    base_url: str,
    internal_secret: str,
    site_url: str,
    user_id: str,
    delivery_id: str,
) -> tuple[str, str] | None:
    api = urlsplit(base_url)
    try:
        api_port = api.port
    except ValueError as exc:
        raise RuntimeError("A valid recipient API origin is required.") from exc
    if (
        not base_url
        or not internal_secret
        or api.username
        or api.password
        or api.query
        or api.fragment
        or api.path not in ("", "/")
        or not api.hostname
        or (api.scheme != "https" and not (
            api.scheme == "http" and api.hostname in ("localhost", "127.0.0.1", "::1")
        ))
        or (api_port is not None and not 1 <= api_port <= 65535)
    ):
        raise RuntimeError(
            "A valid recipient API origin and internal credential are required."
        )
    site = urlsplit(site_url)
    try:
        site_port = site.port
    except ValueError as exc:
        raise ValueError("SITE_URL must be a secure site origin.") from exc
    if (
        not site.hostname
        or site.username
        or site.password
        or site.query
        or site.fragment
        or site.path not in ("", "/")
        or site.scheme != "https"
        or (site_port is not None and not 1 <= site_port <= 65535)
    ):
        raise ValueError("SITE_URL must be a secure site origin.")
    response = http_client.post(
        base_url.rstrip("/")
        + "/api/internal/movie-notification-unsubscribe-tokens",
        headers={"Authorization": f"Bearer {internal_secret}"},
        json={"userId": user_id, "deliveryId": delivery_id},
        timeout=(5, 15),
        allow_redirects=False,
    )
    if int(getattr(response, "status_code", 0) or 0) != 200:
        raise RuntimeError(
            "Movie notification unsubscribe links could not be created."
        )
    try:
        body = response.json()
        data = body.get("data") if isinstance(body, dict) else None
        if isinstance(data, dict) and data.get("eligible") is False:
            return None
        manage_token = data.get("manageLetterboxd") if isinstance(data, dict) else None
        one_click_token = data.get("oneClickAll") if isinstance(data, dict) else None
    except Exception as exc:
        raise RuntimeError("Movie notification unsubscribe links were invalid.") from exc
    token_values = (manage_token, one_click_token)
    if not all(
        isinstance(token, str)
        and len(token) == 43
        and all(character.isalnum() or character in "-_" for character in token)
        for token in token_values
    ):
        raise RuntimeError("Movie notification unsubscribe links were invalid.")
    origin = f"{site.scheme}://{site.netloc}"
    return (
        f"{origin}/unsubscribe/letterboxd#token={manage_token}",
        f"{origin}/api/v1/unsubscribe/one-click/{one_click_token}",
    )


class SupabaseMovieNotificationRepository(SupabaseLetterboxdRepository):
    def letterboxd_supported_movies(self, user_id: str, tmdb_ids: list[int]) -> set[int]:
        if not tmdb_ids:
            return set()
        rows = self._collect_pages(
            lambda start, end: self.supabase.table("letterboxd_source_films")
            .select("tmdb_id")
            .eq("user_id", user_id)
            .in_("tmdb_id", tmdb_ids)
            .is_("removed_at", "null")
            .order("tmdb_id")
            .range(start, end)
        )
        supported: set[int] = set()
        for row in rows:
            try:
                supported.add(int(row["tmdb_id"]))
            except (KeyError, TypeError, ValueError):
                continue
        return supported

    def load_movie_posters(self, tmdb_ids: list[int]) -> dict[int, str]:
        posters: dict[int, str] = {}
        for table_name in (NOW_PLAYING_TABLE, COMING_SOON_TABLE):
            for start in range(0, len(tmdb_ids), 150):
                chunk = tmdb_ids[start : start + 150]
                rows = self._collect_pages(
                    lambda page_start, page_end: self.supabase.table(table_name)
                    .select("tmdb_id,en_poster")
                    .in_("tmdb_id", chunk)
                    .range(page_start, page_end)
                )
                for row in rows:
                    try:
                        tmdb_id = int(row["tmdb_id"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    poster_url = _poster_url(row.get("en_poster"))
                    if poster_url:
                        posters.setdefault(tmdb_id, poster_url)
        return posters

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
        movie_codes = self.repository.load_movie_codes(ids) if ids else {}
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
            movie_codes=movie_codes,
        )
        poster_loader = getattr(self.repository, "load_movie_posters", None)
        posters = poster_loader(ids) if callable(poster_loader) else {}
        for event in candidates:
            poster_url = _poster_url(posters.get(int(event["tmdb_id"])))
            if poster_url:
                event["event_payload"]["poster_url"] = poster_url
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
                    batch_movie_ids = sorted(
                        {
                            int(event["tmdb_id"])
                            for event in batch["events"]
                            if str(event.get("tmdb_id", "")).isdigit()
                        }
                    )
                    batch_movie_codes = self.repository.load_movie_codes(
                        batch_movie_ids
                    )
                    support_reader = getattr(
                        self.repository, "letterboxd_supported_movies", None
                    )
                    supported_ids = (
                        support_reader(user, batch_movie_ids)
                        if callable(support_reader)
                        else set()
                    )
                    unsubscribe_urls = None
                    if supported_ids:
                        unsubscribe_urls = create_movie_notification_unsubscribe_urls(
                            self.http_client,
                            base_url=self.config.recipient_api_url,
                            internal_secret=self.config.internal_api_secret,
                            site_url=self.config.site_url,
                            user_id=user,
                            delivery_id=batch["id"],
                        )
                    email = render_movie_notification_email(
                        batch["events"],
                        self.config.site_url,
                        batch_movie_codes,
                        **(
                            {
                                "letterboxd_manage_url": unsubscribe_urls[0],
                                "one_click_unsubscribe_url": unsubscribe_urls[1],
                            }
                            if unsubscribe_urls is not None
                            else {}
                        ),
                    )
                    snapshot = {
                        "subject": email.subject,
                        "html": email.html,
                        "text": email.text,
                        "headers": email.headers,
                        "recipient": self.repository.canonical_email(user),
                        "from": self.config.from_email,
                    }
                snapshot = self.repository.attempt(batch, snapshot)
                if snapshot is None:
                    continue
                email = RenderedEmail(
                    snapshot["subject"],
                    snapshot["html"],
                    snapshot["text"],
                    snapshot.get("headers") or {},
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
