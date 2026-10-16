# PR 3 handoff — public data API, frontend transport, and social previews

## PR and base

- **PR:** [#170](https://github.com/jeremyjacob101/Kartiseret/pull/170), kept as a draft and targeting `main` after PR 2 merged.
- **PR 2:** [#167](https://github.com/jeremyjacob101/Kartiseret/pull/167) merged into `main` as `c10cd50f2b98992edbaeb9f49b903fe827b81d94`.
- **Implementation branch:** `codex/backend-03-public-data-api`; refreshed from the merged `main` with a normal merge, so the update does not require a force-push.
- **Refreshed branch commit:** `cdc60d39c46eb9faedabbf24a4fcfe4020e7cf65`, whose second parent is PR 2's main merge commit. PR #170's base is now `main` at that merge commit.
- **No reviewers were requested.** PR 3 has not been merged.
- **Scope:** move public movie, showtime, theater, ticket-availability, and Open Graph reads to Express + Drizzle. Preferences, ticket-alert subscriptions, admin checks/edits, and Supabase Auth remain in their current client paths for later PRs.

## Public API contract

Successful responses use `{ data, error: null }`; errors use `{ data: null, error: { code, message } }` with safe messages and appropriate HTTP statuses.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/catalog/now-playing` | Normalized now-playing movies, permanent codes, and settled `movieCodesStatus`. |
| `GET /api/v1/catalog/coming-soon` | Normalized coming-soon movies and the same batched code hydration contract. |
| `GET /api/v1/showtimes?city&startDate&endDate[&tmdbId]` | Inclusive 1–180-day date window, optional integer movie filter, deterministic order, timezone-free local date/time values. |
| `GET /api/v1/theaters` | Cities and theaters through the actual relationship; includes cities with no theaters and reports invalid metadata/orphan joins safely. |
| `GET /api/v1/ticket-availability?tmdbId&fromDate` | Independent all-city availability candidates with validated English/Hebrew HTTP(S) URLs. |

Movie codes are fetched in bounded batches (500 IDs per query), then indexed in the client. A failed code lookup leaves the catalog usable and returns `movieCodesStatus: "failed"`; there is no browser fallback to `movieCodes`. Direct code lookup uses precision-safe IDs and prefers now-playing deterministically. Shared Zod schemas validate requests and responses; the fetch boundary passes through `AbortSignal`.

## Client/cache and remaining Supabase calls

- TanStack Query retains its broad-versus-targeted readiness distinction, one-day initial city load, 15-day incremental prefetch, deduplication, cancellation, targeted prefetch, scoped replacement, and stale-row removal. A targeted movie query never marks the full date window as loaded.
- Public catalog, showtime, theater, availability, and OG table reads no longer use browser Supabase queries.
- Direct protected Supabase operations remain intentionally for PR 4: `userPreferences` reads/writes, `ticket_alert_subscriptions` list/create/cancel, `admin_users` membership, and admin `tableFixes`/movie/showtime operations. Supabase Auth remains with the current login/account UI.

## Open Graph and Vercel routing

- OG preview data calls the same Drizzle services directly; it does not make a second HTTP request to the deployment. Sharp, image processing, fonts, and other server-only dependencies remain out of browser/shared packages.
- PR 2's `api/dispatch.ts` is the single Vercel function for API and OG requests. Keep its `includeFiles` glob and rewrite order: API and short-code paths reach the dispatcher before the SPA fallback. The public `/api/og`, `/api/og-image`, and short-link URLs stay stable; unknown API paths return JSON 404s.
- Merging PR 2 exposed an outdated PR 3 OG smoke assertion that expected separate `api/og.ts` and `api/og-image.ts` functions. The smoke now verifies the unified dispatcher, SPA/server build files, OG assets, API rewrite, and short-code rewrite. This is a routing/configuration alignment; no second dispatcher or duplicate handler was added.

## SQL and hosted project state

- SQL remains the sole DDL/migration authority. `20261015162250_public_api_runtime_select.sql` grants the restricted runtime group `SELECT` on `finalSoons`, `finalShowtimes`, `cities`, and `theaters`. `20261016040826_remove_redundant_public_read_policies.sql` removes the four duplicate runtime policies while keeping the explicit table grants and existing public policies.
- Read-only Supabase checks on 2026-10-16 confirm DEV **Kartiseret - dev** (`jbydpmjjptwevyijarzl`) is `ACTIVE_HEALTHY`, PostgreSQL 17.11. Its provider ledger has baseline `20261015141043` and public-read grant `20261015162250`; it does **not** yet list cleanup migration `20261016040826`. The cleanup SQL was already applied to DEV through the previously authorized SQL path and is idempotent. Reconcile its ledger entry before the next provider-managed migration push; do not replay the baseline.
- DEV remains separate from Production. Preview acceptance found that DEV contained only the Tel Aviv public showtime fixture although the checked-in seed also defines Jerusalem. A read-only query confirmed the missing row; the exact fictional Jerusalem fixture (`id` ending `9007`, movie `9100001`) was inserted into DEV with `ON CONFLICT (id) DO NOTHING`. No schema, migration ledger, real scraped rows, or Production data was changed.
- Vercel's shared `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` originally targeted all three environments. An initial CLI update unexpectedly changed the shared URL; it was immediately restored to the Production URL. Separate Preview-scoped overrides now target DEV for both values. Effective Preview and Production URL scopes were verified using temporary environment pulls that were deleted without displaying credentials. No Production deployment was triggered. The current Preview deployment predates these overrides, so a new Preview build must confirm its bundled Supabase origin is DEV.
- Production **KartiseretNew** (`gsdrcyrduxbrxgsvhxvr`) is `ACTIVE_HEALTHY`, PostgreSQL 17.6.1. Read-only checks show an empty Supabase migration ledger and no `kartiseret_runtime` or `kartiseret_api` role. PR 2's current PR description also reports no Vercel Production `DATABASE_URL` or `DATABASE_SSL_CA_CERT`; recheck these variables before cutover.
- **Production setup is a required PR 3 merge gate.** PR 3 switches the shipped frontend's public reads to Express. If Production still lacks its restricted DB login, public API catalog requests will fail after deployment. Before merging PR 3, verify the existing Production schema against the baseline without executing the baseline; provision the restricted `kartiseret_runtime` group and `kartiseret_api` login with only required public `SELECT` rights; record the existing baseline as applied only after schema verification; apply the forward PR 3 migrations in order; and configure Vercel Production `DATABASE_URL` (Production transaction pooler + restricted role) and verified `DATABASE_SSL_CA_CERT`. Never use DEV or the admin/migration URL for Production runtime.
- The Production baseline was not recorded by the read-only check, so a blind `supabase db push` could try to execute the create-table baseline against the existing Production schema. Verify first; do not run or repair the baseline history until its schema is confirmed. No Production credentials, schema, policies, rows, or Vercel settings were changed during this work.

## Verification

- `npm ci --no-audit` passed and installed 417 packages. The worktree uses Node 26.10.0 while packages and CI target Node 24.x, so npm emitted engine warnings; GitHub Actions on Node 24 remains the authoritative target-version check. The existing `fsevents` install-script allowlist notice also appeared.
- `npm run verify` passed after the dispatcher smoke update: lint, formatting, contract/server/web/E2E typechecks, **492 web tests**, **46 server/API tests**, server and web builds, OG HTML/JPEG/assets smoke, API dispatcher typecheck, and eager bundle (**206.8 KiB gzip / 210 KiB budget**). The Vite large asynchronous chunk advisory remains informational; the enforced eager bundle budget passes.
- The first local full run hit sandbox `EPERM` when Supertest opened a loopback listener. The same full suite passed when rerun with loopback permitted; this was an environment permission issue, not a test assertion failure.
- Local PostgreSQL-backed integration and Playwright browser execution were not run: the Docker CLI is present but its daemon socket is unavailable, and there is no local PostgreSQL CLI. GitHub Full checks provisions disposable PostgreSQL 17 and runs the restricted-role integration suite followed by four Playwright scenarios; a fresh run on the updated PR head is required before merge.
- The earlier PR 3 Full checks run #94 passed on the old stacked head; it is historical evidence only. Refreshed Full checks [run #111](https://github.com/jeremyjacob101/Kartiseret/actions/runs/38897282909) passed on `cdc60d39`: web verify, Python tests, PostgreSQL 17 bootstrap/integration, Chromium install, and all four Playwright scenarios.
- Earlier fixture-only comparison observed 626 JSON bytes and two catalog/code requests on the old browser path versus 608 bytes and one catalog API request on the new path. This is a synthetic one-row comparison, not a latency or general performance claim.
- Authenticated Vercel CLI smoke ran on Preview deployment `dpl_FDFe8JdGBhZyX2WEKnHfy4rGrkBK` (`cdc60d39`, Ready; alias `kartiseret-git-codex-backend-03-pub-48069a-jeremyjacob-projects.vercel.app`). Health returned 200 JSON; now-playing and coming-soon returned DEV fixtures with `movieCodesStatus: ready`; showtimes returned Tel Aviv and Jerusalem fixtures; theaters returned both DEV cities; ticket availability returned the DEV Tel Aviv fixture; unknown API returned the JSON 404 envelope; `/` returned the SPA; `/D01` returned movie-specific OG HTML; `/api/og` returned HTML; and `/api/og-image?home=1` produced a **1200×630 JPEG**. The first showtime call hit a short-lived cached empty response from before the fixture insert; a cache-bypassed retry returned the fixture as expected.
- The deployment smoke above predates the newly scoped Supabase Preview overrides. A new Preview build is still required to confirm the bundle now points at DEV instead of the Production Supabase origin. Do not use the older Preview deployment for login/private-flow checks.

## Owner steps before merging PR 3

1. Wait for the new Preview deployment triggered after the scoped environment correction. Verify its HTML bundles `https://jbydpmjjptwevyijarzl.supabase.co`, then repeat the API, SPA, short-link, OG HTML, and JPEG smoke checks while signed into Vercel. Confirm Preview's database URL and browser Supabase variables target DEV.
2. Prepare Production separately: verify schema compatibility with the checked-in baseline; create the restricted runtime group/login and its initial catalog/code rights because Production has not recorded the baseline migration; record baseline history only after that comparison; apply the forward public-read migrations; add Production-only `DATABASE_URL` and `DATABASE_SSL_CA_CERT`; and test the Production DB connection before the frontend cutover. Do not copy any DEV/admin credential into Production.
3. Reconcile DEV cleanup migration `20261016040826` in the provider migration history before the next provider-managed migration push. Use the Supabase CLI's migration-history repair workflow only after confirming the cleanup is already applied; never rerun the baseline against DEV.
4. Once the refreshed CI and Preview checks pass and Production is prepared, mark PR #170 ready and merge it. No reviewers have been requested.
5. PR 4 can then move preferences, ticket-alert subscriptions, and admin operations behind authenticated APIs. Preserve temporary Supabase Auth until PR 5.
