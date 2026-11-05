from __future__ import annotations

import multiprocessing
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

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
