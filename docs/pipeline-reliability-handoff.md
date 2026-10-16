# Pipeline reliability handoff

Updated 15 October 2026 for PR3, based on the merged default branch containing PR #164, PR #166, and PR #168.

## Current guarantees and limits

PR #164 owns shared stages, the run-scoped successful TMDb request cache, request coalescing, Update prefetch, Update worker limits, and union IMDb projection. PR3 reuses those paths; it does not add a parallel cache or scheduler. PR #166 owns the current matching and parsing policy, and PR #168 owns whole-run deadlines and process cleanup.

Expected skips, ambiguous records, and unavailable listings remain normal successful run behavior. PR3 adds no “completed with skipped rows” status, warning exit code, or skip threshold. Existing normal Update retention, solo Update clearing, title grouping, alias handling, stable movie codes, and notification behavior remain in place.

PR3 records source completion and makes all three category publications resumable at confirmed write phases. It does not save TMDb match decisions: an interrupted or unresolved title is searched again on the next normal pipeline invocation. PR3 does not schedule that invocation. A complete now-playing or Cinematheque snapshot replaces that cinema’s prior screening set: screenings absent from the successfully resolved new snapshot are deleted even if another row in that snapshot is unresolved. Unresolved raw rows stay unmarked for a later matching attempt. Related writes are still not atomic, so readers can briefly see mixed publication state; PR4 must close that gap.

## Matching retries

TMDb searches continue to use the existing grouping, title fixes, aliases, skips, and candidate selection. PR3 does not persist matched IDs, intentional skips, or provider failures across runs. If a request raises an error, the dataflow exits with publication unfinished and the raw row unmarked; the existing runner retries that failed dataflow up to three attempts in the same run. If all attempts fail, a later normal run can claim the unfinished snapshot and match again. A successful search with no usable candidate is an expected unresolved row rather than a run error, so it stays unmarked and is searched again on the next normal run.

PR3 adds no retry scheduler. After the existing three attempts are exhausted, another attempt depends on the existing runner being invoked again, either by its current schedule or manually. Existing request-level retry limits remain separate from whole-dataflow retries.

## Scrape manifests and empty results

`pipeline_scrape_snapshots` records one UUID-scoped attempt for a source table and cinema. `BaseCinema.scrape()` inserts a `running` manifest before navigation, attaches the UUID to that attempt's raw rows, and marks the manifest `complete` only after raw upload succeeds. Exceptions mark it `failed` when the manifest exists. `row_count` is the number of raw rows for that snapshot; it is reconciled after the existing raw-row dedupe and age cleanup remove rows later.

An empty scraper result is not automatically success. `formatAndUpload()` raises on an empty gathering table unless the scraper calls `confirmEmptySnapshot()` with positive source evidence. The Jerusalem Cinematheque scraper does this only after all 45 calendar dates explicitly show the source's no-screenings state. Other scrapers currently treat an empty page as incomplete unless they add similarly verifiable evidence. This can retain old future screenings until that source has an authoritative complete snapshot; it avoids interpreting a blocked or half-loaded page as “nothing is showing.”

The dataflow first selects the latest attempt for each table/cinema, regardless of status. It processes that attempt only when its status is complete and its manifest row count exactly equals the raw rows associated with its UUID. A newer failed, running, or count-mismatched attempt fences off an older complete snapshot; none can authorize stale-row deletion. A confirmed complete snapshot with zero rows is still a real scope and may remove stale screenings for that cinema. Old rows with no manifest remain processable only through the legacy path; legacy input can be marked after successful publication but cannot authorize stale-row deletion.

Raw dedupe keys include `snapshot_id` for new attempts, so two retries or later snapshots are not merged before the dataflow reads them. Rows without a snapshot UUID retain their prior dedupe grouping. When existing raw dedupe or age cleanup deletes rows from a complete snapshot, it updates that manifest's count so the next read can validate the remaining snapshot exactly.

Coming-soon mapping uses the same latest-complete/legacy-unadded selection so failed source attempts do not feed matching. It does not delete final coming-soon rows based on an empty scrape.

## Publication checkpoints and resume behavior

`pipeline_publication_checkpoints` is keyed by `(category, snapshot_id)`. It stores the snapshot input fingerprint, publication phase, and whether any identity work was unresolved; it does not cache a TMDb match. There are no per-cinema owner tokens or generations in this PR. Claiming requires that the snapshot is still the latest complete attempt for that cinema. A published snapshot with the same fingerprint and no unresolved groups is skipped; changed evidence or unresolved results are matched again on a later normal invocation.

The current phases are `prepared`, `screenings_written`, `movies_written`, `stale_rows_deleted`, and `published`. Coming-soon snapshots use the movie-write phase for the `finalSoons` upsert and have no screening deletion. If a multi-table write fails, a retry with unchanged, resolved evidence resumes after the last confirmed phase. If matching had unresolved identities, the retry starts matching again because provider results may have changed. Raw rows are marked only after the relevant final-table writes succeed. PR4’s atomic transaction should replace the intermediate write-phase recovery with one publication commit and checkpoint update.

Each `PreparedPublication` records category, snapshot UUID, run ID, fingerprint, screening and movie rows, stale and retained screening IDs, raw IDs eligible to mark, unresolved group keys, and whether source coverage is complete. PR4 can consume this representation without changing screening identity or snapshot replacement semantics.

## Retention rules

For a complete now-playing or Cinematheque snapshot, the pipeline builds a plan per cinema. Screening identity remains the existing title-based key: normalized English title, cinema, city, date, time, technology, screening type, original language, and dub language. A new raw database ID on the next scrape does not by itself create another final screening when those fields match. Event links do not override the title key.

The complete snapshot replaces that cinema’s current final-screening set. The pipeline upserts resolved new screenings, then deletes existing screenings whose keys are absent from those resolved rows, including when another title in the snapshot is unresolved. For example, if old final rows are Dune, Barbie, and Spider-Man, and the latest complete scrape resolves Barbie and Spider-Man but cannot match Dune, the new Barbie and Spider-Man rows are published and the old Dune row is removed. The Dune raw row remains unmarked so a later run can search it again. A complete empty snapshot removes all old screenings. Failed, running, missing, or row-count-mismatched snapshots never authorize stale deletion. Existing date-based expiration cleanup remains separate.

## Schema access and deployment

The migration enables RLS and revokes direct table/function access from `public`, `anon`, and `authenticated`; the backend service role is the only granted writer and can call the claim/advance RPCs. PR3 has no per-cinema publication-ownership generations or checkpoint/snapshot cleanup RPC. Apply `20261015170000_pipeline_publication_checkpoints.sql` before deploying PR3 workers because the code reads and writes the new tables and raw `snapshot_id` columns. No checkpoint backfill is required: existing raw rows without manifests use the legacy path, and matching runs under the current policy when the pipeline next processes them.

## PR4 contract

PR4 should use the prepared publication and retention plans from PR3 and commit a category's coupled publication work in one database transaction. At minimum, the transaction must validate the current complete snapshot and input fingerprint; upsert the final screening and movie rows; maintain movie-code relationships; delete only the planned stale screening IDs; mark only eligible raw IDs; and set the publication checkpoint to `published`. A failure before commit must leave all those live-table changes and the publication marker unapplied. A lost response after commit must be reconciled by reading the durable snapshot checkpoint rather than duplicating or undoing work.

Atomic writes alone do not make multiple HTTP reads consistent. PR4 must also give supported application readers a revision-aware boundary (or equivalent protocol) and test a reader that straddles publication. It should preserve category-level independence and expected-skip success behavior. It should not add persisted provider freshness, another request cache, or a global run-across-categories transaction unless a separate measured requirement calls for them.

## PR3 verification and remaining limitation

Unit tests cover complete-empty versus failed/partial snapshots, failed-latest-attempt fencing, snapshot-isolated dedupe, replacement of old cinema screenings when rows are unresolved or intentionally skipped, title-based screening identity across fresh raw IDs, phase-aware retries after partial final-table writes, and fresh TMDb matching when a failed or unresolved snapshot is retried. The local environment has no PostgreSQL client/server or running Docker daemon, so the migration and RLS grants still require validation against an isolated database before production rollout. Fake Supabase tests exercise client-side behavior but do not prove PostgreSQL transaction, locking, or RLS semantics.
