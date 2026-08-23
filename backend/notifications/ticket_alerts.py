from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from html import escape
from typing import Any, Callable
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo
import os
import re

import requests
from supabase import create_client


TICKET_ALERTS_TABLE = "ticket_alert_subscriptions"
SHOWTIMES_TABLE = "finalShowtimes"
PREFERENCES_TABLE = "userPreferences"
MOVIE_CODES_TABLE = "movieCodes"
RESEND_ENDPOINT = "https://api.resend.com/emails"
DEFAULT_FROM_EMAIL = "Kartiseret <notifications@seret.site>"
DEFAULT_SITE_URL = "https://seret.site"
DEFAULT_LOCATION = "Jerusalem"
JERUSALEM_TIME_ZONE = ZoneInfo("Asia/Jerusalem")
SHOWTIME_DAY_CUTOFF_MINUTES = 65
SHOWTIME_GRACE_PERIOD_MINUTES = 15
SHOWTIME_LINK_DATE_COUNT = 62
DATE_CODE_ALPHABET = (
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)
MOVIE_CODE_PATTERN = re.compile(r"^[0-9A-Za-z]{3}$")
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
CITY_CODE_BY_NAME = {
    "Jerusalem": "i",
    "Tel Aviv": "l",
    "Glilot": "j",
    "Modiin": "I",
    "Herziliya": "t",
    "Afula": "2",
    "Ashdod": "3",
    "Ashkelon": "4",
    "Ayalon": "5",
    "Beer Sheva": "7",
    "Carmiel": "f",
    "Chadera": "k",
    "Even Yehuda": "r",
    "Givatayim": "s",
    "Haifa": "v",
    "Kfar Saba": "x",
    "Kiryat Bialik": "y",
    "Kiryat Ono": "z",
    "Nahariya": "F",
    "Netanya": "J",
    "Omer": "L",
    "Petach Tikvah": "T",
    "Raanana": "0",
    "Ramat Hasharon": "6",
    "Rehovot": "8",
    "Rishon Letzion": "9",
    "Zichron Yaakov": "a",
    "Holon": "b",
}


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _parse_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(_text(value))
    except (TypeError, ValueError):
        return None


def _parse_showtime_minutes(value: Any) -> int | None:
    match = re.match(r"^(\d{1,2}):(\d{2})", _text(value))
    if not match:
        return None

    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def _format_showtime(value: Any) -> str | None:
    minutes = _parse_showtime_minutes(value)
    if minutes is None:
        return None
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def _jerusalem_now(value: datetime | None = None) -> datetime:
    if value is None:
        return datetime.now(JERUSALEM_TIME_ZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=JERUSALEM_TIME_ZONE)
    return value.astimezone(JERUSALEM_TIME_ZONE)


def get_cinema_date(value: datetime | None = None) -> date:
    now = _jerusalem_now(value)
    now_minutes = now.hour * 60 + now.minute
    return now.date() if now_minutes >= SHOWTIME_DAY_CUTOFF_MINUTES else now.date() - timedelta(days=1)


def is_future_showtime(
    showing_date: Any,
    showtime: Any,
    now: datetime | None = None,
) -> bool:
    cinema_date = _parse_date(showing_date)
    showtime_minutes = _parse_showtime_minutes(showtime)
    if cinema_date is None or showtime_minutes is None:
        return False

    effective_date = (
        cinema_date + timedelta(days=1)
        if showtime_minutes < SHOWTIME_DAY_CUTOFF_MINUTES
        else cinema_date
    )
    current = _jerusalem_now(now)
    if effective_date > current.date():
        return True
    if effective_date < current.date():
        return False
    return (
        showtime_minutes + SHOWTIME_GRACE_PERIOD_MINUTES
        >= current.hour * 60 + current.minute
    )


def valid_ticket_href(row: dict[str, Any]) -> str | None:
    for raw_value in (row.get("english_href"), row.get("hebrew_href")):
        href = _text(raw_value)
        if not href:
            continue
        try:
            parsed = urlsplit(href)
            if parsed.scheme.lower() in {"http", "https"} and parsed.hostname:
                return href
        except ValueError:
            continue
    return None


@dataclass(frozen=True)
class LinkedShowtime:
    city: str
    cinema: str
    date: str
    time: str
    ticket_href: str
    title: str

    @property
    def sort_key(self) -> tuple[Any, ...]:
        minutes = _parse_showtime_minutes(self.time)
        adjusted_minutes = (
            minutes + 24 * 60
            if minutes is not None and minutes < SHOWTIME_DAY_CUTOFF_MINUTES
            else minutes
        )
        return (
            self.date,
            adjusted_minutes if adjusted_minutes is not None else 10**9,
            self.city.casefold(),
            self.cinema.casefold(),
            self.ticket_href,
        )


def select_linked_showtime(
    rows: list[dict[str, Any]],
    preferred_city: str,
    now: datetime | None = None,
) -> LinkedShowtime | None:
    earliest_preferred: LinkedShowtime | None = None
    earliest_anywhere: LinkedShowtime | None = None

    for row in rows:
        city = _text(row.get("screening_city"))
        showing_date = _text(row.get("date_of_showing"))
        showtime = _format_showtime(row.get("showtime"))
        ticket_href = valid_ticket_href(row)
        if not (
            city
            and showing_date
            and showtime
            and ticket_href
            and is_future_showtime(showing_date, showtime, now)
        ):
            continue

        candidate = LinkedShowtime(
            city=city,
            cinema=_text(row.get("cinema")),
            date=showing_date,
            time=showtime,
            ticket_href=ticket_href,
            title=_text(row.get("english_title")),
        )
        if earliest_anywhere is None or candidate.sort_key < earliest_anywhere.sort_key:
            earliest_anywhere = candidate
        if city == preferred_city and (
            earliest_preferred is None
            or candidate.sort_key < earliest_preferred.sort_key
        ):
            earliest_preferred = candidate

    return earliest_preferred or earliest_anywhere


def encode_date_code(value: date) -> str:
    epoch_day = (value - date(1970, 1, 1)).days
    return DATE_CODE_ALPHABET[epoch_day % len(DATE_CODE_ALPHABET)]


def build_ticket_alert_path(
    movie_code: str | None,
    city: str,
    showing_date: str,
    cinema_today: date,
) -> str:
    code = _text(movie_code)
    if not MOVIE_CODE_PATTERN.fullmatch(code):
        return "/showtimes"

    plain_path = f"/{code}"
    parsed_date = _parse_date(showing_date)
    city_code = CITY_CODE_BY_NAME.get(city)
    last_linked_date = cinema_today + timedelta(days=SHOWTIME_LINK_DATE_COUNT - 1)
    if (
        parsed_date is None
        or city_code is None
        or parsed_date < cinema_today
        or parsed_date > last_linked_date
    ):
        return plain_path

    return f"/{code}{city_code}{encode_date_code(parsed_date)}j"


def build_ticket_alert_url(
    item: "DeliveryItem",
    site_url: str,
    cinema_today: date,
) -> str:
    path = build_ticket_alert_path(
        item.movie_code,
        item.city,
        item.date,
        cinema_today,
    )
    return f"{site_url.rstrip('/')}{path}"


@dataclass(frozen=True)
class DeliveryItem:
    tmdb_id: int
    title: str
    city: str
    date: str
    ticket_href: str
    movie_code: str | None

    def as_claim_item(self) -> dict[str, Any]:
        return {
            "tmdb_id": self.tmdb_id,
            "title": self.title,
            "city": self.city,
            "showing_date": self.date,
            "ticket_href": self.ticket_href,
            "movie_code": self.movie_code,
        }


@dataclass(frozen=True)
class DeliveryBatch:
    user_id: str
    delivery_id: str
    items: tuple[DeliveryItem, ...]


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


@dataclass(frozen=True)
class DispatchSummary:
    pending_subscriptions: int
    emails_sent: int
    movies_notified: int


@dataclass(frozen=True)
class TicketAlertConfig:
    resend_api_key: str
    from_email: str
    site_url: str

    @classmethod
    def from_environment(cls) -> "TicketAlertConfig":
        return cls(
            resend_api_key=os.environ.get("RESEND_API_KEY", "").strip(),
            from_email=os.environ.get("RESEND_FROM_EMAIL", DEFAULT_FROM_EMAIL).strip()
            or DEFAULT_FROM_EMAIL,
            site_url=os.environ.get("SITE_URL", DEFAULT_SITE_URL).strip()
            or DEFAULT_SITE_URL,
        )


def delivery_item_from_snapshot(row: dict[str, Any]) -> DeliveryItem | None:
    tmdb_id = _positive_int(row.get("tmdb_id"))
    title = _text(row.get("delivery_title"))
    city = _text(row.get("delivery_city"))
    showing_date = _text(row.get("delivery_date"))
    ticket_href = _text(row.get("delivery_href"))
    movie_code = _text(row.get("delivery_movie_code")) or None
    if not (
        tmdb_id
        and title
        and city
        and _parse_date(showing_date)
        and valid_ticket_href({"english_href": ticket_href})
    ):
        return None
    if movie_code and not MOVIE_CODE_PATTERN.fullmatch(movie_code):
        movie_code = None
    return DeliveryItem(
        tmdb_id=tmdb_id,
        title=title,
        city=city,
        date=showing_date,
        ticket_href=ticket_href,
        movie_code=movie_code,
    )


def _safe_header(value: str) -> str:
    return _text(value.replace("\r", " ").replace("\n", " "))


def _friendly_date(value: str) -> str:
    parsed = _parse_date(value)
    if parsed is None:
        return value
    return parsed.strftime("%B %d, %Y").replace(" 0", " ")


def render_ticket_alert_email(
    items: tuple[DeliveryItem, ...],
    site_url: str,
    cinema_today: date,
) -> RenderedEmail:
    if not items:
        raise ValueError("A ticket alert email must contain at least one movie.")

    sorted_items = tuple(sorted(items, key=lambda item: (item.title.casefold(), item.tmdb_id)))
    if len(sorted_items) == 1:
        subject = f"Tickets for {_safe_header(sorted_items[0].title)} are now on sale!"
    else:
        subject = f"Tickets for {len(sorted_items)} movies are now on sale!"

    html_items: list[str] = []
    text_items: list[str] = []
    for item in sorted_items:
        movie_url = build_ticket_alert_url(item, site_url, cinema_today)
        title = escape(item.title)
        city = escape(item.city)
        friendly_date = escape(_friendly_date(item.date))
        escaped_url = escape(movie_url, quote=True)
        html_items.append(
            "".join(
                [
                    '<li style="margin:0 0 18px;">',
                    f'<strong style="font-size:17px;">{title}</strong><br>',
                    f'<span style="color:#685f72;">{city} · {friendly_date}</span><br>',
                    f'<a href="{escaped_url}" style="color:#7a3db8;font-weight:700;">View showtimes</a>',
                    "</li>",
                ]
            )
        )
        text_items.append(
            f"- {item.title} — {item.city}, {_friendly_date(item.date)}\n  {movie_url}"
        )

    count_intro = (
        f"Tickets for {sorted_items[0].title} are now on sale."
        if len(sorted_items) == 1
        else f"Tickets for {len(sorted_items)} movies you follow are now on sale."
    )
    html_body = "".join(
        [
            '<!doctype html><html><body style="margin:0;background:#f7f4fa;color:#211a29;font-family:Arial,sans-serif;">',
            '<div style="max-width:600px;margin:0 auto;padding:32px 22px;">',
            '<div style="background:#ffffff;border:1px solid #e5dcec;border-radius:18px;padding:28px;">',
            '<p style="margin:0 0 8px;color:#7a3db8;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Kartiseret</p>',
            '<h1 style="margin:0 0 20px;font-size:25px;line-height:1.2;">Tickets are on sale</h1>',
            f'<p style="margin:0 0 22px;line-height:1.55;">{escape(count_intro)}</p>',
            f'<ul style="margin:0;padding-left:22px;">{"".join(html_items)}</ul>',
            '<p style="margin:24px 0 0;color:#685f72;font-size:13px;line-height:1.5;">You requested this one-time alert on Kartiseret. You will not receive another email for these movies.</p>',
            "</div></div></body></html>",
        ]
    )
    text_body = "\n\n".join(
        [
            "Kartiseret — Tickets are on sale",
            count_intro,
            "\n".join(text_items),
            "You requested this one-time alert on Kartiseret. You will not receive another email for these movies.",
        ]
    )
    return RenderedEmail(subject=subject, html=html_body, text=text_body)


def get_canonical_auth_email(supabase_client: Any, user_id: str) -> str:
    response = supabase_client.auth.admin.get_user_by_id(user_id)
    user = getattr(response, "user", None)
    if user is None and isinstance(response, dict):
        user = response.get("user")

    if isinstance(user, dict):
        email = _text(user.get("email"))
    else:
        email = _text(getattr(user, "email", None))

    if not EMAIL_PATTERN.fullmatch(email) or "\r" in email or "\n" in email:
        raise ValueError(f"Supabase Auth user {user_id} has no deliverable email address.")
    return email


def send_resend_email(
    http_client: Any,
    *,
    api_key: str,
    from_email: str,
    to_email: str,
    delivery_id: str,
    email: RenderedEmail,
) -> str:
    if not api_key:
        raise RuntimeError("RESEND_API_KEY is required for ticket alert delivery.")
    if "\r" in from_email or "\n" in from_email or not from_email.strip():
        raise ValueError("RESEND_FROM_EMAIL is invalid.")

    response = http_client.post(
        RESEND_ENDPOINT,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"ticket-alert-{delivery_id}",
        },
        json={
            "from": from_email,
            "to": [to_email],
            "subject": email.subject,
            "html": email.html,
            "text": email.text,
        },
        timeout=20,
    )
    status_code = int(getattr(response, "status_code", 0) or 0)
    if status_code < 200 or status_code >= 300:
        response_text = _text(getattr(response, "text", ""))[:500]
        suffix = f": {response_text}" if response_text else ""
        raise RuntimeError(f"Resend returned HTTP {status_code}{suffix}")

    try:
        response_payload = response.json()
    except Exception as exc:
        raise RuntimeError("Resend returned an invalid JSON response.") from exc
    resend_id = _text(
        response_payload.get("id") if isinstance(response_payload, dict) else None
    )
    if not resend_id:
        raise RuntimeError("Resend did not return an email ID.")
    return resend_id


class SupabaseTicketAlertRepository:
    def __init__(self, supabase_client: Any):
        self.supabase = supabase_client

    @staticmethod
    def _collect_pages(
        query_for_range: Callable[[int, int], Any],
        page_size: int = 500,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        start = 0
        while True:
            response = query_for_range(start, start + page_size - 1).execute()
            page_rows = list(response.data or [])
            rows.extend(page_rows)
            if len(page_rows) < page_size:
                return rows
            start += page_size

    def load_pending_subscriptions(self) -> list[dict[str, Any]]:
        columns = ",".join(
            [
                "user_id",
                "tmdb_id",
                "created_at",
                "notified_at",
                "delivery_id",
                "delivery_title",
                "delivery_city",
                "delivery_date",
                "delivery_href",
                "delivery_movie_code",
                "delivery_attempts",
                "last_delivery_attempt_at",
            ]
        )
        return self._collect_pages(
            lambda start, end: self.supabase.table(TICKET_ALERTS_TABLE)
            .select(columns)
            .is_("notified_at", "null")
            .order("created_at")
            .order("user_id")
            .order("tmdb_id")
            .range(start, end)
        )

    def _load_rows_for_ids(
        self,
        table_name: str,
        columns: str,
        tmdb_ids: list[int],
        *,
        earliest_date: str | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for start in range(0, len(tmdb_ids), 150):
            chunk = tmdb_ids[start : start + 150]

            def query_for_range(page_start: int, page_end: int):
                query = (
                    self.supabase.table(table_name)
                    .select(columns)
                    .in_("tmdb_id", chunk)
                )
                if earliest_date is not None:
                    query = query.gte("date_of_showing", earliest_date)
                order_column = (
                    "id"
                    if table_name in {SHOWTIMES_TABLE, "finalSoons"}
                    else "tmdb_id"
                )
                return query.order(order_column).range(page_start, page_end)

            rows.extend(self._collect_pages(query_for_range))
        return rows

    def load_showtimes(
        self, tmdb_ids: list[int], earliest_date: str
    ) -> list[dict[str, Any]]:
        return self._load_rows_for_ids(
            SHOWTIMES_TABLE,
            "tmdb_id,english_title,screening_city,date_of_showing,showtime,cinema,english_href,hebrew_href",
            tmdb_ids,
            earliest_date=earliest_date,
        )

    def load_titles(self, tmdb_ids: list[int]) -> dict[int, str]:
        titles: dict[int, str] = {}
        for table_name in ("finalSoons", "finalMovies"):
            rows = self._load_rows_for_ids(
                table_name, "tmdb_id,english_title", tmdb_ids
            )
            for row in rows:
                tmdb_id = _positive_int(row.get("tmdb_id"))
                title = _text(row.get("english_title"))
                if tmdb_id and title:
                    titles[tmdb_id] = title
        return titles

    def load_movie_codes(self, tmdb_ids: list[int]) -> dict[int, str]:
        codes: dict[int, str] = {}
        rows = self._load_rows_for_ids(
            MOVIE_CODES_TABLE, "tmdb_id,movie_code", tmdb_ids
        )
        for row in rows:
            tmdb_id = _positive_int(row.get("tmdb_id"))
            movie_code = _text(row.get("movie_code"))
            if tmdb_id and MOVIE_CODE_PATTERN.fullmatch(movie_code):
                codes[tmdb_id] = movie_code
        return codes

    def load_preferred_cities(self, user_ids: list[str]) -> dict[str, str]:
        rows: list[dict[str, Any]] = []
        for start in range(0, len(user_ids), 150):
            chunk = user_ids[start : start + 150]
            response = (
                self.supabase.table(PREFERENCES_TABLE)
                .select("user_id,location")
                .in_("user_id", chunk)
                .execute()
            )
            rows.extend(response.data or [])

        preferences: dict[str, str] = {}
        for row in rows:
            user_id = _text(row.get("user_id"))
            location = _text(row.get("location"))
            if user_id and location in CITY_CODE_BY_NAME:
                preferences[user_id] = location
        return preferences

    def claim_delivery(
        self,
        user_id: str,
        delivery_id: str,
        items: tuple[DeliveryItem, ...],
    ) -> list[dict[str, Any]]:
        response = self.supabase.rpc(
            "claim_ticket_alert_delivery",
            {
                "p_user_id": user_id,
                "p_delivery_id": delivery_id,
                "p_items": [item.as_claim_item() for item in items],
            },
        ).execute()
        return list(response.data or [])

    def record_attempt(self, user_id: str, delivery_id: str) -> None:
        response = self.supabase.rpc(
            "record_ticket_alert_delivery_attempt",
            {"p_user_id": user_id, "p_delivery_id": delivery_id},
        ).execute()
        updated_count = int(response.data or 0)
        if updated_count <= 0:
            raise RuntimeError("The ticket alert delivery batch is no longer pending.")

    def canonical_email(self, user_id: str) -> str:
        return get_canonical_auth_email(self.supabase, user_id)

    def mark_success(
        self,
        user_id: str,
        delivery_id: str,
        resend_email_id: str,
        delivered_at: datetime,
    ) -> None:
        (
            self.supabase.table(TICKET_ALERTS_TABLE)
            .update(
                {
                    "notified_at": delivered_at.isoformat(),
                    "resend_email_id": resend_email_id,
                    "last_delivery_error": None,
                }
            )
            .eq("user_id", user_id)
            .eq("delivery_id", delivery_id)
            .is_("notified_at", "null")
            .execute()
        )

    def mark_failure(self, user_id: str, delivery_id: str, error: str) -> None:
        safe_error = _text(error)[:2_000] or "Unknown ticket alert delivery failure"
        (
            self.supabase.table(TICKET_ALERTS_TABLE)
            .update({"last_delivery_error": safe_error})
            .eq("user_id", user_id)
            .eq("delivery_id", delivery_id)
            .is_("notified_at", "null")
            .execute()
        )


class TicketAlertDispatcher:
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
    ):
        self.run_id = run_id
        self.http_client = http_client
        self.config = config or TicketAlertConfig.from_environment()
        self.now_factory = now_factory or (lambda: datetime.now(JERUSALEM_TIME_ZONE))
        self.delivery_id_factory = delivery_id_factory
        if repository is None:
            supabase_url = os.environ.get("SUPABASE_URL", "").strip()
            service_role_key = os.environ.get(
                "SUPABASE_SERVICE_ROLE_KEY", ""
            ).strip()
            if not supabase_url or not service_role_key:
                raise RuntimeError(
                    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for ticket alerts."
                )
            repository = SupabaseTicketAlertRepository(
                create_client(supabase_url, service_role_key)
            )
        self.repository = repository

    @staticmethod
    def _retry_batches(
        pending_rows: list[dict[str, Any]],
    ) -> list[DeliveryBatch]:
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in pending_rows:
            user_id = _text(row.get("user_id"))
            delivery_id = _text(row.get("delivery_id"))
            if user_id and delivery_id:
                groups.setdefault((user_id, delivery_id), []).append(row)

        earliest_by_user: dict[str, tuple[str, list[dict[str, Any]]]] = {}
        for (user_id, delivery_id), rows in groups.items():
            created_at = min(_text(row.get("created_at")) for row in rows)
            current = earliest_by_user.get(user_id)
            if current is None or (created_at, delivery_id) < (
                min(_text(row.get("created_at")) for row in current[1]),
                current[0],
            ):
                earliest_by_user[user_id] = (delivery_id, rows)

        batches: list[DeliveryBatch] = []
        for user_id, (delivery_id, rows) in sorted(earliest_by_user.items()):
            parsed_items = [delivery_item_from_snapshot(row) for row in rows]
            items = (
                tuple(item for item in parsed_items if item is not None)
                if all(item is not None for item in parsed_items)
                else ()
            )
            batches.append(
                DeliveryBatch(
                    user_id=user_id,
                    delivery_id=delivery_id,
                    items=items,
                )
            )
        return batches

    def _new_batches(
        self,
        pending_rows: list[dict[str, Any]],
        retry_user_ids: set[str],
        now: datetime,
    ) -> list[DeliveryBatch]:
        unclaimed_rows = [
            row
            for row in pending_rows
            if not _text(row.get("delivery_id"))
            and _text(row.get("user_id")) not in retry_user_ids
        ]
        tmdb_ids = sorted(
            {
                tmdb_id
                for tmdb_id in (
                    _positive_int(row.get("tmdb_id")) for row in unclaimed_rows
                )
                if tmdb_id is not None
            }
        )
        user_ids = sorted(
            {_text(row.get("user_id")) for row in unclaimed_rows if row.get("user_id")}
        )
        if not tmdb_ids or not user_ids:
            return []

        showtime_rows = self.repository.load_showtimes(
            tmdb_ids, get_cinema_date(now).isoformat()
        )
        titles = self.repository.load_titles(tmdb_ids)
        movie_codes = self.repository.load_movie_codes(tmdb_ids)
        preferred_cities = self.repository.load_preferred_cities(user_ids)
        showtimes_by_tmdb: dict[int, list[dict[str, Any]]] = {}
        for row in showtime_rows:
            tmdb_id = _positive_int(row.get("tmdb_id"))
            if tmdb_id:
                showtimes_by_tmdb.setdefault(tmdb_id, []).append(row)

        items_by_user: dict[str, list[DeliveryItem]] = {}
        for subscription in unclaimed_rows:
            user_id = _text(subscription.get("user_id"))
            tmdb_id = _positive_int(subscription.get("tmdb_id"))
            if not user_id or not tmdb_id:
                continue
            preferred_city = preferred_cities.get(user_id, DEFAULT_LOCATION)
            linked_showtime = select_linked_showtime(
                showtimes_by_tmdb.get(tmdb_id, []), preferred_city, now
            )
            if linked_showtime is None:
                continue
            title = linked_showtime.title or titles.get(tmdb_id, "")
            if not title:
                continue
            items_by_user.setdefault(user_id, []).append(
                DeliveryItem(
                    tmdb_id=tmdb_id,
                    title=title,
                    city=linked_showtime.city,
                    date=linked_showtime.date,
                    ticket_href=linked_showtime.ticket_href,
                    movie_code=movie_codes.get(tmdb_id),
                )
            )

        batches: list[DeliveryBatch] = []
        for user_id, items in sorted(items_by_user.items()):
            delivery_id = str(self.delivery_id_factory())
            deduped_items = tuple(
                sorted(
                    {item.tmdb_id: item for item in items}.values(),
                    key=lambda item: (item.title.casefold(), item.tmdb_id),
                )
            )
            claimed_rows = self.repository.claim_delivery(
                user_id, delivery_id, deduped_items
            )
            parsed_claimed_items = [
                delivery_item_from_snapshot(row) for row in claimed_rows
            ]
            claimed_items = (
                tuple(
                    item for item in parsed_claimed_items if item is not None
                )
                if all(item is not None for item in parsed_claimed_items)
                else ()
            )
            if claimed_rows:
                batches.append(
                    DeliveryBatch(
                        user_id=user_id,
                        delivery_id=delivery_id,
                        items=claimed_items,
                    )
                )
        return batches

    def dispatch(self) -> DispatchSummary:
        now = _jerusalem_now(self.now_factory())
        pending_rows = self.repository.load_pending_subscriptions()
        retry_batches = self._retry_batches(pending_rows)
        retry_user_ids = {batch.user_id for batch in retry_batches}
        batches = retry_batches + self._new_batches(
            pending_rows, retry_user_ids, now
        )
        emails_sent = 0
        movies_notified = 0
        failures: list[str] = []

        for batch in batches:
            try:
                self.repository.record_attempt(batch.user_id, batch.delivery_id)
                if not batch.items:
                    raise RuntimeError(
                        "The ticket alert delivery snapshot is incomplete."
                    )
                to_email = self.repository.canonical_email(batch.user_id)
                rendered_email = render_ticket_alert_email(
                    batch.items,
                    self.config.site_url,
                    get_cinema_date(now),
                )
                resend_email_id = send_resend_email(
                    self.http_client,
                    api_key=self.config.resend_api_key,
                    from_email=self.config.from_email,
                    to_email=to_email,
                    delivery_id=batch.delivery_id,
                    email=rendered_email,
                )
                self.repository.mark_success(
                    batch.user_id,
                    batch.delivery_id,
                    resend_email_id,
                    now,
                )
                emails_sent += 1
                movies_notified += len(batch.items)
            except Exception as exc:
                error_message = f"{type(exc).__name__}: {exc}"
                try:
                    self.repository.mark_failure(
                        batch.user_id, batch.delivery_id, error_message
                    )
                except Exception as mark_exc:
                    error_message = (
                        f"{error_message}; could not record failure: "
                        f"{type(mark_exc).__name__}: {mark_exc}"
                    )
                failures.append(f"{batch.delivery_id}: {error_message}")

        if failures:
            raise RuntimeError(
                f"Ticket alert delivery failed for {len(failures)} batch(es): "
                + " | ".join(failures)
            )

        return DispatchSummary(
            pending_subscriptions=len(pending_rows),
            emails_sent=emails_sent,
            movies_notified=movies_notified,
        )

    def dataRun(self) -> None:
        summary = self.dispatch()
        print(
            "Ticket alerts: "
            f"pending={summary.pending_subscriptions}, "
            f"emails={summary.emails_sent}, "
            f"movies={summary.movies_notified}",
            flush=True,
        )
