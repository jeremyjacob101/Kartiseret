# Cloudflare scraper run logs and artifacts

This change keeps new scraper output outside Git commits. Supabase `utilRunLogs`
continues to own run IDs and final status. D1 stores scraped rows, run summaries,
diagnostics, and artifact metadata. Private R2 stores screenshots and other
binary files. Existing Git history and historical artifact files are retained.

Each environment has its own D1 database, R2 bucket, and D1-bound Worker. The
Worker accepts authenticated D1 requests and has a binding to only its matching
database. The scraper does not receive a Cloudflare account API token for D1.
Artifact R2 credentials are separate from the movie-artwork R2 credentials.

## Resources

| Environment | D1 database | D1 ID | Private artifact bucket | Worker |
| --- | --- | --- | --- | --- |
| Development | `kartiseret-run-logs-dev` | `dbace3cc-386d-42f4-8ab9-0863f17adcfc` | `kartiseret-run-artifacts-dev` | `kartiseret-run-artifact-retention-dev` |
| Production | `kartiseret-run-logs-prod` | Set after production provisioning is approved | `kartiseret-run-artifacts-prod` | `kartiseret-run-artifact-retention-prod` |

Development D1 and R2 resources have been created. The D1 migration is applied
and the schema and a disposable write/read/delete smoke test were verified.
The run-artifact bucket remains private; it has no public or custom domain.
Production resources have not been created or changed.

## Local configuration

Put values in the repository-root `.env`; do not put these in GitHub Actions or
Vercel. Current scraper runs are local cron, manual, and watcher processes.
`R2_ACCOUNT_ID` is shared across profiles, as with the existing artwork R2
setup. Keep all other values target-prefixed.

Required entries are shown in `.env.example`:

- `DEV_D1_DATABASE_ID` and `PROD_D1_DATABASE_ID`
- `DEV_RUN_LOGS_API_URL` and `PROD_RUN_LOGS_API_URL`
- `DEV_RUN_LOGS_API_SECRET` and `PROD_RUN_LOGS_API_SECRET`
- `DEV_RUN_ARTIFACTS_R2_BUCKET`, `_ACCESS_KEY_ID`, and `_SECRET_ACCESS_KEY`
- `PROD_RUN_ARTIFACTS_R2_BUCKET`, `_ACCESS_KEY_ID`, and `_SECRET_ACCESS_KEY`

The Workers account currently has no `workers.dev` subdomain. A read-only
Cloudflare API check returned the provider's “no workers.dev subdomain” result.
Open **Workers & Pages** in the Cloudflare dashboard once to initialize the
account subdomain. The Worker URLs then follow this form:

```text
https://kartiseret-run-artifact-retention-dev.<account-subdomain>.workers.dev
https://kartiseret-run-artifact-retention-prod.<account-subdomain>.workers.dev
```

The scraper sends D1 queries only to the selected Worker URL. The target
resolver checks that a development target uses the development Worker hostname,
and production uses the production hostname. It also requires a 32-character
or longer Worker secret and the matching D1 ID and R2 bucket.

## Configure the development Worker

Install Node.js and Wrangler on the machine that will deploy Cloudflare Workers,
then run from the repository root:

```sh
npx wrangler deploy --config backend/cloudflare/run-artifact-retention/wrangler.dev.toml
npx wrangler secret put RUN_LOGS_API_SECRET --config backend/cloudflare/run-artifact-retention/wrangler.dev.toml
```

Generate a random secret with a password manager or `openssl rand -hex 32`.
Use that same value for the Worker secret prompt and
`DEV_RUN_LOGS_API_SECRET` in `.env`. Save the Worker URL Wrangler reports to
`DEV_RUN_LOGS_API_URL`. Do not reuse the production secret. The Worker binding
in `wrangler.dev.toml` selects only the development D1 database and artifact
bucket. Its daily scheduled handler enforces the two-calendar-month retention
window.

For artifact uploads, create an R2 S3 API token named
`kartiseret-run-artifacts-dev-dataflow`, choose **Object Read & Write**, and
scope it to only `kartiseret-run-artifacts-dev`. Store its **Access Key ID** and
**Secret Access Key** in the matching `.env` variables. The displayed API token
value is not used by the scraper. Do not reuse the movie-artwork token.

After those values are present, initialize the D1 schema:

```sh
python -m backend.utils.log.initialize_run_storage --target development
```

This command validates the selected profile and runs the idempotent schema
initializer. Do not start a scrape until it succeeds. To test storage without
running a scrape, use the storage unit tests and a controlled development
fixture. A real Worker/R2 end-to-end run requires the account subdomain, Worker
secret, and bucket-scoped S3 credentials described above.

## Data and failure behavior

- Scraped items are rows keyed by run, scraper, attempt, and row order. Known
  catalog columns remain queryable; unknown future CSV fields are serialized
  into `extra_json`.
- Supabase `utilRunLogs` remains the source of truth for run allocation and
  final status. Finalization uses the run's specific ID. A D1 lease prevents
  overlapping scraper runs from claiming the same logging window.
- Screenshot files are converted to WebP at quality 82 and maximum width 1,920
  without upscaling. If conversion fails or the output is larger, the PNG is
  kept. A 25-image historical sample reduced image bytes by 86.6% overall.
- R2 object upload happens before D1 metadata publication. When either store
  fails, unsent data is kept under the OS application-support directory in a
  private recovery folder. It is not retried or committed to Git automatically.
- A run with published catalog data but a storage failure is reported as
  published with a logging failure. Failed Supabase finalization is reported
  as unconfirmed.
- The scheduled Worker removes expired R2 objects before D1 rows. If R2 has
  another old-object page or the D1 write budget is reached, it leaves cleanup
  pending for a later scheduled run. Two calendar months are measured from the
  original run or artifact date.
- New daily, weekly, manual, and watcher-triggered scraper runs do not stage,
  commit, rebase, or push artifact files. Safe fast-forward code synchronization
  remains in cron. The separate license-year maintenance workflow is unrelated.

## Historical files and importer

The Git history and old files under the cron logs and logger artifact folders
stay as they are. The release-date backfill can read D1 and historical Git
files. The importer defaults to a dry run and accepts at most the latest three
days; it imports newest complete artifacts first, uses idempotent IDs, and
stops at a conservative 20,000 estimated D1 row writes. It does not schedule a
continuation.

Only after the matching production resources and access are approved, inspect
the report first and run an explicit import:

```sh
python -m backend.utils.log.import_historical_artifacts --target production
python -m backend.utils.log.import_historical_artifacts --target production --apply
```

The first command is a dry run. The second writes to production and is not part
of this implementation's dev verification. Review the exact report and daily
D1 metrics before deciding whether to start another explicitly requested import
later. The plan's approximately 44,000-row three-day sample cannot safely be
assumed to fit in one free-plan day after indexes and normal scraper writes.

## Production rollout boundary

No production D1 database, run-artifact bucket, Worker, secret, schema, backfill,
or application write has been created in this task. The prior instruction for
this account allowed production read-only. Production rollout requires explicit
authorization to create and write those production resources.

After that authorization, provision the production database and private bucket,
put the exact D1 UUID in `wrangler.prod.example.toml`, deploy the production
Worker, set a separate `RUN_LOGS_API_SECRET`, and create a separate bucket-scoped
R2 token named `kartiseret-run-artifacts-prod-dataflow`. Then set the production
profile values, initialize the production schema, verify a controlled run, and
only then consider the capped historical import. Do not use a production
scrape/import as the first configuration test.

## Rollback

To roll back the application code, revert the application PR; old Git history
and D1/R2 data remain available. Before reverting, disable the Worker cron if
you need to retain expired D1/R2 records for investigation; otherwise its
two-month cleanup continues independently. Do not delete either database or
bucket as part of rollback. Recovery files remain local and require manual
review/reconciliation.

Cloudflare references: [D1 limits and pricing](https://developers.cloudflare.com/d1/platform/limits/),
[D1 Workers binding API](https://developers.cloudflare.com/d1/worker-api/d1-database/),
[R2 S3 API](https://developers.cloudflare.com/r2/get-started/s3/).
