import unittest
from unittest.mock import Mock
from uuid import uuid4

from backend.notifications.ticket_alerts import (
    SupabaseTicketAlertRepository, TicketAlertDispatcher, get_canonical_app_email,
    send_resend_email, RenderedEmail,
)


class RecipientLookupTests(unittest.TestCase):
    def setUp(self):
        self.user_id = str(uuid4())
        self.http = Mock()
        self.http.post.return_value.status_code = 200
        self.http.post.return_value.json.return_value = {
            "data": [{"id": self.user_id, "email": "canonical@example.test", "emailVerified": True}], "error": None,
        }

    def lookup(self, **overrides):
        return get_canonical_app_email(self.http, base_url="https://dev.example.test", secret="test-internal-secret", user_id=self.user_id, **overrides)

    def test_uses_only_verified_app_identity_and_bounded_authenticated_http(self):
        self.assertEqual(self.lookup(), "canonical@example.test")
        self.http.post.assert_called_once_with(
            "https://dev.example.test/api/internal/ticket-alert-recipients",
            headers={"Authorization": "Bearer test-internal-secret", "Content-Type": "application/json"},
            json={"userIds": [self.user_id]}, timeout=(5, 15), allow_redirects=False,
        )

    def test_missing_unverified_malformed_and_wrong_identity_fail_closed(self):
        cases = [[], [{"id": self.user_id, "email": "a@example.test", "emailVerified": False}],
                 [{"id": str(uuid4()), "email": "a@example.test", "emailVerified": True}],
                 [{"id": self.user_id, "email": "a@example.test\n", "emailVerified": True}], None]
        for rows in cases:
            with self.subTest(rows=rows):
                self.http.post.return_value.json.return_value = {"data": rows, "error": None}
                with self.assertRaises(ValueError): self.lookup()

    def test_http_errors_redirects_and_timeout_do_not_fall_back(self):
        for status in [301, 401, 500]:
            self.http.post.return_value.status_code = status
            with self.assertRaises(RuntimeError): self.lookup()
        self.http.post.side_effect = TimeoutError("timeout")
        with self.assertRaises(TimeoutError): self.lookup()

    def test_missing_configuration_has_no_production_default(self):
        for base in ["", "http://remote.example.test", "https://user:secret@example.test", "https://dev.example.test/path"]:
            with self.assertRaises(RuntimeError):
                get_canonical_app_email(self.http, base_url=base, secret="test", user_id=self.user_id)
        self.http.post.assert_not_called()

    def test_repository_memoizes_only_successful_recipient_for_its_run(self):
        repository = SupabaseTicketAlertRepository(Mock(), recipient_api_url="https://dev.example.test", internal_api_secret="test", http_client=self.http)
        self.assertEqual(repository.canonical_email(self.user_id), "canonical@example.test")
        self.assertEqual(repository.canonical_email(self.user_id), "canonical@example.test")
        self.http.post.assert_called_once()

    def test_pending_retry_retains_claimed_delivery_identity(self):
        rows = [{"user_id": self.user_id, "delivery_id": "existing-delivery", "created_at": "2026-10-19T12:00:00Z"}]
        batches = TicketAlertDispatcher._retry_batches(rows)
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0].delivery_id, "existing-delivery")
        self.assertEqual(batches[0].user_id, self.user_id)

    def test_delivery_retry_keeps_existing_idempotency_key(self):
        self.http.post.return_value.json.return_value = {"id": "provider-message"}
        email = RenderedEmail(subject="Test", html="<p>Test</p>", text="Test")
        for _ in range(2):
            send_resend_email(self.http, api_key="test", from_email="test@example.test", to_email="canonical@example.test", delivery_id="existing-delivery", email=email)
        keys = [call.kwargs["headers"]["Idempotency-Key"] for call in self.http.post.call_args_list]
        self.assertEqual(keys, ["ticket-alert-existing-delivery"] * 2)


if __name__ == "__main__": unittest.main()
