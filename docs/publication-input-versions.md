# Publication input versions

Category preparation still loads the input rows it needs, matches/enriches them,
and builds the same before/after mutation plan. Publication no longer stages a
second copy of every input table or runs a full-table JSON `EXCEPT ALL` comparison.
Each read table instead contributes one compact revision guard.

## Correctness and concurrency

- `PublicationWorkspace` reads a revision before and after its paginated table
  scan. If they differ, it discards that scan and refuses preparation. RPC errors
  or malformed/missing revisions fail closed; there is no row-copy fallback.
- Statement triggers on raw tables, final tables, and manual matching evidence
  advance transactional counters for INSERT, UPDATE, DELETE and TRUNCATE. Even
  a same-value update advances the counter. Rolled-back writes roll the counter
  back too. Counters are private and cannot be reset by service/API/publisher
  roles.
- Shared scrape manifests and publication checkpoints use category-scoped
  counters and category-filtered pagination, so unrelated inserts cannot shift
  offsets unnoticed. Their small metadata tables use row triggers to invalidate the old
  and new categories when a row changes scope; TRUNCATE invalidates all three.
  Independently prepared categories can therefore publish sequentially without
  invalidating one another's unrelated metadata guards.
- At commit, the publisher first takes the existing movie advisory locks and
  then fences the guarded tables and write targets in a consistent table order.
  Read-only manual evidence uses SHARE; writable inputs use SHARE ROW EXCLUSIVE.
  These modes allow ordinary SELECTs while waiting for existing writers and
  preventing new writes between validation and commit. Revision checks happen
  after lock acquisition in READ COMMITTED. Other transaction isolation levels
  are refused rather than validating an older transaction snapshot.
- An input-token mismatch raises SQLSTATE `40001` before any live mutations.
  Rebuild that category's workspace from current inputs on a subsequent pipeline
  invocation; retrying the same frozen payload will not make it current. The
  runner reports an unconfirmed/failed publication and skips its notifications.
- Existing per-target before-row checks, snapshot completeness/latest-attempt
  checks, atomic writes, receipt reconciliation, public catalog revisions, and
  permanent movie-code behavior remain in place. `movieCodes` keeps its special
  concurrent reservation contract and does not get a whole-table input guard.

Multiple scrapes per day work normally. A scrape that changes a category's
inputs during preparation invalidates the older preparation. Table-wide tokens
can also reject an otherwise unaffected publication after an unrelated change
in that same table; that conservative retry is intentional. The implementation
holds no database transaction or table lock across external provider requests.

## Deployment and rollback

1. Pause starting new pipeline publications and let active publications finish.
2. Apply `20261112120834_publication_input_versions.sql` to each intended
   environment before running the updated Python producer. No Vercel or
   Cloudflare configuration change is needed.
3. Run the updated producer and verify its applied receipt before resuming normal
   schedules. Old prepared row-copy payloads must be rebuilt, not replayed.

The migration is additive for counters/triggers/RPC and replaces the atomic
publication implementation. Already applied receipts remain idempotent. Old
producers with full-row guards fail closed with a re-preparation hint; new
producers against an unmigrated database fail when reading revisions. Do not
roll back only the producer. To restore the old protocol, quiesce publications,
restore the previous commit implementation, and deploy its matching producer.
The additive counters and triggers may remain installed during that rollback.

This PR does not apply the migration to a hosted database, deploy application
code, change hosting settings, or change logging.

## Validation

The tests bootstrap all migrations on disposable PostgreSQL 17, including the
new migration under a non-superuser administrator. Coverage includes every
tracked table's inserts, updates, deletes, truncation and rollback; category
scope changes; multiple scrapes; stale/legacy/malformed guards; empty-input
insertions; manual corrections; committed and rolled-back concurrent writers;
a writer arriving after validation; ordinary reads during publication; role
permissions; receipt idempotency; and the real Python workspace and restricted
PostgreSQL publisher.

Synthetic local measurements on 12 November 2026 with `work_mem = 2184kB`:

| Fixture | Result |
| --- | --- |
| 150,000 unchanged historical raw rows plus one new movie | 65-byte raw-table guard; approximately 6 ms publication |
| 46,244 mutations with failed historical rows and pending legacy work retained | 247 parts / 46.4 MB; approximately 3.2 seconds SQL publication |
| The same backlog through Python COPY staging and the restricted publisher, split into 638 parts | 43.7 MB canonical payload; approximately 0.58 seconds staging + 3.83 seconds publication |

These are local measurements, not hosted performance claims. Most of the
remaining payload is the actual mutation plan, not unchanged input history.
The heavy fixture keeps correctness checks for retained rows, snapshot counts,
permanent codes, checkpoint publication, and staging cleanup.

Run the normal integration suite with `npm run api:test:integration`. To include
its optional full Python backlog replay, set
`RUN_POSTGRES_PUBLISHER_BACKLOG_PERF=true` and select the Python interpreter with
`PYTHON` if needed. Python unit coverage runs with
`python -m unittest discover -s backend/tests -v`.
