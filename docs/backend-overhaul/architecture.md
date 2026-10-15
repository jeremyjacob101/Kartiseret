# Backend overhaul architecture decisions

## PR 1: workspace and contract boundaries

- The repository root owns the npm workspaces and the only npm lockfile. Workspaces are `packages/contracts`, `packages/server`, and the existing `Codebase - Kartiseret Web` folder. Python, Supabase SQL, and Vercel API paths remain in place.
- `@kartiseret/contracts` emits ESM and TypeScript declarations into ignored `dist/` output. Its explicit exports are `runtime`, `movies`, `showtime-day`, `showtime-filters`, `showtime-links`, and `preferences`; there is no browser-wide barrel.
- Shared contracts use Zod and pure helpers only. They have no browser globals, provider clients, server dependencies, UI state, or secrets.
- Root scripts build contracts before server and frontend consumers. Vercel builds the SPA, Express API adapter, and fixed Open Graph handlers from the root lockfile.

## PR 2: Express, SQL baseline, and Drizzle

- `@kartiseret/server` owns the side-effect-free Express app, server-only environment parsing, normalized catalog mapping, database composition, and API tests. `createApp` receives a repository and never opens a socket or reads environment variables.
- The server uses stable `drizzle-orm` with `drizzle-orm/node-postgres` and the existing `pg` driver. Its explicit `pg.Pool` has a configurable maximum (default 1 for the Vercel serverless runtime), finite connection and idle timeouts, remote TLS verification, and an idempotent `close()` lifecycle. A warm Vercel instance reuses its pool.
- `src/db/schema.ts` maps all 18 public application tables, preserving physical names, column types, nullability, defaults and keys. It is a query mapping only. Provider-owned `auth.users` foreign keys, RLS, grants, checks, indexes, publication membership, and all DDL remain owned by Supabase SQL.
- Timestamped SQL under `supabase/migrations/` is the only schema/migration authority. The current-state baseline bootstraps a new empty project once; it is never replayed against existing DEV or production. Drizzle Kit is not part of install/build/start and is not used to apply DDL.
- The runtime role inherits read access only to `finalMovies` and `movieCodes` for this first API slice. Migration/admin access stays separate. The Express endpoint uses that restricted identity; `createApp` unit tests inject repositories without a database.
- Express exposes `GET /api/v1/health` and `GET /api/v1/catalog/now-playing` as the first stable API slice. It preserves pending-row exclusion, `popularity DESC NULLS LAST`, numeric movie-ID tie ordering, bounded movie-code reads, DTO normalization and safe JSON errors. Public browser reads and existing Open Graph handlers remain unchanged until PR 3.
- `api/[...path].ts` is the thin Vercel Express adapter. `vercel.json` keeps the SPA output and fixed OG endpoints. Vite's `/api` proxy is optional through `VITE_API_PROXY_TARGET`.
- Ordinary `npm run verify` remains database-free. GitHub Actions runs the guarded, disposable PostgreSQL 17 bootstrap and Drizzle integration suite separately. The bootstrap accepts only local `kartiseret_test`; it never falls back to a hosted URL.

## Schema inventory and native type conventions

`applicationTables` in `packages/server/src/db/schema.ts` accounts for all 18 physical tables. `date` values are strings, `time without time zone` values are local clock strings, `timestamptz` values are instants, and `utilRunLogs.date_created` remains a timezone-free Jerusalem wall-clock string. The pool overrides only PostgreSQL timestamp-without-time-zone parsing to keep that wall clock as text. PostgreSQL `bigint` values use JavaScript `bigint`; `numeric` ratings remain exact decimal strings under node-postgres. Nullable arrays stay nullable, including `finalMovies.genres`.

The mapping does not invent an auth schema. SQL-owned `auth.users` references are documented at their app columns and continue to exist in the SQL baseline. The actual `theaters.city_name → cities.name` relationship and the subscription composite primary key are represented. SQL-only policies, checks, partial indexes and Realtime membership are intentionally not recreated in Drizzle.

## Hosted development and migration lineage

- Hosted DEV is **Kartiseret - dev**, Supabase project ref `jbydpmjjptwevyijarzl`, PostgreSQL 17.11, `eu-central-2`. Production remains separate and was not modified.
- DEV records baseline migration version `20261015141043` with provider display name `20261015122907_current_app_schema_baseline`. The checked-in baseline filename and disposable bootstrap use the applied version. This provider version/name difference is documented; no baseline reapplication is needed.
- Fictional seed rows are used for DEV and disposable CI only. CI never resets hosted DEV or production.
- Vercel Preview uses only the restricted DEV runtime `DATABASE_URL`; migration/admin credentials do not belong in app runtime or browser configuration. Jeremy configured the Preview variable privately; no credential value is checked in or logged.
- Remote PostgreSQL connections require verified TLS. The transaction pooler connection and custom shared-pooler username come from Supabase's Connect dialog. The Drizzle node-postgres path does not attach named, session-bound prepared statements; integration against the actual Preview runtime remains a deployment acceptance check.

## Lockfile and dependency scope

The root lockfile is the only npm lock. PR 2 retains the original `pg` dependency and adds stable `drizzle-orm` without an additional driver, schema migration runner, generator, or auth package. Prisma runtime/CLI packages, generated client output, scripts, URL options, install allowances, and dependency-only overrides are removed. Existing `source-map-js`, `sharp`, and `esbuild` resolutions are retained.
