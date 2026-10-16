# PR 3 handoff — public data API, frontend transport, and social previews

## PR and base

- **Implementation branch:** `codex/backend-03-public-data-api`.
- **Base:** `codex/backend-02-api-prisma-foundation`, PR #167. PR 2 remains open; PR 3 is intentionally stacked on its Drizzle implementation.
- **Draft PR:** [#170](https://github.com/jeremyjacob101/Kartiseret/pull/170), head commit `81dbff1e6a9b1db87be5bdfbcc48bd212ba0dca7`, based on PR 2. It remains a draft with no reviewers requested. After PR 2 merges, retarget PR 3 to `main` and rerun checks.
- **DEV project:** Kartiseret - dev, ref `jbydpmjjptwevyijarzl`, PostgreSQL 17.11 in `eu-central-2`. Production was not changed.

## Implemented behavior

Five public read endpoints are served by Express and Drizzle. Success responses use `{ data, error: null }`; failures use `{ data: null, error: { code, message } }` with safe messages and status codes.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/catalog/now-playing` | Normalized now-playing DTOs plus permanent codes and settled `movieCodesStatus`. |
| `GET /api/v1/catalog/coming-soon` | Normalized coming-soon DTOs and the same batched code hydration contract. |
| `GET /api/v1/showtimes?city&startDate&endDate[&tmdbId]` | Inclusive bounded 1–180 calendar-day range; optional PostgreSQL integer movie ID; local dates/times stay timezone-free. |
| `GET /api/v1/theaters` | Cities and theaters from the actual relationship, including cities with no theaters; bad metadata/orphan joins are explicit failures. |
| `GET /api/v1/ticket-availability?tmdbId&fromDate` | Independent all-city availability candidates with validated English/Hebrew HTTP(S) URLs. |

## Contracts, query/cache ownership, and remaining Supabase calls

- Public wire schemas and request validation are in `packages/contracts/src/public-data.ts`; API repository/service logic is in `packages/server/src/public-data/` and `packages/server/src/catalog/drizzle-repository.ts`.
- Root `web:build` and `web:typecheck` build the server workspace first so the web's server-only OG modules resolve `@kartiseret/server` cleanly from a fresh checkout; they do not rely on ignored `dist` output left by a prior build.
- Catalog movie codes are included in one bounded batched query (chunks of 500), then indexed in the client. If that query fails, movie DTOs still load and the response marks codes `failed`; the browser has no silent fallback to `movieCodes`. For direct permanent-code lookup used by server previews, IDs remain decimal strings/BigInt-safe and now-playing wins if a code happens to resolve in both catalogs.
- `Codebase - Kartiseret Web/src/data/apiClient.ts` validates each same-origin response against the shared schema and forwards TanStack's `AbortSignal`. TanStack Query retains query-key dimensions, cache freshness, deduplication, cancellation, targeted prefetch, incremental 15-day loads, broad/targeted coverage distinction, scoped replacement, and stale-row removal. Initial city loading remains one day.
- OG data uses the Drizzle services directly from `Codebase - Kartiseret Web/server/og/previewData.ts`; Sharp/JPEG rendering and fonts stay in the web server-only tree. Stable `/api/og` and `/api/og-image` wrappers and short-code rewrites remain in `vercel.json`. Vercel `includeFiles` packages built contracts/server modules and OG assets.
- Remaining direct protected Supabase operations are intentionally assigned to PR 4: `userPreferences` reads/writes in the preference store; `admin_users` membership and `tableFixes`/movie/showtime admin edits in `adminStatus.ts` and `movieCatalog.ts`; and `ticket_alert_subscriptions` list/create/cancel calls in `ticketAlerts.ts`. Supabase Auth calls remain in the current login/account UI. Public catalog, showtime, theater, availability and OG reads no longer use browser Supabase table queries.

## Database and migration state

- `20261015162250_public_api_runtime_select.sql` grants `SELECT` to `kartiseret_runtime` on `finalSoons`, `finalShowtimes`, `cities`, and `theaters`. It was applied to DEV and appears in the provider migration ledger as version `20261015162250`.
- That migration also added four role-specific SELECT policies. The baseline already had equivalent `TO PUBLIC` read policies. Supabase's performance advisor flagged the duplicate permissive policies. With Jeremy's authorization to clean up the separate DEV project, those four duplicates were removed; existing baseline policies and restricted SELECT grants remain. Live privilege metadata still reports SELECT on all six intended public tables and no SELECT on `userPreferences` or `ticket_alert_subscriptions`.
- The idempotent cleanup is checked in as `20261016040826_remove_redundant_public_read_policies.sql` and replays after the grant migration. DEV reflects the cleanup, but the provider migration ledger currently does **not** contain version `20261016040826`: repeated Supabase `apply_migration` requests expired with `Invalid or expired requestState`. The migration SQL itself was applied successfully through Supabase `execute_sql`; the checked-in Supabase CLI migration generator could not be used because the CLI is not installed. The timestamped filename was generated from the UTC clock in Supabase's expected format. Reconcile this one ledger entry before the next provider-managed migration push; do not rerun the baseline. The clean CI replay is deterministic and applies both files in order.
- Supabase security advisors returned no lints. After cleanup, the performance advisor no longer reports duplicate SELECT policies on the four PR 3 tables. A pre-existing duplicate policy on `finalMovies` remains from PR 2; there are also informational unused-index notices. PR 3 changes no indexes.
- SQL privilege metadata is not the same as impersonating the runtime login. The Supabase SQL tool denied `SET ROLE kartiseret_api`, so actual role query success and private-table denials must be proven by the PR 3 PostgreSQL integration job using its restricted login. Do not claim that hosted queries executed as `kartiseret_api`.

## Verification and environment

- `npm run verify` passed locally on Node 24.21: lint, format, contracts/server/web/Playwright typechecks, 492 frontend tests, 41 server/API tests, server and web production builds, built OG HTML/JPEG/assets smoke, and eager bundle (**207.0 KiB gzip / 210 KiB budget**).
- `npx playwright test --config playwright.config.ts --list` passed and discovers four scenarios. It does not connect to a DB. The actual browser run is wired after PostgreSQL integration in `.github/workflows/full_checks.yml` as `npm run web:e2e`; it was not run locally because PostgreSQL 17 is unavailable here.
- The PostgreSQL 17 integration test now covers real restricted-role public reads/denials, code batching, range bounds, optional movie filter, local-time serialization, city/theater join, all-city availability, and >1,000 rows. These new integration cases await branch CI. PR 2's separate 10/10 integration pass in Full checks run #76 is predecessor evidence only.
- `npm run web:og:smoke` passes against built handlers from repository root, including SPA HTML fallback, generated 1200×630 JPEG, invalid remote backdrop fallback, fonts and Vercel packaging. The Fontconfig warning about the machine's default config did not fail generation.
- A synthetic one-row comparison measured 626 bytes and two catalog/code HTTP requests on the former browser path versus 608 bytes and one request on the combined catalog API path. This is a fixture-level comparison only; no latency measurement or general speed claim is made.
- Preview endpoints were not checked because the deployment is behind Vercel SSO in this environment. Before relying on Preview, confirm `DATABASE_URL` and remaining `VITE_SUPABASE_URL`/publishable key values are scoped to DEV. Then, from an authenticated owner browser, verify the five API routes, `/api/not-a-route` JSON 404, SPA `/`, a permanent-code short link, `/api/og`, and `/api/og-image?home=true` return expected JSON/HTML/JPEG types and DEV fixture data.

## Next steps

1. Confirm PR 3 GitHub CI is green, especially the PostgreSQL 17 migration replay and Playwright browser run.
2. Reconcile DEV migration version `20261016040826` in Supabase's provider ledger before future migration automation; DEV schema already has the intended final state.
3. Check Vercel Preview environment variables point the server database and still-direct Supabase browser client to DEV, then run the authenticated route checks above.
4. After PR 2 merges, retarget this PR from the PR 2 branch to `main`; wait for checks on the new base before deciding whether to merge.
5. PR 4 can move protected preference, subscription, and admin calls behind authenticated APIs. Preserve temporary Supabase Auth until PR 5.
