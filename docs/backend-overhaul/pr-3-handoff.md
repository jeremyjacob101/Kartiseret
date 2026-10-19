# PR 3 handoff — public data API, frontend transport, and social previews

## PR and base

- **PR:** [#170](https://github.com/jeremyjacob101/Kartiseret/pull/170), kept as a draft and targeting `main` after PR 2 merged.
- **PR 2:** [#167](https://github.com/jeremyjacob101/Kartiseret/pull/167) merged into `main` as `c10cd50f2b98992edbaeb9f49b903fe827b81d94`.
- **Implementation branch:** `codex/backend-03-public-data-api`; refreshed from the merged `main` with a normal merge, so the update does not require a force-push.
- **Refreshed implementation commit:** `cdc60d39c46eb9faedabbf24a4fcfe4020e7cf65`, whose second parent is PR 2's main merge commit. Follow-up commits record verification and environment corrections. PR #170's base is `main` at PR 2's merge commit.
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
- DEV **Kartiseret - dev** (`jbydpmjjptwevyijarzl`) is `ACTIVE_HEALTHY`, PostgreSQL 17.11. Its provider ledger now contains baseline `20261015141043`, public-read grant `20261015162250`, and cleanup `20261016040826`. The cleanup SQL and its effects were verified before the missing ledger entry was recorded on 2026-10-19; the baseline and cleanup SQL were not replayed. DEV retains the fictional Tel Aviv and Jerusalem showtime fixtures (`9100001`, on 2026-10-29 and 2026-10-30 at verification time).
- Production **KartiseretNew** (`gsdrcyrduxbrxgsvhxvr`) is `ACTIVE_HEALTHY`, PostgreSQL 17.6.1. Its existing 18-table application schema was compared with the checked-in baseline before the baseline was recorded as applied; the baseline DDL was not run. The Production ledger now contains `20261015141043`, `20261015162250`, and `20261016040826`. The cleanup migration's SQL had already been run and its effects were verified before its missing ledger record was repaired on 2026-10-19; no schema SQL was rerun.
- Read-only role checks on both projects confirm `kartiseret_runtime` is a non-login, non-admin group and `kartiseret_api` is a login member without superuser, create-database, create-role, replication, or `BYPASSRLS` privileges. The API role can `SELECT` the six public API tables and cannot write to them or read the private account/admin tables. The four duplicate runtime policies are absent in both projects.
- Vercel's Production `SUPABASE_URL` was pulled to a temporary file and confirmed as `https://gsdrcyrduxbrxgsvhxvr.supabase.co`. `DATABASE_URL` and `DATABASE_SSL_CA_CERT` are present as Secret values in Production only. Vercel does not reveal these secret values through `env pull`, so the configured Production host, username, and password cannot be independently inspected from the CLI. A read-only request to the existing Production `/api/v1/health` returned `{"data":{"status":"ok"},"error":null}`; this validates runtime configuration parsing, not a database connection.
- Vercel Preview has Preview-only Supabase URL/key and database URL/CA values for DEV. The effective Preview URL is `https://jbydpmjjptwevyijarzl.supabase.co`; the Production URL remains Production. The DEV Postgres CA is the Supabase Root 2021 certificate; its SHA-256 fingerprint matches the certificate Jeremy provided. The DEV database connection uses the restricted read-only role. Shared Production/Development Supabase values remain scoped to Production and Development.
- The fresh Preview redeployment `dpl_CnZFNpUtX3Gn2TVa4VGmqpXULx4m` is Ready at `https://kartiseret-fqg2mmmwk-jeremyjacob-projects.vercel.app` with PR alias `https://kartiseret-git-codex-backend-03-pub-48069a-jeremyjacob-projects.vercel.app`. Vercel CLI smoke returned DEV fixtures from both catalogs, both city showtime queries, theaters, and availability; health and JSON 404 responses were correct. The app shell contains only the DEV Supabase origin, and the home OG image is a 1200×630 JPEG.
- No Production deployment was triggered during this verification. Production migration history was reconciled only after schema and SQL effects were verified. The current Production `main` deployment already has PR 2's now-playing API route, but it returns HTTP 503. Vercel runtime logs show PostgreSQL SQLSTATE `28P01` (`invalid_password`) for that request. This is a pre-merge Production credential blocker. The coming-soon and theaters routes return 404 because PR 3 is not deployed to Production yet.

## Verification

- `npm ci --no-audit` passed and installed 417 packages. The worktree uses Node 26.10.0 while packages and CI target Node 24.x, so npm emitted engine warnings; GitHub Actions on Node 24 remains the authoritative target-version check. The existing `fsevents` install-script allowlist notice also appeared.
- `npm run verify` passed after the dispatcher smoke update: lint, formatting, contract/server/web/E2E typechecks, **492 web tests**, **46 server/API tests**, server and web builds, OG HTML/JPEG/assets smoke, API dispatcher typecheck, and eager bundle (**206.8 KiB gzip / 210 KiB budget**). The Vite large asynchronous chunk advisory remains informational; the enforced eager bundle budget passes.
- The first local full run hit sandbox `EPERM` when Supertest opened a loopback listener. The same full suite passed when rerun with loopback permitted; this was an environment permission issue, not a test assertion failure.
- Local PostgreSQL-backed integration and Playwright browser execution were not run: the Docker CLI is present but its daemon socket is unavailable, and there is no local PostgreSQL CLI. GitHub Full checks provisions disposable PostgreSQL 17 and runs the restricted-role integration suite followed by four Playwright scenarios. Full checks [run #115](https://github.com/jeremyjacob101/Kartiseret/actions/runs/38898980823) passed on implementation commit `51bef17727d4bbbfd79b921c2d299341b2a0277d`. This handoff has since received documentation-only updates; check the PR's current status for the resulting revision.
- Earlier fixture-only comparison observed 626 JSON bytes and two catalog/code requests on the old browser path versus 608 bytes and one catalog API request on the new path. This is a synthetic one-row comparison, not a latency or general performance claim.
- After adding the Preview-only DEV database URL and Root 2021 CA, redeployment `dpl_CnZFNpUtX3Gn2TVa4VGmqpXULx4m` became Ready. Its app shell contains only the DEV Supabase origin. Authenticated Vercel CLI requests passed health, both catalogs with ready movie-code hydration, both city showtime fixtures, theaters, ticket availability, JSON API 404, and the 1200×630 home OG image. Preview database secrets are scoped only to Preview; Production remains separate.
- A showtime request immediately after inserting the missing fictional fixture briefly returned a cached pre-insert response; a cache-bypassed retry returned the inserted row. No persistent query or API issue was found. Do not use pre-override deployment `dpl_FDFe8JdGBhZyX2WEKnHfy4rGrkBK` for login/private-flow checks.

- Production `/api/v1/health` returns HTTP 200, but that route does not query Postgres. On the current `main` deployment, `/api/v1/catalog/now-playing` returns HTTP 503; its Vercel runtime log records SQLSTATE `28P01` (`invalid_password`). The Production `DATABASE_URL` secret exists but its write-only value cannot be inspected through Vercel CLI. Reconcile the Production `kartiseret_api` password with that URL and confirm now-playing succeeds before merging PR 3. The coming-soon and theaters routes return 404 until PR 3 is deployed.

## Owner steps before merging PR 3

1. PR #170's code, disposable-Postgres CI, hosted role grants/migrations, and DEV Preview checks pass. It remains a draft; no reviewers have been requested.
2. **Before merging, fix Production database authentication.** The current `main` now-playing API returns 503 and Vercel logs report SQLSTATE `28P01` (`invalid_password`). Keep `DATABASE_SSL_CA_CERT` unchanged; the connection reached Postgres and failed at authentication. Create a new Production-only password and use it consistently:

   ```bash
   openssl rand -hex 24
   ```

   In the Production Supabase SQL Editor, set that generated password on `kartiseret_api`:

   ```sql
   ALTER ROLE kartiseret_api WITH PASSWORD '<paste the generated password here>';
   ```

   Then update Vercel's Production-only `DATABASE_URL` with the same password, the Production pooler host copied from that project's Connect dialog, and the custom-role username. Use the interactive CLI prompt so the password does not appear in shell history:

   ```text
   postgresql://kartiseret_api.gsdrcyrduxbrxgsvhxvr:<password>@<production-transaction-pooler-host>:6543/postgres
   ```

   ```bash
   npx vercel@latest env update DATABASE_URL production --project kartiseret --scope jeremyjacob-projects
   ```

   Save the variable for **Production only**, then redeploy the current Production deployment so it loads the new value:

   Find the current deployment URL, then redeploy that URL to Production (the URL verified during this check was `https://kartiseret-p1k8iiwet-jeremyjacob-projects.vercel.app`):

   ```bash
   npx vercel@latest inspect https://seret.site --scope jeremyjacob-projects
   npx vercel@latest redeploy <current-production-deployment-url> --target=production --scope jeremyjacob-projects
   ```

   Confirm `curl -fsS https://seret.site/api/v1/catalog/now-playing` returns a successful response with `"error":null` before merging PR 3. Do not share the password in chat; delete any saved SQL Editor query containing it.
3. After PR 3 is merged and its Production deployment becomes Ready, verify the additional database-backed routes:

   ```bash
   npx vercel@latest curl /api/v1/health --deployment https://seret.site
   npx vercel@latest curl /api/v1/catalog/now-playing --deployment https://seret.site
   npx vercel@latest curl /api/v1/catalog/coming-soon --deployment https://seret.site
   npx vercel@latest curl /api/v1/theaters --deployment https://seret.site
   ```

   The catalog and theater routes must return `{ data: ..., error: null }`. If a database-backed request fails, inspect Production function logs and recheck the write-only `DATABASE_URL` against the Production pooler and role credentials before considering PR 3 complete.
4. PR 4 can then move preferences, ticket-alert subscriptions, and admin operations behind authenticated APIs. Preserve temporary Supabase Auth until PR 5.
