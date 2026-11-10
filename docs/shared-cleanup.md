# Shared pipeline and R2 cleanup

`backend.utils.log.shared_cleanup` is the one preflight and scheduled cleanup entry point. It runs the established Supabase old-entry sweep, final-movie orphan sweeps, 30-day artwork and social-card cleanup, the existing D1 screenshot retention check, and a conservative audit of old orphan run artifacts.

The separate `weekly_publication_cleanup.yml` GitHub Actions workflow runs every Sunday at 03:00 UTC. It removes every `prepared` publication whose `utilRunLogs.running_now` flag is false or whose run record no longer exists; there is no minimum age. Applied receipts are preserved, and deleting a preparation cascades to its staged JSON parts. The cleanup reports eligible and deleted publication counts without fetching payloads, processes at most 100 publications per database call, and verifies the target lease between batches. If another job holds the lease, it reports a safe skip for the next weekly run.

Apply the `weekly_publication_cleanup` Supabase migration to development and production before merging the new workflow; merging then enables the Sunday schedule automatically. The standalone workflow can also be dispatched manually for a selected target, with the same dry-run/apply choice. Its `--publications-only` path uses the target lease but does not consult or update the daily cleanup marker.

## Safety and coordination

- Each target uses its own D1 lease. A confirmed heartbeat every 10 seconds gives it another 120 seconds. D1 server time decides expiry; an expired token cannot renew or release its replacement. This covers pipeline preflight, publication, finalization, daily cleanup, and standalone commands.
- On an uncertain renewal, the worker latches failure, blocks new R2/PostgREST/D1 requests, and terminates. Its supervisor stops the process group. Requests already sent may finish; recovery records preserve that uncertainty. Ownership is checked before storage requests, including after sleep or supervisor loss.
- Commands have a five-hour maximum total lifetime including shutdown. Defaults remain 4.5 hours for normal jobs and 30 minutes for realtime updates. Shorter workflow timeouts still apply.
- Cleanup scans the selected target only. `--target` is required unless `KARTISERET_TARGET` is already selected; the target resolver checks Supabase project, artwork bucket, D1 UUID shape, and private artifact bucket names before work starts.
- The R2 artwork, social-card, and orphan-artifact stages delete at most 500 objects each per invocation. Artwork and social references must scan completely and pass validation before deletion. Ordinary run artifacts are eligible only when older than 30 days, absent from D1 references, and owned by a confirmed successful run; active, failed, unconfirmed, unknown, or recoverable runs are retained. Scrape snapshots use the completed-run retention rules below, including failed runs.
- A successful applied cleanup is recorded in the target's D1 database and suppresses expensive catalog scans until the next UTC day. Dry-runs have a separate daily marker and never count as a successful cleanup. D1 storage checks still run before and after jobs.
- Do not delete R2 buckets. The cleanup only deletes individually verified objects.

## Dry-run rollout

Automatic deletion is off by default. Pipeline preflight reads `KARTISERET_SHARED_CLEANUP_APPLY` and defaults to `false`. The `KARTISERET_SHARED_CLEANUP_ENABLED` repository variable gates only the daily shared cleanup workflow; it does not gate the separate Sunday publication cleanup workflow. Once that weekly workflow is merged, it runs each Sunday and uses `KARTISERET_SHARED_CLEANUP_APPLY` to choose dry-run or apply. Manual dispatch on either workflow has an explicit `apply` checkbox. Inspect the counts in the workflow output before enabling automatic deletion, then set `KARTISERET_SHARED_CLEANUP_APPLY` to `true` in GitHub and on the pipeline scheduler host when ready.

Commands:

```bash
python -m backend.utils.log.shared_cleanup --target development --dry-run --force
python -m backend.utils.log.shared_cleanup --target development --apply --force
python -m backend.utils.log.shared_cleanup --target production --dry-run --force
```

`--force` bypasses the once-per-day marker. Omit it for ordinary scheduled or pipeline use. A cleanup that cannot acquire the target lease exits successfully with a clear `skipped` report; a pipeline fails startup if safe preflight cannot complete. The report contains counts and object totals, never credentials or payloads.

## Recovering an interrupted owner

Normal completion releases promptly. Crashed owners expire automatically after 120 seconds without a confirmed heartbeat. A successful replacement claim durably retains the predecessor run ID, marks that run unconfirmed in D1 and unsuccessful/not-running in Supabase, then starts new work. Failed reconciliation blocks new work and retains recovery information. A stale finalizer cannot unlock a replacement owner.

If Supabase finalization is uncertain, the owner persists its run ID for reconciliation before releasing the lease. If that marker cannot be confirmed, it leaves the lease to expire. A run ID reserved just before a crash may have no run records yet; takeover accepts this only after both D1 and Supabase confirm their absence.

The explicit recovery command below is only for operator recovery, including old year-9999 tokens left by the previous non-expiring implementation. Ordinary crash failover requires no manual unlock.

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

The workflow names each Actions secret explicitly. Mutually exclusive development and production steps receive their corresponding credentials through step-level environment variables; checkout, Python setup, and dependency installation receive no application credentials. Secret values are not copied into job-wide environment variables or persisted through `GITHUB_ENV`. The existing target matrix, validation barrier, and cleanup commands are unchanged.

## R2 storage pressure protection

Every pipeline preflight inventories the selected target's artwork and run-artifact buckets after the daily cleanup check, even when the full daily scan was skipped. Standalone maintenance also initializes this inventory under the same target lease. All object prefixes and pending multipart parts count, with an additional conservative 4 KiB allowance per object/part. The inventory uses existing S3 credentials and paginated listings, not delayed dashboard metrics or new API tokens.

Default high/low watermarks, in decimal bytes:

| Target | Stop/cleanup threshold | Recovery target |
| --- | ---: | ---: |
| Production | 6,000,000,000 | 5,000,000,000 |
| Development | 2,000,000,000 | 1,500,000,000 |

Override these with `KARTISERET_R2_STORAGE_PRODUCTION_HIGH_BYTES`, `KARTISERET_R2_STORAGE_PRODUCTION_LOW_BYTES`, `KARTISERET_R2_STORAGE_DEVELOPMENT_HIGH_BYTES`, and `KARTISERET_R2_STORAGE_DEVELOPMENT_LOW_BYTES`. Each requires positive integer bytes with low < high. Keep the sum of target ceilings below the desired account allowance, reserving room for other buckets and writers.

Before a `PutObject` request is sent, its payload and overhead are reserved in a job-local SQLite ledger shared by threads and child processes. Failed uploads and overwrites remain conservatively charged for that job. Ordinary uploads add no remote storage lookup: refreshes occur after five minutes, 128 MiB of attempted uploads, or pressure at the high watermark. A periodic scan never discards reservations for writes still in flight.

At pressure, one bounded R2 cleanup pass can run again even after today's successful cleanup. It reuses the existing reference scans, 30-day grace periods, recovery exclusions, deletion limits, and immediate ownership checks. Objects read, uploaded, or loaded into a publication workspace during this job are protected locally; touching an artwork variant or completion marker protects its whole variant set, including references not yet published. No Supabase sweep is repeated just to reclaim R2 space. Cleanup credits only a measured reduction in storage. If the recovery target cannot be reached, the guard fails the job before its next upload. Reads and deletion/recovery operations remain available unless the separate operation budget has tripped.

The `KARTISERET_SHARED_CLEANUP_APPLY` rollout gate still controls automatic deletion. With it false, pressure cleanup is a dry run and uploads stop if room cannot be established. Inventory errors, missing ledgers, and unknown upload sizes fail closed. The pipeline's current uploads all use bounded `PutObject`; new copy/multipart writes and Infrequent Access writes are refused until they have explicit storage accounting. Existing pending multipart parts are counted and retained, not automatically aborted.

This protects the four managed buckets through updated pipeline/maintenance entry points. It is not an account-wide billing cap: other buckets, old scheduler code, external clients, in-flight requests during failover, and operations already consumed remain outside this storage ceiling. Main-pipeline R2 operation limits and D1 retention are unchanged. No new service, credentials, runtime dependency, D1 migration, or scheduled job is introduced.

## Scrape snapshots

New scraper attempts are archived as versioned gzip JSON objects under `runs/<UTC date>/<run ID>/scraped_snapshots/`. Supabase continues to receive the same working rows. D1 stores one catalog record per attempt with its R2 key, checksum, row count, outcome, and format version. Archive reads verify the compressed and content checksums and merge catalogued snapshots with legacy D1 rows by stable row key.

The existing daily and pressure cleanup paths in the Python run preflight scan the full snapshot catalog and delete up to 500 expired snapshots per pass, only after the owning run has a confirmed completion timestamp at least 30 days old. They report eligible, retained, and deleted object counts and bytes, with counts for retention blockers. Active or unresolved runs, runs without a completion timestamp, local recovery spools, and objects pinned by the active job are retained. The R2 object is deleted before its D1 catalog record. D1 size retention skips legacy scrape rows and snapshot catalog entries so it cannot remove migration sources or retained references. No Cloudflare Worker or separate background service is added for snapshot cleanup.

Use `backend.utils.log.migrate_scraped_archives` to copy and later delete legacy per-row archives. Both phases default to read-only. Review the dry run first, apply copy, and begin deletion only after every copied snapshot has passed checksum, row count, and row-key verification:

```sh
python -m backend.utils.log.migrate_scraped_archives --target production --phase copy
python -m backend.utils.log.migrate_scraped_archives --target production --phase copy --apply
python -m backend.utils.log.migrate_scraped_archives --target production --phase delete
python -m backend.utils.log.migrate_scraped_archives --target production --phase delete --apply
```

The same command accepts `development`. Migration writes reserve against one persistent account-wide ledger in production D1, capped at 60,000 conservative writes per UTC day. Deletion reserves three writes per legacy row plus batch overhead, and reservations are kept after uncertain outcomes. Catalog entries remain for the normal 30-day retention period after legacy row deletion. Do not run migration commands until the D1 daily allowance resets; all runner hosts must use the snapshot-writing version before production migration begins.

## Existing publication cleanup

Category-specific post-publication cleanup remains in place because a publication can make rows obsolete after preflight. The preflight sweep is idempotent and runs at most once per target per UTC day after a successful applied run. The two former commented-out daily workflows have been consolidated into `daily_shared_cleanup.yml`.

If a target uses the direct PostgreSQL publisher, configure its `DEV_` or `PROD_PUBLICATION_DATABASE_URL` and matching `PUBLICATION_DATABASE_SSL_CA_CERT` Actions secrets (with the same target prefix on both). The workflow passes those target-specific values into validation and cleanup. Targets without them retain the existing PostgREST publication path. Direct publisher SQL also verifies job ownership before execution.
