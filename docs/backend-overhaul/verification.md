# Backend overhaul verification ledger

PR 1 evidence remains valid for the workspace/shared contracts. PR 2's final gate is the Drizzle implementation in the current draft PR #167. Earlier Prisma integration results are historical and do not verify Drizzle. Production and hosted DEV are never CI reset targets.

| ID | Owner | Current status | Implementation and evidence |
| --- | --- | --- | --- |
| F01 | 1 | Current local gates and Preview routes pass | Current root `npm run verify` passes; the PR2 Preview deployment `kartiseret-adspovw9a-jeremyjacob-projects.vercel.app` (commit `3f283e07`) is Ready. `/` returns the SPA document, `/api/v1/health` returns 200, the catalog returns 200 with the two seeded DEV movies, unknown API routes return JSON 404, `/api/og` returns HTML, and `/api/og-image?home=1` returns a valid 1200×630 JPEG. |
| F02 | 1–5 | Local build and bundle passed | Shared contracts remain browser-safe; Drizzle, `pg`, Express and secrets stay in the server workspace. Final web build passes; eager client bundle is 207.5 KiB gzip under the 210 KiB budget. |
| F08 | 1, 3 | Shared module verified; server clock deferred | Existing fixed-clock cinema-day/cutoff/grace/carryover/time-zone tests use `@kartiseret/contracts/showtime-day`. PR 2 does not introduce a request-scoped clock. |
| F09 | 1, 3 | Shared module verified | Existing short/encoded-link codec, filter mask and 62-day interpretation use `@kartiseret/contracts/showtime-links`. PR 2 does not change routes. |
| F13 | 1, 4, 5 | Shared values verified; persistence deferred | Preference constants, schemas and pure normalizers are in shared contracts. Storage, theme, sync and server persistence remain with their later owners. |
| F25 | 2, 4, 5 | SQL snapshot retained; Drizzle/PG17 gate passed | Current-state SQL baseline is unchanged by the ORM conversion and retains all raw/final/cinematheque/worker tables, keys/checks/RLS/grants/indexes/Realtime. The Drizzle integration suite compared the full 18-table/column type/null/default/key inventory to disposable PostgreSQL 17 and passed. Python app code is unchanged in PR 2; current main's Rotten Tomatoes changes, run artifacts and PR #168 deadline work are retained; local compileall and all 64 Python tests pass. |
| F26 | 2–5 | Hosted DEV privileges and verified Preview runtime pass | DEV is the separate `Kartiseret - dev` project (`jbydpmjjptwevyijarzl`), `ACTIVE_HEALTHY`, PostgreSQL 17.11, with 18 public tables and the recorded baseline. Read-only SQL confirms `kartiseret_api` inherits `kartiseret_runtime`, can SELECT `finalMovies` and `movieCodes`, and cannot SELECT `userPreferences`. The Preview-only `DATABASE_SSL_CA_CERT` now trusts Supabase Root 2021 while retaining certificate and hostname verification. The deployed catalog returns fictional fixture IDs `9100001` and `9100003`; Production was not changed. |
| F27 | 2–5 | Single SQL authority; disposable replay passed | The clean-project baseline is the only bootstrap; six unrecorded old ticket-alert scripts remain checksummed in `legacy-migrations/`. Drizzle definitions do not migrate. The guarded PostgreSQL 17 CI bootstrap applied the recorded-version baseline once to a fresh disposable database, seeded fictional rows, and passed. There is no forward DDL migration in PR 2. |
| F28 | 2–5 | Local API tests, PostgreSQL 17 CI, and deployed catalog pass | Current `npm run verify` passed on Node 26.10.0: 488 web tests, 24 API tests, lint/format/typechecks, production builds, and the 207.3 KiB gzip eager bundle budget. Both current-commit PostgreSQL 17 CI jobs passed their integration suite (10/10). A separate read-only query through the DEV pooler succeeded as `kartiseret_api` with verified TLS; no hosted integration suite or mutation was run. |
| F29 | 2 | Current implementation and CI gates pass | Current `npm run verify` and the PR checks on `3f283e07` pass. The installed package graph contains no Prisma packages; Drizzle remains the server ORM, with no generated client, migration runner, or Prisma-only URL options. |
| F30 | 2–5 | PostgreSQL 17 mapping and semantic tests pass on current commit | Both current-commit PostgreSQL 17 CI jobs pass the 10 integration tests covering SQL type/null/default/key mapping, FKs/uniqueness, arrays, bigint/numeric/date/time behavior, constraints, and rollback. The earlier run #76 remains historical comparison only. |

## Historical PR 1 bundle measurement

PR 1 reported a 207.5 KiB gzip eager client bundle under the existing 210 KiB limit (base 205.9 KiB). PR 2's final Drizzle build reports 207.3 KiB gzip under the 210 KiB limit.

### Supabase TLS diagnosis and fix

- Vercel runtime logs originally showed only the outer Drizzle error. Safe, bounded nested cause logging now records driver error codes without logging SQL, error messages, URLs, or credentials.
- The failing connection was not a bad password, pooler host, database role, or table grant. A direct strict-TLS connection to the same DEV pooler failed with `SELF_SIGNED_CERT_IN_CHAIN` before database authentication. The Supabase Root 2021 CA from Supabase’s certificate distribution made the same connection succeed; `SELECT current_user` returned `kartiseret_api`.
- Added `DATABASE_SSL_CA_CERT` to server configuration and passed it to node-postgres as the TLS CA. Supabase database URLs require a PEM CA certificate. `rejectUnauthorized: true` remains enabled, preserving certificate-chain and hostname verification.
- Added `DATABASE_SSL_CA_CERT` to Vercel Preview only. No Supabase schema/migration/data/password or Production setting was changed for this fix.
- Latest deployment: `dpl_Dv4hLNvR9wEoKJT7N8gE2ATRNGge`, commit `3f283e0723509353822b5357ad24fb0846d8387b`, Ready. The catalog returns fixture rows; health, JSON 404, SPA, OG HTML, and 1200×630 JPEG checks pass. GitHub’s Vercel, backend, web, and PostgreSQL checks pass.
## Prior Drizzle implementation evidence

Final evidence for the pushed implementation commit:

- Node 24.21 `npm ci --no-audit`: passed, 414 packages; lockfile SHA-256 unchanged at `38144c36200c072336c605f6378aa28bc00d0524f94c7dde1daa162e7f0732af`.
- Implementation commit: [`9ebee2a866ee95bd7904d7438db7175a8a1943fc`](https://github.com/jeremyjacob101/Kartiseret/commit/9ebee2a866ee95bd7904d7438db7175a8a1943fc).
- Root `npm run verify` on the prior Drizzle commit passed after the comparator correction; 488 web tests, 19 API tests, server/web builds, 207.3 KiB gzip eager bundle.
- PostgreSQL 17 CI: [Full checks run #76](https://github.com/jeremyjacob101/Kartiseret/actions/runs/38759285807) passed; the Drizzle integration suite passed 10/10, alongside web and Python jobs.
- `npm audit --audit-level=moderate`: 0 vulnerabilities on the unchanged dependency graph before the final test-only commit. The repeat on the final implementation commit was blocked by `registry.npmjs.org` DNS `ENOTFOUND`. Active source/config/script search: no Prisma execution/generation remnants or Prisma-only URL options. `npm ls --all --parseable`: no installed Prisma package; optional-peer metadata in Drizzle is documented in the handoff.
- All six legacy SQL checksums and `git diff --check` passed before the final implementation commit.
- Vercel Preview build on that commit: Ready. Jeremy's later authenticated CLI requests showed the API/OG/image routes falling through to SPA HTML.
- Production: no DB credentials, SQL, rows, auth, or deployment operation performed by PR 2.

## Vercel routing follow-up

- Current local `npm run verify`: passed on Node 24.21.0 after merging `origin/main` f5faf042; 488 web tests, 22 server/API tests, lint/format/typechecks, server and web builds, and 207.5 KiB gzip eager client bundle under the 210 KiB budget.
- Current-main Python compatibility: `python3 -m compileall -q backend` passed; all 64 tests passed with an isolated environment installed from `requirements.txt`, including the new supervisor tests from PR #168.
- Vercel local Preview build: the single-string `includeFiles` brace glob passes `npx vercel build --target preview --yes`. The earlier invalid array shape and named wildcard query parameter are fixed.
- Focused loopback smoke of `api/dispatch.ts`: health 200 JSON, unknown API path 404 JSON, OG HTML 200, and `/api/og-image?home=1` JPEG 200 (20,792 bytes). This used a dummy localhost database URL and did not access Supabase. The handler's home flag is `1`; prior instructions using `true` were incorrect.
- Local Vercel dev passed health, unknown API JSON 404, OG HTML and JPEG requests through the anonymous capture rewrite. The deployed Preview root was also checked directly and contains the SPA title and `#root` mount.
- Earlier Preview attempts exposed the SPA-routing issue and then the catalog TLS issue. The latest Preview on `3f283e07` returns fixture rows from DEV, health 200, unknown API JSON 404, SPA HTML, OG HTML and a valid 1200×630 JPEG.
