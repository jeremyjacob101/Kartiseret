# Safe reduction of raw cleaning work

The cleaners retain pending work unless there is positive evidence that it belongs
to an explicitly failed source attempt which has already been replaced. Row age,
an earlier `run_id`, or `added=false` is not sufficient evidence.

`cleaned=true` means normalization has finished. `added=true` means publication
handled that source row; this can include a deliberate manual skip. An unresolved
match stays unadded and can be retried. The existing mapper selects complete,
count-matched current source snapshots, with its existing non-authoritative legacy
fallback. This change does not alter matching, skip decisions, or that selection.

## Eligibility

An older row is excluded from a cleaner's write loop only when all of these hold:

- The same run plan selects the mapping stage for that raw table. A direct or
  Clean-only run retains its existing historical scope.
- The row has a known snapshot manifest for the same table and cinema, and that
  manifest explicitly says `failed`.
- The latest attempt for that cinema is `complete`, its stored row count matches
  its actual raw rows, and all those rows belong to the manifest's cinema.
- The replacement has the same nonempty source identity and a strictly newer
  manifest order (run, attempt, start time).

Keep older complete snapshots, unresolved/current snapshots, running attempts,
legacy rows without a snapshot, unknown snapshot IDs, and rows without a valid
replacement eligible under the existing rules. A failed/running/count-mismatched
latest attempt cannot authorize this optimization. A confirmed empty complete
replacement can. The decision uses manifest identity/order even if a previous
cleaner stamped a row with a later run ID.

This optimization does not delete rows or mark them cleaned/added. Existing
retention and dedupe still run under their original rules. Full input guards
remain in the publication, including the manifests used to justify excluding
failed attempts. Historical rows remain available to cross-cinema title evidence;
manual fix precedence is unchanged. No `_checkpoint_source` annotation is added
to cleaning payloads.

## Atomic publication and failure status

Movie/screening writes, stale deletions, required raw completion state, checkpoints,
and revision continue through the existing single atomic category commit. SQL and
the 60-second deadline are unchanged. These Python changes need no new migration.

An unsuccessful plan now exits nonzero through the worker and supervisor. GitHub
Actions fails on a false, missing, or invalid completion marker, while still
uploading artifacts. Prepared flow summaries say `STAGED (PUBLICATION PENDING)`
and are written under `prepared/`; they do not claim the catalog is already live.
Publication must return an `applied` receipt before it is accepted as complete.
Commit failure leaves the run failed and prevents dependent alert dispatch.

## Scale evidence and limits

The incident's 59,416 raw guard rows included 31,864 rows from failed attempts
and 3,105 legacy rows. The original 75,301-change publication included 29,057
retained failed-attempt updates and 2,673 retained legacy updates. This policy
removes the former while preserving the latter: 46,244 changes after the existing
retention/dedupe output. It does not use the more aggressive investigation variant
that omitted all historical cleaning or deferred housekeeping.

Tests include the actual cleaners and private workspace serializer at 59,416 raw
rows, plus a synthetic PostgreSQL fixture with full row shapes, provider metadata,
real indexes/triggers, six current snapshots, 18 failed attempts, 14,492 raw
deletions, 19,297 screening changes, permanent codes, and low `work_mem` (2184 kB).
The fixture stages approximately 101 MB across 599 parts and published in about
4.5 seconds on the local PostgreSQL 17 investigation machine. It verifies that
29,057 failed-attempt rows remain uncleaned/unadded, all 2,673 pending legacy rows
still receive their intended cleaning updates, and movie/screening/checkpoint/
source-count invariants hold. The existing 737-small-part test remains separate;
part count alone is not a production workload model.

Local performance is not proof of a sub-minute hosted commit. Recheck on
representative compute before claiming the incident is resolved. Existing staged
publications retain their original immutable identity/payload and do not shrink
when this code is deployed. A normal new preparation, or an explicit reprepare
with a new publication ID, is needed to benefit; never rewrite an existing
publication's parts under its old fingerprint. This PR neither replays production
data nor sends notifications.
