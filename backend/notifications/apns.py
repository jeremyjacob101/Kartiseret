from __future__ import annotations

from dataclasses import dataclass
import base64
import json
import os
import time
from typing import Any

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


class APNSResponseError(RuntimeError):
    def __init__(self, status_code: int, reason: str):
        self.status_code = status_code
        self.reason = reason
        super().__init__(f"APNs returned {status_code}: {reason}")


@dataclass(frozen=True)
class APNSConfig:
    key_id: str
    team_id: str
    bundle_id: str
    private_key: bytes

    @classmethod
    def from_environment(cls) -> "APNSConfig":
        key_id = os.environ.get("APNS_KEY_ID", "").strip()
        team_id = os.environ.get("APNS_TEAM_ID", "").strip()
        bundle_id = os.environ.get("APNS_BUNDLE_ID", "").strip()
        encoded_key = "".join(
            os.environ.get("APNS_PRIVATE_KEY_BASE64", "").split()
        )
        if not all((key_id, team_id, bundle_id, encoded_key)):
            raise RuntimeError(
                "APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, and "
                "APNS_PRIVATE_KEY_BASE64 are required for iPhone notifications."
            )
        try:
            private_key = base64.b64decode(encoded_key, validate=True)
        except ValueError as error:
            raise RuntimeError("APNS_PRIVATE_KEY_BASE64 is invalid.") from error
        return cls(key_id, team_id, bundle_id, private_key)


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class ApplePushClient:
    def __init__(
        self,
        config: APNSConfig,
        *,
        http_client: httpx.Client | None = None,
        now: Any = time.time,
    ):
        self.config = config
        self.http_client = http_client or httpx.Client(http2=True, timeout=15)
        self._owns_client = http_client is None
        self.now = now
        self._provider_token: str | None = None
        self._provider_token_expires_at = 0
        self._private_key = serialization.load_pem_private_key(
            config.private_key, password=None
        )
        if not isinstance(self._private_key, ec.EllipticCurvePrivateKey):
            raise RuntimeError("The APNs authentication key must be an EC private key.")

    @classmethod
    def from_environment(cls) -> "ApplePushClient":
        return cls(APNSConfig.from_environment())

    def _authorization_token(self) -> str:
        now = int(self.now())
        if self._provider_token and now < self._provider_token_expires_at:
            return self._provider_token
        header = _base64url(
            json.dumps(
                {"alg": "ES256", "kid": self.config.key_id},
                separators=(",", ":"),
            ).encode()
        )
        claims = _base64url(
            json.dumps(
                {"iss": self.config.team_id, "iat": now},
                separators=(",", ":"),
            ).encode()
        )
        signing_input = f"{header}.{claims}".encode("ascii")
        der_signature = self._private_key.sign(
            signing_input, ec.ECDSA(hashes.SHA256())
        )
        r_value, s_value = decode_dss_signature(der_signature)
        signature = r_value.to_bytes(32, "big") + s_value.to_bytes(32, "big")
        self._provider_token = f"{header}.{claims}.{_base64url(signature)}"
        self._provider_token_expires_at = now + 50 * 60
        return self._provider_token

    def send(self, device_token: str, environment: str, payload: dict[str, Any]) -> str | None:
        if environment not in ("development", "production"):
            raise ValueError("APNs environment is invalid.")
        host = (
            "https://api.sandbox.push.apple.com"
            if environment == "development"
            else "https://api.push.apple.com"
        )
        response = self.http_client.post(
            f"{host}/3/device/{device_token}",
            headers={
                "authorization": f"bearer {self._authorization_token()}",
                "apns-topic": self.config.bundle_id,
                "apns-push-type": "alert",
                "apns-priority": "10",
            },
            json=payload,
        )
        if response.status_code != 200:
            try:
                reason = response.json().get("reason", "UnknownReason")
            except (ValueError, AttributeError):
                reason = "UnknownReason"
            raise APNSResponseError(response.status_code, str(reason))
        return response.headers.get("apns-id")

    def close(self) -> None:
        if self._owns_client:
            self.http_client.close()
