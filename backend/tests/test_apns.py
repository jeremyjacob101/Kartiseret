from __future__ import annotations

import base64
import json
from unittest import TestCase
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from backend.notifications.apns import (
    APNSConfig,
    APNSResponseError,
    ApplePushClient,
)


class FakeResponse:
    def __init__(self, status_code: int, *, headers=None, body=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.body = body or {}

    def json(self):
        return self.body


class FakeHTTPClient:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.response


class ApplePushClientTests(TestCase):
    def setUp(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1()).private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        self.config = APNSConfig("KEY123", "TEAM123", "com.example.app", self.private_key)

    def test_sends_alert_to_the_matching_apns_environment_and_reuses_provider_token(self):
        http = FakeHTTPClient(FakeResponse(200, headers={"apns-id": "request-1"}))
        client = ApplePushClient(self.config, http_client=http, now=lambda: 1_800_000_000)
        payload = {"aps": {"alert": {"title": "Movie alert"}}, "url": "https://seret.site/abc"}

        self.assertEqual(client.send("a1" * 32, "development", payload), "request-1")
        self.assertEqual(client.send("b2" * 32, "production", payload), "request-1")

        first_url, first_request = http.calls[0]
        second_url, second_request = http.calls[1]
        self.assertEqual(first_url, "https://api.sandbox.push.apple.com/3/device/" + "a1" * 32)
        self.assertEqual(second_url, "https://api.push.apple.com/3/device/" + "b2" * 32)
        self.assertEqual(first_request["headers"]["apns-topic"], "com.example.app")
        self.assertEqual(first_request["json"], payload)
        self.assertEqual(
            first_request["headers"]["authorization"],
            second_request["headers"]["authorization"],
        )

        token = first_request["headers"]["authorization"].removeprefix("bearer ")
        header, claims, signature = token.split(".")
        decoded_header = json.loads(base64.urlsafe_b64decode(header + "=="))
        decoded_claims = json.loads(base64.urlsafe_b64decode(claims + "=="))
        self.assertEqual(decoded_header, {"alg": "ES256", "kid": "KEY123"})
        self.assertEqual(decoded_claims, {"iss": "TEAM123", "iat": 1_800_000_000})
        raw_signature = base64.urlsafe_b64decode(signature + "==")
        der_signature = encode_dss_signature(
            int.from_bytes(raw_signature[:32], "big"),
            int.from_bytes(raw_signature[32:], "big"),
        )
        signing_input = f"{header}.{claims}".encode("ascii")
        public_key = serialization.load_pem_private_key(
            self.private_key, password=None
        ).public_key()
        public_key.verify(der_signature, signing_input, ec.ECDSA(hashes.SHA256()))

    def test_surfaces_apns_reason_for_retry_and_token_cleanup_decisions(self):
        http = FakeHTTPClient(FakeResponse(410, body={"reason": "Unregistered"}))
        client = ApplePushClient(self.config, http_client=http, now=lambda: 1_800_000_000)

        with self.assertRaises(APNSResponseError) as raised:
            client.send("a1" * 32, "production", {"aps": {}})

        self.assertEqual(raised.exception.status_code, 410)
        self.assertEqual(raised.exception.reason, "Unregistered")

    def test_requires_all_apns_environment_values(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "APNS_KEY_ID"):
                APNSConfig.from_environment()

        encoded_key = base64.b64encode(self.private_key).decode("ascii")
        with patch.dict(
            "os.environ",
            {
                "APNS_KEY_ID": "KEY123",
                "APNS_TEAM_ID": "TEAM123",
                "APNS_BUNDLE_ID": "com.example.app",
                "APNS_PRIVATE_KEY_BASE64": "\n".join(
                    (encoded_key[:40], encoded_key[40:])
                ),
            },
            clear=True,
        ):
            configured = APNSConfig.from_environment()
        self.assertEqual(configured.private_key, self.private_key)
