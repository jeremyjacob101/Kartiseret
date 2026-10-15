# PR 2 handoff — Express, Drizzle, baseline, and PostgreSQL foundation

## Scope and current PR

- **PR:** [#167](https://github.com/jeremyjacob101/Kartiseret/pull/167), kept as a draft; PR title is updated to describe Express, Drizzle, and PostgreSQL.
- **Implementation branch:** `codex/backend-02-api-prisma-foundation` (kept for continuity even though the old branch name mentions Prisma).
- **Base:** `main`, including PR 1 and the current main update through `3a10e0fc07559e718f5e45c1b1779bda7759abdc`. The PR 2 branch now contains that main commit through a normal merge, preserving PR 2's intermediate history without force-pushing.
- **Scope:** Express/server foundation, the SQL-only baseline and fictional fixtures, hosted DEV bootstrap, PostgreSQL 17 CI, one public catalog read, Vercel/Vite adapters, and the final Prisma-to-Drizzle conversion. Public browser transport, authentication, preferences, subscriptions, admin operations, production DDL, and the later PR stages remain out of scope.
- **Final source commit:** recorded in the final CI/Preview update below after the Drizzle branch is pushed.

PR 2 does not change Python scraper behavior. Main's Rotten Tomatoes score/count preservation and current run artifacts are retained; no Python product files were changed for this PR. After merging current `main`, `python3 -m compileall -q backend` and `python3 -m unittest discover -s backend/tests -v` passed locally (55 tests); the same compile/unit checks remain in full CI.

## SQL schema and migration history

The only schema authority is timestamped SQL under `supabase/migrations/`. The current-state bootstrap is `supabase/migrations/20261015141043_current_app_schema_baseline.sql`. It captures the 18 public application tables, observed defaults/nullability, keys/FKs/checks, indexes, comments, grants, RLS and Realtime membership. Six earlier ticket-alert SQL files remain checksum-preserved in `supabase/legacy-migrations/` because they were not recorded in the source project's migration ledger and do not represent the current deployed table state.

DEV **Kartiseret - dev** (`jbydpmjjptwevyijarzl`) reports migration version `20261015141043` with provider display name `20261015122907_current_app_schema_baseline`. This exact version/name pair was confirmed from Supabase's migration list. The checked-in file and disposable bootstrap use the recorded version; the provider's earlier display name is retained as a documented historical label. Renaming the local baseline to the applied version changed no SQL: the old and current file SHA-256 are both `f57e751fb9b28f83da192d5a6422a3c32e3c3df21cad604934e5af197f1ab56f`. The baseline has already been applied to DEV. Do not reapply it there or in production. Do not replay the legacy files before it on a clean bootstrap.

Fresh disposable PostgreSQL 17 setup is:

1. Start an empty local `kartiseret_test` database on loopback.
2. Set `TEST_DATABASE_URL` to its admin URL and `DATABASE_URL` to its test-only restricted runtime login.
3. Run `npm run api:test:integration`. The guard checks loopback, exact database name and PostgreSQL 17; bootstrap refuses any existing public base table, installs test-only Supabase compatibility roles/auth objects, applies the baseline once and seeds the fictional fixtures.

There is no `db:test:up` script and PR 2 does not require Docker on Jeremy's Mac. CI provisions an ephemeral PostgreSQL 17 service. Neither the CI bootstrap nor Preview tests reset hosted DEV or production. Future application DDL is authored as forward Supabase SQL migrations and replayed in order by the guarded disposable CI bootstrap; Drizzle Kit is not a migration runner.

## Drizzle mapping, driver, and lifecycle

- Stable versions: `drizzle-orm` **0.45.4** and existing `pg` **8.16.3** (`@types/pg` remains a development dependency). No Drizzle Kit, alternate driver, Prisma package, client generator, auth adapter, or competing migration ledger is installed.
- All 18 tables are mapped in `packages/server/src/db/schema.ts` and inventoried as `applicationTables`. The integration suite checks every physical table and column against PostgreSQL for SQL type, nullability, default presence, and primary key. It also checks the actual city/theater FK, provider-owned `auth.users` FK inventory, `movieCodes.movie_code` uniqueness, and that `finalSoons.tmdb_id` is not unique.
- `finalMovies.genres` and `finalSoons.genres` remain nullable arrays. `date` columns use strings, `time without time zone` uses local clock text, `timestamptz` uses instants, and `utilRunLogs.date_created` uses timezone-free Jerusalem wall-time text. PostgreSQL `bigint` uses JS `bigint`; `numeric` ratings remain exact strings. SQL still owns provider auth FKs, RLS, grants, checks, partial indexes, defaults, comments and publication membership.
- `packages/server/src/db/client.ts` exports `ApplicationDatabase`, `ApplicationTransaction`, and `createDatabase()`. One bounded `pg.Pool` (default maximum 1, configurable up to the validated limit), finite connection/idle timeouts and verified TLS for remote URLs are composed once per runtime. Loopback test/local URLs use no TLS. A pool-scoped `pg.TypeOverrides` keeps PostgreSQL OID 1114 (`timestamp without time zone`) as text so node-postgres cannot reinterpret the Jerusalem wall clock through the process timezone. The pool emits sanitized error metadata only, creates no socket until first query, and has idempotent `close()`. Vercel's warm module reuses its pool; local process and tests close it on teardown.
- Supabase's shared transaction-pooler connection is used for serverless runtime. The Drizzle node-postgres session uses ordinary unnamed parameterized queries; there are no named/session-bound prepared statements or session-persistent `SET` dependencies. Migration/admin connections remain separate.
- `DrizzleCatalogRepository` is behind the neutral `CatalogRepository` interface. It filters pending rows, uses explicit `popularity DESC NULLS LAST` plus numeric `tmdb_id ASC`, batches movie-code reads in chunks of 500, converts decimal IDs to `bigint`, and performs a relation probe for empty code lists so missing-schema failures are not reported as a healthy empty catalog.
- `createApp` remains importable without reading config or creating a database connection. `createProductionApp` creates the pool explicitly and returns its close lifecycle.

## API and hosting boundary

- `GET /api/v1/health` remains a database-free liveness response.
- `GET /api/v1/catalog/now-playing` keeps `{ data: { mode: "nowPlaying", movies: Movie[] }, error: null }`, existing DTO normalization, pending-row exclusion, null-genre normalization, bounded code lookup, cache headers, and safe database/data-integrity responses.
- A behavior check during conversion found that the service's second JavaScript sort could undo PostgreSQL `NULLS LAST` after nullable popularity was normalized to `0`. The service now sorts raw rows with nulls last and numeric movie-ID ties; unit and PostgreSQL integration tests cover `0` versus `NULL` and IDs such as `2` versus `10`.
- Unknown API routes remain JSON 404s. The existing SPA routing and fixed `/api/og` and `/api/og-image` functions stay separate. The frontend does not switch away from its existing Supabase transport until PR 3.
- Vite's local `/api` proxy remains opt-in. Builds do not connect to a DB or generate client code.

## Environment and provider status

- Hosted DEV is **Kartiseret - dev**, project ref `jbydpmjjptwevyijarzl`, in `eu-central-2`, PostgreSQL 17.11, and currently `ACTIVE_HEALTHY`. Read-only SQL confirmed 18 public tables and that `kartiseret_api` inherits `kartiseret_runtime`, can SELECT `finalMovies` and `movieCodes`, and cannot SELECT `userPreferences`. It has the baseline, fictional seed and restricted login membership from the earlier PR 2 setup. The user privately set the role password and configured Vercel Preview `DATABASE_URL`; no secret value is stored in the repository, handoff, or logs.
- Vercel Preview `DATABASE_URL` must be the DEV transaction-pooler URL with `kartiseret_api.jbydpmjjptwevyijarzl`. Production must use a separately provisioned restricted runtime login if/when API consumers are deployed there. `MIGRATION_DATABASE_URL` is admin-only and must not be present in Vercel app runtime or browser variables.
- PR 2 does not change production credentials, schema, rows, auth settings or frontend configuration. Before a later production-consuming rollout, provision the production API role, set its Production runtime URL, and reconcile production's migration ledger without replaying the clean-project baseline.
- Before PR 3 Preview acceptance, audit all remaining frontend/Supabase/auth variables and ensure they target DEV; PR 2 still leaves existing browser auth/data transport untouched.

## Verification evidence

### Final Drizzle implementation

- Node **24.21.0** clean `npm ci --no-audit` passed (414 packages installed). The `package-lock.json` SHA-256 remained `38144c36200c072336c605f6378aa28bc00d0524f94c7dde1daa162e7f0732af` before and after the install. npm emitted only its existing optional `fsevents@2.3.3` install-script allowlist notice.
- Post-install `npm run verify` passed: lint, formatting, contract/server/web typechecks, **488 web tests**, **19 API tests**, server and web production builds, and the eager bundle check (**207.5 KiB gzip / 210 KiB budget**). An initial sandboxed invocation could not bind Supertest's loopback listener (`EPERM`); the same command passed when rerun with loopback permitted. Vite still emits its existing large lazy-chunk advisory; the enforced eager gzip budget passes.
- Targeted database-free Drizzle tests passed (**4 files, 10 tests**), including pool TLS/limits/close behavior, environment defaults, movie mapping and null-popularity ordering. `npm run server:typecheck` and `npm run format:check` passed.
- `npm audit --audit-level=moderate` passed with **0 vulnerabilities**. `npm ls --all --parseable` found no installed Prisma package. Drizzle's lockfile metadata lists Prisma and other database adapters only as optional peers; none are installed or imported. The active source/config/script search found no Prisma client, generation hook, Prisma URL option or P-code references. Historical plan/handoff text remains labeled as such.
- After merging current `main`, `python3 -m compileall -q backend` and `python3 -m unittest discover -s backend/tests -v` passed; all **55 Python tests** passed, including the Rotten Tomatoes score/count preservation tests.
- The six-file legacy migration SHA-256 manifest passes. The source branch has been merged with current `origin/main` commit `3a10e0fc07559e718f5e45c1b1779bda7759abdc`; the merge brings the independent Rotten Tomatoes update and its run artifacts. No Python behavior was changed by PR 2. Re-run staged `git diff --check` immediately before committing.
- `npm run api:test:integration` was not run locally: this machine has no running local PostgreSQL 17 service/Docker daemon, and the command requires a disposable local `kartiseret_test`. The mandatory CI PostgreSQL 17 job remains the evidence gate for all real schema, permission, native-type, SQL constraint, transaction rollback and driver-error cases. Record its run URL/result against the final pushed source commit below.
- Vercel Preview: Jeremy privately configured the runtime URL. Record the Preview URL/source commit and actual API route/fixture, unknown API, SPA and OG assertions after a Preview build for the final Drizzle commit. A build status alone is not runtime proof. Production remains untouched.

### Final pushed commit and external verification

- Final source commit: pending commit and push.
- GitHub PostgreSQL 17/API/Python workflow: pending final-commit CI.
- Vercel Preview runtime assertions: pending final-commit deployment.
- Legacy checksum and whitespace checks: pending immediately before commit.

### Historical Prisma-only evidence

The earlier PR 2 Prisma state passed its original PostgreSQL 17 CI integration job and Vercel build; it did not verify the Drizzle code. Earlier clean installs, API/database tests and bundle measurements are historical comparisons only. They must not be reported as evidence for the final Drizzle commit.

## Required final searches and ledger

Before handoff, search the active package graph, server source, scripts, CI, config, and env examples for `prisma`, `@prisma`, generated-client imports, generation hooks, `?schema=public`, Prisma-only URL options, Prisma Decimal APIs and P-codes. Historical plan and predecessor handoff discussion is allowed when labeled. Recheck F01/F02 and record F25–F30 in `verification.md`, with F26 Preview and F28/F29/F30 CI/DB evidence separated from local checks.

## Next PR readiness and owner steps

1. Review this draft PR after the final CI and Preview acceptance checks complete. Merge is Jeremy's action; this branch remains open and no review was requested.
2. No new hosted migration or local database setup is needed to merge PR 2: the ORM conversion changes no DDL and DEV already has the recorded baseline. The disposable PostgreSQL CI job replays it on a fresh test database.
3. After merging PR 2, start PR 3 from updated `main`. Verify that `DrizzleCatalogRepository`, `ApplicationDatabase`, `applicationTables`, and this handoff exist; do not repeat the ORM conversion. PR 3 must add explicit SQL grants/policies for additional public reads and verify them against restricted DEV credentials.
4. Keep production API variables/credentials separate. Before a later API-consuming production release, provision a restricted production login and set Production `DATABASE_URL`; do not reuse DEV or the admin migration URL.

The revised controlling plan is checked in at `docs/backend-overhaul-master-plan-drizzle.md`. It supersedes earlier Prisma instructions for all remaining PRs.
