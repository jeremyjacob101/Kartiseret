# PR 2 as built — Enforce whole-run process deadlines

Status: merged as PR #168, `[DATAFLOW PR 2] Enforce whole-run process deadlines`. This file is an implementation record, not a task prompt.

## What merged

- The parent keeps menu/plan selection, then runs the selected pipeline plan together in one isolated worker process group. Shared PR #164 request state and stage scheduling remain inside that worker.
- The supervisor enforces a 4h 30m full-run deadline and a 30m realtime solo-Update deadline by default. Configure them with `PIPELINE_JOB_DEADLINE_SECONDS` and `PIPELINE_SOLO_UPDATE_DEADLINE_SECONDS`.
- The deadline starts before worker startup; time spent choosing a menu option is excluded. On timeout or interruption, the supervisor sends TERM, escalates to KILL within a bounded 20-second default grace, then reaps the owned worker group. The long-lived realtime watcher remains alive and supervises each solo Update separately.
- If a run ID was allocated, the supervisor records the interruption locally and makes a bounded best-effort attempt to set `successful=false` and `running_now=false` in `utilRunLogs`. It records that already-in-flight database writes may still commit.

## Explicitly not included

PR #168 did not add provider-level or per-operation deadlines, change HTTP retries or provider fallbacks, define a new retry owner per layer, change stage retry/replay rules, alter IMDb behavior, or make database writes rollback when the client is killed. Those remain existing behavior unless a later PR explicitly addresses them. PR 3 adds publication-phase recovery; it does not add a retry scheduler or durable per-title match cache.

## Validation recorded on PR #168

- `python -m compileall -q backend`
- `python -m unittest discover -s backend/tests -v` — 64 tests passed.
- `zsh -n backend/config/realtime/start_realtime_watcher_background.sh`
- `git diff --check`

The new outer process boundary was tested with child-process supervision. It does not promise that a request already executing in Postgres is rolled back on cancellation.
