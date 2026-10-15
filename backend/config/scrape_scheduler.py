"""Estimate and schedule scrape jobs across a fixed number of workers."""

from __future__ import annotations

from math import ceil, isfinite
from typing import Sequence


WORKER_COUNT = 6
FALLBACK_SECONDS = 60.0


def duration_to_milliseconds(value: object, fallback_seconds: float = FALLBACK_SECONDS) -> int:
    try:
        seconds = float(value)
    except (TypeError, ValueError, OverflowError):
        seconds = fallback_seconds
    if not isfinite(seconds) or seconds <= 0:
        seconds = fallback_seconds
    return max(1, int(round(seconds * 1000)))


def optimal_assignment(
    durations_ms: Sequence[int],
    worker_loads_ms: Sequence[int] | None = None,
) -> list[list[int]]:
    """Return an exact minimum-makespan assignment of jobs to worker slots.

    ``worker_loads_ms`` represents work already in progress on each slot. The
    returned job indexes are in the input order and are grouped by worker.
    """
    worker_count = WORKER_COUNT
    loads = list(worker_loads_ms or [0] * worker_count)
    if len(loads) != worker_count:
        raise ValueError(f"worker_loads_ms must have exactly {worker_count} values")
    if any(value < 0 for value in loads):
        raise ValueError("worker loads must be non-negative")
    durations = [max(1, int(value)) for value in durations_ms]
    assignment: list[list[int]] = [[] for _ in range(worker_count)]
    if not durations:
        return assignment

    jobs = sorted(range(len(durations)), key=lambda index: (-durations[index], index))

    # LPT gives a cheap incumbent and is also the deterministic tie-break seed.
    best_loads = list(loads)
    best_assignment: list[list[int]] = [[] for _ in range(worker_count)]
    for job_index in jobs:
        worker = min(range(worker_count), key=lambda slot: (best_loads[slot], slot))
        best_loads[worker] += durations[job_index]
        best_assignment[worker].append(job_index)
    best_makespan = max(best_loads)

    smallest_load = min(loads)
    minimum_jobs_per_worker = ceil(len(durations) / worker_count)
    pigeonhole_bound = smallest_load + sum(sorted(durations)[:minimum_jobs_per_worker])
    average_bound = ceil((sum(loads) + sum(durations)) / worker_count)
    lower_bound = max(max(loads), pigeonhole_bound, average_bound)
    if best_makespan == lower_bound:
        return _ordered(best_assignment, durations)

    current_assignment: list[list[int]] = [[] for _ in range(worker_count)]
    current_loads = list(loads)
    visited: set[tuple[int, tuple[int, ...]]] = set()

    def search(position: int) -> None:
        nonlocal best_makespan, best_assignment
        if position == len(jobs):
            makespan = max(current_loads)
            if makespan < best_makespan:
                best_makespan = makespan
                best_assignment = [list(bucket) for bucket in current_assignment]
            return

        state = (position, tuple(sorted(current_loads)))
        if state in visited:
            return
        visited.add(state)

        if max(current_loads) >= best_makespan:
            return

        job_index = jobs[position]
        job_duration = durations[job_index]
        seen_loads: set[int] = set()
        for worker in sorted(range(worker_count), key=lambda slot: (current_loads[slot], slot)):
            load = current_loads[worker]
            if load in seen_loads:
                continue
            seen_loads.add(load)
            if load + job_duration >= best_makespan:
                continue

            current_loads[worker] += job_duration
            current_assignment[worker].append(job_index)
            search(position + 1)
            current_assignment[worker].pop()
            current_loads[worker] = load

    search(0)
    return _ordered(best_assignment, durations)


def _ordered(assignment: list[list[int]], durations: Sequence[int]) -> list[list[int]]:
    return [
        sorted(bucket, key=lambda index: (-durations[index], index))
        for bucket in assignment
    ]
