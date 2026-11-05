# Shared pipeline and R2 cleanup

`backend.utils.log.shared_cleanup` is the one preflight and scheduled cleanup entry point. It runs the established Supabase old-entry sweep, final-movie orphan sweeps, 30-day artwork and social-card cleanup, the existing D1 screenshot retention check, and a conservative audit of old orphan run artifacts.

## Safety and coordination

- Each target uses its own exclusive D1 `run_locks` owner token. Pipeline runs acquire it before startup cleanup and keep it through run finalization and the post-run D1 size check. Scheduled and standalone mutating commands use the same lock. A timestamp never permits takeover of a held token, protecting long jobs and suspended machines without a background renewal thread.
- Existing lease method/column names remain for compatibility. Held tokens write a far-future timestamp so older clients also cannot take over. Checks before deletion fail closed on D1 errors or a changed token. Supervisor timeouts bound resource use; lock safety does not depend on those timeouts.
- Cleanup scans the selected target only. `--target` is required unless `KARTISERET_TARGET` is already selected; the target resolver checks Supabase project, artwork bucket, D1 UUID shape, and private artifact bucket names before work starts.
- The R2 artwork, social-card, and orphan-artifact stages delete at most 500 objects each per invocation. Artwork and social references must scan completely and pass validation before deletion. Run artifacts are eligible only when older than 30 days, absent from D1 references, and owned by a confirmed successful run; active, failed, unconfirmed, unknown, or recoverable runs are retained.
- A successful applied cleanup is recorded in the target's D1 database and suppresses expensive catalog scans until the next UTC day. Dry-runs have a separate daily marker and never count as a successful cleanup. D1 storage checks still run before and after jobs.
- Do not delete R2 buckets. The cleanup only deletes individually verified objects.

## Dry-run rollout

Automatic deletion is off by default. Pipeline preflight reads `KARTISERET_SHARED_CLEANUP_APPLY` and defaults to `false`. Scheduled jobs are entirely skipped until the repository variable `KARTISERET_SHARED_CLEANUP_ENABLED` is set to `true`, so the workflow does not consume runner minutes or fail on missing secrets before setup. Manual dispatch can validate and dry-run before enabling the schedule; it has an explicit `apply` checkbox. Inspect the counts and candidate key samples in the workflow output for both targets first. Then enable the schedule, run an applied cleanup, verify its summary, and only then set the repository variable `KARTISERET_SHARED_CLEANUP_APPLY` to `true` and configure the same environment variable on the pipeline scheduler host.

Commands:

```bash
python -m backend.utils.log.shared_cleanup --target development --dry-run --force
python -m backend.utils.log.shared_cleanup --target development --apply --force
python -m backend.utils.log.shared_cleanup --target production --dry-run --force
```

`--force` bypasses the once-per-day marker. Omit it for ordinary scheduled or pipeline use. A cleanup that cannot acquire the target lease exits successfully with a clear `skipped` report; a pipeline fails startup if safe preflight cannot complete. The report contains counts and object totals, never credentials or payloads.

## Recovering an interrupted owner

Normal completion and handled failure release the owner token. The supervisor only finalizes and releases an interrupted pipeline after confirming its process group stopped. A crash, killed supervisor, or failed release can leave the lock held. Scheduled cleanup then skips; another pipeline waits for its bounded interval and fails startup. This is intentional: an expired timestamp cannot prove a remote process is dead.

Stop the old owner and all descendants on the scheduler host before recovering. Inspect `SELECT lease_token, run_id FROM run_locks WHERE id = 1` in the selected target's D1 console. Then run:

```bash
python -m backend.utils.log.recover_run_lock --target development --expected-token THE_OBSERVED_TOKEN --confirm-owner-stopped
```

Use `--target production` only for the production lock. Recovery checks the exact token and refuses to clear a different owner. For a pipeline run, it requires Supabase failure confirmation and marks D1 unconfirmed before releasing; standalone locks have no run ID. Do not recover a lock merely because its owner is slow or temporarily offline. Update every scheduler host to the merged code before enabling automatic cleanup; stale code must not keep launching writers outside the shared lock.

## GitHub Actions configuration

The `Daily Shared Cleanup` workflow is scheduled for 02:00 UTC. GitHub can delay scheduled workflows, so this is a daily opportunity rather than a precise timer. No scheduled validation or cleanup jobs run until `KARTISERET_SHARED_CLEANUP_ENABLED=true`. Manual dispatch performs read-only validation first and defaults to dry-run. Its `force` checkbox repeats a scan when a pipeline preflight already used that target's daily scan. Add these repository or organization **Actions secrets** (the workflow does not bind to named GitHub environments):

- Shared: `R2_ACCOUNT_ID`
- Development: `DEV_SUPABASE_URL`, `DEV_SUPABASE_SERVICE_ROLE_KEY`, `DEV_R2_BUCKET`, `DEV_R2_IMAGE_ORIGIN`, `DEV_R2_ACCESS_KEY_ID`, `DEV_R2_SECRET_ACCESS_KEY`, `DEV_D1_DATABASE_ID`, `DEV_D1_API_TOKEN`, `DEV_RUN_ARTIFACTS_R2_BUCKET`, `DEV_RUN_ARTIFACTS_R2_ACCESS_KEY_ID`, `DEV_RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY`
- Production: `PROD_SUPABASE_URL`, `PROD_SUPABASE_SERVICE_ROLE_KEY`, `PROD_R2_BUCKET`, `PROD_R2_IMAGE_ORIGIN`, `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY`, `PROD_D1_DATABASE_ID`, `PROD_D1_API_TOKEN`, `PROD_RUN_ARTIFACTS_R2_BUCKET`, `PROD_RUN_ARTIFACTS_R2_ACCESS_KEY_ID`, `PROD_RUN_ARTIFACTS_R2_SECRET_ACCESS_KEY`

The validation job performs read-only access checks against Supabase, D1, and both R2 buckets. If any selected target fails validation, no cleanup job starts. The workflow needs only `contents: read`; it does not need a GitHub token with write permissions. Verify the validation job succeeds for every target before enabling `KARTISERET_SHARED_CLEANUP_ENABLED`.

## Existing publication cleanup

Category-specific post-publication cleanup remains in place because a publication can make rows obsolete after preflight. The preflight sweep is idempotent and runs at most once per target per UTC day after a successful applied run. The two former commented-out daily workflows have been consolidated into `daily_shared_cleanup.yml`.
