from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
import sqlite3
import tempfile
from concurrent.futures import ThreadPoolExecutor
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from backend.utils.log.r2_budget import (
    R2Budget,
    R2BudgetError,
    R2BudgetExceeded,
    R2_BUDGET_PATH_ENV,
    R2_CLASS_A_LIMIT_ENV,
    R2_CLASS_B_LIMIT_ENV,
    install_budget,
)


def _reserve_many(path: str, count: int) -> None:
    budget = R2Budget(Path(path), 1000, 1000)
    for _ in range(count):
        budget.reserve("PutObject")


def _reserve_until_limited(path: str, limit: int) -> None:
    budget = R2Budget(Path(path), limit, limit)
    while True:
        try:
            budget.reserve("PutObject")
        except R2BudgetExceeded:
            return


class R2BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.budget = R2Budget.create_job_budget(self.temp.name)
        self.path = self.budget.path

    def tearDown(self):
        for key in (R2_BUDGET_PATH_ENV, R2_CLASS_A_LIMIT_ENV, R2_CLASS_B_LIMIT_ENV):
            os.environ.pop(key, None)
        self.temp.cleanup()

    def test_counts_classes_and_stops_before_next_attempt(self):
        os.environ[R2_CLASS_A_LIMIT_ENV] = "2"
        os.environ[R2_CLASS_B_LIMIT_ENV] = "1"
        self.budget = R2Budget.create_job_budget(self.temp.name)
        self.budget.reserve("PutObject")
        self.budget.reserve("UnknownOperation")
        self.budget.reserve("GetObject")
        with self.assertRaises(R2BudgetExceeded):
            self.budget.reserve("PutObject")
        with self.assertRaises(R2BudgetExceeded):
            self.budget.reserve("HeadObject")
        self.assertEqual(self.budget.snapshot(), {"class_a": 2, "class_b": 1, "tripped": "class_a"})

    def test_deletes_do_not_consume_billable_operation_budget(self):
        for operation in ("DeleteObject", "DeleteObjects", "AbortMultipartUpload"):
            self.budget.reserve(operation)
        self.assertEqual(self.budget.snapshot()["class_a"], 0)
        self.assertEqual(self.budget.snapshot()["class_b"], 0)

    def test_unmetered_delete_still_fails_closed_without_a_valid_ledger(self):
        with sqlite3.connect(self.path) as connection:
            connection.execute("DROP TABLE counters")
        with self.assertRaises(R2BudgetError):
            self.budget.reserve("DeleteObjects")

    def test_missing_ledger_blocks_every_operation(self):
        missing = R2Budget(self.path.parent / "missing.sqlite3", 1, 1)
        with self.assertRaises(R2BudgetError):
            missing.reserve("DeleteObject")

    def test_independent_job_ledgers_keep_separate_counters(self):
        first = R2Budget.create_job_budget(self.path.parent / "first")
        second = R2Budget.create_job_budget(self.path.parent / "second")
        first.reserve("PutObject")
        second.reserve("GetObject")
        self.assertEqual(first.snapshot()["class_a"], 1)
        self.assertEqual(first.snapshot()["class_b"], 0)
        self.assertEqual(second.snapshot()["class_a"], 0)
        self.assertEqual(second.snapshot()["class_b"], 1)

    def test_budget_trip_blocks_free_delete_requests_too(self):
        budget = R2Budget(self.path, 1, 1)
        budget.reserve("PutObject")
        with self.assertRaises(R2BudgetExceeded):
            budget.reserve("PutObject")
        with self.assertRaisesRegex(R2BudgetExceeded, "already reached"):
            budget.reserve("DeleteObjects")

    def test_r2_operation_classes_are_conservative_and_match_known_reads(self):
        self.budget.reserve("GetObject")
        self.budget.reserve("HeadBucket")
        self.budget.reserve("ListObjectsV2")
        self.budget.reserve("FutureUnknownReadOperation")
        counts = self.budget.snapshot()
        self.assertEqual(counts["class_b"], 2)
        self.assertEqual(counts["class_a"], 2)

    def test_before_send_hook_counts_each_http_attempt_independently(self):
        events = Mock()
        client = SimpleNamespace(meta=SimpleNamespace(events=events))
        with patch.dict(os.environ, {R2_BUDGET_PATH_ENV: str(self.path)}):
            install_budget(client)
            handler = events.register_first.call_args.args[1]
            handler(object(), event_name="before-send.s3.GetObject")
            handler(object(), event_name="before-send.s3.GetObject")
            handler(object(), event_name="before-send.s3.ListObjectsV2")
            for operation in ("CreateMultipartUpload", "UploadPart", "CompleteMultipartUpload"):
                handler(object(), event_name=f"before-send.s3.{operation}")
            handler(object(), event_name="before-send.s3.AbortMultipartUpload")
        counts = self.budget.snapshot()
        self.assertEqual(counts["class_b"], 2)
        self.assertEqual(counts["class_a"], 4)
        self.assertEqual(events.register_first.call_args.args[0], "before-send.s3.*")

    def test_shared_r2_client_bounds_sdk_retries_and_installs_http_guard(self):
        import boto3

        from backend.utils.log.r2_client import create_r2_s3_client

        client = SimpleNamespace(meta=SimpleNamespace(events=Mock()))
        with patch.dict(os.environ, {
            "R2_ACCOUNT_ID": "a" * 32,
            R2_BUDGET_PATH_ENV: str(self.path),
        }), patch.object(boto3, "client", return_value=client) as create_client:
            self.assertIs(create_r2_s3_client(access_key="writer", secret_key="secret"), client)
        config = create_client.call_args.kwargs["config"]
        self.assertEqual(config.retries["total_max_attempts"], 1)
        events = [call.args[0] for call in client.meta.events.register_first.call_args_list]
        self.assertIn("before-send.s3.*", events)
        self.assertIn("before-parameter-build.s3.*", events)

    def test_reservations_are_shared_across_processes(self):
        processes = [multiprocessing.Process(target=_reserve_many, args=(str(self.path), 100)) for _ in range(4)]
        for process in processes:
            process.start()
        for process in processes:
            process.join(10)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(self.budget.snapshot()["class_a"], 400)

    def test_concurrent_reservations_cannot_cross_limit(self):
        processes = [multiprocessing.Process(target=_reserve_until_limited, args=(str(self.path), 100)) for _ in range(4)]
        for process in processes:
            process.start()
        for process in processes:
            process.join(10)
            self.assertEqual(process.exitcode, 0)
        self.assertEqual(self.budget.snapshot()["class_a"], 100)

    def test_threaded_reservations_share_one_atomic_ledger(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda _index: self.budget.reserve("PutObject"), range(400)))
        self.assertEqual(self.budget.snapshot()["class_a"], 400)

    def test_class_b_limit_blocks_the_next_request_without_overcounting(self):
        budget = R2Budget(self.path, class_a_limit=10, class_b_limit=1)
        budget.reserve("GetObject")
        with self.assertRaisesRegex(R2BudgetExceeded, "class b operation budget reached"):
            budget.reserve("HeadObject")
        self.assertEqual(
            budget.snapshot(),
            {"class_a": 0, "class_b": 1, "tripped": "class_b"},
        )

    def test_install_guard_fails_closed_without_initialized_budget(self):
        os.environ.pop(R2_BUDGET_PATH_ENV, None)
        client = Mock()
        with self.assertRaises(R2BudgetError):
            install_budget(client)
        client.meta.events.register_first.assert_not_called()

    def test_before_send_hook_counts_http_attempt_operation(self):
        client = Mock()
        os.environ[R2_BUDGET_PATH_ENV] = str(self.budget.path)
        install_budget(client)
        handler = client.meta.events.register_first.call_args.args[1]
        handler(request=object(), event_name="before-send.s3.PutObject")
        handler(request=object(), event_name="before-send.s3.GetObject")
        self.assertEqual(self.budget.snapshot()["class_a"], 1)
        self.assertEqual(self.budget.snapshot()["class_b"], 1)

    def test_limits_reject_non_positive_or_invalid_values(self):
        for value in ("0", "-1", "bad"):
            os.environ[R2_CLASS_A_LIMIT_ENV] = value
            with self.assertRaises(R2BudgetError):
                R2Budget.create_job_budget(self.temp.name)


if __name__ == "__main__":
    unittest.main()
