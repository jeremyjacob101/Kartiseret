from copy import deepcopy
from datetime import datetime
from unittest import TestCase

from backend.notifications.movie_alerts import (
    MovieNotificationDispatcher,
    collect_first_availability,
    render_movie_notification_email,
)
from backend.notifications.ticket_alerts import TicketAlertConfig, ALERT_FILTER_OPTIONS
from backend.tests.test_letterboxd_alerts import (
    FakeRepository,
    FakeLetterboxdAndResend,
    FakeResponse,
    _source,
)
from backend.tests.test_ticket_alert_criteria import showtime

NOW = datetime.fromisoformat("2026-10-21T14:00:00+03:00")


class Repository(FakeRepository):
    def __init__(self, *, sources=None, showtimes=None, dates=None):
        super().__init__(
            sources or [],
            [
                {"tmdb_id": 101, "english_title": "Future Film", "release_year": 2028},
                {"tmdb_id": 102, "english_title": "Shared Film", "release_year": 2027},
            ],
            local_dates=dates,
            showtimes=showtimes,
        )
        self.preferences, self.subscriptions = [], []
        self.tickets, self.dates = [], []
        self.events, self.deliveries = {}, {}
        self.locations = {}

    def load_watches(self):
        return self.tickets, self.dates

    def load_locations(self, users):
        return self.locations

    def queue(self, candidates):
        keys = {
            (e["user_id"], e["tmdb_id"], e["event_type"], e["scope_city"])
            for e in candidates
        }
        for key, event in self.events.items():
            if (
                event["status"] == "pending"
                and not event.get("delivery_id")
                and key not in keys
            ):
                event["status"] = "cancelled"
        for item in candidates:
            key = (
                item["user_id"],
                item["tmdb_id"],
                item["event_type"],
                item["scope_city"],
            )
            if (
                item["event_type"] == "showtime"
                and item["notification_mode"] == "first_any_city"
            ):
                if any(
                    k[:3] == key[:3]
                    and e["status"] in ("sent", "suppressed", "pending")
                    for k, e in self.events.items()
                ):
                    continue
            prior = self.events.get(key)
            if prior and prior["status"] != "cancelled":
                continue
            self.events[key] = {**deepcopy(item), "id": str(key)}

    def pending_users(self):
        return sorted(
            {e["user_id"] for e in self.events.values() if e["status"] == "pending"}
        )

    def claim(self, user, delivery_id):
        for batch in self.deliveries.values():
            if batch["user_id"] == user and batch["status"] == "pending":
                return deepcopy(batch)
        events = [
            e
            for e in self.events.values()
            if e["user_id"] == user
            and e["status"] == "pending"
            and not e.get("delivery_id")
        ]
        if not events:
            return None
        batch = {
            "id": delivery_id,
            "user_id": user,
            "events": deepcopy(events),
            "attempts": 0,
            "status": "pending",
        }
        self.deliveries[delivery_id] = batch
        for event in events:
            event["delivery_id"] = delivery_id
        return deepcopy(batch)

    def attempt(self, batch, snapshot):
        stored = self.deliveries[batch["id"]]
        stored["attempts"] += 1
        stored.setdefault("email_snapshot", deepcopy(snapshot))
        return stored["email_snapshot"]

    def complete(self, batch, resend_id):
        self.deliveries[batch["id"]]["status"] = "sent"
        for event in self.events.values():
            if event.get("delivery_id") == batch["id"]:
                event["status"] = "sent"

    def fail(self, batch, error):
        self.deliveries[batch["id"]]["last_error"] = str(error)


def ticket(city="Jerusalem", day="2026-10-22", **kwargs):
    return showtime(screening_city=city, date_of_showing=day, **kwargs)


class MovieNotificationTests(TestCase):
    def dispatcher(self, repo, http=None):
        return MovieNotificationDispatcher(
            repository=repo,
            http_client=http or FakeLetterboxdAndResend(),
            config=TicketAlertConfig(
                resend_api_key="fake",
                from_email="alerts@example.test",
                site_url="https://seret.site",
            ),
            now_factory=lambda: NOW,
            delivery_id_factory=lambda: f"batch-{len(repo.deliveries)}",
        )

    def watch(self, repo, *, date=False):
        (repo.dates if date else repo.tickets).append(
            {"user_id": "alice", "tmdb_id": 101}
        )

    def test_default_city_and_first_day_only_even_as_sessions_links_and_days_change(
        self,
    ):
        repo = Repository(
            showtimes=[ticket("Haifa"), ticket(), ticket(day="2026-10-23")]
        )
        self.watch(repo)
        http = FakeLetterboxdAndResend()
        result = self.dispatcher(repo, http).dispatch()
        self.assertEqual((result.emails_sent, result.events_notified), (1, 1))
        text = http.post_calls[0]["json"]["text"]
        self.assertIn("Jerusalem", text)
        self.assertIn("October 22, 2026", text)
        self.assertNotIn("Haifa", text)
        self.assertNotIn("October 23", text)
        repo.showtimes = [
            ticket(
                day="2026-10-28",
                cinema="New cinema",
                english_href="https://tickets.test/new",
            )
        ]
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)
        self.assertEqual(len(http.post_calls), 1)

    def test_preferred_city_is_used_before_jerusalem_fallback(self):
        repo = Repository(showtimes=[ticket(), ticket("Haifa")])
        repo.locations["alice"] = "Haifa"
        self.watch(repo)
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()
        self.assertIn("Haifa", http.post_calls[0]["json"]["text"])
        self.assertNotIn("Jerusalem", http.post_calls[0]["json"]["text"])

    def test_any_city_picks_earliest_and_per_city_groups_one_film_with_two_cities(self):
        for mode, count in [("first_any_city", 1), ("first_per_city", 2)]:
            with self.subTest(mode=mode):
                repo = Repository(
                    showtimes=[
                        ticket(day="2026-10-24"),
                        ticket("Haifa"),
                        ticket("Haifa", day="2026-10-23"),
                    ]
                )
                self.watch(repo)
                repo.preferences = [
                    {
                        "user_id": "alice",
                        "cities": ["Jerusalem", "Haifa"],
                        "notification_mode": mode,
                    }
                ]
                http = FakeLetterboxdAndResend()
                self.assertEqual(
                    self.dispatcher(repo, http).dispatch().events_notified, count
                )
                body = http.post_calls[0]["json"]
                self.assertEqual(body["text"].count("Film 101"), 1)
                self.assertIn("Tickets for 1 film", body["subject"])
                self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)

    def test_switching_to_per_city_allows_only_previously_unfulfilled_cities(self):
        repo = Repository(showtimes=[ticket(), ticket("Haifa", day="2026-10-23")])
        self.watch(repo)
        repo.preferences = [{"user_id": "alice", "cities": ["Jerusalem", "Haifa"]}]
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()
        repo.preferences[0]["notification_mode"] = "first_per_city"
        result = self.dispatcher(repo, http).dispatch()
        self.assertEqual(result.events_notified, 1)
        self.assertIn("Haifa", http.post_calls[-1]["json"]["text"])
        self.assertNotIn("Jerusalem", http.post_calls[-1]["json"]["text"])

    def test_manual_per_city_creation_baselines_already_available_cities(self):
        repo = Repository(showtimes=[ticket(), ticket("Haifa")])
        repo.tickets = [
            {"user_id": "alice", "tmdb_id": 101, "baseline_cities": ["Jerusalem"]}
        ]
        repo.preferences = [
            {
                "user_id": "alice",
                "cities": ["Jerusalem", "Haifa"],
                "notification_mode": "first_per_city",
            }
        ]
        http = FakeLetterboxdAndResend()
        self.assertEqual(self.dispatcher(repo, http).dispatch().events_notified, 1)
        self.assertNotIn("Jerusalem", http.post_calls[0]["json"]["text"])

    def test_manual_and_two_letterboxd_sources_share_one_digest_and_date_once(self):
        sources = [
            _source("watch", "https://letterboxd.com/fixture/watchlist/", "watchlist"),
            _source("list", "https://letterboxd.com/fixture/list/favorites/", "list"),
        ]
        repo = Repository(
            sources=sources,
            showtimes=[ticket()],
            dates=[
                {
                    "tmdb_id": 101,
                    "english_title": "Future Film",
                    "release_date": "2027-01-03",
                }
            ],
        )
        self.watch(repo)
        self.watch(repo, date=True)
        http = FakeLetterboxdAndResend()
        result = self.dispatcher(repo, http).dispatch()
        self.assertEqual((result.emails_sent, result.events_notified), (1, 2))
        body = http.post_calls[0]["json"]["text"]
        self.assertIn("Coming Soon dates announced · 1 film", body)
        self.assertIn("Tickets now available · 1 film", body)
        repo.local_dates[0]["release_date"] = "2027-02-03"
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)

    def test_first_source_sync_is_silent_and_nonmatching_baseline_does_not_close_watch(
        self,
    ):
        repo = Repository(
            sources=[
                _source(
                    "watch", "https://letterboxd.com/fixture/watchlist/", "watchlist"
                )
            ],
            showtimes=[ticket()],
        )
        repo.preferences = [
            {
                "user_id": "alice",
                "cities": None,
                "filter_exclusions": {
                    "screeningTech": [
                        v for v in ALERT_FILTER_OPTIONS["screeningTech"] if v != "IMAX"
                    ]
                },
            }
        ]
        http = FakeLetterboxdAndResend()
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)
        self.assertEqual(len(repo.events), 0)
        repo.showtimes.append(ticket(screening_tech="IMAX"))
        self.assertEqual(self.dispatcher(repo, http).dispatch().events_notified, 1)

    def test_initial_qualifying_availability_is_silently_completed(self):
        repo = Repository(
            sources=[
                _source(
                    "watch", "https://letterboxd.com/fixture/watchlist/", "watchlist"
                )
            ],
            showtimes=[ticket()],
        )
        http = FakeLetterboxdAndResend()
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)
        self.assertEqual({e["status"] for e in repo.events.values()}, {"suppressed"})
        repo.showtimes = [ticket(day="2026-10-29")]
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 0)

    def test_retry_keeps_body_recipient_and_provider_key_when_catalog_changes(self):
        repo = Repository(showtimes=[ticket()])
        self.watch(repo)
        http = FakeLetterboxdAndResend(responses=[FakeResponse(500), FakeResponse(200)])
        with self.assertRaisesRegex(RuntimeError, "delivery failed"):
            self.dispatcher(repo, http).dispatch()
        repo.showtimes = [ticket(day="2026-10-28")]
        repo.canonical_email = lambda user: "changed@example.test"
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 1)
        self.assertEqual(http.post_calls[0]["json"], http.post_calls[1]["json"])
        self.assertEqual(
            http.post_calls[0]["headers"]["Idempotency-Key"],
            http.post_calls[1]["headers"]["Idempotency-Key"],
        )

    def test_title_overrides_mode_city_and_filters(self):
        repo = Repository(
            showtimes=[
                ticket(),
                ticket("Haifa", screening_tech="IMAX"),
                ticket("Haifa", day="2026-10-23"),
            ]
        )
        self.watch(repo)
        repo.subscriptions = [
            {
                "user_id": "alice",
                "tmdb_id": 101,
                "criteria_overrides": {
                    "cities": ["Haifa"],
                    "notificationMode": "first_per_city",
                    "filters": {"screeningTech": ["Standard"]},
                },
            }
        ]
        http = FakeLetterboxdAndResend()
        self.assertEqual(self.dispatcher(repo, http).dispatch().events_notified, 1)
        self.assertIn("Haifa", http.post_calls[0]["json"]["text"])
        self.assertNotIn("Jerusalem", http.post_calls[0]["json"]["text"])

    def test_templates_omit_empty_sections_and_escape_movie_names(self):
        event = {
            "tmdb_id": 101,
            "event_type": "coming_soon",
            "event_payload": {"title": "<Film>", "release_date": "2027-01-01"},
        }
        email = render_movie_notification_email([event])
        self.assertIn("&lt;Film&gt;", email.html)
        self.assertNotIn("Tickets now available", email.html)
        self.assertEqual(email.subject, "1 Coming Soon date")
