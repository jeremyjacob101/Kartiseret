from datetime import date, datetime
from types import SimpleNamespace
from unittest import TestCase

from backend.notifications.ticket_alerts import (
    DEFAULT_FROM_EMAIL,
    DeliveryItem,
    TicketAlertConfig,
    TicketAlertDispatcher,
    build_ticket_alert_path,
    get_canonical_auth_email,
    render_ticket_alert_email,
    select_linked_showtime,
    valid_ticket_href,
)


TEST_NOW = datetime.fromisoformat("2026-08-23T15:00:00+03:00")


def showtime_row(**overrides):
    row = {
        "tmdb_id": 1,
        "english_title": "Movie One",
        "screening_city": "Tel Aviv",
        "date_of_showing": "2026-08-24",
        "showtime": "18:00:00",
        "cinema": "Cinema City",
        "english_href": "https://tickets.example/showing/1",
        "hebrew_href": None,
    }
    row.update(overrides)
    return row


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self.payload = payload if payload is not None else {"id": "email-123"}
        self.text = text

    def json(self):
        return self.payload


class FakeHttpClient:
    def __init__(self, responses=None):
        self.responses = list(responses or [FakeResponse()])
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if not self.responses:
            return FakeResponse()
        return self.responses.pop(0)


class FakeRepository:
    def __init__(self, pending_rows, showtimes=None, guest_rows=None):
        self.pending_rows = list(pending_rows)
        self.guest_rows = list(guest_rows or [])
        self.showtimes = list(showtimes or [])
        self.attempts = []
        self.claims = []
        self.successes = []
        self.failures = []
        self.guest_attempts = []
        self.guest_claims = []
        self.guest_successes = []
        self.guest_failures = []

    def load_pending_subscriptions(self):
        return list(self.pending_rows)

    def load_pending_guest_subscriptions(self):
        return list(self.guest_rows)

    def load_showtimes(self, tmdb_ids, earliest_date):
        return [row for row in self.showtimes if int(row["tmdb_id"]) in tmdb_ids]

    def load_titles(self, tmdb_ids):
        return {int(row["tmdb_id"]): row["english_title"] for row in self.showtimes}

    def load_movie_codes(self, tmdb_ids):
        return {tmdb_id: f"A{tmdb_id}z" for tmdb_id in tmdb_ids}

    def load_preferred_cities(self, user_ids):
        return {user_id: "Jerusalem" for user_id in user_ids}

    def claim_delivery(self, user_id, delivery_id, items):
        self.claims.append((user_id, delivery_id, items))
        return [
            {
                "user_id": user_id,
                "tmdb_id": item.tmdb_id,
                "created_at": "2026-08-23T12:00:00+00:00",
                "delivery_id": delivery_id,
                "delivery_title": item.title,
                "delivery_city": item.city,
                "delivery_date": item.date,
                "delivery_href": item.ticket_href,
                "delivery_movie_code": item.movie_code,
            }
            for item in items
        ]

    def record_attempt(self, user_id, delivery_id):
        self.attempts.append((user_id, delivery_id))

    def canonical_email(self, user_id):
        return "person@example.com"

    def mark_success(self, user_id, delivery_id, resend_email_id, delivered_at):
        self.successes.append(
            (user_id, delivery_id, resend_email_id, delivered_at)
        )

    def mark_failure(self, user_id, delivery_id, error):
        self.failures.append((user_id, delivery_id, error))

    def claim_guest_delivery(self, guest_token, delivery_id, items):
        self.guest_claims.append((guest_token, delivery_id, items))
        return [
            {
                "guest_token": guest_token,
                "tmdb_id": item.tmdb_id,
                "created_at": "2026-08-23T12:00:00+00:00",
                "delivery_id": delivery_id,
                "delivery_title": item.title,
                "delivery_city": item.city,
                "delivery_date": item.date,
                "delivery_href": item.ticket_href,
                "delivery_movie_code": item.movie_code,
            }
            for item in items
        ]

    def record_guest_attempt(self, guest_token, delivery_id):
        self.guest_attempts.append((guest_token, delivery_id))

    def mark_guest_success(
        self, guest_token, delivery_id, resend_email_id, delivered_at
    ):
        self.guest_successes.append(
            (guest_token, delivery_id, resend_email_id, delivered_at)
        )

    def mark_guest_failure(self, guest_token, delivery_id, error):
        self.guest_failures.append((guest_token, delivery_id, error))


def pending_subscription(tmdb_id, *, delivery_id=None, title=None):
    row = {
        "user_id": "user-1",
        "tmdb_id": tmdb_id,
        "created_at": "2026-08-23T12:00:00+00:00",
        "notified_at": None,
        "delivery_id": delivery_id,
    }
    if delivery_id:
        row.update(
            {
                "delivery_title": title or f"Movie {tmdb_id}",
                "delivery_city": "Jerusalem",
                "delivery_date": "2026-08-24",
                "delivery_href": f"https://tickets.example/showing/{tmdb_id}",
                "delivery_movie_code": f"A{tmdb_id}z",
            }
        )
    return row


class TicketAlertSelectionTests(TestCase):
    def test_prefers_saved_city_then_falls_back_anywhere(self):
        rows = [
            showtime_row(showtime="10:00:00"),
            showtime_row(
                screening_city="Jerusalem",
                showtime="21:00:00",
                english_href="https://tickets.example/jerusalem-late",
            ),
            showtime_row(
                screening_city="Jerusalem",
                showtime="17:30:00",
                english_href="https://tickets.example/jerusalem-early",
            ),
        ]

        preferred = select_linked_showtime(rows, "Jerusalem", TEST_NOW)
        fallback = select_linked_showtime(rows[:1], "Haifa", TEST_NOW)

        self.assertEqual(preferred.city, "Jerusalem")
        self.assertEqual(preferred.time, "17:30")
        self.assertEqual(fallback.city, "Tel Aviv")

    def test_rejects_invalid_links_and_uses_hebrew_fallback(self):
        self.assertIsNone(
            valid_ticket_href(
                {"english_href": "javascript:alert(1)", "hebrew_href": "none"}
            )
        )
        self.assertEqual(
            valid_ticket_href(
                {
                    "english_href": "none",
                    "hebrew_href": "https://tickets.example/he/1",
                }
            ),
            "https://tickets.example/he/1",
        )

    def test_route_codec_matches_frontend_and_has_plain_fallback(self):
        self.assertEqual(
            build_ticket_alert_path(
                "Ab9", "Jerusalem", "2026-08-24", date(2026, 8, 23)
            ),
            "/Ab9iRj",
        )
        self.assertEqual(
            build_ticket_alert_path(
                "Ab9", "Jerusalem", "2026-12-18", date(2026, 8, 23)
            ),
            "/Ab9",
        )


class TicketAlertEmailTests(TestCase):
    def test_batches_movies_and_escapes_html(self):
        items = (
            DeliveryItem(
                tmdb_id=1,
                title="Dune <Part Three>",
                city="Jerusalem",
                date="2026-08-24",
                ticket_href="https://tickets.example/1",
                movie_code="Ab9",
            ),
            DeliveryItem(
                tmdb_id=2,
                title="Movie & Two",
                city="Tel Aviv",
                date="2026-08-25",
                ticket_href="https://tickets.example/2",
                movie_code="Cd8",
            ),
        )

        email = render_ticket_alert_email(
            items, "https://seret.site", date(2026, 8, 23)
        )

        self.assertEqual(email.subject, "Tickets for 2 movies are now on sale!")
        self.assertIn("Dune &lt;Part Three&gt;", email.html)
        self.assertIn("Movie &amp; Two", email.html)
        self.assertNotIn("Dune <Part Three>", email.html)

    def test_singular_subject_matches_product_copy(self):
        email = render_ticket_alert_email(
            (
                DeliveryItem(
                    tmdb_id=1,
                    title="Dune Part Three",
                    city="Jerusalem",
                    date="2026-08-24",
                    ticket_href="https://tickets.example/1",
                    movie_code="Ab9",
                ),
            ),
            "https://seret.site",
            date(2026, 8, 23),
        )
        self.assertEqual(
            email.subject, "Tickets for Dune Part Three are now on sale!"
        )

    def test_auth_email_comes_from_admin_lookup(self):
        client = SimpleNamespace(
            auth=SimpleNamespace(
                admin=SimpleNamespace(
                    get_user_by_id=lambda user_id: SimpleNamespace(
                        user=SimpleNamespace(email="canonical@example.com")
                    )
                )
            )
        )

        self.assertEqual(
            get_canonical_auth_email(client, "user-1"),
            "canonical@example.com",
        )


class TicketAlertDispatcherTests(TestCase):
    def make_dispatcher(self, repository, http_client, delivery_id="batch-123"):
        return TicketAlertDispatcher(
            99,
            repository=repository,
            http_client=http_client,
            config=TicketAlertConfig(
                resend_api_key="re_test_key",
                from_email=DEFAULT_FROM_EMAIL,
                site_url="https://seret.site",
            ),
            now_factory=lambda: TEST_NOW,
            delivery_id_factory=lambda: delivery_id,
        )

    def test_groups_new_movies_into_one_email_and_marks_success(self):
        repository = FakeRepository(
            [pending_subscription(1), pending_subscription(2)],
            [
                showtime_row(
                    tmdb_id=1,
                    english_title="Dune <Three>",
                    screening_city="Jerusalem",
                ),
                showtime_row(
                    tmdb_id=2,
                    english_title="Movie Two",
                    screening_city="Tel Aviv",
                    english_href="https://tickets.example/showing/2",
                ),
            ],
        )
        http_client = FakeHttpClient()

        summary = self.make_dispatcher(repository, http_client).dispatch()

        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(summary.movies_notified, 2)
        self.assertEqual(len(repository.claims), 1)
        self.assertEqual(len(repository.successes), 1)
        self.assertEqual(len(http_client.calls), 1)
        _, request = http_client.calls[0]
        self.assertEqual(request["json"]["to"], ["person@example.com"])
        self.assertEqual(
            request["headers"]["Idempotency-Key"], "ticket-alert-batch-123"
        )
        self.assertIn("Dune &lt;Three&gt;", request["json"]["html"])

    def test_failed_delivery_retries_with_same_idempotency_key(self):
        repository = FakeRepository(
            [pending_subscription(1, delivery_id="stable-delivery")]
        )
        http_client = FakeHttpClient(
            [
                FakeResponse(status_code=503, text="temporarily unavailable"),
                FakeResponse(payload={"id": "email-after-retry"}),
            ]
        )
        dispatcher = self.make_dispatcher(repository, http_client)

        with self.assertRaisesRegex(RuntimeError, "Ticket alert delivery failed"):
            dispatcher.dispatch()
        summary = dispatcher.dispatch()

        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(len(repository.failures), 1)
        self.assertEqual(len(repository.successes), 1)
        idempotency_keys = [
            request["headers"]["Idempotency-Key"]
            for _, request in http_client.calls
        ]
        self.assertEqual(
            idempotency_keys,
            [
                "ticket-alert-stable-delivery",
                "ticket-alert-stable-delivery",
            ],
        )

    def test_guest_delivery_uses_submitted_email_and_batches_movies(self):
        repository = FakeRepository(
            [],
            [
                showtime_row(
                    tmdb_id=1,
                    english_title="Dune Part Three",
                    screening_city="Jerusalem",
                ),
                showtime_row(
                    tmdb_id=2,
                    english_title="Movie Two",
                    screening_city="Tel Aviv",
                    english_href="https://tickets.example/showing/2",
                ),
            ],
            guest_rows=[
                {
                    "guest_token": "guest-1",
                    "tmdb_id": 1,
                    "email": "guest@example.com",
                    "preferred_city": "Jerusalem",
                    "created_at": "2026-08-23T12:00:00+00:00",
                    "notified_at": None,
                    "delivery_id": None,
                },
                {
                    "guest_token": "guest-1",
                    "tmdb_id": 2,
                    "email": "guest@example.com",
                    "preferred_city": "Jerusalem",
                    "created_at": "2026-08-23T12:01:00+00:00",
                    "notified_at": None,
                    "delivery_id": None,
                },
            ],
        )
        http_client = FakeHttpClient()

        summary = self.make_dispatcher(repository, http_client).dispatch()

        self.assertEqual(summary.pending_subscriptions, 2)
        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(summary.movies_notified, 2)
        self.assertEqual(len(repository.guest_claims), 1)
        self.assertEqual(len(repository.guest_successes), 1)
        _, request = http_client.calls[0]
        self.assertEqual(request["json"]["to"], ["guest@example.com"])


if __name__ == "__main__":
    import unittest

    unittest.main()
