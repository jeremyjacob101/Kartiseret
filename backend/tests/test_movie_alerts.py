from copy import deepcopy
from datetime import datetime
from unittest import TestCase

from backend.notifications.movie_alerts import (
    MovieNotificationDispatcher,
    SupabaseMovieNotificationRepository,
    collect_first_availability,
    create_movie_notification_unsubscribe_urls,
    render_movie_notification_email,
)
from backend.notifications.ticket_alerts import (
    TicketAlertConfig,
    ALERT_FILTER_OPTIONS,
    build_movie_showtime_path,
    filter_mask_from_exclusions,
)
from backend.tests.test_letterboxd_alerts import (
    FakeRepository,
    FakeLetterboxdAndResend,
    FakeResponse,
    _source,
)
from backend.tests.test_ticket_alert_criteria import showtime
from backend.tests.dataflow_database import DB

NOW = datetime.fromisoformat("2026-10-21T14:00:00+03:00")


class MoviePosterRepositoryTests(TestCase):
    def test_posters_load_from_both_catalogs_with_safe_fallback_and_precedence(self):
        now_poster = "https://seret.site/api/images/v1/poster/101"
        soon_poster = "https://image.tmdb.org/t/p/w500/102.jpg"
        database = DB({
            "finalMovies": [
                {"tmdb_id": 101, "en_poster": now_poster},
                {"tmdb_id": 102, "en_poster": "https://untrusted.example/poster.jpg"},
                {"tmdb_id": 103, "en_poster": "javascript:alert(1)"},
                {"tmdb_id": 999, "en_poster": now_poster},
            ],
            "finalSoons": [
                {"tmdb_id": 101, "en_poster": soon_poster},
                {"tmdb_id": 102, "en_poster": soon_poster},
                {"tmdb_id": 103, "en_poster": None},
            ],
        })
        repository = SupabaseMovieNotificationRepository(database)

        self.assertEqual(repository.load_movie_posters([101, 102, 103]), {
            101: now_poster, 102: soon_poster,
        })
        self.assertEqual(repository.load_movie_posters([]), {})
        self.assertEqual(database.actions, [])

    def test_poster_queries_cover_multiple_id_chunks(self):
        ids = list(range(1, 302))
        database = DB({
            "finalMovies": [
                {"tmdb_id": movie_id, "en_poster": f"https://image.tmdb.org/t/p/w500/{movie_id}.jpg"}
                for movie_id in ids[:151]
            ],
            "finalSoons": [
                {"tmdb_id": movie_id, "en_poster": f"https://image.tmdb.org/t/p/w500/{movie_id}.jpg"}
                for movie_id in ids[151:]
            ],
        })
        posters = SupabaseMovieNotificationRepository(database).load_movie_posters(ids)
        self.assertEqual(set(posters), set(ids))
        self.assertEqual(database.actions, [])


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
        self.posters = {}

    def letterboxd_supported_movies(self, user_id, tmdb_ids):
        return {
            int(row["tmdb_id"])
            for row in self.source_films.values()
            if row.get("user_id") == user_id
            and row.get("removed_at") is None
            and row.get("tmdb_id") is not None
            and int(row["tmdb_id"]) in tmdb_ids
        }

    def load_watches(self):
        return self.tickets, self.dates

    def load_locations(self, users):
        return self.locations

    def load_movie_posters(self, tmdb_ids):
        return self.posters

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
                recipient_api_url="https://api.example.test",
                internal_api_secret="internal-test-secret",
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

    def test_dispatch_includes_the_catalog_poster_in_the_email(self):
        repo = Repository(showtimes=[ticket()])
        repo.posters[101] = "https://image.tmdb.org/t/p/w342/wild-horse.jpg"
        self.watch(repo)
        http = FakeLetterboxdAndResend()

        self.dispatcher(repo, http).dispatch()

        self.assertIn(
            'src="https://image.tmdb.org/t/p/w342/wild-horse.jpg"',
            http.post_calls[0]["json"]["html"],
        )

    def test_preferred_city_is_used_before_jerusalem_fallback(self):
        repo = Repository(showtimes=[ticket(), ticket("Haifa")])
        repo.locations["alice"] = "Haifa"
        self.watch(repo)
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()
        self.assertIn("Haifa", http.post_calls[0]["json"]["text"])
        self.assertNotIn("Jerusalem", http.post_calls[0]["json"]["text"])

    def test_delivery_link_preserves_selected_city_date_and_effective_filter_mask(self):
        repo = Repository(
            showtimes=[ticket("Tel Aviv", day="2027-01-15")],
        )
        repo.movie_codes[101] = "A7z"
        repo.preferences = [
            {
                "user_id": "alice",
                "cities": ["Tel Aviv"],
                "filter_exclusions": {
                    "showType": ["VIP"],
                    "screenFormat": ["3D"],
                    "screeningTech": ["IMAX"],
                    "dubLanguage": ["French"],
                },
            }
        ]
        self.watch(repo)
        http = FakeLetterboxdAndResend()

        self.dispatcher(repo, http).dispatch()

        body = http.post_calls[0]["json"]
        self.assertIn("Tel Aviv", body["text"])
        self.assertIn("/A7zlb1fHK?date=2027-01-15", body["text"])
        self.assertNotIn("tickets.example.test", body["html"])

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
        repo.movie_codes[101] = "A7z"
        repo.preferences = [
            {
                "user_id": "alice",
                "cities": ["Jerusalem"],
                "filter_exclusions": {"screeningTech": ["IMAX"]},
            }
        ]
        self.watch(repo)
        http = FakeLetterboxdAndResend(responses=[FakeResponse(500), FakeResponse(200)])
        with self.assertRaisesRegex(RuntimeError, "delivery failed"):
            self.dispatcher(repo, http).dispatch()
        repo.showtimes = [ticket(day="2026-10-28")]
        repo.preferences[0]["filter_exclusions"] = {
            "screeningTech": ["Standard"]
        }
        repo.preferences[0]["cities"] = ["Tel Aviv"]
        repo.canonical_email = lambda user: "changed@example.test"
        self.assertEqual(self.dispatcher(repo, http).dispatch().emails_sent, 1)
        self.assertEqual(http.post_calls[0]["json"], http.post_calls[1]["json"])
        self.assertEqual(
            http.post_calls[0]["headers"]["Idempotency-Key"],
            http.post_calls[1]["headers"]["Idempotency-Key"],
        )

    def test_letterboxd_digest_includes_distinct_manage_and_one_click_controls(self):
        repo = Repository(
            sources=[
                _source("watch", "https://letterboxd.com/fixture/watchlist/", "watchlist")
            ],
            showtimes=[ticket()],
        )
        self.watch(repo)
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()

        email = http.post_calls[0]["json"]
        self.assertIn("Manage Letterboxd list alerts", email["html"])
        self.assertIn("Manage Letterboxd list alerts", email["text"])
        self.assertEqual(
            http.unsubscribe_calls[0]["json"],
            {"userId": "alice", "deliveryId": "batch-0"},
        )
        self.assertEqual(
            email["headers"]["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click"
        )
        self.assertTrue(email["headers"]["List-Unsubscribe"].startswith("<https://"))
        self.assertIn(
            "including connected Letterboxd lists and individual movie watches",
            email["text"],
        )

    def test_manual_only_digest_has_no_list_unsubscribe_headers_or_footer(self):
        repo = Repository(showtimes=[ticket()])
        self.watch(repo)
        http = FakeLetterboxdAndResend()
        self.dispatcher(repo, http).dispatch()

        email = http.post_calls[0]["json"]
        self.assertNotIn("headers", email)
        self.assertNotIn("Manage Letterboxd list alerts", email["text"])

    def test_templates_escape_manage_url_and_add_headers_only_as_a_pair(self):
        event = {
            "tmdb_id": 101,
            "event_type": "coming_soon",
            "event_payload": {"title": "A Film", "release_date": "2027-01-01"},
        }
        email = render_movie_notification_email(
            [event],
            letterboxd_manage_url="https://seret.site/unsubscribe/letterboxd#token=abc&x=1",
            one_click_unsubscribe_url="https://seret.site/api/v1/unsubscribe/one-click/token",
        )

        self.assertIn("token=abc&amp;x=1", email.html)
        self.assertIn("token=abc&x=1", email.text)
        self.assertEqual(
            email.headers,
            {
                "List-Unsubscribe": "<https://seret.site/api/v1/unsubscribe/one-click/token>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
        )
        with self.assertRaisesRegex(ValueError, "Both movie notification"):
            render_movie_notification_email([event], letterboxd_manage_url="https://seret.site/manage")

    def test_unsubscribe_urls_use_configured_https_origins_and_block_redirects(self):
        http = FakeLetterboxdAndResend()
        urls = create_movie_notification_unsubscribe_urls(
            http,
            base_url="https://api.example.test",
            internal_secret="internal-test-secret",
            site_url="https://watch.example.test",
            user_id="alice",
            delivery_id="batch-17",
        )
        self.assertEqual(
            urls,
            (
                "https://watch.example.test/unsubscribe/letterboxd#token=" + "M" * 43,
                "https://watch.example.test/api/v1/unsubscribe/one-click/" + "O" * 43,
            ),
        )
        self.assertEqual(
            http.unsubscribe_calls[0]["endpoint"],
            "https://api.example.test/api/internal/movie-notification-unsubscribe-tokens",
        )
        self.assertEqual(http.unsubscribe_calls[0]["timeout"], (5, 15))
        self.assertFalse(http.unsubscribe_calls[0]["allow_redirects"])
        self.assertEqual(
            http.unsubscribe_calls[0]["headers"],
            {"Authorization": "Bearer internal-test-secret"},
        )
        for base_url in (
            "",
            "http://api.example.test",
            "https://api.example.test/path",
            "https://user:secret@api.example.test",
        ):
            with self.subTest(base_url=base_url), self.assertRaises(RuntimeError):
                create_movie_notification_unsubscribe_urls(
                    http,
                    base_url=base_url,
                    internal_secret="internal-test-secret",
                    site_url="https://watch.example.test",
                    user_id="alice",
                    delivery_id="batch-17",
                )

    def test_template_rejects_header_injection_in_unsubscribe_urls(self):
        event = {
            "tmdb_id": 101,
            "event_type": "coming_soon",
            "event_payload": {"title": "A Film", "release_date": "2027-01-01"},
        }
        with self.assertRaisesRegex(ValueError, "safe HTTPS URLs"):
            render_movie_notification_email(
                [event],
                letterboxd_manage_url="https://seret.site/manage#token=abc",
                one_click_unsubscribe_url="https://seret.site/unsub\r\nBcc:evil@example.test",
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
        repo.movie_codes[101] = "A7z"
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
        override_filters = {
            "showType": [],
            "screenFormat": [],
            "screeningTech": ["Standard"],
            "dubLanguage": [],
        }
        self.assertIn(
            "https://seret.site"
            + build_movie_showtime_path(
                "A7z",
                "Haifa",
                "2026-10-22",
                filter_mask_from_exclusions(override_filters),
            ),
            http.post_calls[0]["json"]["text"],
        )

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

    def test_digest_uses_movie_page_showtime_action_and_keeps_booking_url_private(self):
        email = render_movie_notification_email(
            [
                {
                    "tmdb_id": 101,
                    "event_type": "showtime",
                    "event_payload": {
                        "title": "Wild Horse Nine",
                        "movie_code": "Ab1",
                        "poster_url": "https://image.tmdb.org/t/p/w342/wild-horse.jpg",
                        "screening_city": "Jerusalem",
                        "date_of_showing": "2026-11-05",
                        "showtime": "17:00",
                        "cinema": "Yes Planet",
                        "ticket_href": "https://tickets.example.test/showtime/101",
                    },
                }
            ]
        )
        self.assertIn(
            'src="https://image.tmdb.org/t/p/w342/wild-horse.jpg"', email.html
        )
        self.assertIn('alt="Wild Horse Nine poster"', email.html)
        self.assertIn("View showtimes", email.html)
        self.assertIn("?date=2026-11-05", email.html)
        self.assertNotIn("tickets.example.test", email.html)
        self.assertIn("View showtimes:", email.text)
        self.assertNotIn("tickets.example.test", email.text)
        self.assertIn("Jerusalem · November 5, 2026 at 17:00 · Yes Planet", email.text)

    def test_digest_omits_unsafe_poster_urls_and_keeps_a_fallback_tile(self):
        event = {
            "tmdb_id": 101,
            "event_type": "coming_soon",
            "event_payload": {
                "title": "Future Film",
                "release_date": "2027-01-01",
                "poster_url": "javascript:alert(1)",
            },
        }
        email = render_movie_notification_email([event])
        self.assertNotIn("javascript:", email.html)
        self.assertIn("Film poster unavailable", email.html)
