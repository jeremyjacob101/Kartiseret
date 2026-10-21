from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from html import escape
from typing import Any, Callable
from uuid import uuid4
import os
import re

import requests
from supabase import create_client

from backend.notifications.ticket_alerts import (
    JERUSALEM_TIME_ZONE,
    RenderedEmail,
    TicketAlertConfig,
    _friendly_date,
    _safe_header,
    _text,
    get_canonical_app_email,
    send_resend_email,
)

WATCHES_TABLE = "coming_soon_date_watches"
SOONS_TABLE = "finalSoons"


@dataclass(frozen=True)
class ComingSoonDateAlertItem:
    tmdb_id: int
    title: str
    release_date: str


@dataclass(frozen=True)
class ComingSoonDateAlertBatch:
    user_id: str
    delivery_id: str
    items: tuple[ComingSoonDateAlertItem, ...]


@dataclass(frozen=True)
class ComingSoonDateDispatchSummary:
    pending_watches: int
    emails_sent: int
    movies_notified: int


def _positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _parsed_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(_text(value))
    except (TypeError, ValueError):
        return None


def _item_from_snapshot(row: dict[str, Any]) -> ComingSoonDateAlertItem | None:
    tmdb_id = _positive_int(row.get("tmdb_id"))
    title = _text(row.get("delivery_title"))
    release_date = _text(row.get("delivery_date"))
    if not tmdb_id or not title or not _parsed_date(release_date):
        return None
    return ComingSoonDateAlertItem(tmdb_id, title, release_date)


def render_coming_soon_date_email(
    items: tuple[ComingSoonDateAlertItem, ...],
) -> RenderedEmail:
    if not items:
        raise ValueError("A Coming Soon date email must contain at least one title.")
    sorted_items = tuple(
        sorted(items, key=lambda item: (item.title.casefold(), item.tmdb_id))
    )
    if len(sorted_items) == 1:
        subject = f"{_safe_header(sorted_items[0].title)} has a Coming Soon date"
        intro = f"A local Coming Soon date is now available for {sorted_items[0].title}."
    else:
        subject = f"New Coming Soon dates for {len(sorted_items)} movies"
        intro = f"Local Coming Soon dates are now available for {len(sorted_items)} movies you follow."

    html_items: list[str] = []
    text_items: list[str] = []
    for item in sorted_items:
        title = escape(item.title)
        release_date = escape(_friendly_date(item.release_date))
        html_items.append(
            f'<li style="margin:0 0 16px;"><strong>{title}</strong><br>'
            f'<span style="color:#685f72;">Israeli cinema date: {release_date}</span></li>'
        )
        text_items.append(f"- {item.title} — Israeli cinema date: {_friendly_date(item.release_date)}")

    html_body = "".join(
        [
            '<!doctype html><html><body style="margin:0;background:#f7f4fa;color:#211a29;font-family:Arial,sans-serif;">',
            '<div style="max-width:600px;margin:0 auto;padding:32px 22px;">',
            '<div style="background:#ffffff;border:1px solid #e5dcec;border-radius:18px;padding:28px;">',
            '<p style="margin:0 0 8px;color:#7a3db8;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Kartiseret</p>',
            '<h1 style="margin:0 0 20px;font-size:25px;line-height:1.2;">Coming Soon dates are available</h1>',
            f'<p style="margin:0 0 22px;line-height:1.55;">{escape(intro)}</p>',
            f'<ul style="margin:0;padding-left:22px;">{"".join(html_items)}</ul>',
            '<p style="margin:24px 0 0;color:#685f72;font-size:13px;line-height:1.5;">These dates come from Kartiseret’s local Coming Soon catalog.</p>',
            "</div></div></body></html>",
        ]
    )
    text_body = "\n\n".join(
        [
            "Kartiseret — Coming Soon dates are available",
            intro,
            "\n".join(text_items),
            "These dates come from Kartiseret’s local Coming Soon catalog.",
        ]
    )
    return RenderedEmail(subject=subject, html=html_body, text=text_body)


class SupabaseComingSoonDateAlertRepository:
    def __init__(
        self,
        supabase_client: Any,
        *,
        recipient_api_url: str = "",
        internal_api_secret: str = "",
        http_client: Any = requests,
    ):
        self.supabase = supabase_client
        self.recipient_api_url = recipient_api_url
        self.internal_api_secret = internal_api_secret
        self.http_client = http_client
        self._recipient_cache: dict[str, str] = {}

    @staticmethod
    def _response_rows(response: Any) -> list[dict[str, Any]]:
        data = getattr(response, "data", None)
        if isinstance(data, dict):
            return [data]
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        return []

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

    def load_pending_watches(self) -> list[dict[str, Any]]:
        columns = ",".join(
            [
                "user_id",
                "tmdb_id",
                "title",
                "release_year",
                "poster_path",
                "created_at",
                "notified_at",
                "delivery_id",
                "delivery_title",
                "delivery_date",
                "delivery_attempts",
            ]
        )
        return self._collect_pages(
            lambda start, end: self.supabase.table(WATCHES_TABLE)
            .select(columns)
            .is_("notified_at", "null")
            .order("created_at")
            .order("user_id")
            .order("tmdb_id")
            .range(start, end)
        )

    def load_local_dates(
        self, tmdb_ids: list[int]
    ) -> dict[int, tuple[str, str]]:
        result: dict[int, tuple[str, str]] = {}
        for start in range(0, len(tmdb_ids), 150):
            chunk = tmdb_ids[start : start + 150]
            rows = self._collect_pages(
                lambda page_start, page_end: self.supabase.table(SOONS_TABLE)
                .select("tmdb_id,english_title,release_date")
                .in_("tmdb_id", chunk)
                .eq("solo_update", False)
                .order("release_date")
                .order("id")
                .range(page_start, page_end)
            )
            for row in rows:
                tmdb_id = _positive_int(row.get("tmdb_id"))
                title = _text(row.get("english_title"))
                release_date = _text(row.get("release_date"))
                if tmdb_id and title and _parsed_date(release_date):
                    result.setdefault(tmdb_id, (title, release_date))
        return result

    def claim_delivery(
        self,
        user_id: str,
        delivery_id: str,
        items: tuple[ComingSoonDateAlertItem, ...],
    ) -> list[dict[str, Any]]:
        claimed: list[dict[str, Any]] = []
        for item in items:
            response = (
                self.supabase.table(WATCHES_TABLE)
                .update(
                    {
                        "delivery_id": delivery_id,
                        "delivery_title": item.title,
                        "delivery_date": item.release_date,
                        "last_delivery_error": None,
                    },
                    returning="representation",
                )
                .eq("user_id", user_id)
                .eq("tmdb_id", item.tmdb_id)
                .is_("notified_at", "null")
                .is_("delivery_id", "null")
                .execute()
            )
            claimed.extend(self._response_rows(response))
        return claimed

    def record_attempt(self, user_id: str, delivery_id: str) -> None:
        rows = self._response_rows(
            self.supabase.table(WATCHES_TABLE)
            .select("tmdb_id,delivery_attempts")
            .eq("user_id", user_id)
            .eq("delivery_id", delivery_id)
            .is_("notified_at", "null")
            .execute()
        )
        if not rows:
            raise RuntimeError("The Coming Soon date delivery is no longer pending.")
        attempted_at = datetime.now(JERUSALEM_TIME_ZONE).isoformat()
        updated = 0
        for row in rows:
            tmdb_id = _positive_int(row.get("tmdb_id"))
            if tmdb_id is None:
                continue
            attempts = int(row.get("delivery_attempts") or 0)
            response = (
                self.supabase.table(WATCHES_TABLE)
                .update(
                    {
                        "delivery_attempts": attempts + 1,
                        "last_delivery_attempt_at": attempted_at,
                        "last_delivery_error": None,
                    },
                    returning="representation",
                )
                .eq("user_id", user_id)
                .eq("tmdb_id", tmdb_id)
                .eq("delivery_id", delivery_id)
                .eq("delivery_attempts", attempts)
                .is_("notified_at", "null")
                .execute()
            )
            updated += len(self._response_rows(response))
        if updated != len(rows):
            raise RuntimeError("Could not record every Coming Soon date delivery attempt.")

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
        (
            self.supabase.table(WATCHES_TABLE)
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
        safe_error = _text(error)[:2_000] or "Unknown Coming Soon date delivery failure"
        (
            self.supabase.table(WATCHES_TABLE)
            .update({"last_delivery_error": safe_error})
            .eq("user_id", user_id)
            .eq("delivery_id", delivery_id)
            .is_("notified_at", "null")
            .execute()
        )


class ComingSoonDateAlertDispatcher:
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
                    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Coming Soon date alerts."
                )
            repository = SupabaseComingSoonDateAlertRepository(
                create_client(supabase_url, service_role_key),
                recipient_api_url=self.config.recipient_api_url,
                internal_api_secret=self.config.internal_api_secret,
                http_client=self.http_client,
            )
        self.repository = repository

    @staticmethod
    def _retry_batches(rows: list[dict[str, Any]]) -> list[ComingSoonDateAlertBatch]:
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
        batches: list[ComingSoonDateAlertBatch] = []
        for user_id, (delivery_id, grouped) in sorted(earliest.items()):
            parsed = [_item_from_snapshot(row) for row in grouped]
            items = tuple(item for item in parsed if item is not None) if all(parsed) else ()
            batches.append(ComingSoonDateAlertBatch(user_id, delivery_id, items))
        return batches

    def _new_batches(
        self,
        rows: list[dict[str, Any]],
        retry_user_ids: set[str],
    ) -> list[ComingSoonDateAlertBatch]:
        unclaimed = [
            row
            for row in rows
            if not _text(row.get("delivery_id"))
            and _text(row.get("user_id")) not in retry_user_ids
        ]
        ids = sorted(
            {
                parsed
                for row in unclaimed
                if (parsed := _positive_int(row.get("tmdb_id"))) is not None
            }
        )
        if not ids:
            return []
        local_dates = self.repository.load_local_dates(ids)
        by_user: dict[str, list[ComingSoonDateAlertItem]] = {}
        for row in unclaimed:
            user_id = _text(row.get("user_id"))
            tmdb_id = _positive_int(row.get("tmdb_id"))
            local = local_dates.get(tmdb_id) if tmdb_id else None
            if user_id and tmdb_id and local:
                by_user.setdefault(user_id, []).append(
                    ComingSoonDateAlertItem(tmdb_id, local[0], local[1])
                )
        batches: list[ComingSoonDateAlertBatch] = []
        for user_id, items in sorted(by_user.items()):
            deduped = tuple(
                sorted(
                    {item.tmdb_id: item for item in items}.values(),
                    key=lambda item: (item.title.casefold(), item.tmdb_id),
                )
            )
            delivery_id = str(self.delivery_id_factory())
            claimed = self.repository.claim_delivery(user_id, delivery_id, deduped)
            parsed = [_item_from_snapshot(row) for row in claimed]
            claimed_items = tuple(item for item in parsed if item is not None) if all(parsed) else ()
            if claimed:
                batches.append(ComingSoonDateAlertBatch(user_id, delivery_id, claimed_items))
        return batches

    def dispatch(self) -> ComingSoonDateDispatchSummary:
        now = self.now_factory()
        if now.tzinfo is None:
            now = now.replace(tzinfo=JERUSALEM_TIME_ZONE)
        else:
            now = now.astimezone(JERUSALEM_TIME_ZONE)
        pending = self.repository.load_pending_watches()
        retry_batches = self._retry_batches(pending)
        retry_users = {batch.user_id for batch in retry_batches}
        batches = retry_batches + self._new_batches(pending, retry_users)
        emails_sent = 0
        movies_notified = 0
        failures: list[str] = []

        for batch in batches:
            try:
                self.repository.record_attempt(batch.user_id, batch.delivery_id)
                if not batch.items:
                    raise RuntimeError("The Coming Soon date delivery snapshot is incomplete.")
                recipient = self.repository.canonical_email(batch.user_id)
                rendered = render_coming_soon_date_email(batch.items)
                resend_id = send_resend_email(
                    self.http_client,
                    api_key=self.config.resend_api_key,
                    from_email=self.config.from_email,
                    to_email=recipient,
                    delivery_id=batch.delivery_id,
                    email=rendered,
                    idempotency_prefix="coming-soon-date-alert",
                )
                self.repository.mark_success(
                    batch.user_id, batch.delivery_id, resend_id, now
                )
                emails_sent += 1
                movies_notified += len(batch.items)
            except Exception as exc:
                message = f"{type(exc).__name__}: {exc}"
                try:
                    self.repository.mark_failure(batch.user_id, batch.delivery_id, message)
                except Exception as mark_exc:
                    message = f"{message}; could not record failure: {type(mark_exc).__name__}: {mark_exc}"
                failures.append(f"{batch.delivery_id}: {message}")
        if failures:
            raise RuntimeError(
                f"Coming Soon date delivery failed for {len(failures)} batch(es): "
                + " | ".join(failures)
            )
        return ComingSoonDateDispatchSummary(len(pending), emails_sent, movies_notified)

    def dataRun(self) -> None:
        summary = self.dispatch()
        print(
            "Coming Soon date alerts: "
            f"pending={summary.pending_watches}, emails={summary.emails_sent}, "
            f"movies={summary.movies_notified}",
            flush=True,
        )

