from pathlib import Path
import sqlite3
import unittest

from backend.utils.log.cloudflare_storage import CloudflareStorageError, D1Result, LeaseLostError
from backend.utils.log.expiring_lease import ExpiringLeaseStore


class SQLiteD1:
    def __init__(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(Path('backend/cloudflare/d1/migrations/0001_run_artifacts.sql').read_text())
        self.connection.executescript(Path('backend/cloudflare/d1/migrations/0003_lease_predecessor.sql').read_text())

    def execute(self, sql, params=()):
        cursor = self.connection.execute(sql, params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        return D1Result(rows, max(0, cursor.rowcount), max(0, cursor.rowcount), {'results': rows})


class ExpiringLeaseTests(unittest.TestCase):
    def setUp(self):
        self.d1 = SQLiteD1()
        self.addCleanup(self.d1.connection.close)
        self.lease = ExpiringLeaseStore(self.d1)

    def test_expiry_takeover_and_stale_owner_rejection(self):
        first = self.lease.acquire()
        self.lease.verify(first.token)
        self.lease.renew(first.token)
        with self.assertRaises(CloudflareStorageError):
            self.lease.acquire()
        self.d1.execute("UPDATE run_locks SET run_id = 42, lease_until = '2000-01-01T00:00:00Z' WHERE id = 1")
        with self.assertRaises(LeaseLostError):
            self.lease.renew(first.token)
        second = self.lease.acquire()
        self.assertEqual(second.predecessor_run_id, 42)
        self.assertEqual(second.predecessor_token, first.token)
        with self.assertRaises(LeaseLostError):
            self.lease.release(first.token)
        self.lease.verify(second.token)
        self.lease.release(second.token)

    def test_invalid_expiry_is_not_treated_as_expired(self):
        first = self.lease.acquire()
        self.d1.execute("UPDATE run_locks SET lease_until = 'invalid' WHERE id = 1")
        with self.assertRaises(CloudflareStorageError):
            self.lease.acquire()
        with self.assertRaises(LeaseLostError):
            self.lease.verify(first.token)

    def test_takeover_predecessor_survives_another_crash(self):
        first = self.lease.acquire()
        self.d1.execute("UPDATE run_locks SET run_id=42, lease_until='2000-01-01T00:00:00Z'")
        second = self.lease.acquire()
        self.d1.execute("UPDATE run_locks SET lease_until='2000-01-01T00:00:00Z'")
        third = self.lease.acquire()
        self.assertEqual(second.predecessor_run_id, 42)
        self.assertEqual(third.predecessor_run_id, 42)
        self.assertNotEqual(first.token, third.token)

    def test_competing_claim_between_read_and_update_cannot_be_overwritten(self):
        original = self.d1.execute
        competitor = []
        class RaceD1:
            def execute(_self, sql, params=()):
                result = original(sql, params)
                if sql.startswith('SELECT lease_token'):
                    competitor.append(self.lease.acquire())
                return result
        with self.assertRaises(CloudflareStorageError):
            ExpiringLeaseStore(RaceD1()).acquire()
        self.lease.verify(competitor[0].token)
