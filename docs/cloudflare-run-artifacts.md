# Scraper run logs and artifacts in Cloudflare

Scraper runs write structured movie/screening rows and text diagnostics to D1,
and private screenshots to R2. Supabase `utilRunLogs` remains the source of
truth for the run ID and status. Existing Git history remains available; runs do
not commit or push artifacts.

## Environment setup

| Target | D1 database | Private screenshot bucket |
| --- | --- | --- |
| Development | `kartiseret-run-logs-dev` (`dbace3cc-386d-42f4-8ab9-0863f17adcfc`) | `kartiseret-run-artifacts-dev` |
| Production | `kartiseret-run-logs-prod` | `kartiseret-run-artifacts-prod` |

Create a Cloudflare **Account API Token** with **D1 Edit** for the account and
place the token value in the selected profile's `DEV_D1_API_TOKEN` or
`PROD_D1_API_TOKEN` in the root `.env`. Cloudflare's D1 permission is scoped to
the account, so this credential can access other D1 databases in that account;
the scraper validates the selected database ID and bucket before running. Do
not put the token in Git, Vercel, GitHub, or log output. The R2 credentials are
separate S3 credentials scoped to the matching screenshot bucket; put their
Access Key ID and Secret Access Key in the matching `*_RUN_ARTIFACTS_R2_*`
variables. `R2_ACCOUNT_ID` is shared. See `.env.example` for exact names.

Initialize the selected database after configuring its profile:

```sh
python -m backend.utils.log.initialize_run_storage --target development
```

No Worker, Wrangler configuration, Worker secret, or scheduled Cloudflare
cleanup is required. The scraper checks D1 storage before and after runs.

## Cleanup and recovery

The scraper begins removing the oldest completed runs when D1 reaches 350 MB,
and continues toward 300 MB. It deletes each run's screenshot objects before
their D1 metadata, protects active/unconfirmed and recently created runs, and
resumes interrupted cleanup on the next invocation. Cleanup reserves at most
5,000 D1 writes per UTC day. If measurement fails, cleanup cannot make progress,
or the database remains at or above 350 MB, the run stops safely. Cleanup only
runs when the scraper or an explicit maintenance/backfill command runs. Large
individual runs can still hit storage or daily write limits between checks.

If D1 or R2 fails, the affected run is marked failed where possible, or
unconfirmed if Supabase finalization cannot be confirmed. Unsent data is saved
under the OS application-support `Kartiseret/run-recovery` directory. Inspect
and reconcile it manually; no automatic retry or deletion is performed. A
catalog publication that already succeeded must be reported as published with a
logging failure.

## Historical import

The importer reads historical CSVs, converts them into D1 rows, and writes text
diagnostics to D1 and screenshots to R2. It defaults to a dry run, preserves
unknown fields, uses stable IDs, and never schedules a continuation. Run only
against the desired target and confirm current UTC-day account-wide D1 row
writes in Cloudflare metrics before applying:

```sh
python -m backend.utils.log.import_historical_artifacts --target production
python -m backend.utils.log.import_historical_artifacts --target production --apply --account-writes-used CURRENT_UTC_DAY_WRITES
```

Replace `CURRENT_UTC_DAY_WRITES` with the measured value. The importer reserves
40,000 writes for normal work and cleanup and caps itself at 60,000 writes.
Index writes count, so 60,000 rows may not fit in one day. Review the report for
unresolved files, uncertain writes, and data remaining in Git before manually
starting any later import. The release-date backfill still reads both D1 and
historical Git files.

## Rollout and rollback

Validate the complete flow with the development database and bucket first. Set
up the production database and distinct profile, then measure usage before a
controlled production test and capped import. Production D1 has been initialized.
To roll back, revert the application PR; existing Git history,
D1/R2 data, and local recovery material remain available. Do not delete the
buckets or databases as part of rollback.
