from itertools import product
from random import Random
import sys
from threading import Lock
from time import sleep
from io import StringIO
from unittest import TestCase, main
from unittest.mock import patch
from rich.console import Console

from backend.config.scrape_scheduler import duration_to_milliseconds, optimal_assignment
from backend.config import runners
from backend.utils.console.progressBars import RunResult


def brute_makespan(durations, worker_loads=None):
    loads = list(worker_loads or [0] * 6)
    best = [float("inf")]
    jobs = sorted((int(value) for value in durations), reverse=True)

    def place(index):
        if index == len(jobs):
            best[0] = min(best[0], max(loads))
            return
        seen = set()
        for worker in sorted(range(6), key=lambda slot: (loads[slot], slot)):
            if loads[worker] in seen:
                continue
            seen.add(loads[worker])
            loads[worker] += jobs[index]
            place(index + 1)
            loads[worker] -= jobs[index]

    place(0)
    return best[0]


class ScrapeSchedulerTests(TestCase):
    def assert_optimal(self, durations, worker_loads=None):
        assignment = optimal_assignment(durations, worker_loads)
        flattened = [index for group in assignment for index in group]
        self.assertCountEqual(flattened, range(len(durations)))
        loads = list(worker_loads or [0] * 6)
        for worker, jobs in enumerate(assignment):
            loads[worker] += sum(durations[index] for index in jobs)
        self.assertEqual(max(loads), brute_makespan(durations, worker_loads))

    def test_small_workloads_match_exhaustive_assignments(self):
        for durations in product((1, 2, 4), repeat=5):
            with self.subTest(durations=durations):
                self.assert_optimal(durations)

        random = Random(421)
        for _ in range(40):
            durations = [random.randint(1, 20) for _ in range(random.randint(1, 8))]
            self.assert_optimal(durations)

    def test_active_workloads_and_equal_duration_sixteen_job_case(self):
        self.assert_optimal([13, 11, 9, 8, 4, 3, 2], [28, 15, 9, 1, 0, 0])
        assignment = optimal_assignment([100] * 16)
        self.assertEqual(max(len(group) * 100 for group in assignment), 300)
        self.assert_optimal([100] * 7, [30, 10, 0, 0, 0, 0])

    def test_invalid_estimates_use_sixty_second_fallback(self):
        for value in (None, "bad", 0, -2, float("inf"), float("nan")):
            with self.subTest(value=value):
                self.assertEqual(duration_to_milliseconds(value), 60_000)
        self.assertEqual(duration_to_milliseconds(0.0001), 1)
        self.assertEqual(duration_to_milliseconds(1.2345), 1234)

    def test_scheduler_caps_concurrency_at_six_and_requeues_failed_attempts(self):
        classes = [type(f"Scraper{index}", (), {}) for index in range(10)]
        active = peak = 0
        lock = Lock()
        attempts = {}

        def run_attempt(_spec, cls, _key, _run_id, attempt, _context=None):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                attempts[cls] = attempts.get(cls, 0) + 1
            sleep(0.02)
            with lock:
                active -= 1
            ok = not (cls is classes[0] and attempt == 1)
            return RunResult(cls.__name__, 0.02, ok, attempt)

        estimates = {cls.__name__: index + 1 for index, cls in enumerate(classes)}
        with patch.object(runners, "_average_times", return_value=estimates), patch.object(runners, "_run_attempt", side_effect=run_attempt):
            console = Console(file=StringIO())
            self.assertTrue(runners._run_scheduled_scrapes([("allSoons", cls) for cls in classes], 1, console=console))

        self.assertEqual(peak, 6)
        self.assertEqual(len(attempts), 10)
        self.assertEqual(attempts[classes[0]], 2)

    def test_scheduler_runs_attempt_through_scraper_spec_adapter(self):
        scraper = type("AdapterScraper", (), {})
        instance = type("FakeInstance", (), {"driver": None})()
        calls = []

        def make_instance(cls, key, run_id, request_context=None):
            calls.append(("make", cls, key, run_id, request_context))
            return instance

        def run_instance(actual_instance):
            calls.append(("run", actual_instance))

        def cleanup(actual_instance):
            calls.append(("cleanup", actual_instance))

        scraper_spec = {
            "make_instance": make_instance,
            "run_instance": run_instance,
            "cleanup": cleanup,
            "registry": {},
        }
        with patch.object(runners, "cinemaDictionary", scraper_spec), patch.object(
            runners, "_average_times", return_value={scraper.__name__: 1}
        ):
            console = Console(file=StringIO())
            self.assertTrue(
                runners._run_scheduled_scrapes(
                    [("allSoons", scraper)], 123, console=console
                )
            )

        self.assertEqual(calls, [
            ("make", scraper, "allSoons", 123, None),
            ("run", instance),
            ("cleanup", instance),
        ])

    def test_cleanup_failure_does_not_replace_original_attempt_error(self):
        scraper = type("CleanupFailureScraper", (), {})
        instance = type("FakeInstance", (), {"driver": None})()
        artifact_errors = []

        def fail_run(_instance):
            raise RuntimeError("original scrape failure")

        def fail_cleanup(_instance):
            raise ValueError("cleanup failure")

        spec = type("Spec", (), {})()
        spec.make_instance = lambda *_args: instance
        spec.run_instance = fail_run
        spec.cleanup = fail_cleanup

        def capture_artifact_error(*_args, **_kwargs):
            artifact_errors.append(str(sys.exc_info()[1]))

        with patch.object(runners, "artifactPrinting", side_effect=capture_artifact_error):
            with self.assertLogs("backend.config.runners", level="ERROR") as logs:
                result = runners._run_attempt(spec, scraper, "allSoons", 123, 1)

        self.assertFalse(result.ok)
        self.assertEqual(artifact_errors, ["original scrape failure"])
        self.assertIn("cleanup failure", "\n".join(logs.output))


if __name__ == "__main__":
    main()
