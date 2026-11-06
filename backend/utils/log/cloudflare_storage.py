"""Small, synchronous clients for the private D1 and R2 run-artifact stores.

All write calls are deliberately single-attempt. If a request has an uncertain
outcome, its local recovery envelope is kept for an operator to reconcile.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import requests


class CloudflareStorageError(RuntimeError):
    """A D1 or R2 request failed; credentials are never included in the error."""


class LeaseLostError(CloudflareStorageError):
    """The job no longer owns its target's maintenance lease."""


def redact_secrets(value: str) -> str:
    """Redact recognizable credentials and every configured secret value."""
    text = str(value or "")
    for name, secret in os.environ.items():
        if not secret or len(secret) < 8:
            continue
        if any(marker in name.upper() for marker in ("KEY", "SECRET", "TOKEN", "PASSWORD", "ACCESS")):
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(
        r"(?i)(api[_-]?key|access[_-]?token|secret[_-]?access[_-]?key|password|authorization)(\s*[=:]\s*)([^&\s,;]+)",
        r"\1\2[REDACTED]",
        text,
    )
    text = re.sub(r"(?i)Bearer\s+[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", text)
    text = re.sub(r"\b(?:sb_secret|sb_publishable)_[A-Za-z0-9_-]+", "[REDACTED]", text)
    return text


@dataclass(frozen=True)
class D1Result:
    rows: list[dict]
    rows_written: int
    changes: int
    raw: dict


class D1Client:
    def __init__(self, database_id: str, account_id: str, api_token: str, *, timeout: float = 30.0):
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", database_id or ""):
            raise CloudflareStorageError("D1_DATABASE_ID must be a Cloudflare D1 database UUID.")
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id or ""):
            raise CloudflareStorageError("R2_ACCOUNT_ID must be a Cloudflare account ID.")
        if not api_token or len(api_token) < 20:
            raise CloudflareStorageError("D1_API_TOKEN must be a Cloudflare API token with D1 access.")
        self.database_id = database_id
        self._api_secret = api_token
        self.timeout = timeout
        self.endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"

    @classmethod
    def from_environment(cls) -> "D1Client":
        return cls(
            os.environ.get("D1_DATABASE_ID", "").strip(),
            os.environ.get("R2_ACCOUNT_ID", "").strip(),
            os.environ.get("D1_API_TOKEN", "").strip(),
        )

    @staticmethod
    def _as_text_params(params) -> list:
        # Preserve JSON nulls and scalar types through the Worker binding.
        return list(params)

    def _post(self, payload: dict) -> list[dict]:
        from backend.utils.log.job_lease import before_mutation
        before_mutation()
        try:
            response = requests.post(
                self.endpoint,
                headers={
                    "Authorization": f"Bearer {self._api_secret}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.timeout,
            )
        except requests.RequestException as error:
            raise CloudflareStorageError(
                f"D1 request failed before a response was confirmed ({type(error).__name__})."
            ) from error
        try:
            body = response.json()
        except ValueError as error:
            raise CloudflareStorageError(
                f"D1 returned a non-JSON response (HTTP {response.status_code})."
            ) from error
        if not response.ok or not isinstance(body, dict) or body.get("success") is False:
            errors = body.get("errors", []) if isinstance(body, dict) else []
            message = "; ".join(
                str(item.get("message", "D1 API error"))
                for item in errors
                if isinstance(item, dict)
            ) or f"HTTP {response.status_code}"
            raise CloudflareStorageError(f"D1 request failed: {redact_secrets(message[:400])}")
        results = body.get("result")
        if not isinstance(results, list):
            raise CloudflareStorageError("D1 returned an unexpected result shape.")
        failed = [item for item in results if isinstance(item, dict) and item.get("success") is False]
        if failed:
            raise CloudflareStorageError("D1 reported a failed query in the submitted batch.")
        return results

    def execute(self, sql: str, params=()) -> D1Result:
        results = self._post({"sql": sql, "params": self._as_text_params(params)})
        first = results[0] if results and isinstance(results[0], dict) else {}
        meta = first.get("meta") if isinstance(first.get("meta"), dict) else {}
        rows = first.get("results") if isinstance(first.get("results"), list) else []
        return D1Result(
            rows=[row for row in rows if isinstance(row, dict)],
            rows_written=int(meta.get("rows_written") or 0),
            changes=int(meta.get("changes") or 0),
            raw=first,
        )

    def measure_database_size(self) -> int:
        result = self.execute("SELECT 1 AS ok")
        size = result.raw.get("meta", {}).get("size_after")
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise CloudflareStorageError("D1 did not return a reliable database size.")
        return size

    def batch(self, statements: list[tuple[str, tuple | list]]) -> list[D1Result]:
        if not statements:
            return []
        if len(statements) > 100:
            raise CloudflareStorageError("D1 batches are limited to 100 statements.")
        results = self._post({
            "batch": [
                {"sql": sql, "params": self._as_text_params(params)}
                for sql, params in statements
            ]
        })
        output = []
        for item in results:
            if not isinstance(item, dict):
                raise CloudflareStorageError("D1 returned an invalid batch result.")
            meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
            rows = item.get("results") if isinstance(item.get("results"), list) else []
            output.append(D1Result(
                rows=[row for row in rows if isinstance(row, dict)],
                rows_written=int(meta.get("rows_written") or 0),
                changes=int(meta.get("changes") or 0),
                raw=item,
            ))
        if len(output) != len(statements):
            raise CloudflareStorageError("D1 returned an incomplete batch result.")
        return output


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def recovery_root() -> Path:
    configured = os.environ.get("KARTISERET_RECOVERY_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif os.uname().sysname == "Darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "Kartiseret" / "run-recovery"


def write_recovery_envelope(kind: str, identity: str, payload: dict, data: bytes | None = None) -> tuple[Path, Path | None]:
    """Durably save unsent data outside the checkout with owner-only permissions."""
    safe_kind = re.sub(r"[^A-Za-z0-9_-]", "_", kind)[:50] or "artifact"
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", identity)[:100] or "unknown"
    directory = recovery_root() / safe_kind
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        directory.chmod(0o700)
    except OSError:
        pass
    attachment_path = None
    if data is not None:
        attachment_path = directory / f"{safe_id}.bin"
        temporary_data = attachment_path.with_suffix(".bin.tmp")
        temporary_data.write_bytes(data)
        try:
            temporary_data.chmod(0o600)
        except OSError:
            pass
        os.replace(temporary_data, attachment_path)
    envelope_path = directory / f"{safe_id}.json"
    temporary = envelope_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")
    try:
        temporary.chmod(0o600)
    except OSError:
        pass
    os.replace(temporary, envelope_path)
    return envelope_path, attachment_path


def remove_recovery_envelope(paths: tuple[Path, Path | None]) -> None:
    for path in paths:
        if path is not None:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
