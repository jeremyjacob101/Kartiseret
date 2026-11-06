"""Atomic D1-time lease primitives; callers manage heartbeat and recovery."""
from __future__ import annotations

from dataclasses import dataclass
import uuid

from backend.utils.log.cloudflare_storage import CloudflareStorageError, LeaseLostError

LEASE_SECONDS = 120


@dataclass(frozen=True)
class LeaseClaim:
    token: str
    predecessor_run_id: int | None
    predecessor_token: str


class ExpiringLeaseStore:
    def __init__(self, d1):
        from backend.utils.log.cloudflare_storage import D1Client
        if isinstance(d1, D1Client):
            from copy import copy
            d1 = copy(d1)
            d1.timeout = 5
        self.d1 = d1

    def acquire(self) -> LeaseClaim:
        rows = self.d1.execute("SELECT lease_token, run_id, lease_until, predecessor_run_id FROM run_locks WHERE id = 1").rows
        if len(rows) != 1 or not isinstance(rows[0].get("lease_token"), str):
            raise CloudflareStorageError("Target lease row is missing or malformed")
        previous = rows[0]
        token = uuid.uuid4().hex
        result = self.d1.execute(
            "UPDATE run_locks SET lease_token = ?, predecessor_run_id = COALESCE(predecessor_run_id, run_id), run_id = NULL, "
            "lease_until = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+120 seconds') "
            "WHERE id = 1 AND lease_token = ? AND lease_until = ? "
            "AND (lease_token = '' OR unixepoch(lease_until) <= unixepoch('now'))",
            (token, previous['lease_token'], previous['lease_until']),
        )
        if result.changes != 1:
            raise CloudflareStorageError("Another scraper run holds the D1 run lease; no run was started.")
        return LeaseClaim(token, previous.get('predecessor_run_id') or previous.get('run_id'), previous['lease_token'])

    def renew(self, token: str) -> None:
        if not token:
            raise LeaseLostError("Cannot renew an empty lease token")
        result = self.d1.execute(
            "UPDATE run_locks SET lease_until = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+120 seconds') "
            "WHERE id = 1 AND lease_token = ? AND unixepoch(lease_until) > unixepoch('now')",
            (token,),
        )
        if result.changes != 1:
            raise LeaseLostError("Target lease expired or ownership changed")

    def verify(self, token: str) -> None:
        if not token:
            raise LeaseLostError("Cannot verify an empty lease token")
        rows = self.d1.execute(
            "SELECT id FROM run_locks WHERE id = 1 AND lease_token = ? "
            "AND unixepoch(lease_until) > unixepoch('now')", (token,),
        ).rows
        if len(rows) != 1:
            raise LeaseLostError("Target lease expired or ownership changed")

    def release(self, token: str) -> None:
        if not token:
            raise LeaseLostError("Cannot release an empty lease token")
        result = self.d1.execute(
            "UPDATE run_locks SET lease_token = '', run_id = NULL, "
            "lease_until = '1970-01-01T00:00:00Z' WHERE id = 1 AND lease_token = ?",
            (token,),
        )
        if result.changes != 1:
            raise LeaseLostError("Target lease no longer belongs to this job")
