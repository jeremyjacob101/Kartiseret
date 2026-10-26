# Pipeline reliability: current state and remaining work

Updated 20 October 2026 against `main` at `b06df691` (including backend PRs #167 and #170–#173, dataflow PR #169, and access-control PR #174). This is the index for the dataflow superplan. Refresh main and inspect subsequent changes before implementing either remaining PR; the commit above is an audit baseline, not a branch to pin future work to.

## Current sequence

| Step | Status | Actual scope |
| --- | --- | --- |
| PR 1 — [#166](https://github.com/jeremyjacob101/Kartiseret/pull/166) | Merged | Preserve explicit zero Rotten Tomatoes scores/counts. Existing matching and normalization rules remain. |
| PR 2 — [#168](https://github.com/jeremyjacob101/Kartiseret/pull/168) | Merged | One enforceable process-group deadline for a selected whole run or realtime solo Update; bounded shutdown and best-effort run-lock finalization. |
| PR 3 — [#169](https://github.com/jeremyjacob101/Kartiseret/pull/169) | Merged, deployed, verified | Record scrape completeness and resume publication phases. No durable title-match cache. A complete snapshot replaces old cinema screenings even when some titles remain unresolved. |
| PR 4 — [implementation prompt](04-atomic-publication.md) | Next; not implemented | Prepare the selected category's related changes privately and publish them together; coordinate API reads and frontend caches so users cannot see a partial category update. |
| PR 5 — [implementation prompt](05-provider-freshness.md) | After PR 4; not implemented | Persist provider freshness and failure provenance with the values they describe through PR 4's publication mechanism. |

Files [01](01-identity-and-parsing.md), [02](02-deadlines-and-retries.md), and [03](03-checkpoints-and-retention.md) are historical implementation records. Do not send them as new implementation tasks or restore removed features. [The code-level handoff](../pipeline-reliability-handoff.md) describes the current PR3 contract. This dataflow PR numbering is separate from the completed backend overhaul's own PR1–PR5 numbering.

## PR3 rollout is complete

PR #169 merged as `fe56a890`, after refreshed PR CI passed on `335ecac4`; [post-merge main CI](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39416830433) also passed. The checks included Python tests, web verification, disposable PostgreSQL 17 schema/RLS/migration tests, and browser/API acceptance.

Migration `20261020113605_pipeline_publication_checkpoints.sql` was applied to hosted DEV first, then Production. Thirteen additional DEV cases exercised actual Supabase tables/RPCs with deterministic provider fixtures; all isolated fixtures/checkpoints were removed. Bounded live Lev Cinema Coming Soon scrape → Clean → TMDb runs succeeded in DEV (`9100001`) and Production (`645`): each completed a 19-row snapshot, published its checkpoint, and released its run lock. Ratings and email stages were excluded from these live checks. Production's six public API checks returned HTTP 200 with no API error. This evidence does not claim an all-provider/all-category live run or atomic publication, which remains PR4's work.

Subsequent PR #174 is also merged. A read-only migration-history check on 20 October confirms both hosted environments include `20261020112925_api_only_catalog_access`, PR3's `20261020113605`, and `20261020114942_disable_default_data_api_exposure`. The earlier DEV-only catalog-policy migration is now part of main's shared history. Do not repeat PR3's migration or replay the earlier rollout's temporary DEV migration-directory workaround. Reinspect both histories before any future rollout; never repair or reset history merely to bypass a discrepancy.

## Current architecture the remaining PRs must preserve

- The browser reads and writes application data through the same-origin Express API. Shared request/response contracts live in `packages/contracts`; repositories, services, routes, and Drizzle mappings live in `packages/server`. Open Graph reads run server-side and must participate in consistent publication reads too. Do not restore direct browser Supabase reads to implement revisions.
- `kartiseret_api` inherits the restricted `kartiseret_runtime` permissions. Protected workflows use verified Better Auth identity, transaction-local authorization, and the existing restricted database roles. Keep the backend's origin, account-isolation, admin, and private-response contracts intact; publication metadata is not an authorization token.
- Python ingestion/maintenance continues through the service-role Supabase client. Realtime remains in use for existing solo-update behavior. New bookkeeping must not create update loops.
- Admin correction in `packages/server/src/protected/service.ts` takes sorted `pg_advisory_xact_lock(tmdb_id)` locks for source/destination IDs. Publication must use that exact lock key space/order for overlapping IDs and revalidate prepared evidence so a correction made during network preparation cannot be overwritten. Locking after stale preparation alone is insufficient.
- Ticket-alert recipient lookup stays behind `POST /api/internal/ticket-alert-recipients` with its separate internal secret and verified Better Auth recipient checks. Deliver only after committed publication, using the existing delivery/provider idempotency keys. Do not return to direct auth-table reads from Python.
- PR #174 removes browser roles' application-table access and disables automatic `postgres`-owned public table/sequence/function grants, including future service-role defaults. Every new table/sequence/RPC must explicitly grant the exact worker/API rights it needs. Service-role RLS bypass does not replace object privileges. Keep staging/checkpoint/provider diagnostics private; grant runtime reads only for the minimal revision/read boundary actually required.
- Reuse the existing Drizzle/SQL migration chain and PostgreSQL 17 CI bootstrap. If physical application-table columns change, keep their Drizzle mappings aligned. Account for intentional internal tables explicitly in integration tests without exposing them through `applicationTables` just to satisfy a table-count assertion.

## What “batched publication” means in PR4

The default publication unit is one selected category: Now Playing, Coming Soon, or Cinematheques. Prepare all ready changes for that category's selected stages and affected cinemas privately, then commit its related live rows, safe deletions, movie-code relationships, revision, raw flags, and completion state together. In a normal run that selects mapping and Update, do not publish the mapper's intermediate rows and then visibly drip-feed Update changes. Optional unavailable ratings retain the existing policy and do not block valid screenings.

Example: Now Playing has newly prepared movies and screenings for several cinemas. Users continue seeing the prior coherent Now Playing state while the category is prepared. One commit makes its ready changes visible together; a failure before commit leaves its old publication intact. A failed cinema scrape cannot authorize deletion of that cinema's old rows. Ready categories can publish independently: this plan does not require one global all-category/all-run transaction. Coming Soon also keeps its existing rule that an empty scrape does not delete final Coming Soon movies.

Update-only runs prepare and publish the selected category's patch without requiring unselected scrape/mapping work. A realtime solo Update has its existing selected-row scope; its values, bookkeeping, and revision change must still commit consistently. Normal Update retention and solo clearing/reset rules remain unchanged.

Atomic writes and consistent application reads are separate requirements. Catalog, showtime range/pagination, previews, movie-code lookups, and ticket availability must not silently mix incompatible revisions across requests or cached results. Define the revision scope and cache behavior explicitly, including responses served from HTTP/CDN caches. Retain independent category publication and the current UX.

## Decisions that remain in force

- Expected skips, ambiguous titles, and unavailable optional listings remain ordinary successful behavior. Add no “completed with skips” state, warning exit code, skip threshold, or routine user-facing warning banner.
- Preserve existing TMDb search/candidate selection and typo tolerance, ASCII title normalization, grouping, aliases, manual fixes/skips, permanent movie codes, selected-stage execution, and notification idempotency. PR #166 introduced no strict RT/TMDb title/link verification or Unicode normalization policy.
- Preserve full-snapshot replacement for complete Now Playing/Cinematheque input. Unresolved raw rows stay retryable but do not protect old final screenings. Failed/incomplete/count-mismatched source attempts cannot justify stale deletion. Event links do not become screening identity.
- Do not reintroduce durable title-match decisions, whole-cinema/per-title unresolved protection, per-cinema ownership generations, stale-owner RPCs, overlapping-run fencing, or a new retry scheduler. The existing run lock remains the whole-run coordination model. Stable commit identity/fingerprint and lost-response reconciliation are still necessary.
- Keep PR #168's whole-process deadline and bounded cleanup. Do not assume killing a client cancels an already executing database commit. Do not add provider-level budgets or new retry ownership as incidental work in PR4/5.
- Create draft implementation PRs. Do not merge, request review, or assign any reviewer, including Shaun-Regenbaum, without Jeremy's explicit authorization. New implementation work uses isolated fixtures/database verification; hosted migrations, production jobs, deployment, and real messages need separate authorization. Earlier authorization for the completed PR3 rollout is not blanket authorization for future rollouts.

## Efficiency is already covered

PR #164 provides the run-owned `DataflowRequestContext`, shared successful TMDb responses, in-flight sharing, cross-category Update prefetch, the existing five-worker Update row pool, and union IMDb projection for participating ratings flows in a shared Update round. Reuse these paths. No additional efficiency PR, cache, scheduler, or union-prefetch framework is planned. Independent-process duplicate work and provider behavior remain limitations; further optimization needs profiling evidence. PR5 is provider freshness/provenance, not a replacement efficiency project.

## How to resume

1. Read this index and the current code-level handoff, then use the complete [PR4 prompt](04-atomic-publication.md). Start from the latest main, inspect commits since this plan's audit baseline, and inventory reader/writer boundaries before editing. Stop after a thoroughly verified draft PR and updated handoff; do not auto-deploy or start PR5.
2. After PR4 is reviewed, merged, and its required schema/contracts are available, use the complete [PR5 prompt](05-provider-freshness.md) from a fresh main branch. Reinspect PR4's actual final scope, including any user-requested removals, rather than assuming every proposed detail shipped.
3. Planning continues in this chat. No documentation branch, PR, merge, or deployment is needed to update the plan. Start an implementation branch only when Jeremy asks to implement the next PR; use the latest main at that time.

When implementation is requested in this chat, use:

> Read `docs/pipeline-reliability-plan/README.md`, `docs/pipeline-reliability-plan/04-atomic-publication.md`, and `docs/pipeline-reliability-handoff.md`. Implement the full PR4 prompt on a new branch from current main, preserving all accepted scope exclusions and the current Express/Drizzle/Better Auth/API-only access architecture. Create a verified draft PR and update the handoff. Do not merge, deploy, apply hosted migrations, request/assign reviewers, send real messages, or start PR5.

## Combined verification target

Across PR4 and PR5 cover multiple cinemas/categories; aliases/remakes/expected skips; zero RT values; unresolved replacement; complete-empty versus failed snapshots; deadline termination and uncertain writes; transaction rollback/resume and lost-response reconciliation; cached/API reads straddling a publication; admin correction during preparation; normal/solo Update semantics; provider failure retaining prior values and last-success provenance; stable codes; and fake alerts only after commit. PostgreSQL integration must replay the complete current migration chain including PR #174, test explicit grants after defaults are revoked, and exercise genuine transactions/role restrictions. Do not add overlapping-whole-run or ownership-generation tests.
