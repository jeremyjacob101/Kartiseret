from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

from backend.utils.supabase import storage_guard


class SupabaseStorageGuardTests(TestCase):
    def client(self, *sizes):
        client = Mock()
        client.rpc.return_value.execute.side_effect = [
            SimpleNamespace(data=size) for size in sizes
        ]
        return client

    def test_size_rpc_accepts_supported_postgrest_scalar_shapes(self):
        for data in (123, [123], {"get_database_size_bytes": 123}, [{"bytes": 123}]):
            with self.subTest(data=data):
                client = Mock()
                client.rpc.return_value.execute.return_value.data = data
                self.assertEqual(storage_guard.measure_database_size_bytes(client), 123)

    def test_size_rpc_rejects_malformed_or_negative_results(self):
        for data in (None, True, -1, "123", [], [1, 2], {"bytes": False}):
            with self.subTest(data=data):
                client = Mock()
                client.rpc.return_value.execute.return_value.data = data
                with self.assertRaises(storage_guard.SupabaseStorageGuardError):
                    storage_guard.measure_database_size_bytes(client)

    def test_size_measurement_failure_fails_closed(self):
        client = Mock()
        client.rpc.return_value.execute.side_effect = TimeoutError("timeout")
        with self.assertRaisesRegex(storage_guard.SupabaseStorageGuardError, "could not be verified"):
            storage_guard.measure_database_size_bytes(client)

    def test_below_limit_does_not_run_cleanup(self):
        client = self.client(storage_guard.DATABASE_HIGH_WATER_BYTES - 1)
        with patch.object(storage_guard, "_run_existing_supabase_cleanup") as cleanup:
            result = storage_guard.enforce_database_size_limit(
                client, apply=True, lease_guard=Mock()
            )
        self.assertFalse(result["blocked"])
        cleanup.assert_not_called()

    def test_at_limit_runs_standard_cleanup_then_first_pressure_tier(self):
        limit = storage_guard.DATABASE_HIGH_WATER_BYTES
        client = self.client(limit, limit, limit - 1)
        lease = Mock()
        with patch.object(storage_guard, "_run_existing_supabase_cleanup", return_value={"old_entries": {}}) as normal, patch(
            "backend.utils.supabase.clear_old_entries.clear_processed_raw_entries",
            return_value={"allShowtimes": 5, "allSoons": 6, "allTheques": 7},
        ) as pressure:
            result = storage_guard.enforce_database_size_limit(
                client, apply=True, lease_guard=lease
            )
        self.assertFalse(result["blocked"])
        self.assertEqual(result["after_bytes"], limit - 1)
        normal.assert_called_once_with(apply=True, lease_guard=lease)
        pressure.assert_called_once_with(
            **storage_guard.PRESSURE_RETENTION_TIERS[0],
            apply=True,
            lease_guard=lease,
            client=client,
        )

    def test_second_pressure_tier_runs_only_if_first_pass_cannot_recover(self):
        limit = storage_guard.DATABASE_HIGH_WATER_BYTES
        client = self.client(limit + 1, limit + 1, limit, limit - 1)
        with patch.object(storage_guard, "_run_existing_supabase_cleanup", return_value={}), patch(
            "backend.utils.supabase.clear_old_entries.clear_processed_raw_entries",
            return_value={"allShowtimes": 1, "allSoons": 2, "allTheques": 3},
        ) as pressure:
            result = storage_guard.enforce_database_size_limit(
                client, apply=True, lease_guard=Mock()
            )
        self.assertFalse(result["blocked"])
        self.assertEqual(len(result["stages"]), 2)
        self.assertEqual(
            [call.kwargs["showtimes_days_ago"] for call in pressure.call_args_list],
            [2, 1],
        )

    def test_dry_run_reports_both_tiers_and_blocks_while_still_over_limit(self):
        limit = storage_guard.DATABASE_HIGH_WATER_BYTES
        client = self.client(limit, limit, limit, limit)
        with patch.object(storage_guard, "_run_existing_supabase_cleanup", return_value={}), patch(
            "backend.utils.supabase.clear_old_entries.clear_processed_raw_entries",
            return_value={"allShowtimes": 8, "allSoons": 9, "allTheques": 10},
        ) as pressure:
            result = storage_guard.enforce_database_size_limit(
                client, apply=False, lease_guard=Mock()
            )
        self.assertTrue(result["blocked"])
        self.assertEqual(len(result["stages"]), 2)
        self.assertTrue(all(call.kwargs["apply"] is False for call in pressure.call_args_list))
        self.assertEqual(
            result["reason"],
            "Supabase remains at or above the database-size limit after both "
            "processed-row retention passes; new writes and publication are blocked.",
        )

    def test_over_limit_without_lease_does_not_delete_and_blocks(self):
        client = self.client(storage_guard.DATABASE_HIGH_WATER_BYTES)
        with patch.object(storage_guard, "_run_existing_supabase_cleanup") as cleanup:
            result = storage_guard.enforce_database_size_limit(
                client, apply=True, lease_guard=None
            )
        self.assertTrue(result["blocked"])
        cleanup.assert_not_called()

    def test_prepared_publication_is_blocked_without_running_cleanup(self):
        client = self.client(storage_guard.DATABASE_HIGH_WATER_BYTES)
        with patch("backend.utils.log.shared_cleanup.verify_lease") as verify:
            with self.assertRaisesRegex(storage_guard.SupabaseStorageGuardError, "fresh run"):
                storage_guard.ensure_publication_allowed(client, lease_guard=Mock())
        verify.assert_called_once()
        client.rpc.assert_called_once_with("get_database_size_bytes", {})

    def test_upload_is_blocked_if_pressure_cleanup_still_exceeds_limit(self):
        limit = storage_guard.DATABASE_HIGH_WATER_BYTES
        client = self.client(limit, limit, limit, limit)
        with patch.object(storage_guard, "_run_existing_supabase_cleanup", return_value={}), patch(
            "backend.utils.supabase.clear_old_entries.clear_processed_raw_entries",
            return_value={"allShowtimes": 0, "allSoons": 0, "allTheques": 0},
        ), patch("backend.utils.log.shared_cleanup.verify_lease"):
            with self.assertRaisesRegex(storage_guard.SupabaseStorageGuardError, "both processed-row retention passes"):
                storage_guard.ensure_scrape_upload_allowed(
                    client, lease_guard=Mock(), apply=True
                )
