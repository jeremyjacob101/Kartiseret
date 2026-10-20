# Backend overhaul verification ledger

PRs 1–4 are merged and deployed. PR 4 (#171) merged as `4c4c02d8c3a1dc5a230b1e2f065a6d70acfb5144`; Production deployment `dpl_9zYJpnMNd12iqLdgDc2MD9R4xrkp` is Ready at [seret.site](https://seret.site). The PR4 database migration, protected-flow acceptance and browser privilege retirement are complete. Post-merge [Full checks #39378977517](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39378977517) passed all three jobs. Production release evidence and rollback guidance are in the [PR4 handoff](pr-4-handoff.md). Supabase Auth remains active until PR5.

| ID | Owner | Current status | Implementation and evidence |
| --- | --- | --- | --- |
| F01 | 1 | PRs 1–4 deployed; post-merge CI passes | PR2 Full checks [run #108](https://github.com/jeremyjacob101/Kartiseret/actions/runs/38893049794) passed. Current-head PR3 Full checks [run #121](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39260964261) passed, as did the Vercel Preview check. Preview deployment `dpl_5qGVCFRoZQ3wuBobvq1NAUXXhHEF` is Ready and its API/OG smoke returns DEV fixtures. PR4 Production release and current-main checks are recorded at the top of this ledger and in the PR4 handoff. |
| F02 | 1–5 | Local build and bundle pass | Contracts remain browser-safe; Drizzle, `pg`, Express, and DB secrets stay server-side. Refreshed web build passes with **206.6 KiB gzip eager JS (PR4 Node24 CI)** under the 210 KiB budget. |
| F03 | 3 | Local tests and refreshed PostgreSQL CI pass | Now-playing and coming-soon rows normalize ratings, artwork, trailers, alternatives, ordering, nullable genres, and pending enrichment. API/unit tests pass; current Full checks run #121 replayed the migration chain and passed the PostgreSQL suite. |
| F04 | 3 | Local behavior and refreshed restricted-role integration pass | Catalog responses batch permanent codes in chunks of 500. A code-query failure leaves movies usable and returns `movieCodesStatus: failed`; client code-index hydration has no Supabase fallback. Direct-code lookup keeps bigint IDs precise and prefers now-playing. |
| F05 | 3 | Local tests and refreshed PostgreSQL integration pass | `/api/v1/showtimes` validates ISO dates, inclusive 1–180-day ranges, city, and optional integer movie ID. SQL order is deterministic and date/time values remain timezone-free. Integration cases cover bounds, targeted IDs, local times, and more than 1,000 rows in run #121. |
| F06 | 3 | Cache tests and refreshed Playwright run pass | TanStack Query retains broad/targeted coverage, one-day initial city loading, incremental 15-day prefetch, cancellation, deduplication, scoped replacement, and stale-row removal. Targeted fetches do not claim broad-window readiness. |
| F07 | 3 | Local mapper/API tests and refreshed PostgreSQL join check pass | Theater data uses the actual city relation, preserves aliases/neighbors/coordinates/zoom, includes cities with no theaters, and reports invalid metadata or orphan joins instead of manufacturing map data. |
| F08 | 1, 3 | Shared date tests pass | Existing Jerusalem cutoff/grace/carryover/DST tests still use shared cinema-day helpers. OG preview evaluation uses a request time or injected test time, not a module-level frozen clock. |
| F09 | 1, 3 | Codec/navigation tests and refreshed browser run pass | Short/encoded route, filter mask, and 62-day link helpers remain shared. Code resolution is case-sensitive and deterministic. Playwright direct/encoded-link scenarios passed in run #121. |
| F10 | 3 | Built OG HTML smoke and rebuilt authenticated Preview pass | OG HTML handlers use public Drizzle services directly and preserve escaped metadata, expiry/filter behavior, unknown-link fallback, SPA document, and asset handling. The rebuilt Preview serves movie-specific short-link and home OG HTML with the DEV Supabase origin in the SPA bundle. |
| F11 | 3 | Built JPEG/assets smoke and rebuilt authenticated Preview image pass | Sharp generates 1200×630 JPEGs with bounded image fetch and safe fallback. Local smoke and rebuilt Preview verified fonts/assets and JPEG output. |
| F12 | 3 | Four E2E scenarios executed and passed in refreshed CI | Playwright covers catalog/search/detail, city/date/filter browsing, incremental ranges, encoded links on mobile, and JSON API 404. All four scenarios passed against CI's disposable PostgreSQL 17 service in run #121. |
| F13 | 1, 4, 5 | PR4 local/CI/hosted regression pass | Guest/theme bootstrap, cache and cross-tab behavior retain their existing frontend owner; no browser application-table calls remain. |
| F19 | 3, 4 | Public regressions pass; server write precheck added | Valid all-city link/expiry behavior remains; subscribe checks authoritative current availability on the server before inserting. |
| F25 | 2, 4, 5 | Baseline preserved; PR4 PostgreSQL17 replay passes | The SQL baseline retains all 18 tables, keys/checks/RLS/grants/indexes/Realtime. PR 2's final Drizzle integration compared table/column types, nullability, defaults, and keys to PostgreSQL 17. Python behavior remains on `main`; PR 2 Full checks passed. |
| F26 | 2–5 | PR4 migration applied in DEV and Production; browser grants retired in both | Runtime has only the required private feature grants with owner/admin RLS; it cannot write admin membership or delivery state or read delivery errors. Browser grants are retired and Python service-role and Realtime compatibility are verified. Production release evidence is in the PR4 handoff. |
| F27 | 2–5 | PR4 migration/retirement replay passes | New migration 20261019152448 is aligned with DEV ledger. Browser privilege retirement is a separate versioned post-deployment SQL operation rehearsed in CI/DEV, preserving safe deploy order. |
| F28 | 2–5 | PR4 local and target-version CI pass | 495 web tests, 64 API tests, typechecks/builds and OG smoke pass. Full checks #134 passes Node24, 26 PostgreSQL17 tests, 6 Chromium scenarios and 64 Python tests; eager bundle 206.6 KiB in CI. Hosted DEV private/browser/Realtime acceptance passes. |
| F29 | 2 | Drizzle boundary verified in PR 2 and retained | No Prisma runtime or client is used. Drizzle + existing `pg` remain the TypeScript DB boundary; SQL remains the migration authority. |
| F30 | 2–5 | PR 2 mapping gate and current PR 3 migration/semantic suite pass | PR 2's PostgreSQL 17 integration passed 10/10 in Full checks run #108. Current-head PR 3 run #121 passed its public grants/policy replay, restricted-role tests, API integration, and browser suite. |
| F14 | 4, 5 | PostgreSQL/hosted initialization pass | Server-owned idempotent preference initialization and field PATCH; signup marker preserves established choices and applies new-account location once. |
| F15 | 4, 5 | Local/CI behavioral tests and hosted rollback pass | Optimistic rollback, rapid-save coalescing and latest-intent tests pass on the new API transport; stale-account request results are discarded and private caches cleared. |
| F16 | 4, 5 | API/adapter, restricted SQL and real Auth acceptance pass | Real Supabase /user verification adapter, strict input schemas, no-store private responses, SQL ownership predicates and RLS; server admin membership. |
| F17 | 4 | PostgreSQL branches/rollback and hosted Realtime pass | Both merge and new-target correction branches are Drizzle transactions; required date preserved, UUID-specific coming-soon writes, ambiguous IDs rejected, late SQL rollback tested in integration suite. |
| F18 | 4 | Existing invalidation tests pass | Now-playing corrections reset showtimes and invalidate catalog/availability; coming-soon invalidates its catalog; subscription lists remain outside generic admin invalidation. |
| F20 | 4 | API/cache, PostgreSQL and hosted browser pass | Own-account list/create/cancel, precise bigint IDs, duplicate-safe insert preserving sent/delivery state, no write retries and cancellation failure behavior. |

## PR 3 local verification details

- `npm ci --no-audit`: passed, 417 packages installed. This worktree used Node 26.10.0 while repository packages target Node 24.x; npm emitted engine warnings. CI on Node 24 is the target-version gate.
- `npm run verify`: passed after the dispatcher smoke correction. It includes 492 frontend tests and 46 API tests. It does not include the PostgreSQL integration or browser server run.
- `npm run web:og:smoke`: passed against built SPA/OG handlers, real 1200×630 JPEG generation, font/assets, and the unified dispatcher packaging/rewrite contract.
- Eager bundle: 206.8 KiB gzip / 210 KiB budget. Vite still reports a large asynchronous map chunk; the enforced eager budget passes.
- Docker CLI is installed, but the local Docker daemon socket is missing. No local PostgreSQL CLI/service is available, so PR 3 database integration and Playwright execution are delegated to refreshed GitHub CI.
- One fixture-only comparison measured 626 bytes/two catalog-code requests on the old browser path versus 608 bytes/one catalog request on the new path. No latency benchmark or general performance claim is made.
- Earlier PR 3 Full checks run #94 passed on the old stacked head and is historical only. Current Full checks run #121 and the authenticated Preview smoke described above are the current implementation evidence; this is historical PR3 evidence; PR3 is now merged/deployed.

## PR 2 evidence carried forward

- PR 2 merged successfully as commit `c10cd50f2b98992edbaeb9f49b903fe827b81d94`; final head `1b70a5baa9a81c7f6ef27c9224d40ab57b28bf85` was mergeable and its latest Full checks run #108 passed, including PostgreSQL 17 integration and the Preview deployment check.
- PR 2 added the Root 2021 Supabase CA to Preview configuration while preserving strict TLS verification. Production was intentionally not configured because the PR 2 frontend did not switch public reads to Express.
- The merge into PR 3 retains PR 2's single `api/dispatch.ts` Vercel function and package boundaries. The outdated PR 3 packaging smoke was updated to enforce this current-main route design.

## PR 4 evidence

See the [PR 4 handoff](pr-4-handoff.md) for commit/run/deployment identities, hosted browser QA, provider dependencies, cleanup and emergency rollback guidance. PR4 Production migration, deployment and browser-permission retirement are complete; no PR4 release operation remains.
