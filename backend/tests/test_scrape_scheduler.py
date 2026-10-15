from itertools import product
from random import Random
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


if __name__ == "__main__":
    main()
