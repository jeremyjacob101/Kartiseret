# Implementation plan: expiring job leases with automatic failover

## 1. Required outcome and agreed behavior

Replace the non-expiring owner-token change in PR #237 with an expiring lease shared by pipeline jobs and maintenance commands. Keep PR #236's R2 request budgets intact. Do not merge, deploy, enable cleanup, or change the user's Vercel firewall as part of this implementation.

There are two independent timers:

| Setting | Required behavior |
| --- | --- |
| Heartbeat interval | Renew ownership every 10 seconds while a job is active. |
| Lease validity | Each confirmed renewal gives the owner another 120 seconds. |
| Maximum whole-job lifetime | 18,000 seconds (five hours), including shutdown/finalization. A heartbeat must never extend this limit. |
| Default normal work deadline | Preserve the current 16,200 seconds (4.5 hours). Shorter existing realtime/maintenance deadlines remain shorter. |
| Shutdown grace | Default 20 seconds, maximum 30 seconds; bounded by the whole-job deadline. |
| Lease request timeout | At most 5 seconds for each control request; no hidden retry loop. |

Example: renewal succeeds at 12:00:00, so ownership lasts until 12:02:00. A renewal at 12:00:10 moves expiry to 12:02:10. If the machine crashes just afterward, another machine can claim the lease after 12:02:10. Missing one heartbeat does not immediately free the lock. No separate job needs to clear expired locks: acquisition tests expiry atomically.

If a renewal fails or its outcome is uncertain, the original job immediately stops starting storage mutations and starts shutdown. It does not continue working for the remaining two minutes or silently retry until success. The lease remains reserved until confirmed shutdown and release, or until expiry. A write already sent may complete; this is an accepted existing crash behavior. Preserve recovery records for uncertain outcomes. Do not claim this makes R2, D1, and Supabase one atomic transaction.

## 2. Current code to change

Work on `codex/shared-r2-cleanup`, based on `codex/r2-runaway-protection`. Inspect current heads before editing; this plan was written against cleanup head `f219ae50`.

- `backend/utils/log/run_storage.py`: currently uses `LOCK_HELD_UNTIL` and permits acquisition only when the token is empty. Restore real expiry; remove the year-9999 sentinel.
- `backend/utils/log/shared_cleanup.py`: `maintenance_lease`, `lease_renewal_callback`, `verify_lease`, and `current_run_lease_guard` currently provide only synchronous checks. Consolidate them around the new shared lease session.
- `backend/utils/log/run_logging.py`: owns pipeline acquisition, preflight, finalization, and release. Heartbeat must cover startup/preflight too, not start only after `allocate_run_id` returns.
- `backend/config/job_supervisor.py`: already terminates a dedicated process group and has deadline/recovery handling. Extend this; do not build a second unrelated process supervisor.
- `backend/config/job_control.py`: currently treats events as diagnostic. Lease failure communication must not depend solely on this best-effort channel.
- `backend/config/runner_worker.py` and `backend/config/realtime/realtime_watcher.py`: pipeline worker entry points.
- Standalone owners: shared cleanup CLI, artwork backfill/rollback/cleanup CLI, social preview CLI, three Supabase sweep/orphan CLIs, and `backend/config/upload_cron_log.py`.
- `backend/utils/log/retention.py`: preserve D1 retention's watermarks, budget, ordering, and use of an already-held lease.
- `backend/utils/log/recover_run_lock.py`: retain only as explicit operator recovery; ordinary crashed-owner failover must not require it.
- `docs/shared-cleanup.md`: replace non-expiring-lock guidance after implementation is verified.

Preserve the existing distinct `LeaseLostError`, HTTP-attempt R2 budget hook, cleanup batching, strict reference scans, 30-day grace periods, and post-publication cleanup calls.

## 3. Implement and test the D1 ownership primitives first

Use the existing target-specific D1 `run_locks` row. Use D1/database time for expiry comparisons and expiry generation. Never decide remote ownership from a laptop's clock. Use one consistent timestamp format; a small migration to an integer expiry column is acceptable if that makes comparisons safer. Do not compare mixed timestamp formats lexicographically.

Expose explicit acquisition, renewal, verification, and release methods. Return confirmed expiry/server-time information where needed. Avoid boolean success values that callers can accidentally ignore: failure must raise `LeaseLostError` or a distinct busy error.

### Acquisition

1. Generate a fresh random token for each logical job. Never reuse an old job's token.
2. Read the current token, expiry, and associated run ID.
3. Atomically claim only an empty row or a row expired according to D1 time. Compare the observed token/expiry in the update as well as the expiry condition. Require exactly one changed row. An alternative single-statement implementation is acceptable if it also returns the previous owner information reliably.
4. Return the new token and any predecessor run ID. Do not clear a live lock to make tests or startup succeed.
5. Two simultaneous claimants must result in exactly one winner. The loser follows the existing bounded wait/skip policy.

### Renewal

- Match the exact current token, require that it has not already expired, and use D1 time to set expiry to `now + 120 seconds`.
- Require exactly one updated row and a confirmed response within the control-request timeout.
- An expired job cannot resurrect its token even if nobody else has acquired the row yet.
- Never implement renewal as an upsert or unconditional update.
- A timeout can mean the renewal committed without an acknowledgement. The caller still treats ownership as unconfirmed and stops. It must not assume the request failed remotely.

### Verification and release

- Verification requires the current token and unexpired lease, using D1 time.
- Release compares the exact token. Remove automatic unlocking by `run_id` alone from supervisor finalization and recovery paths; a stale finalizer must not clear a new owner's token.
- A stale release/heartbeat after another machine takes over must leave the new token unchanged.
- Control queries must not invoke the ordinary storage-write guard recursively. Give these few named primitives a private raw D1 execution path; do not add a general public `skip_guard=True` option.

## 4. Handle the predecessor run during automatic takeover

An expired lease may leave Supabase `utilRunLogs.running_now=true`. Simply acquiring D1 ownership and then waiting for that row would prevent the promised failover.

After a successful expired-owner takeover, while holding the new lease:

1. Keep heartbeat active for the new owner.
2. If the captured predecessor has a run ID, mark that D1 run `unconfirmed` and mark only that Supabase run unsuccessful/not running.
3. Preserve or create the existing recovery envelope explaining expired-owner takeover and uncertain in-flight writes.
4. Require confirmation before allocating a new pipeline run ID or performing cleanup mutations. If reconciliation cannot be confirmed, fail this attempt safely and preserve recovery state.
5. Do not treat an interrupted predecessor as successful. Do not delete its recoverable artifacts.
6. If there is an unrelated active Supabase run whose ownership cannot be established, retain the bounded wait/failure behavior; do not mass-clear running rows.

Use the same takeover/reconciliation helper for a pipeline and for a standalone maintenance command. A maintenance job can encounter a crashed pipeline predecessor too.

## 5. One shared lease-session implementation

Add a small module such as `backend/utils/log/job_lease.py`. It should own:

- The store, target, owner token, and optional associated run ID.
- A heartbeat thread driven by `threading.Event.wait(10)` so shutdown can wake it immediately.
- A thread-safe, permanent failure latch. Once ownership becomes uncertain, this session can never become healthy again.
- `check_active()` for local failure/deadline checks, and `verify_before_mutation()` for a confirmed current-token D1 check.
- Start/stop lifecycle and a shutdown notification to the existing supervisor.
- A fixed absolute whole-job deadline that renewals cannot move.

Start the session immediately after successful acquisition, before waiting on Supabase startup state, running cleanup, or allocating/uploading run artifacts. Stop and join the heartbeat before releasing the token. Do not let a heartbeat thread renew a released token or keep a completed job alive. Do not share an unsafe mutable HTTP session across threads; use an independent control client for heartbeat requests.

If heartbeat renewal fails:

1. Latch failure first, before logging or notifying another thread.
2. Block future mutations through the shared guard.
3. Request cancellation through the existing supervisor and preserve a concise local recovery reason.
4. The supervisor terminates the worker's owned process group with TERM then KILL within the bounded grace.
5. If shutdown is confirmed, perform token-scoped failed/unconfirmed finalization and release. If shutdown is unconfirmed, do not explicitly release; expiry provides failover.

If the parent supervisor dies, its absence must not leave the worker writing indefinitely. The worker's own lease-session guard and hard-deadline checks remain active. Closing the parent control channel should trigger cancellation where observable, but EOF detection is additional protection, not the only ownership check.

## 6. Cover every storage mutation and waking stale worker

A background thread alone is insufficient: a suspended process may resume before its heartbeat thread runs. At the storage request boundary, verify current ownership before starting each new mutation. A check at the beginning of a large dataflow or cleanup scan does not cover later writes.

Inventory the actual code with `rg` before editing:

```text
RunLogSession / maintenance_lease / acquire_run_lease
boto3.client / create_r2_s3_client
supabase create_client / live_client / PublicationWorkspace
D1Client.execute / batch / requests.post
delete_object / delete_objects / put_object / multipart
```

Apply the same shared guard to the common factories/transports used by pipeline writers:

- R2: integrate with the existing Botocore before-send hook. Ownership verification and budget reservation must both pass before sending mutations; budget accounting still counts every HTTP attempt. Cover multipart initiation, parts, completion, deletes, and other mutating operations. Keep unknown operations conservative.
- Supabase/PostgREST: cover mutation HTTP requests and publication RPCs through the shared client construction/transport. Include clients imported directly outside `PublicationWorkspace`. Treat unknown POST/RPC operations conservatively. Do not rely solely on checks during in-memory staging; the final publication HTTP request needs the guard too.
- D1: guard ordinary run/artifact/catalog mutations, while keeping ownership-control primitives on their explicitly private nonrecursive path. Initialization before ownership acquisition must be limited to the documented idempotent schema setup.
- Cleanup: retain the immediate checks before each deletion batch, including post-publication and D1-associated screenshot cleanup.

An in-flight request may still commit after failure. Do not promise atomic rejection of that request across services. The guarantee is that a worker discovering expired/replaced/unconfirmed ownership stops issuing new mutations, including after waking from sleep. Test a pause before a request boundary and takeover on another client.

Child processes that perform storage work must receive the target/token context and construct the same guard; they must never mint their own lease or budget inside the parent's logical job. If a renderer/browser child only computes or fetches external content, keep storage writes in the guarded Python owner. Explicitly inventory these children rather than assuming all descendants write to storage.

## 7. Enforce the five-hour limit for every entry point

Reuse `run_managed_process` for pipeline and standalone maintenance execution. Add a small reusable command wrapper/helper rather than separate watchdog implementations in seven CLIs.

- The parent selects the target and launches the actual command body as a supervised worker in a dedicated process group.
- Avoid recursive wrapping with a private worker protocol/argument validated by the wrapper; an arbitrary public environment flag must not silently disable all enforcement.
- Normal workers and realtime updates already use a supervisor; do not nest another supervisor around each dataflow stage.
- Standalone cleanup, artwork, preview, sweep, and cron-log-upload commands must use the same bounded execution mechanism before acquiring their lease.
- Preserve busy scheduled cleanup's successful `skipped` result. Maintenance completion must report the supervisor's expected completion event so success is not misclassified as abnormal exit.
- Enforce `work deadline + shutdown/finalization reserve <= 18,000 seconds`. Reject nonfinite/negative/overlong settings before starting a child. Explicit function arguments must not bypass the cap.
- Preserve existing 4.5-hour normal and 30-minute realtime defaults. A five-hour hard lifetime does not require making every command run for five hours. GitHub daily cleanup can retain its shorter 30-minute timeout.
- Maintain an independent immutable worker deadline check at mutation boundaries. Do not trust only a parent process staying alive.
- Account for host suspension in deadline/ownership checks. D1 ownership confirmation on resumed mutations remains mandatory; do not assume `time.monotonic()` includes sleep identically on Linux and macOS.

## 8. Preserve failure reporting and cleanup behavior

Keep `LeaseLostError` distinct from budget exhaustion, provider errors, and ordinary scrape failures. Both the single-flow runner and shared threaded update path must propagate it, cancel queued work, discard unpublished staging, and stop retries. Best-effort artwork/preview/reporting code must not swallow it.

Never report a successful exit after lease loss, budget exhaustion, deadline expiry, unconfirmed shutdown, or failed finalization. Diagnostics must not recursively call R2 once its budget or lease guard has failed. Use local recovery envelopes and bounded token-scoped D1/Supabase finalization as appropriate.

The session remains active through post-run D1 checks and finalization. Retention receives the current session/token and must not reacquire the same lease. Preserve D1 high/low watermarks, daily deletion write budget, metadata ordering, and fail-safe behavior. Do not change artwork keys, public URLs, social fingerprints, reference retention, or production credentials.

## 9. Focused tests: required acceptance cases

Use fake clocks, real temporary SQLite ledgers, controlled D1 SQL fixtures, and short-lived supervised subprocesses. Do not wait two minutes or five hours in tests. Separate database/server time from laptop time in fixtures.

### D1 lease primitives

1. Empty acquisition; simultaneous acquisition with one winner.
2. Unexpired owner blocks a second machine.
3. Expired owner permits atomic takeover and returns the correct predecessor.
4. Renewal extends expiry from server time, only for the current unexpired token.
5. Expired owner cannot renew before or after takeover.
6. Old token cannot release the replacement token.
7. Renewal/verification timeout, missing row, malformed response, and failed confirmation fail closed.
8. Production/development use independent rows/databases and cannot cross-select credentials.

### Session and mutation guards

1. Periodic renewal continues through preflight, long provider work, finalization, and post-run checks.
2. One renewal failure permanently latches failure, requests cancellation, and blocks subsequent R2/Supabase/D1 mutations.
3. A later successful response cannot revive a failed session.
4. Session close stops/joins its thread before release; no renewal after release.
5. Simulate a suspended worker, advance server time beyond expiry, let a second owner acquire, resume the first, and assert zero newly sent mutations from the first.
6. Preserve existing recovery for an operation sent before failure; do not replay it automatically without knowing its outcome.
7. No recursive D1 guard calls; heartbeat traffic does not consume R2 request counters.

### Process lifecycle and takeover

1. Healthy normal completion releases promptly.
2. Handled failure and confirmed process-group termination finalize unsuccessfully and release only the owned token.
3. Unconfirmed shutdown retains the lease until expiry.
4. A dead supervisor cannot cause an active worker to keep issuing mutations after its session/deadline fails.
5. A blocked worker and child ignoring TERM are killed within the shutdown reserve.
6. Every standalone owner command goes through the common wrapper; direct command invocation cannot bypass it.
7. Expired pipeline takeover reconciles the predecessor's Supabase running flag and D1 unconfirmed state, then allows a new run ID.
8. Failed predecessor reconciliation blocks new cleanup/work and preserves recovery state.
9. Late old finalization cannot overwrite or unlock the replacement owner's run.
10. Hard five-hour settings are enforced through environment configuration and explicit supervisor arguments; lower realtime/cleanup limits still work.

### Existing feature regressions

Rerun focused budget, storage, shared cleanup, artwork, social preview, publication, target resolution, cron upload, and supervisor tests. Cover Class A/B exact boundaries, independent/concurrent budgets, retries/pages/multipart, lease failure propagation, dry-run/apply, incomplete scans, shared/recent references, recovery-protected screenshots, daily markers, and D1 retention without reacquisition deadlocks.

## 10. Implementation order and completion requirements

1. Read current code, repository instructions, and this plan. Record all owner entry points and storage factories. Keep PR #237 draft during changes.
2. Replace the non-expiring D1 primitives and their tests. Remove sentinel-based assumptions from tests/docs.
3. Implement the shared lease session with deterministic tests.
4. Add request-boundary ownership guards and propagation tests.
5. Extend the existing supervisor/control protocol and add the common maintenance-command wrapper.
6. Integrate pipeline startup, realtime, every standalone owner, retention, takeover reconciliation, and finalization.
7. Run the focused tests. Inspect failures; do not weaken assertions or remove required safety behavior to get green tests.
8. Compile changed Python modules, run whitespace checks, and validate workflow expressions/structure. Preserve `contents: read`, target selection, manual dispatch, 02:00 UTC schedule, and default rollout gates.
9. Update `docs/shared-cleanup.md`, environment documentation, PR description, and operator recovery guidance to describe the actual expiring behavior. Do not leave contradictory non-expiring-lock instructions.
10. Push one coherent finished update, with no reviewer requests. Report tested behavior and deployment work separately. Do not claim production validation occurred from local tests.

Implementation is complete only when every listed lock owner uses the shared session, every relevant mutation boundary rejects stale ownership, automatic takeover clears the predecessor's running state safely, and the focused tests pass. A heartbeat thread by itself, timeout cap by itself, or another partial patch does not satisfy this plan.

## 11. Deployment after implementation

Pause launching jobs, update all scheduler hosts and maintenance entry points to the merged code, and confirm no old owner is still active. The current year-9999 locks cannot expire naturally: inspect and explicitly recover any such leftover token only after confirming its owner stopped. Do not mass-clear locks during a schema migration.

Deploy PR #236 before this PR. Validate the Actions secrets and target access, then run representative development and production dry-runs. Exercise a controlled development-owner termination and confirm another machine can acquire after expiry, while a resumed old owner is rejected. Verify R2 counters and retained recovery records. Only then enable the scheduled workflow and automatic deletion settings as already documented.

Do not change the user's Vercel rule, request reviewers, run destructive production failure experiments, or promise a zero-overage bill. Per-job budgets remain per-job, and the accepted uncertain in-flight writes remain possible during crashes.
