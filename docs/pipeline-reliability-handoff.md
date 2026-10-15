# Pipeline reliability handoff

Updated 15 October 2026 for PR3, based on the merged default branch containing PR #164, PR #166, and PR #168.

## Current guarantees and limits

PR #164 owns shared stages, the run-scoped successful TMDb request cache, request coalescing, Update prefetch, Update worker limits, and union IMDb projection. PR3 reuses those paths; it does not add a parallel cache or scheduler. PR #166 owns the current matching and parsing policy, and PR #168 owns whole-run deadlines and process cleanup.

Expected skips, ambiguous records, and unavailable listings remain normal successful run behavior. PR3 adds no “completed with skipped rows” status, warning exit code, or skip threshold. Existing normal Update retention, solo Update clearing, title grouping, alias handling, stable movie codes, and notification behavior remain in place.

PR3 persists each completed matching decision and source completion, and makes all three category publications resumable at confirmed write phases. Now-playing and Cinematheque publication also reconcile cinema-scoped stale screenings. It does not make related writes atomic. During a failed or in-progress publication, readers can still observe one final table updated before another; PR4 must close that gap.

## Match checkpoint schema and reuse

`pipeline_match_checkpoints` is append-only. Each record stores category, existing category identity, a SHA-256 identity hash, a deterministic input fingerprint, matching-policy version, decision, selected TMDb/IMDb IDs, match path, at most the existing ten alternate candidates, a short reason, run ID, creation time, and expiry. The category plus identity hash is indexed; checkpoint records do not replace the current grouping functions.

The fingerprint uses canonical JSON with sorted keys and sorted row evidence. For now-playing and Cinematheques it includes the current category group key, raw and normalized title, release year, director, runtime, cinema, city, and scraper source. Coming-soon identity remains its existing `_all_soon_key` (English title, Hebrew title, and release date). Its fingerprint includes the same relevant metadata fields and helper evidence. All categories include `MATCHING_POLICY_VERSION`.

Current `tableFixes` values (`title_fix` and `tmdb_id`) and `tableSkips` values (`name_or_tmdb_id`) participate in the fingerprint. This covers title overrides and TMDb-ID aliases represented by numeric `title_fix` entries. A changed fix, alias target, skip, input field, source, category, or policy version therefore causes a cache miss. Current helper rows are loaded before a cached decision is applied.

Only `matched` and `intentional_skip` decisions are loaded for reuse, and only while their 180-day expiry is in the future. `retryable_failure` rows are stored for 24 hours as diagnostics but never satisfy a cache lookup. Empty TMDb search results and missing candidate details are retryable, not permanent no-match decisions. A previous successful decision can still supply a trusted TMDb identity for retention while changed evidence is being retried.

The cache is durable across worker and process restarts. It is separate from publication state: a cached match means “reuse this identity choice,” not “the final rows were written.” A current intentional skip is reusable and may allow old rows for that title to be removed; a provider failure is unresolved and retains attributable old rows when a prior match is known.

## Scrape manifests and empty results

`pipeline_scrape_snapshots` records one UUID-scoped attempt for a source table and cinema. `BaseCinema.scrape()` inserts a `running` manifest before navigation, attaches the UUID to that attempt's raw rows, and marks the manifest `complete` only after raw upload succeeds. Exceptions mark it `failed` when the manifest exists. `row_count` is the number of raw rows for that snapshot; it is reconciled after the existing raw-row dedupe and age cleanup remove rows later.

An empty scraper result is not automatically success. `formatAndUpload()` raises on an empty gathering table unless the scraper calls `confirmEmptySnapshot()` with positive source evidence. The Jerusalem Cinematheque scraper does this only after all 45 calendar dates explicitly show the source's no-screenings state. Other scrapers currently treat an empty page as incomplete unless they add similarly verifiable evidence. This can retain old future screenings until that source has an authoritative complete snapshot; it avoids interpreting a blocked or half-loaded page as “nothing is showing.”

The dataflow first selects the latest attempt for each table/cinema, regardless of status. It processes that attempt only when its status is complete and its manifest row count exactly equals the raw rows associated with its UUID. A newer failed, running, or count-mismatched attempt fences off an older complete snapshot; none can authorize stale-row deletion. A confirmed complete snapshot with zero rows is still a real scope and may remove stale screenings for that cinema. Old rows with no manifest remain processable only through the legacy path; legacy input can be marked after successful publication but cannot authorize stale-row deletion.

Raw dedupe keys include `snapshot_id` for new attempts, so two retries or later snapshots are not merged before the dataflow reads them. Rows without a snapshot UUID retain their prior dedupe grouping. When existing raw dedupe or age cleanup deletes rows from a complete snapshot, it updates that manifest's count so the next read can validate the remaining snapshot exactly.

Coming-soon mapping uses the same latest-complete/legacy-unadded selection so failed source attempts do not feed matching. It does not delete final coming-soon rows based on an empty scrape.

## Publication checkpoints and resume behavior

`pipeline_publication_checkpoints` is separate from match decisions and keyed by `(category, snapshot_id)`. It stores the snapshot fingerprint, phase, unresolved flag, owner token, owner run, and generation. `pipeline_publication_scope_owners` holds the current owner and generation for each `(category, cinema)`. A same-snapshot claim is blocked while its owner run is active; a newer complete snapshot can take over that scope and advance its generation. Claim, pre-write checks, phase updates, and release verify ownership, fingerprint, generation, and that the snapshot is still the latest attempt. The active run releases claims in `finally` when it can exit normally.

A completed snapshot with the same fingerprint and no unresolved groups can be skipped on a later pass. A changed fingerprint or a published snapshot with unresolved groups is claimable again. Current phases are `prepared`, `screenings_written`, `movies_written`, `stale_rows_deleted`, and `published`. Coming-soon snapshots use `movies_written` for the `finalSoons` upsert; they have no stale-screening deletion phase. A retry with unchanged, resolved evidence resumes after the last confirmed phase, so a successful screening write is not repeated just because the movie write failed. A retry for a snapshot with unresolved identities starts matching again because provider results may have changed. All replayed upserts and cleanup operations remain idempotent; raw rows are marked only after final-table writes succeed. The `added` flag is not the sole completion proof.

Each `PreparedPublication` records category, snapshot UUID, run ID, fingerprint, screening and movie rows, stale and retained screening IDs, raw IDs eligible to mark, unresolved group keys, and whether source coverage is complete. PR4 can consume this representation without inventing a new identity or retention policy.

## Retention rules

For a complete now-playing or Cinematheque snapshot, the pipeline builds one plan per cinema. It compares screenings using cinema, city, date, time, technology, type, and language details plus the English event link, falling back to the Hebrew link when needed. When links are missing, it falls back to the established title-based key. A fresh raw UUID or corrected title can therefore still identify a previously published screening when its stable event links match. Existing candidate ranking, title grouping, and alias/remake mapping behavior remain unchanged.

For an unresolved group, a recent successful checkpoint for the same category/group—or the selected TMDb ID if enrichment failed after matching—can identify screenings to retain. The pipeline keeps old rows at that cinema with that ID while it retries the group, and may remove unrelated stale rows covered by the same complete snapshot. If no trusted ID exists, it retains the whole cinema because it cannot safely attribute old rows to the unresolved title. Invalid rows and titles that cannot form the existing group key use the same conservative whole-cinema fallback. Raw unresolved rows stay unmarked so a later run can retry them.

An explicit current skip is not unresolved: the old screening is eligible for removal when a complete snapshot is published. A failed or missing scrape never reaches this deletion plan. Existing date-based expiration cleanup remains separate from future-row retention.

## Concurrency, expiry, and cleanup

Publication claims use a random owner token and increasing generation. A second run cannot take a claim while its owner run is active; after the owner run is no longer active, a retry can take a higher generation. Database phase updates from a stale owner are rejected. Match decisions are append-only and lookups prefer the highest run ID and latest creation time, so an older run finishing late does not outrank a newer run.

The service-only `cleanup_pipeline_reliability_state` RPC deletes expired match records in bounded batches, marks running scrape manifests older than one day failed when their run is no longer active, and removes superseded manifests and old published checkpoints after 90 days. It preserves the latest source attempt per cinema regardless of status, so cleanup cannot resurrect a previously complete snapshot after a newer failure. It does not remove a resumable newest snapshot. Raw-row expiration remains owned by the existing cleanup process.

The migration enables RLS and revokes direct table/function access from `public`, `anon`, and `authenticated`; the backend service role is the only granted writer. Apply `20261015170000_pipeline_match_and_publication_checkpoints.sql` before deploying PR3 workers because the code reads and writes the new tables and raw `snapshot_id` columns. No checkpoint backfill is required: existing raw rows without manifests are handled through the conservative legacy path, and prior match choices are learned as titles are processed.

## PR4 contract

PR4 should use the prepared publication and retention plans from PR3 and commit a category's coupled publication work in one database transaction. At minimum, the transaction must validate the current complete snapshot, input fingerprint, owner token, and generation; upsert the final screening and movie rows; maintain movie-code relationships; delete only the planned stale screening IDs; mark only eligible raw IDs; and set the publication checkpoint to `published`. A failure before commit must leave all those live-table changes and the publication marker unapplied. A lost response after commit must be reconciled by reading the durable snapshot checkpoint rather than duplicating or undoing work.

Atomic writes alone do not make multiple HTTP reads consistent. PR4 must also give supported application readers a revision-aware boundary (or equivalent protocol) and test a reader that straddles publication. It should preserve category-level independence and expected-skip success behavior. It should not add persisted provider freshness, another request cache, or a global run-across-categories transaction unless a separate measured requirement calls for them.

## PR3 verification and remaining limitation

Unit tests cover immediate cross-instance match reuse, retryable versus intentional decisions, invalidation by metadata/fix/skip/policy changes, complete-empty versus failed/partial snapshots, failed-latest-attempt fencing, snapshot-isolated dedupe, prior-identity retention, unknown-scope retention, intentional-skip deletion, fresh raw UUID and stable-link dedupe, publication owner generations, stale-owner rejection, phase-aware retries after partial final-table writes, and rematching unresolved snapshots. The local environment has no PostgreSQL client/server or running Docker daemon, so the migration, RLS grants, and concurrent RPC behavior still require validation against an isolated database before production rollout. Fake Supabase tests exercise the client-side behavior but do not prove PostgreSQL locking or RLS semantics.
