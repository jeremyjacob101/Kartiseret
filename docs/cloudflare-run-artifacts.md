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

## R2 runaway request guard

Every Python R2 client is created through the shared guarded client factory.
At the Botocore HTTP-send boundary, each outgoing attempt is atomically
reserved in a per-job SQLite ledger. The default limits are 100,000 Class A
operations and 100,000 Class B operations per logical job. Override them with
positive integer `KARTISERET_R2_CLASS_A_LIMIT` and
`KARTISERET_R2_CLASS_B_LIMIT` values. Class A includes writes, copies, and
listing; Class B includes object reads and HEAD checks. Unknown operations
count as Class A. Deletes and multipart aborts do not use either allowance.

SDK automatic retries are disabled so a retry cannot bypass the budget; each
request attempt that reaches the send hook is counted. When a limit is reached
or the local ledger cannot be read or updated, the next R2 request is blocked
and the job fails. The summary reports both counters and whether a limit
tripped. This is a per-job safeguard, not a monthly or account-wide Cloudflare
cap; repeated jobs and other clients have separate budgets.

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

## Historical data

Historical files remain in Git, and previously imported records remain in
Cloudflare until normal cleanup removes them. New runs write directly to D1
and R2. The release-date backfill can still read historical Git files and D1.

## Rollout and rollback

Validate the complete flow with the development database and bucket first. Set
up the production database and distinct profile, then measure usage before a
controlled production test. Production D1 has been initialized.
To roll back, revert the application PR; existing Git history,
D1/R2 data, and local recovery material remain available. Do not delete the
buckets or databases as part of rollback.
