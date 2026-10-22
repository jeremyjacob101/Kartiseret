from datetime import datetime
from unittest import TestCase

from backend.notifications.coming_soon_date_alerts import (
    ComingSoonDateAlertDispatcher,
    render_coming_soon_date_email,
)
from backend.notifications.ticket_alerts import TicketAlertConfig


class FakeResponse:
    def __init__(self, status_code=200, email_id="resend-email"):
        self.status_code = status_code
        self.text = ""
        self.email_id = email_id

    def json(self):
        return {"id": self.email_id}


class FakeResend:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = []

    def post(self, endpoint, *, headers, json, timeout):
        self.calls.append({"endpoint": endpoint, "headers": headers, "json": json, "timeout": timeout})
        return self.responses.pop(0) if self.responses else FakeResponse()


class FakeRepository:
    def __init__(self, watches, local_dates):
        self.watches = [dict(row) for row in watches]
        self.local_dates = dict(local_dates)
        self.claims = []
        self.attempts = 0
        self.successes = []
        self.failures = []

    def load_pending_watches(self):
        return [dict(row) for row in self.watches if row.get("notified_at") is None]

    def load_local_dates(self, tmdb_ids):
        return {tmdb_id: self.local_dates[tmdb_id] for tmdb_id in tmdb_ids if tmdb_id in self.local_dates}

    def claim_delivery(self, user_id, delivery_id, items):
        claimed = []
        for item in items:
            row = next((r for r in self.watches if r["user_id"] == user_id and int(r["tmdb_id"]) == item.tmdb_id), None)
            if row and row.get("notified_at") is None and row.get("delivery_id") is None:
                row.update({"delivery_id": delivery_id, "delivery_title": item.title, "delivery_date": item.release_date})
                claimed.append(dict(row))
        self.claims.append((user_id, delivery_id, tuple(items)))
        return claimed

    def record_attempt(self, user_id, delivery_id):
        self.attempts += 1
        for row in self.watches:
            if row["user_id"] == user_id and row.get("delivery_id") == delivery_id:
                row["delivery_attempts"] = int(row.get("delivery_attempts") or 0) + 1

    def canonical_email(self, user_id):
        return f"{user_id}@example.test"

    def mark_success(self, user_id, delivery_id, resend_email_id, delivered_at):
        for row in self.watches:
            if row["user_id"] == user_id and row.get("delivery_id") == delivery_id:
                row["notified_at"] = delivered_at.isoformat()
                row["resend_email_id"] = resend_email_id
        self.successes.append((user_id, delivery_id))

    def mark_failure(self, user_id, delivery_id, error):
        self.failures.append((user_id, delivery_id, error))


def watch(user_id, tmdb_id, *, delivery_id=None):
    return {
        "user_id": user_id,
        "tmdb_id": tmdb_id,
        "title": f"TMDb result {tmdb_id}",
        "release_year": 2028,
        "poster_path": "/poster.jpg",
        "created_at": "2026-10-21T10:00:00+00:00",
        "notified_at": None,
        "delivery_id": delivery_id,
        "delivery_title": None,
        "delivery_date": None,
        "delivery_attempts": 0,
    }


class ComingSoonDateAlertTests(TestCase):
    def dispatcher(self, repository, http_client=None, delivery_ids=None):
        return ComingSoonDateAlertDispatcher(
            run_id=1,
            repository=repository,
            http_client=http_client or FakeResend(),
            config=TicketAlertConfig(
                resend_api_key="fake-resend-key",
                from_email="Kartiseret <notifications@example.test>",
                site_url="https://seret.test",
            ),
            now_factory=lambda: datetime.fromisoformat("2026-10-21T14:00:00+03:00"),
            delivery_id_factory=lambda: next(delivery_ids) if delivery_ids else "delivery-1",
        )

    def test_no_local_catalog_record_means_no_date_alert(self):
        repository = FakeRepository([watch("alice", 101)], local_dates={})
        resend = FakeResend()
        summary = self.dispatcher(repository, resend).dispatch()
        self.assertEqual(summary.pending_watches, 1)
        self.assertEqual(summary.emails_sent, 0)
        self.assertEqual(resend.calls, [])
        self.assertEqual(repository.claims, [])

    def test_first_local_date_groups_each_users_discoveries_into_one_email(self):
        repository = FakeRepository(
            [watch("alice", 101), watch("alice", 102), watch("bob", 103)],
            {
                101: ("First Local Film", "2027-04-12"),
                102: ("Second Local Film", "2027-05-03"),
                103: ("Another Local Film", "2027-06-07"),
            },
        )
        resend = FakeResend()
        summary = self.dispatcher(repository, resend).dispatch()
        self.assertEqual(summary.emails_sent, 2)
        self.assertEqual(summary.movies_notified, 3)
        self.assertEqual(len(resend.calls), 2)
        self.assertEqual(len(repository.claims), 2)
        for call in resend.calls:
            self.assertTrue(call["headers"]["Idempotency-Key"].startswith("coming-soon-date-alert-"))
        alice_email = next(call["json"] for call in resend.calls if "alice@example.test" in call["json"]["to"])
        self.assertIn("First Local Film", alice_email["text"])
        self.assertIn("Second Local Film", alice_email["text"])
        self.assertIn("April 12, 2027", alice_email["text"])
        self.assertEqual(sum(row["notified_at"] is not None for row in repository.watches), 3)

    def test_retry_reuses_delivery_snapshot_and_resend_idempotency_key(self):
        repository = FakeRepository(
            [watch("alice", 101)], {101: ("First Local Film", "2027-04-12")}
        )
        resend = FakeResend([FakeResponse(status_code=500), FakeResponse(email_id="recovered")])
        dispatcher = self.dispatcher(repository, resend, iter(["delivery-stable"]))
        with self.assertRaisesRegex(RuntimeError, "Coming Soon date delivery failed"):
            dispatcher.dispatch()
        self.assertIsNone(repository.watches[0]["notified_at"])
        self.assertEqual(repository.watches[0]["delivery_id"], "delivery-stable")

        repository.local_dates[101] = ("Changed Local Title", "2027-12-25")
        summary = dispatcher.dispatch()
        self.assertEqual(summary.emails_sent, 1)
        self.assertEqual(repository.watches[0]["notified_at"], "2026-10-21T14:00:00+03:00")
        self.assertEqual(
            [call["headers"]["Idempotency-Key"] for call in resend.calls],
            ["coming-soon-date-alert-delivery-stable"] * 2,
        )
        self.assertIn("April 12, 2027", resend.calls[1]["json"]["text"])
        self.assertNotIn("Changed Local Title", resend.calls[1]["json"]["text"])

    def test_email_escapes_titles_and_uses_the_local_date(self):
        email = render_coming_soon_date_email(
            (
                type("Item", (), {"tmdb_id": 101, "title": "<Future Film>", "release_date": "2027-04-12"})(),
            )
        )
        self.assertIn("&lt;Future Film&gt;", email.html)
        self.assertNotIn("<Future Film>", email.html)
        self.assertIn("April 12, 2027", email.text)


if __name__ == "__main__":
    import unittest

    unittest.main()
