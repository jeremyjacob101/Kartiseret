# PR 3 as built — Resumable publication checkpoints

Status: merged and deployed as [PR #169](https://github.com/jeremyjacob101/Kartiseret/pull/169), `[DATAFLOW PR 3] Resumable publication checkpoints`, on 20 October 2026. Read current main and `docs/pipeline-reliability-handoff.md` for the authoritative code-level contract. This file records the narrowed scope; do not add the removed features listed below.

## Included behavior

1. Each scrape attempt receives a UUID manifest with `running`, `complete`, or `failed` status and a row count. A confirmed empty listing can be complete only when the scraper supplies positive empty-result evidence. A newer failed/incomplete/mismatched attempt prevents an older snapshot from authorizing deletion.
2. Checkpoints are per category and source snapshot. They store the input fingerprint, unresolved flag, and last confirmed publication phase. They resume publication writes after a partial failure, but do not persist title-to-TMDb decisions.
3. A complete Now Playing or Cinematheques snapshot replaces that cinema’s previous final screening set using the existing title-based screening key. Resolved rows are published and old rows absent from those resolved rows are deleted even when another raw title is unresolved. The unresolved raw row remains unmarked and eligible for matching on a later normal run; its old final screening is not retained because of that uncertainty. Failed, running, missing, or count-mismatched snapshots cannot authorize deletion.
4. Existing TMDb matching, typo-tolerant search, title grouping, aliases, manual fixes/skips, movie codes, and expected-skip success behavior remain unchanged. A published checkpoint with unresolved work is eligible for matching again on a later normal invocation; PR 3 does not schedule that invocation.
5. Screening identity remains the established title-based key. Event links do not override it. A new raw UUID alone does not create a logically distinct screening when the existing key matches.

## Explicitly excluded

- Durable per-title match/skip decisions or a match-result cache.
- Whole-cinema or per-title retention because a title is unresolved.
- Event-link-first screening identity.
- Per-cinema ownership generations, stale-owner RPCs, checkpoint cleanup RPCs, or overlapping-run fencing. Existing run locking remains the coordination mechanism.
- Atomic multi-table publication or consistent application reads; PR 4 owns those.
- Any new “completed with skipped rows” status or skip-based failure policy.

## Completed rollout and verification

PR #169 merged as `fe56a890`; refreshed PR checks and [post-merge main CI](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39416830433) passed, including PostgreSQL 17 migration/schema/RLS checks and browser/API acceptance. The 86-test Python suite passed. The canonical migration is `20261020113605_pipeline_publication_checkpoints.sql`; it is applied to both hosted DEV and Production.

Thirteen additional isolated DEV cases used the real Supabase tables and checkpoint RPCs with deterministic provider fixtures. Normal publication, failed scrape/count-mismatch protection, partial movie-write recovery, unresolved replacement/retry, complete-empty replacement, and Coming Soon publication passed. The test fixtures and checkpoints were removed afterward.

Bounded live Coming Soon scrape/Clean/TMDb runs succeeded in DEV (`9100001`) and Production (`645`), each with 19 source rows, a published checkpoint, and a released run lock. Ratings and email stages were excluded. Production completion was reconciled from durable database state and the successful job marker after the caller connection was interrupted; it was not blindly replayed. Six public Production API checks returned HTTP 200 without an API error. This does not establish all-provider live coverage or atomic publication.

PR #174 subsequently merged API-only access policies and disabled automatic grants for future database objects. Both hosted histories were checked on 20 October through `20261020114942`; future work must preserve explicit worker grants, restricted API roles, and denied browser-table access. Do not rerun PR3's rollout as an implementation task.

## PR 4 handoff

Consume `PreparedPublication` and the current complete-snapshot replacement contract. Its `retained_screening_ids` identify existing screenings whose established title-based key is also present in the resolved new rows; that field does not mean unresolved-title protection. Unresolved groups remain diagnostic/retry evidence only. PR 4 should prepare the selected category's mapping/Update work privately and replace the multiple visible write phases with one atomic category commit and completion marker, while preserving the existing run lock and validating that the snapshot remains the latest source attempt, complete, and row-count matched.
