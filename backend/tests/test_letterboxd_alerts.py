from datetime import datetime
from pathlib import Path
from unittest import TestCase

from backend.notifications.letterboxd_alerts import (
    LetterboxdSourceDispatcher,
    collect_current_events,
    render_letterboxd_event_email,
    resolve_local_movie_ids,
)
from backend.notifications.letterboxd_public import LetterboxdFilm
from backend.notifications.ticket_alerts import TicketAlertConfig

FIXTURES = Path(__file__).parent / "fixtures" / "letterboxd"
NOW = datetime.fromisoformat("2026-10-21T14:00:00+03:00")


class FakeResponse:
    def __init__(self, status_code=200, email_id="resend-email", text=""):
        self.status_code = status_code
        self.email_id = email_id
        self.text = text

    def json(self):
        return {"id": self.email_id}


class FakeLetterboxdAndResend:
    def __init__(self, *, page1=None, page2=None, responses=None):
        self.page1 = page1 or (FIXTURES / "watchlist-page-1.html").read_text()
        self.page2 = page2 or (FIXTURES / "watchlist-page-2.html").read_text()
        self.responses = list(responses or [])
        self.get_calls = []
        self.post_calls = []

    def get(self, url, **kwargs):
        self.get_calls.append((url, kwargs))
        if url.endswith("/page/2/"):
            return FakeResponse(text=self.page2)
        if "/watchlist/" in url:
            return FakeResponse(text=self.page1)
        # A saved non-paginated public list fixture with overlapping members.
        return FakeResponse(
            text="""<ul class='poster-list'>
              <li><div data-film-slug='future-film' data-film-name='Future Film' data-film-release-year='2028'></div></li>
              <li><div data-film-slug='shared-film' data-film-name='Shared Film' data-film-release-year='2027'></div></li>
            </ul>"""
        )

    def post(self, endpoint, *, headers, json, timeout):
        self.post_calls.append(
            {"endpoint": endpoint, "headers": headers, "json": json, "timeout": timeout}
        )
        return self.responses.pop(0) if self.responses else FakeResponse()


def _source(source_id, url, source_type):
    return {
        "id": source_id,
        "user_id": "alice",
        "source_url": url,
        "source_type": source_type,
        "created_at": "2026-10-21T10:00:00+03:00",
    }


class FakeRepository:
    def __init__(self, sources, candidates, *, local_dates=None, showtimes=None):
        self.sources = [dict(row) for row in sources]
        self.candidates = list(candidates)
        self.local_dates = list(local_dates or [])
        self.showtimes = list(showtimes or [])
        self.preferences = [
            {
                "user_id": "alice",
                "cities": ["Tel Aviv"],
                "filter_exclusions": {
                    "showType": [],
                    "screenFormat": [],
                    "screeningTech": [],
                    "dubLanguage": [],
                },
            }
        ]
        self.subscriptions = [
            {
                "user_id": "alice",
                "tmdb_id": 102,
                "criteria_overrides": {"cities": ["Haifa"]},
            }
        ]
        self.source_films = {}
        self.events = {}
        self.source_failures = {}
        self.attempts = {}
        self.successes = []
        self.failures = []

    def load_sources(self):
        return [dict(row) for row in self.sources]

    def mark_source_attempt(self, source_id, attempted_at):
        self.source_failures.pop(source_id, None)

    def mark_source_failure(self, source_id, error):
        self.source_failures[source_id] = error

    def mark_source_success(self, source_id, synced_at, film_count, matched_count):
        source = next(row for row in self.sources if row["id"] == source_id)
        source.update(
            {
                "film_count": film_count,
                "matched_film_count": matched_count,
                "last_successful_sync_at": synced_at.isoformat(),
                "last_sync_error": None,
            }
        )

    def load_source_films(self, source_id):
        return [dict(row) for (sid, _slug), row in self.source_films.items() if sid == source_id]

    def load_local_movie_candidates(self):
        return list(self.candidates)

    def sync_source_films(self, source, films, resolved_ids, synced_at):
        source_id = source["id"]
        now_text = synced_at.isoformat()
        present = set()
        matched = 0
        for film in films:
            key = (source_id, film.slug)
            existing = self.source_films.get(key)
            active = existing is not None and existing.get("removed_at") is None
            tmdb_id = resolved_ids.get(film.slug)
            if tmdb_id is None and existing and existing.get("tmdb_id"):
                tmdb_id = existing["tmdb_id"]
            row = {
                "source_id": source_id,
                "user_id": source["user_id"],
                "letterboxd_slug": film.slug,
                "title": film.title,
                "release_year": film.release_year,
                "tmdb_id": tmdb_id,
                "first_seen_at": existing["first_seen_at"] if active else now_text,
                "last_seen_at": now_text,
                "removed_at": None,
                "needs_baseline": existing["needs_baseline"] if active else tmdb_id is not None,
            }
            self.source_films[key] = row
            present.add(film.slug)
            matched += int(tmdb_id is not None)
        for (sid, slug), row in self.source_films.items():
            if sid == source_id and row["removed_at"] is None and slug not in present:
                row["removed_at"] = now_text
                if row.get("tmdb_id") and not any(
                    other["user_id"] == row["user_id"]
                    and other.get("tmdb_id") == row["tmdb_id"]
                    and other["removed_at"] is None
                    for other in self.source_films.values()
                ):
                    for event in self.events.values():
                        if event["user_id"] == row["user_id"] and event["tmdb_id"] == row["tmdb_id"] and event["status"] == "pending":
                            event["status"] = "cancelled"
                            event["delivery_id"] = None
        return matched

    def load_active_source_films(self):
        return [
            dict(row)
            for row in self.source_films.values()
            if row["removed_at"] is None
        ]

    def set_source_film_tmdb_id(self, row, tmdb_id):
        self.source_films[(row["source_id"], row["letterboxd_slug"])]["tmdb_id"] = tmdb_id

    def clear_baseline(self, rows):
        for row in rows:
            self.source_films[(row["source_id"], row["letterboxd_slug"])]["needs_baseline"] = False

    def load_local_events(self, tmdb_ids, today):
        ids = set(tmdb_ids)
        dates = [row for row in self.local_dates if int(row["tmdb_id"]) in ids]
        showtimes = [row for row in self.showtimes if int(row["tmdb_id"]) in ids]
        titles = {
            int(row["tmdb_id"]): row["english_title"]
            for row in self.candidates
            if int(row["tmdb_id"]) in ids
        }
        return dates, showtimes, titles

    def load_criteria(self, user_ids, tmdb_ids):
        return self.preferences, [
            row
            for row in self.subscriptions
            if row["user_id"] in user_ids and int(row["tmdb_id"]) in tmdb_ids
        ]

    def insert_events(self, events, status):
        for event in events:
            key = (event.user_id, event.event_key)
            self.events.setdefault(
                key,
                {
                    "id": f"event-{len(self.events) + 1}",
                    "user_id": event.user_id,
                    "tmdb_id": event.tmdb_id,
                    "event_key": event.event_key,
                    "event_type": event.event_type,
                    "event_payload": event.payload,
                    "status": status,
                    "delivery_id": None,
                    "delivery_attempts": 0,
                    "created_at": NOW.isoformat(),
                    "notified_at": None,
                },
            )

    def load_pending_events(self):
        return [dict(row) for row in self.events.values() if row["status"] == "pending"]

    def claim_delivery(self, user_id, delivery_id, rows):
        claimed = []
        for row in rows:
            event = self.events[(user_id, row["event_key"])]
            if event["status"] == "pending" and event["delivery_id"] is None:
                event["delivery_id"] = delivery_id
                claimed.append(dict(event))
        return claimed

    def record_attempt(self, user_id, delivery_id):
        for row in self.events.values():
            if row["user_id"] == user_id and row["delivery_id"] == delivery_id:
                row["delivery_attempts"] += 1
                self.attempts[(user_id, delivery_id)] = row["delivery_attempts"]

    def canonical_email(self, user_id):
        return f"{user_id}@example.test"

    def mark_success(self, user_id, delivery_id, resend_email_id, delivered_at):
        for row in self.events.values():
            if row["user_id"] == user_id and row["delivery_id"] == delivery_id:
                row.update(status="sent", notified_at=delivered_at.isoformat())
        self.successes.append((user_id, delivery_id, resend_email_id))

    def mark_failure(self, user_id, delivery_id, error):
        self.failures.append((user_id, delivery_id, error))


def future_showtime(tmdb_id, city, cinema, showing_date, time="19:30"):
    return {
        "tmdb_id": tmdb_id,
        "english_title": None,
        "screening_city": city,
        "cinema": cinema,
        "date_of_showing": showing_date,
        "showtime": time,
        "english_href": f"https://tickets.example.test/{tmdb_id}/{city}/{showing_date}",
        "hebrew_href": None,
        "screening_type": "Regular",
        "screening_tech": "2D",
        "dub_language": None,
    }


class LetterboxdSourceAlertTests(TestCase):
    def dispatcher(self, repo, http, delivery_ids=None):
        return LetterboxdSourceDispatcher(
            run_id=1,
            repository=repo,
            http_client=http,
            config=TicketAlertConfig(
                resend_api_key="fake-key",
                from_email="Kartiseret <alerts@example.test>",
                site_url="https://seret.site",
            ),
            now_factory=lambda: NOW,
            delivery_id_factory=lambda: next(delivery_ids) if delivery_ids else "delivery-1",
        )

    def baseline_repository(self, source_urls=None):
        urls = source_urls or [
            ("source-watch", "https://letterboxd.com/fixture/watchlist/", "watchlist"),
            ("source-list", "https://letterboxd.com/fixture/list/favorites/", "list"),
        ]
        sources = [_source(*values) for values in urls]
        candidates = [
            {"tmdb_id": 101, "english_title": "Future Film", "release_year": 2028},
            {"tmdb_id": 102, "english_title": "Shared Film", "release_year": 2027},
        ]
        return FakeRepository(
            sources,
            candidates,
            local_dates=[
                {"tmdb_id": 101, "english_title": "Future Film", "release_date": "2027-04-12"}
            ],
            showtimes=[future_showtime(101, "Tel Aviv", "Cinema A", "2026-12-01")],
        )

    def test_silent_baseline_and_union_membership_across_two_sources(self):
        repo = self.baseline_repository()
        http = FakeLetterboxdAndResend()
        summary = self.dispatcher(repo, http).dispatch()
        self.assertEqual(summary.active_titles, 2)
        self.assertEqual(summary.emails_sent, 0)
        self.assertEqual(http.post_calls, [])
        self.assertEqual(len(repo.events), 2)
        self.assertEqual(
            {row["event_type"] for row in repo.events.values()},
            {"coming_soon", "showtime"},
        )
        self.assertTrue(
            all(row["status"] == "suppressed" for row in repo.events.values())
        )
        self.assertEqual(
            sum(row["tmdb_id"] == 101 for row in repo.source_films.values()), 2
        )
        self.assertTrue(all(not row["needs_baseline"] for row in repo.source_films.values()))

    def test_only_events_discovered_after_entry_are_sent_and_title_override_wins(self):
        repo = self.baseline_repository()
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()
        repo.local_dates.append(
            {"tmdb_id": 102, "english_title": "Shared Film", "release_date": "2027-08-02"}
        )
        repo.showtimes.extend(
            [
                future_showtime(102, "Haifa", "Cinema B", "2026-12-03"),
                future_showtime(101, "Haifa", "Cinema C", "2026-12-04"),
                future_showtime(101, "Tel Aviv", "Cinema A", "2026-10-20"),
            ]
        )
        summary = self.dispatcher(repo, http).dispatch()
        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(summary.events_notified, 2)
        self.assertEqual(len(http.post_calls), 1)
        body = http.post_calls[0]["json"]["text"]
        self.assertIn("Shared Film", body)
        self.assertIn("August 2, 2027", body)
        self.assertIn("Haifa", body)
        self.assertNotIn("Cinema C", body)
        self.assertNotIn("October 20, 2026", body)
        self.assertEqual({row["status"] for row in repo.events.values()}, {"suppressed", "sent"})

    def test_unavailable_or_parse_failed_source_keeps_last_known_membership(self):
        repo = self.baseline_repository(source_urls=[
            ("source-watch", "https://letterboxd.com/fixture/watchlist/", "watchlist")
        ])
        self.dispatcher(repo, FakeLetterboxdAndResend()).dispatch()
        existing = set(repo.source_films)
        blocked = FakeLetterboxdAndResend()
        blocked.get = lambda _url, **_kwargs: FakeResponse(status_code=403)
        summary = self.dispatcher(repo, blocked).dispatch()
        self.assertEqual(summary.sources_failed, 1)
        self.assertEqual(set(repo.source_films), existing)
        self.assertTrue(repo.source_failures["source-watch"])

    def test_resend_retry_reuses_snapshot_and_idempotency_key(self):
        repo = self.baseline_repository(source_urls=[
            ("source-watch", "https://letterboxd.com/fixture/watchlist/", "watchlist")
        ])
        http = FakeLetterboxdAndResend(responses=[FakeResponse(500), FakeResponse(200, "recovered")])
        self.dispatcher(repo, http).dispatch()
        repo.local_dates.append(
            {"tmdb_id": 102, "english_title": "Shared Film", "release_date": "2027-08-02"}
        )
        with self.assertRaisesRegex(RuntimeError, "Letterboxd event delivery failed"):
            self.dispatcher(repo, http, iter(["delivery-stable"])).dispatch()
        pending = next(
            row for row in repo.events.values() if row["status"] == "pending"
        )
        self.assertEqual(pending["delivery_id"], "delivery-stable")
        self.assertIn("August 2, 2027", http.post_calls[0]["json"]["text"])
        summary = self.dispatcher(repo, http).dispatch()
        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(
            [call["headers"]["Idempotency-Key"] for call in http.post_calls],
            ["letterboxd-event-alert-delivery-stable"] * 2,
        )

    def test_title_mapping_requires_a_unique_exact_title_and_year(self):
        films = [LetterboxdFilm("same", "Future Film", 2028)]
        self.assertEqual(
            resolve_local_movie_ids(
                films,
                [
                    {"tmdb_id": 101, "english_title": "Future Film", "release_year": 2028},
                    {"tmdb_id": 102, "english_title": "Future Film", "release_year": 2028},
                ],
            ),
            {"same": None},
        )
        self.assertEqual(
            resolve_local_movie_ids(
                films,
                [{"tmdb_id": 101, "english_title": "future-film", "release_year": 2028}],
            ),
            {"same": 101},
        )

    def test_email_escapes_titles_and_requires_ticket_link_for_showtimes(self):
        email = render_letterboxd_event_email(
            (
                {
                    "event_type": "coming_soon",
                    "event_payload": {"title": "<Future Film>", "release_date": "2027-04-12"},
                },
            )
        )
        self.assertIn("&lt;Future Film&gt;", email.html)
        self.assertIn("April 12, 2027", email.text)
        with self.assertRaisesRegex(ValueError, "no ticket link"):
            render_letterboxd_event_email(
                ({"event_type": "showtime", "event_payload": {"title": "No Link"}},)
            )


if __name__ == "__main__":
    import unittest

    unittest.main()
