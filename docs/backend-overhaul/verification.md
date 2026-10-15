# Backend overhaul verification ledger

PR 1 evidence remains valid for the workspace/shared contracts. PR 2's final gate is the Drizzle implementation in the current draft PR #167. Earlier Prisma integration results are historical and do not verify Drizzle. Production and hosted DEV are never CI reset targets.

| ID | Owner | Current status | Implementation and evidence |
| --- | --- | --- | --- |
| F01 | 1 | Local gate passed; external gates pending | Node 24.21 clean `npm ci --no-audit` installed 414 packages and left lock SHA-256 unchanged (`38144c36200c072336c605f6378aa28bc00d0524f94c7dde1daa162e7f0732af`). Root `npm run verify` passes after the clean install. Final-commit CI and Vercel Preview remain pending. |
| F02 | 1–5 | Local build and bundle passed | Shared contracts remain browser-safe; Drizzle, `pg`, Express and secrets stay in the server workspace. Final web build passes; eager client bundle is 207.5 KiB gzip under the 210 KiB budget. |
| F08 | 1, 3 | Shared module verified; server clock deferred | Existing fixed-clock cinema-day/cutoff/grace/carryover/time-zone tests use `@kartiseret/contracts/showtime-day`. PR 2 does not introduce a request-scoped clock. |
| F09 | 1, 3 | Shared module verified | Existing short/encoded-link codec, filter mask and 62-day interpretation use `@kartiseret/contracts/showtime-links`. PR 2 does not change routes. |
| F13 | 1, 4, 5 | Shared values verified; persistence deferred | Preference constants, schemas and pure normalizers are in shared contracts. Storage, theme, sync and server persistence remain with their later owners. |
| F25 | 2, 4, 5 | SQL snapshot retained; Drizzle/PG17 gate pending | Current-state SQL baseline is unchanged by the ORM conversion and retains all raw/final/cinematheque/worker tables, keys/checks/RLS/grants/indexes/Realtime. The Drizzle integration suite compares the full 18-table/column type/null/default/key inventory to disposable PostgreSQL 17. Python app code is unchanged in PR 2; the latest `main` Rotten Tomatoes changes and run artifacts were merged unchanged, and local `compileall` plus all 55 Python tests pass. Retain the full Python CI compile/unit job. |
| F26 | 2–5 | Hosted DEV and privileges verified; Preview runtime needs owner session | DEV is Kartiseret - dev (`jbydpmjjptwevyijarzl`), separate from production, `ACTIVE_HEALTHY`, PostgreSQL 17.11, with 18 public tables. Its migration ledger records version `20261015141043`, provider name `20261015122907_current_app_schema_baseline`; the checked-in baseline/bootstrap use the applied version. Read-only SQL confirms `kartiseret_api` inherits `kartiseret_runtime`, can SELECT `finalMovies` and `movieCodes`, and cannot SELECT `userPreferences`. Jeremy privately configured the runtime password and Vercel Preview `DATABASE_URL`; no secret is recorded. The Preview build reports Ready, but direct route checks redirect to Vercel SSO (HTTP 302); Jeremy must verify the catalog, JSON 404, SPA and OG routes from an authenticated browser on the final deployment. |
| F27 | 2–5 | Single SQL authority; final disposable replay pending | The clean-project baseline is the only bootstrap; six unrecorded old ticket-alert scripts remain checksummed in `legacy-migrations/`. Drizzle definitions do not migrate. The guarded PostgreSQL 17 CI bootstrap applies the recorded-version baseline once to a fresh disposable database and seeds fictional rows. There is no forward DDL migration in PR 2. |
| F28 | 2–5 | Local API tests pass; Drizzle real-DB/CI evidence pending | Root verify passes all 19 API tests with loopback permitted. The integration suite covers restricted runtime success/denial, DTO and null genres, all-table mappings, bigint/numeric/date/time semantics, SQL checks, transaction rollback, safe driver failures and readiness behavior. This machine has no local PostgreSQL 17/Docker service; no local PG pass is claimed. Required GitHub PostgreSQL 17 job must pass on the final commit. |
| F29 | 2 | Local implementation/build gates passed; final CI pending | Installed package graph contains no Prisma packages; Drizzle's optional peer metadata mentions alternate adapters but none are installed. `createDatabase`, all-table Drizzle mapping and `DrizzleCatalogRepository` replace the Prisma runtime. A service-level null-ordering issue found during conversion is fixed and covered with numeric-ID tie tests. Root verify and npm audit pass; final CI remains pending. |
| F30 | 2–5 | Mapping/semantic suite implemented; PostgreSQL replay pending | Integration tests compare Drizzle table/column SQL types, nullability, defaults and primary keys against physical SQL, verify real FKs/uniqueness, and test nullable arrays, large `bigint`, exact numeric strings, calendar date, local clock text, Jerusalem wall time, CHECK failure and rollback. Required final proof is the PostgreSQL 17 CI run; later PRs must replay every added SQL migration without drift. |

## Historical PR 1 bundle measurement

PR 1 reported a 207.5 KiB gzip eager client bundle under the existing 210 KiB limit (base 205.9 KiB). PR 2 must report a new measurement from its final Drizzle build; the old figure is not substituted for that result.

## Final PR 2 evidence

Update with the actual pushed source commit before handoff:

- Node 24.21 `npm ci --no-audit`: passed, 414 packages; lockfile SHA-256 unchanged at `38144c36200c072336c605f6378aa28bc00d0524f94c7dde1daa162e7f0732af`.
- Root `npm run verify`: passed after clean install; 488 web tests, 19 API tests, server/web builds, 207.5 KiB gzip eager bundle.
- `npm run api:test:integration` on PostgreSQL 17, CI run URL and commit: pending.
- `npm audit --audit-level=moderate`: 0 vulnerabilities. Active source/config/script search: no Prisma execution/generation remnants or Prisma-only URL options. `npm ls --all --parseable`: no installed Prisma package; optional-peer metadata in Drizzle is documented in the handoff.
- Legacy SQL checksum and staged `git diff --check`: pending final pre-commit check.
- Vercel Preview URL and Drizzle runtime assertions (catalog fixture, unknown API JSON 404, SPA/OG responses): pending.
- Production: no DB credentials, SQL, rows, auth, or deployment operation performed by PR 2.
