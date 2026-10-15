# PR 2 handoff — Express, Prisma, baseline, and PostgreSQL foundation

## Scope and base

- **Base:** current `main` after PR 1 and PR 164, commit `93eee8db7061b287d01ad6293fe2f34b2933b327`.
- **Implementation branch:** `codex/backend-02-api-prisma-foundation`.
- **Scope:** server/workspace foundation, current-schema mapping and clean-project baseline, one public now-playing read endpoint, Vercel/Vite adapters, fixtures, CI PostgreSQL integration, and hosted-dev bootstrap materials. Browser data transport, authentication, preferences, subscriptions, admin operations, and production schema changes remain out of scope. Hosted-dev provisioning is part of the plan but awaits Jeremy's organization choice and cost confirmation.

The latest main updates after PR 1 are PR 164's `backend/config/runners.py` and scheduler tests, plus run-artifact records. PR 2 does not edit those Python paths or change worker behavior. Its SQL baseline describes the same physical worker tables but is explicitly for a new empty project and has not been applied to the existing database. After rebasing, `python3 -m compileall -q backend` and all 53 Python unit tests passed under Python 3.14.2, including the updated scheduler tests; the existing Python test step remains in the full-check workflow.

## Current schema inventory and migration authority

The active project was read-only inspected on 2026-10-15: **KartiseretNew**, project ref `gsdrcyrduxbrxgsvhxvr`, PostgreSQL 17, Europe Central 2. The public site bundle points to that project. No production DDL or rows were changed.

The baseline at `supabase/migrations/20261015122907_current_app_schema_baseline.sql` captures all 18 application tables, their observed columns/defaults/nullability, primary/unique/foreign/check constraints, 21 standalone indexes, table comments, current application-role grants, 33 observed RLS policies, and the `finalMovies`/`finalSoons` membership in Supabase Realtime. RLS is enabled on all 18 tables; `tableFixes` also forces RLS. There were no public triggers, public routines, or app sequences. Provider-owned `auth`, `realtime`, extensions and their publications are prerequisites/managed objects, not recreated by the baseline.

The six earlier ticket-alert SQL files had no corresponding Supabase migration-ledger entries on the active project, and the live table already had the final account-only shape. They are preserved with checksums in `supabase/legacy-migrations/` and are excluded from the active migration path; replaying that historical guest/RPC sequence before the current-state baseline would not bootstrap the observed schema. The SQL baseline is the only schema-creation authority for a **new, empty project**. Future DDL is timestamped Supabase SQL. Prisma only maps/query-generates; there is no Prisma migration history or `migrate` script.

**Do not apply this baseline to KartiseretNew or another database that already has these tables.** The current hosted project's schema migration tracking must be reconciled deliberately before any future hosted SQL migration. Use a separate empty development project for first bootstrap.

The baseline adds a `NOLOGIN` group role named `kartiseret_runtime`, with SELECT on only `finalMovies` and `movieCodes` and two matching read policies. Create a separate `kartiseret_api` login/password in the target provider and grant it membership in that group. Never use the migration/admin login as `DATABASE_URL`.

## Dependency audit adjustments

The registry audit initially reported six high findings. The lockfile now resolves patched versions: `sharp` 0.35.5, `source-map-js` 1.2.2, `deepmerge-ts` 8.0.2, and `mysql2` 3.24.6. The two Prisma transitive overrides are scoped to the Prisma CLI/config dependency paths; Prisma remains pinned at 7.10.0. A final full `npm audit` reported zero vulnerabilities, and a clean Node 24 `npm ci --no-audit` succeeded.

## Prisma mappings and known limits

`packages/server/prisma/schema.prisma` maps all 18 tables with physical names preserved, including:

- `finalSoons.id` as UUID PK while `tmdb_id` remains non-unique.
- `theaters.location` as the PK and ticket-alert subscriptions as the real composite `(user_id, tmdb_id)` key.
- Integer versus bigint, smallint, real/double, Decimal, UUID, JSONB, arrays, date, time, timestamptz, and the Jerusalem wall-time `utilRunLogs.date_created` as observed.
- Provider-owned `auth.users` relations remain SQL foreign keys; Prisma uses scalar-only models because the provider schema is not owned here.

Prisma does not express PostgreSQL check constraints, partial indexes, RLS policies, or nullable scalar-list columns. Those remain in SQL. In particular, `finalMovies.genres` is physically nullable; Prisma exposes its scalar list as required and the API mapper explicitly normalizes SQL NULL to an empty list. Query code does not use Prisma schema migration diffs.

## Server, routes, and response

- Workspace: `@kartiseret/server`; shared contracts build first.
- Local API: `npm run server:dev` (Node 24, `PORT` defaults to 3000). Start the frontend in a second terminal with `npm run dev`.
- Compiled startup: `npm run build`, then `npm run server:start`.
- Express composition: `createApp({ catalogRepository })` does not listen, read env, or connect to a database. Production composition creates a pooled Prisma/PostgreSQL adapter only when explicitly requested.
- Vercel catch-all: `api/[...path].ts`; fixed `api/og.ts` and `api/og-image.ts` remain configured. Existing SPA output and rewrites remain in place. Vite proxies `/api` only when `VITE_API_PROXY_TARGET` is set.
- `GET /api/v1/health` returns a liveness response without querying the database.
- `GET /api/v1/catalog/now-playing` returns `{ data: { mode: "nowPlaying", movies: Movie[] }, error: null }`. It filters pending `solo_update` rows, looks up movie codes in bounded chunks, preserves the existing title/rating/genre/alternative normalization, and returns a successful empty list for a valid empty catalog. Unknown API routes, bad queries, database failures, and malformed catalog data have distinct safe JSON error codes.
- This endpoint does not change any frontend caller; that transport cutover belongs to PR 3.

## Environment and connections

Only variable names are committed. See the root `.env.example`.

- `DATABASE_URL`: runtime login, inherited from `kartiseret_runtime`; for Preview and optional local Node use the separate DEV project's Supavisor transaction-mode URL (port 6543), and keep `DATABASE_POOL_MAX` conservative (default 5). Production requires its own runtime login.
- `MIGRATION_DATABASE_URL`: separate Supabase direct/session-admin connection for intentional SQL migration operations only. Never used during app build or runtime.
- `TEST_DATABASE_URL`: admin credential for the disposable CI database, or an optional separately provisioned local test database. The bootstrap requires loopback plus the exact database name `kartiseret_test`; it never falls back to `DATABASE_URL`.
- `PORT`, `NODE_ENV`, `DATABASE_POOL_MAX`, `SITE_ORIGIN`: server config.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: documented for the transitional auth stage; PR 2's Express API does not consume them.
- `VITE_API_PROXY_TARGET`: optional local frontend-to-API proxy.
- Future stages may add `BETTER_AUTH_SECRET` and `RESEND_API_KEY`; neither is read by this PR.

Prisma generation uses an unreachable placeholder URL and never connects. Builds do not require a database. Do not configure Vercel Production/Preview with the admin URL. Before a Preview endpoint is exercised, create the separate dev project, bootstrap its clean schema, create the runtime login, and scope its variables to Preview. Before a later production-consuming release, provision the corresponding production runtime login and reconcile the existing project's migration ledger; no such operation was performed here.

## Disposable database and test commands

Fast checks do not need PostgreSQL:

- `npm ci`
- `npm run verify` — contracts, frontend and server lint/format/typecheck/unit tests, Prisma generation/build, SPA build, and eager bundle budget.

The real integration job is separate and required in GitHub Actions. It uses `postgres:17`, test-only `auth.users`/`auth.uid()` and Supabase-role compatibility objects, the app baseline, and fictional deterministic fixtures.

CI runs the required disposable PostgreSQL 17 integration job automatically. If a separate, disposable local PostgreSQL 17 database is already available, create an empty database named `kartiseret_test`, then run:

```sh
npm run db:test:up
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/kartiseret_test?schema=public'
export DATABASE_URL='postgresql://kartiseret_api:local-test-only@127.0.0.1:5432/kartiseret_test?schema=public'
npm run api:test:integration
```

The bootstrap refuses a non-empty public schema. Integration tests exercise the real runtime role, catalog DTO, nullable array, BigInt/Decimal/date/time mappings, a database check constraint, and transaction rollback. They never use a remote URL. The fictional, stable development seed includes cities/theaters, movie/showtime, coming-soon/cinematheque, and worker utility fixtures. It does not create fake Supabase Auth accounts or invoke the Python scraper. Docker setup on Jeremy's Mac is intentionally not required.

## Verification evidence and limits

- Under Node 24.21.0, clean `npm ci --no-audit`, Prisma 7.10 generation/validation, `npm run verify`, `npm audit`, legacy SQL-file checksum verification, and `git diff --check` passed. `npm run verify` covered root lint/format, contracts/server/web typechecks, 488 web tests, 16 API tests, server and web builds, and the eager bundle check (207.3 KiB gzip under the 210 KiB budget). `npm audit` reported zero vulnerabilities after the scoped lockfile fixes described above. See `verification.md` for feature-level evidence.
- GitHub Actions passed the web, Python backend, and disposable PostgreSQL 17 integration jobs. The first PostgreSQL run caught an incorrect test fixture (`'bad'` satisfies the three-character movie-code check); the test now uses `'bad!'`, and the rerun passed the clean baseline replay, fixtures, Prisma queries, runtime-role denial, SQL check, and transaction rollback.
- Vercel rejected the first catch-all config because `functions.*.includeFiles` must be one glob string. `vercel.json` now uses `packages/**/dist/**`, following [Vercel's `vercel.json` reference](https://vercel.com/docs/project-configuration/vercel-json). The corrected Preview deployment completed successfully, and GitHub reports the Vercel status as success. This verifies build/deploy only; the API still needs its Preview `DATABASE_URL` pointed at a separate dev project before endpoint requests can succeed. The Vercel dashboard is login-gated for this task, so detailed deployment logs are not available here.
- A hosted development project and Vercel Preview variables were not created or configured. The Supabase project-creation flow requires Jeremy to choose the organization and confirm the quoted cost. The current production project remained read-only.
- No production schema/data, Vercel environment variables, existing user/auth flows, Python worker behavior, or frontend transport were changed.

## Next steps for the project owner

1. Review draft PR 167. The latest web, Python backend, disposable PostgreSQL 17, and Vercel deployment checks passed; GitHub reports the branch mergeable. No reviewer has been requested.
2. To finish the planned hosted-dev setup, choose the Supabase organization. I can then fetch the project cost and ask you to confirm that exact amount before creating a distinct dev project. After creation, apply the baseline once to that empty project, create the runtime login, and configure only Preview variables.
3. Do not merge a production `DATABASE_URL` into Vercel until a dedicated production API login exists and the current production project's migration ledger approach has been agreed.
4. PR 3 can switch public frontend reads only after the API is verified against the separate dev project's data.
