# Publication input versions

Category preparation still loads the input rows it needs, matches/enriches them,
and builds the same before/after mutation plan. Publication no longer stages a
second copy of every input table or runs a full-table JSON `EXCEPT ALL` comparison.
Each read table instead contributes one compact revision guard.

## Correctness and concurrency

- `PublicationWorkspace` reads a revision before and after its primary-key cursor
  scan (500 rows per request, without OFFSET). If they differ, it discards that scan and refuses preparation. RPC errors
  or malformed/missing revisions fail closed; there is no row-copy fallback.
- Statement triggers on raw tables, final tables, and manual matching evidence
  record INSERT, UPDATE, DELETE and TRUNCATE increments in transaction-private
  `xid8` slots. Independent writers never update a shared counter row. The token
  is the base plus committed increments; even a same-value update advances it.
  Rollback removes the increment with the write. Slots and base values are
  private and cannot be forged by service/API/publisher roles. Successful
  publication folds the slots into the base under its existing writer fences,
  atomically preserving the token and bounding retained bookkeeping.
- Shared scrape manifests and publication checkpoints use category-scoped
  tokens and category-filtered cursor scans, so unrelated inserts cannot
  invalidate or shift a category scan. Their small metadata tables use row triggers to invalidate the old
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
2. Apply `20261112120834_publication_input_versions.sql`, then
   `20261112192203_concurrent_publication_revisions.sql`, to each intended
   environment before running the updated Python producer. The latter preserves
   every existing token while removing the shared-row writer queue. No Vercel or
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

Raw scraper uploads use at most 200 rows and 256 KiB of compact UTF-8 JSON per
request, with minimal responses. A manifest remains running until every batch
succeeds; a failed partial attempt cannot authorize public replacement or stale
row deletion. The full attempted payload remains available to recovery logging.
Private workspace queries evaluate the captured input once rather than sorting
it repeatedly for each outer page. These changes preserve public catalog output
and source completeness rules.

Do not restore the original shared-counter trigger on its own: outstanding
transaction slots must first be folded into the base under writer fences, with
publications quiesced. Otherwise the token would go backwards. The new schema
remains compatible with the previous integer-token producer during rollout.

## Validation

The tests bootstrap all migrations on disposable PostgreSQL 17, including the
new migration under a non-superuser administrator. Coverage includes every
tracked table's inserts, updates, deletes, truncation and rollback; category
scope changes; multiple scrapes; stale/legacy/malformed guards; empty-input
insertions; manual corrections; committed and rolled-back concurrent writers;
a writer arriving after validation; ordinary reads during publication; role
permissions; receipt idempotency; and the real Python workspace and restricted
PostgreSQL publisher. Concurrent-writer regression tests keep one raw or
metadata transaction open while other writes finish with the production
eight-second timeout. They also cover compaction, rollback, role permissions,
prepared-token stability and stale rejection. Upload tests cover the four
incident sizes, UTF-8 byte limits and failure in a later batch.

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
