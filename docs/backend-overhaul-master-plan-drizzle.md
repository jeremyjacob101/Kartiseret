# Kartiseret backend overhaul — revised Drizzle master execution plan

Prepared 2026-10-15 for Jeremy. Intended executor: Jeremy's selected GPT-6 Luna chat with Max reasoning effort. This is a complete replacement for the earlier Prisma master plan, adapted to the work already completed. It contains the overall architecture, preservation requirements, all five PR stages, implementation sequences, verification gates, release ordering, and handoff requirements.

**Latest controlling decision: finish converting Prisma to Drizzle at the END of the existing, still-unmerged PR 2, then push that same PR with Drizzle. Do not defer conversion to PR 3, merge PR 2 with Prisma as its final implementation, create a sixth PR, or restart the already working foundation.**

The project is currently partway through PR 2. PR 1's workspace/shared-contract foundation exists. PR 2 already implements Express, a SQL baseline, hosted-dev setup materials, a first API read, Prisma mappings, and real-Postgres CI tests. Preserve the useful implementation and replace its ORM boundary before the final PR 2 push/merge. PRs 3–5 must consume Drizzle exclusively. Better Auth remains the selected authentication library for PR 5, using its Drizzle adapter; this change does not select the separate OpenAuth project or introduce handwritten authentication.

This document is an implementation specification and an evidence-backed starting snapshot. It does not assert that a PR is merged, every local edit is pushed, Preview environment variables are configured, or production has migrated. Recheck those facts in the implementing chat.

## 0. How Jeremy should use this revised document

### Right now: continue the existing PR 2 chat

Paste or attach this ENTIRE revised plan in the chat implementing PR 2, preceded by:

> Continue the existing PR 2 and its existing GitHub PR using this revised Drizzle master plan. Preserve the Express/workspace/SQL-baseline/hosted-dev/test foundation already written. Complete the Prisma-to-Drizzle conversion as the final implementation phase of PR 2 before its final push and merge readiness. Verify the existing endpoint, schema mapping, permissions, transaction behavior, clean build, CI, and hosted-dev Preview with Drizzle. Reconcile the baseline filename with the migration actually recorded in DEV. Update the same PR's title/body and handoff to describe Drizzle. Do not implement PR 3, merge, request reviewers, or start another PR. Inspect current code and document justified adaptations.

Earlier exploratory Prisma commits in PR 2's history may remain. The final PR diff, source, scripts, package graph, tests, handoff and description must use Drizzle. Do not force-push or rewrite history merely to hide the intermediate implementation.

### Later: one chat for each remaining PR

After Jeremy merges the preceding completed PR, open the next implementation chat on the updated base. Paste or attach this entire revised plan and prepend:

> Implement PR N only from the attached revised Drizzle backend-overhaul master plan. Read the actual merged repository, applicable instructions, verification ledger, and previous handoffs first. PR 2 must already contain Drizzle; verify that prerequisite before implementing later stages. Complete this PR's implementation and verification, update its handoff, and create a draft PR if repository access permits. Adapt justified details to the code and document deviations. Do not implement later PRs, merge, or request reviewers.

Replace N with 3, 4, or 5. Supply the whole document so the executor sees the shared constraints and future dependencies. It may read the plan from the repository instead if the same revision is committed and available. A file saved only in another worktree is not automatically present in a fresh chat/worktree.

Canonical revised filename: `docs/backend-overhaul-master-plan-drizzle.md`. The old `docs/backend-overhaul-master-plan.md` and `docs/backend-overhaul-audit.md` are historical context. This revision supersedes conflicting Prisma instructions and old assumptions that PR 2 has not started or DEV does not exist. Save this revision in the implementation branch as part of PR 2's documentation so subsequent chats can read it. Keep useful predecessor handoffs; add explicit dated corrections rather than presenting old Prisma evidence as Drizzle evidence.

### Five-PR sequence and present status

| Stage | Scope | How to treat it now |
| --- | --- | --- |
| PR 1 | npm workspaces and shared Zod/domain foundation | Existing predecessor; verify its merged result, do not rebuild it |
| PR 2 | Express, SQL baseline, hosted DEV, Postgres CI, first public read; **finish by replacing Prisma with Drizzle** | Current open PR; complete conversion and verification before final push/merge readiness |
| PR 3 | Complete public reads, frontend transport, social previews, Playwright | Begins with a working Drizzle foundation; no postponed ORM conversion |
| PR 4 | Protected APIs, preferences, subscriptions, transactional admin edits; temporary Supabase Auth | All new queries and transactions use Drizzle |
| PR 5 | Better Auth with the Drizzle adapter, app-owned identities, Python recipient transition | Final authentication cutover and whole-feature verification |

### Execution agreement for every chat

1. Work only on the selected PR, necessary supporting changes, and defects demonstrably caused by it. Do not implement the whole overhaul in one chat or repeat completed stages.
2. Inspect the real checkout, instructions, branch/remote, dependency versions, deployed configuration, and predecessor handoffs. Paths and versions below describe observations, not immutable future requirements. An open GitHub PR and unpushed local edits can differ.
3. Proceed autonomously through ordinary implementation choices. Ask only for missing access, unresolved product behavior, a new hosted cost, destructive changes outside scope, or a contradiction preventing correct implementation. Continue independent work while awaiting required input.
4. Do not substitute stubs, swallowed errors, production test bypasses, successful empty datasets for broken SQL, or skipped mandatory integration suites for working features.
5. Distinguish implemented, locally verified, CI verified, hosted-provider verified, Preview verified, and production deployed. Old Prisma integration results do not prove Drizzle. A mock does not prove SQL or RLS; a successful build does not prove deployed routing or cookies.
6. Jeremy wants useful structure and a straightforward migration. Avoid dual-write/dual-ORM frameworks, prolonged dual-auth support, table renames, elaborate rollout machinery, and extra products for hypothetical scale. One short coordinated auth cutover is acceptable.
7. The app is live; scraped data is rebuildable and Jeremy is the only active user. Preserve permanent short codes, corrections, curated geography/configuration, wanted preferences/subscriptions and delivery state. This is not permission to wipe databases or discard other referenced account rows.
8. Never request a PR review or add/assign reviewers, including Shaun-Regenbaum, unless Jeremy explicitly asks. Create/update draft PRs without reviewer requests. Do not invoke review-requesting bots or tooling.
9. Leave merging to Jeremy. Do not change production credentials, apply production migrations, pause production jobs, or send real emails merely as test proof without appropriate existing authorization. Prepare and verify the concrete change first, then give an exact short operation checklist for any remaining production authorization.
10. Do not create additional chats, change model settings, or delegate to subagents unless Jeremy or applicable instructions explicitly authorizes it. This plan is for sequential implementation owned by each selected chat.
11. Inspect concurrent Python/dataflow work and newer main commits before editing affected contracts. Do not revert unrelated improvements, scheduling changes or run artifacts to match an old audit. Scope commits to this stage.

## 1. Goal, scope, and success criteria

Create a dedicated TypeScript application backend for Kartiseret while retaining the existing React/Vite experience, Supabase-hosted PostgreSQL, and Python scraping/enrichment pipeline.

The agreed additions are:

- Shared and extended Zod contracts and validation.
- Express for the API and feature modules.
- Drizzle ORM with the existing `pg` driver for TypeScript database access and transactions; Drizzle Kit only as optional development/introspection tooling, not a second migration runner.
- Better Auth running inside Express, with account/session data in our PostgreSQL database.
- Supertest with the existing Vitest tooling for API/business-logic tests.
- Playwright for browser-level regression coverage.
- npm workspaces for the frontend, server, and shared contracts.

Retain React, Vite, React Router, TanStack Query, Zustand, CSS, MapLibre, Supabase Postgres, Supabase's Python service-side client, Supabase Realtime for existing enrichment, Python/Selenium, and Resend.

Explicitly deferred: Docker setup on Jeremy's Mac, application container packaging, Pino, Sentry, uv, OpenAPI/generated API clients, Redis, queues, a new scraper runtime, and external logging/artifact storage. Existing GitHub CSV/artifact behavior is a separate later task. Helmet and an extra general API rate-limit package are not mandatory additions in these PRs; retain essential auth-library abuse/CSRF protections and document deployment-specific decisions.

Success means all existing feature flows work through the new boundaries, database permissions match the resulting access model, Python remains compatible, tests cover behavior and failure paths, the frontend has no application-table transport dependency on Supabase, and the final auth implementation is app-owned.

## 2. Target architecture and ownership

```text
Browser: React/Vite
  |-- TanStack Query: remote request/cache lifecycle
  |-- Zustand/local state: UI, filters, guest preferences, theme coordination
  |-- Shared Zod contracts and pure cinema-day/filter/link helpers
  |
  +--> same-origin /api/v1/* --> Express feature modules --> Drizzle + pg --> Supabase Postgres
  +--> same-origin /api/auth/* --> Better Auth Drizzle adapter --> same DB layer --> app-owned auth tables

Existing share HTML/JPEG handlers --> same backend data services
Existing Python scrapers/dataflows --> Supabase service-role Data API --> same physical tables
Existing Supabase Realtime watcher --> targeted Python enrichment
Python notification dispatcher --> existing table operations + narrow app-owned recipient lookup
```

### Repository shape

Keep the implemented workspace shape. PR 2 chose `packages/server`, not the earlier proposed root `server/` directory. Do not move the frontend/Python tree or rebuild packages just to match a convention.

```text
package.json                         root workspace/scripts, one package-lock.json
Codebase - Kartiseret Web/           existing React/Vite frontend
packages/contracts/src/              pure shared Zod DTOs/primitives/domain helpers
packages/server/
  src/app.ts                         injectable createApp; no listening/DB side effect
  src/index.ts                       local Node startup
  src/production.ts                  real composition and connection lifecycle
  src/env.ts                         validated server-only configuration
  src/db/                            Drizzle schema, database factory/types/lifecycle
    schema/                          application table definitions; auth added in PR 5
  src/catalog/                       existing first-slice service/mapper/repository
  src/<feature>/                     routers/controllers/services/repositories as useful
  scripts/bootstrap-test-database.mjs guarded CI bootstrap, no hosted reset
  tests/integration/                 real Postgres behavior tests
  drizzle.config.ts                  only if dev introspection/generation needs it
api/dispatch.ts                       explicit Vercel API and OG dispatcher
Codebase - Kartiseret Web/server/og/ existing OG handlers called by dispatcher
backend/                             existing Python scraping/dataflow/notifications
supabase/migrations/                 sole active SQL migration authority
supabase/legacy-migrations/           checksummed earlier SQL, excluded from fresh replay
supabase/seed/dev.sql                 fictional bounded development fixtures
docs/backend-overhaul/               architecture, feature ledger, per-PR handoffs
docs/backend-overhaul-master-plan-drizzle.md
```

Choose exact new DB/feature filenames to fit current code. Existing shared exports are `@kartiseret/contracts/runtime`, `/movies`, `/showtime-day`, `/showtime-filters`, `/showtime-links`, and `/preferences`; maintain explicit subpaths. A broad barrel must not pull server dependencies into the browser.

A router declares HTTP routes/middleware; a controller adapts HTTP; a service owns business rules and transaction boundaries; a repository owns Drizzle queries. Small features may combine trivial layers when useful. Drizzle table definitions are persistence models, not public response contracts. Do not add generic base controllers, arbitrary CRUD/table-query endpoints, a DI framework, or one duplicated class for every SQL table.

### Ownership that must stay explicit

- Server: database normalization, authoritative availability/ownership/admin checks, preference persistence/defaults, write transactions, private projections.
- Frontend: TanStack Query keys/cache/invalidation, incremental coverage, request cancellation, forms, gestures, local search, map rendering/geolocation, UI state, guest storage, immediate theme changes, save coalescing and rollback.
- Shared: normalized DTO schemas, request schemas, constants and deterministic pure domain helpers. No React, Zustand stores, Supabase client instances, Drizzle, Node-only imports, secrets, localStorage, or DOM initialization.
- Python: scraping, matching, enrichment, cleanup, current worker execution, and ticket-email delivery. Drizzle replaces only the TypeScript ORM; it does not replace Python's Supabase client or relocate scraping into HTTP requests.

## 3. Confirmed hosting and environment strategy

Jeremy chose a hosted development environment. Do not require a local database or Docker on his Mac.

| Environment | Application | Database/auth | Intended use |
| --- | --- | --- | --- |
| Production | Existing Vercel production deployment/domain | Existing production Supabase project; Supabase Auth through PR 4, Better Auth after PR 5 cutover | Live product |
| Hosted dev / previews | Same Vercel project, Preview environment and deployment URLs | Separate hosted Supabase dev project, with separate credentials/auth state | Browser acceptance, manual testing, migration rehearsal |
| CI integration | App/tests started on GitHub-hosted Ubuntu runner | Disposable PostgreSQL service created by GitHub Actions | Repeatable SQL/transaction/auth persistence tests; destroyed with job |
| Optional local app | Node/Vite on Jeremy's Mac | Hosted DEV project when explicitly configured, or injected fixtures for unit/browser tests | App development; no local DB service required |

CI's Postgres service is a container on GitHub's runner, not a Docker installation or application-packaging requirement on Jeremy's Mac. Destructive integration tests never reset the shared hosted dev project. Browser unit/fixture tests are not the sole verification of database behavior.

### Hosted dev setup: retain the project already provisioned during PR 2

- Production observed: `KartiseretNew`, project ref `gsdrcyrduxbrxgsvhxvr`, PostgreSQL 17, region `eu-central-2`; PR 2 reports confirming this from the deployed public bundle. Reverify actual deployment config before production operations.
- Hosted DEV already exists: `Kartiseret - dev`, project ref `jbydpmjjptwevyijarzl`, region `eu-central-2`, PostgreSQL 17.11. Read-only provider metadata confirmed `ACTIVE_HEALTHY` while this revision was prepared. Do not create another dev project or repeat the initial provisioning/cost-approval flow.
- DEV migration ledger observed: version `20261015141043`, name `20261015122907_current_app_schema_baseline`. The difference between version and name is an observed provider record; align the repository's active baseline version and bootstrap references deliberately, without replaying the CREATE TABLE baseline on an existing project.
- PR 2's local handoff records applying fictional dev fixtures and creating restricted runtime role membership. Treat fixture contents, login-password completion and Preview variables as recheckable state. No secret values belong in a plan, handoff or chat.
- The older inactive project `Kartiseret` / `vxrmpmfimpzkcvqqrsdt` is unrelated to this work; do not reuse, reset or delete it without explicit instruction.
- Use Vercel Production variables for production and Preview variables for DEV. Optional local Node/Vite development may use DEV. Keep runtime `DATABASE_URL` distinct from migration/admin `MIGRATION_DATABASE_URL`; migration/admin credentials must not enter the deployed app, build step or browser.
- Through PR 4, hosted-dev private flows must use DEV Supabase Auth and its callbacks. Existing frontend public configuration may still point to production during PR 2 because its transport is unchanged; before PR 3/4 Preview acceptance, audit and scope ALL remaining Supabase/auth/frontend variables to DEV. A dev API with a production auth client is not a valid isolated test environment.
- PR 5 uses DEV-specific Better Auth secrets, URLs, accounts, cookies and mail configuration. Keep production private data, sessions, passwords and notification recipients out of dev fixtures.
- One hosted-dev database is enough. Apply intentional forward SQL changes with its migration role; do not reset it from CI or every Preview build. Coordinate unrelated branches that share it.
- Default automated mail to capture/injection; hosted tests use a controlled mailbox/allowlist only when configured. No scraping or real ticket mail is required to seed or validate DEV.
- Record Preview URL, source commit and exact checks actually performed. The PR 2 handoff's historical Vercel build success does not establish that `DATABASE_URL` has since been configured or that a runtime query works.

### Same-origin Vercel and local routing

Retain a normal Express app plus a thin Vercel function adapter. Keep the frontend's static output and existing OG endpoints. Verify the current supported way to combine them; do not switch the entire Vercel project to an Express-only framework that stops serving the SPA.

The current implementation uses the explicit `api/dispatch.ts` function. Route `/api/*` and short-link OG requests to it before the SPA fallback, restore the original path and query for Express, and call the existing OG handlers for their two routes. Verify each route against the deployed Preview; a successful static build does not establish runtime routing.

Application `/api/v1/*`, auth `/api/auth/*`, internal `/api/internal/*`, and OG endpoints must resolve before the SPA catch-all and short-link rewrites. Unknown API routes return an API 404, not a 200 HTML page. The server must see the intended original route after Vercel rewriting. Test this explicitly.

Vite should proxy `/api` to the local Express process for optional local development. The browser can continue using relative same-origin requests. Configure trusted origins, forwarded protocol/host handling, cookies, callbacks, and preview-origin handling deliberately. Do not trust every arbitrary Host/Origin header or use an unrestricted wildcard for authenticated preview requests.

## 4. Known source and live-schema facts

Original source audit baseline: commit `c845bcb8`. PR 1 and PR 2 now substantially extend that tree. Reinspect the current merged base and working branch; never start implementation from the old audit checkout merely because this plan was written there.

### PR 2 snapshot used for this revision

The live GitHub PR was inspected read-only: [PR #167 — PR 2: Establish Express, Prisma, and PostgreSQL foundation](https://github.com/jeremyjacob101/Kartiseret/pull/167). At inspection it was **open, draft, unmerged**, branch `codex/backend-02-api-prisma-foundation`, head `bf068d4ce02916524995d985fc0eb69844860a2f`, base `main` at `93eee8db7061b287d01ad6293fe2f34b2933b327`. Treat these as snapshots; fetch current state before resuming. The PR's title/body still describe Prisma and must be updated after conversion.

The GitHub file list and actual patches confirmed Prisma 7.10.0 (`@prisma/client`, `@prisma/adapter-pg`, CLI), `pg` 8.16.3, Express 5.2.1, the generated-client build step, and `PrismaCatalogRepository`. This is existing implementation to convert, not a request to add Prisma.

The PR 2 worktree was also read without editing it. It had newer unpushed baseline/environment/handoff changes, including replacing the old baseline filename `20261015122907_current_app_schema_baseline.sql` with `20261015141043_current_app_schema_baseline.sql`. Hosted DEV independently records migration VERSION `20261015141043`. Preserve/reconcile those pending changes before final push; do not restore the older GitHub filename over them. Check any additional edits made since this snapshot.

The handoff reports 18 mapped app tables, 21 standalone indexes, 33 source policies plus two runtime policies, forced RLS on `tableFixes`, Realtime membership for `finalMovies` and `finalSoons`, no source public triggers/routines/app sequences at the time of capture, and successful earlier Prisma/CI checks. DEV may have provider/dashboard automation (e.g. an RLS event trigger) not present in the source snapshot. These observations guide inspection; retain the actual SQL definitions and do not overwrite new provider objects based on old counts.

### Existing implementation boundaries

- `packages/server/src/prisma.ts`: builds the Prisma PG adapter/client with a bounded pool. Replace with the Drizzle + existing `pg.Pool` factory, preserving lifecycle/error behavior.
- `packages/server/src/catalog/prisma-repository.ts`: the first now-playing query and batched code lookup. Preserve its neutral `CatalogRepository` interface while replacing its implementation.
- `packages/server/src/catalog/movie-mapper.ts`: runtime normalization/Zod parsing. Keep it unless real driver shapes require a deliberate adjustment; it must not depend on Prisma classes.
- `packages/server/src/production.ts`: production composition and `close()` callback. Keep the external composition contract while replacing DB internals.
- `packages/server/prisma/schema.prisma`: all 18 table mappings. Use as a cross-check, with SQL/catalogs authoritative; replace by Drizzle definitions before removing it.
- `packages/server/tests/integration/catalog.test.ts`: real runtime-role reads/denial, DTO conversion, native types, constraints and rollback. Port behavioral coverage; replace Prisma-specific representation assertions.
- `packages/server/prisma.config.ts`, `scripts/generate-prisma.mjs`, root `server:generate`, generation hooks, install-script allowlist and scoped dependency overrides: conversion cleanup inventory.
- `api/dispatch.ts` and its tested dispatcher helper, server app/service/error boundaries, Vite proxy, Vercel asset rules, CI Postgres service, baseline/seed and legacy checksums: preserve and verify, do not recreate.
- Existing public endpoint: `GET /api/v1/catalog/now-playing`, response `{ data: { mode: "nowPlaying", movies: Movie[] }, error: null }`. Keep its path and DTO stable during conversion. Health is liveness without SQL; unknown API requests return safe JSON 404s.

### Physical database facts to preserve

| Table/group | Important observed facts |
| --- | --- |
| `allShowtimes`, `allSoons`, `allTheques` | UUID primary IDs, nullable listing fields, run/cleaned/added state, native date/time |
| `finalMovies` | Integer movie PK; bigint release year; real runtime; physically nullable genres array; JSONB alternatives; mixed text/numeric ratings; nonnull pending-enrichment flag |
| `finalShowtimes` | UUID PK; nullable integer movie ID; date and time-without-timezone; nullable listing data |
| `finalSoons` | UUID PK; integer movie ID without proven uniqueness; nonnull titles/release date; nullable genres |
| `movieCodes` | Bigint movie PK, unique case-sensitive three-character code, positive-ID/format checks |
| `tableFixes`, `tableSkips` | Persistent intentional overrides; text matching fields; UUID fix PK/text skip PK |
| `theaters`, `cities` | Theater `location` PK and actual named city FK; city name PK; aliases/neighbors arrays; nullable geo/zoom |
| `userPreferences`, `admin_users` | UUID user PKs/FKs to provider `auth.users` until PR 5; preference array check |
| `ticket_alert_subscriptions` | Composite UUID-user/bigint-movie PK, user FK, durable delivery/snapshot/retry/idempotency fields |
| `utilRunLogs`, `utilAvgTime` | Existing run IDs, selected-runner JSON, running state, machine timing/count fields; run timestamp is Jerusalem wall time WITHOUT timezone |
| `finalTheques`, `finalThequeMovies` | Separate cinematheque schedule/catalog used by workers, with numeric/bigint/native-type constraints |

All 18 original public tables had RLS enabled. Several preference rows exist despite one active user. Do not assume obsolete referenced IDs may be deleted. No rescrape or row transfer is required just to change ORM.

### Files to inspect by area

- Workspace/deploy: root/web package manifests and lockfile, `vercel.json`, web `config/*`, `tsconfig.json`, ESLint/Vitest config, `.gitignore`, `.github/workflows/*`.
- Shared validation: web `src/validation/runtime.ts`, `src/data/applicationSchemas.ts`, `externalSchemas.ts`, `ticketAlertSchemas.ts`, `src/lib/supabaseSchemas.ts`, `docs/runtime-validation.md`.
- Catalog/showtime logic: web `src/data/movieCatalog.ts`, `src/App.tsx`, `src/components/MoviePage.tsx`, `AllShowtimesPage.tsx`, `PosterGridPage.tsx`, scroller modules and `MovieSearchMenu.tsx`.
- Geography: web `src/data/theaters.ts`, map components and city helpers.
- Dates/links/filters: web `src/domain/showtimeDay.ts`, `showtimeFilters.ts`, `src/routing/showtimeLinkCodec.ts`, `shareLink.ts`, `src/components/showtimes/showtimeFilters.ts`.
- Accounts: web `src/stores/userPreferencesStore.ts`, `preferenceSavePolicy.ts`, `src/prefs/initialPreferences.ts`, definitions, `UserMenu.tsx`, `PasswordResetPage.tsx`, `PasswordSecurityForm.tsx`, `UserPreferencesPage.tsx`, `authRoutes.ts`, `authMenu.ts`, `src/data/adminStatus.ts`.
- Alerts: web `src/data/ticketAlerts.ts`, alert schemas/domain/UI; Python `backend/notifications/ticket_alerts.py`.
- Social previews: root `api/og.ts`, `api/og-image.ts`; web `server/og/*`, assets and cache headers.
- Workers: Python `backend/config/registry.py`, `runner.py`, `runners.py`, realtime watcher/launcher, scraping base/utilities, dataflow base/utilities/update stages, cleanup and logging utilities, cron scripts.
- Tests: existing web tests for query coverage/hydration, preference synchronization, alerts, route/date/filter invariants, auth UI, previews, remote images, and eager bundle budget.

The README is useful context but partially stale: its preview-table loading/generation descriptions do not match the currently audited implementation. Current catalog source loads full collections and hydrates codes separately. Read actual code and current schema before preserving a purported feature.

## 5. Database and migration policy

### Keep the SQL authority established in PR 2

`supabase/migrations` remains the single active DDL history. Drizzle table definitions describe/query that schema. They do not become a competing schema-application engine. Retain the SQL baseline, provider prerequisites, grants/policies/indexes/checks, legacy-migration archive/checksums, and deterministic seed already established.

Switching the TypeScript ORM requires no table recreation, reset, export/import, auth migration, or rescrape. The expected ORM-only conversion makes zero application-schema changes. Additional public-read permissions for PR 3 or account/auth changes in later stages are separate explicit forward SQL migrations.

Do not run `drizzle-kit push`, `drizzle-kit migrate`, a Drizzle runtime migrator, Prisma schema pushes/migrations, or a separate auth migration engine against these app tables. Do not create a `__drizzle_migrations` history alongside Supabase's ledger. If a tool generates SQL as development assistance, review it and translate the required change into one authoritative timestamped Supabase SQL file. Never apply the same DDL through two systems.

Drizzle Kit is optional dev tooling for read-only introspection/schema generation. Keep its credentials/configuration out of the deployed runtime and ordinary builds. Any pull/introspection output goes to a scratch location first so it cannot replace curated definitions or generate accidental baseline files. Review public schema filters, supported extension/provider exclusions and flags against the installed version. The official existing-Postgres guide documents introspection, but its optional push/migrate steps are not this project's workflow: [Drizzle with an existing Postgres database](https://orm.drizzle.team/docs/get-started/postgresql-existing).

### Baseline and migration-ledger reconciliation

1. Read the actual final PR 2 baseline filename/content, legacy manifest/checksums, disposable-bootstrap script, DEV migration ledger and production ledger. Preserve pending local edits. At preparation time GitHub still used version `20261015122907`; DEV had recorded version `20261015141043` and the worktree was already aligning to that version. Do not treat an older remote file as more current than an intentionally corrected applied version.
2. Once a baseline has been applied to DEV, preserve its applied DDL/version. Resolve any pre-merge filename/history mismatch with explicit evidence. Do not rename or edit an applied baseline to sneak new schema changes into history; use a later migration for new changes. A provider migration display NAME need not equal its VERSION; document the correspondence.
3. Fresh projects/CI apply the current-state baseline ONCE, then all forward migrations in documented order, then the appropriate seed. Do not replay the archived guest/RPC ticket-alert history over the current-state baseline.
4. Existing production already has its application schema. Do not run the CREATE TABLE baseline there. Compare its actual schema with the captured baseline and deliberately reconcile migration tracking before applying future changes. Marking an already-equivalent baseline as represented in history is distinct from executing its DDL; use verified tooling and explicit production authorization where needed.
5. Existing DEV has baseline tables and may have applied later migrations. Apply only missing forward migrations. No automatic reset or replay on every build/Preview. Do not use the production connection as a fallback.
6. Generate/names new SQL migration files using the current Supabase CLI convention (`--help` first); do not require Docker or native Postgres on Jeremy's Mac for schema tooling. Available provider tools/CI/native clients can inspect/apply intentional changes.
7. Retain table defaults, real keys, constraints, comments, RLS, grants, publication membership and Python-facing names. Provider-owned `auth`, Realtime, extensions and their managed objects remain provider-managed until explicit app-owned auth changes in PR 5.
8. CI's current bootstrap applies a single baseline by filename. Before the first forward migration, extend it to apply ALL active migrations in order exactly once on the disposable fresh target. Preserve its loopback/exact-db/non-empty guards and keep provider compatibility objects test-only. Include forward-migration replay in required CI, rather than updating only hosted DEV.
9. No build step may connect to or migrate a real database. Compiling Drizzle schemas is TypeScript compilation; no runtime client code generation is required.

### Drizzle driver, lifecycle and connection choice

Default to `drizzle-orm/node-postgres` and the already installed `pg` driver/types. Avoid adding `postgres.js` or another database transport just to follow a tutorial. Create one explicit bounded `pg.Pool` per application/runtime composition and construct Drizzle around it. Reuse it across requests in a warm Vercel instance; close it via the composition's `close()`/test teardown, not after each response. Keep `createApp` imports side-effect free.

Preserve the current configurable conservative pool maximum, finite connection/idle timeouts and safe pool error handling; account for multiple Vercel instances when selecting limits. Pool errors must not crash silently or expose connection strings. Do not use a schema owner/admin login as the runtime credential.

Drizzle supports existing node-postgres pools: [Drizzle PostgreSQL drivers](https://orm.drizzle.team/docs/get-started-postgresql). Verify exact initialization APIs against the stable compatible version actually installed; current docs can show release-candidate examples. Do not blindly install `@rc`, `@beta`, or `@latest` tool invocations when they would change the chosen API family. Lock compatible ORM/Kit/auth-adapter versions and use one supported relations API.

Use Supabase's transaction pooler for the serverless runtime where appropriate and its direct/session migration connection separately. Do not use named/session-bound prepared statements with the transaction pooler unless the actual provider/version is verified to support them. The `prepare: false` flag in postgres.js examples is not a `pg.Pool` option; do not copy it into node-postgres. Test transactions through the actual selected driver/pooler. Do not depend on session-persistent `SET` state across requests: [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Inspect Prisma-oriented URL options (`schema`, `pgbouncer`, `connection_limit`, etc.) when porting configuration. Remove or translate unsupported options in documented examples/runtime setup while retaining legitimate pooler host, custom-role username, database, password encoding and provider TLS requirements. SQL schema selection belongs in explicit table/schema mapping or a verified driver setting, not an assumption that Prisma's `?schema=public` controls Drizzle. Do not log URLs or disable TLS verification to make a connection pass.

### Native types, SQL semantics and boundary conversion

The SQL baseline/catalogs are authoritative; use the old Prisma mapping only as a secondary cross-check. Explicitly map physical table/column names with Drizzle builders. Keep camelCase internal properties when they preserve current mapper inputs. Relations metadata must reflect real keys and must not invent uniqueness or database FKs.

| Concern | Required handling during conversion and later queries |
| --- | --- |
| Nullability/defaults | Model physical nullable arrays and fields honestly; do not add `.notNull()` or defaults merely to fit an old Prisma limitation. Normalize only at the documented DTO boundary. SQL defaults, including unusual legacy timezone expressions, remain unchanged. |
| Bigint | Preserve precision with bigint/string representation internally. Movie IDs become validated decimal strings in DTOs. Release years/counts become numbers only after bounds checks. No global `BigInt.toJSON` patch or global `pg` parser turning all int8 into unsafe JS numbers. |
| Numeric/decimal | Drizzle/pg values need not be Prisma Decimal objects. Document actual return types; keep exact values as strings where appropriate and explicitly validate/convert bounded rating DTOs. Do not retain `.toNumber()` calls or tests requiring a Prisma class. |
| Calendar date | Prefer explicit date-string mapping for date-only columns. Assert `YYYY-MM-DD` calendar semantics and nulls; do not require Prisma's artificial midnight Date representation. |
| Local showtime | Preserve time-without-timezone as validated local clock text, including supported seconds/precision. Do not route it through an epoch Date/toISOString conversion that changes its meaning. |
| Timestamps | Distinguish absolute timestamptz instants from legacy Jerusalem wall-clock timestamp values. Auth timestamps may use a different supported Date mode than cinema dates. No module-level frozen server clock. |
| JSON/arrays | Explicitly map real JSONB/text-array types and nullability; keep Zod runtime validation. Drizzle type annotations do not validate stored JSON. |
| Ordering | Preserve explicit `popularity DESC NULLS LAST`, then movie-ID tie-breaker; plain PostgreSQL DESC has different null ordering. Keep deterministic ordering for other endpoints and pagination. |
| Keys | `finalSoons.tmdb_id` is not proven unique; subscriptions have a composite key; theaters use location. Do not emulate Prisma `findUnique` by adding invented constraints. |
| Membership/empty input | Keep code lookups bounded/batched, avoid N+1 and empty `IN` mistakes. Preserve existing deliberate missing-table/error behavior versus a legitimate empty catalog. |
| Mutations | Parameterize values and allowlist dynamic sort/field identifiers. Validate partial updates and distinguish an omitted property from explicit null; never pass arbitrary request bodies directly to `.set(...)`. |
| Transactions | Use `db.transaction(async tx => ...)` with all writes on the transaction handle. Do not mix `pool.query` or outer `db` writes into a transaction callback. Unique violations caught inside an aborted PostgreSQL transaction require rollback/savepoint or conflict SQL before rereading. |
| Errors | Translate actual PostgreSQL SQLSTATE/constraint metadata (including driver/Drizzle cause wrapping), not Prisma `P2002`/`P2025`. Inspect narrowly, preserve useful internal causes, return safe API errors. |

These are project-specific representation decisions; validate them with actual seeded SQL. See [Drizzle Postgres types](https://orm.drizzle.team/docs/column-types) and [transactions](https://orm.drizzle.team/docs/transactions) for the supported APIs. Keep physical decimal precision, timezone precision, check/index definitions and DB defaults unchanged unless a later feature needs an explicit migration.

### Authorization and Supabase coexistence

A direct Drizzle/pg connection does not inherit a browser Supabase user's identity or RLS JWT context. Use verified server identity plus explicit own-account/admin service authorization. Preserve the restricted `kartiseret_runtime` group and `kartiseret_api` login: PR 2's runtime should still read ONLY `finalMovies` and `movieCodes`; later migrations grant the exact additional reads/writes needed. Do not grant all tables or `BYPASSRLS` to fix missing policies.

The Python pipeline continues using service-role Supabase Data API/Realtime. Do not disable the Data API globally, change worker keys/types, or require Python to adopt Drizzle. Browser grants/exposure are tightened at the proper migration boundary while service-side worker access stays functional. Keep SQL as the shared source of schema truth across both runtimes.

## 6. API and shared-contract conventions

Suggested endpoint families, adjustable to the current code without duplicating APIs:

| Endpoint | Owner PR | Contract intent |
| --- | --- | --- |
| `GET /api/v1/health` | 2 | Process/config readiness without secrets; optionally separate DB readiness |
| `GET /api/v1/catalog/now-playing` (existing); companion coming-soon route chosen consistently | 2 first slice, complete 3 | Preserve existing path/envelope; ordered normalized collection and explicit code-readiness behavior |
| `GET /api/v1/movies/by-code/:code` | 3 if useful | Direct normalized route lookup; avoid forcing a full catalog for a single server preview |
| `GET /api/v1/showtimes?city=...&startDate=...&endDate=...&tmdbId=...` | 3 | Inclusive bounded range; normalized records; preserve broad/targeted cache meaning |
| `GET /api/v1/theaters` | 3 | Normalized theaters with city metadata, or equivalently clear cities/theaters response |
| `GET /api/v1/movies/:tmdbId/ticket-availability?cinemaDate=...` | 3 | Public valid ticket candidates across cities; city preference remains a selector |
| `GET /api/v1/me`, `/me/preferences`, `/me/ticket-alerts` | 4 | Own identity/admin projection and private settings/subscriptions |
| `PATCH /api/v1/me/preferences` | 4 | Validated partial preference update |
| `POST /api/v1/me/preferences/initialize` if needed | 4 | Idempotent explicit defaults/missing-row repair; preserve chosen signup location |
| `POST` / `DELETE /api/v1/me/ticket-alerts/:tmdbId` | 4 | Own one-shot subscription changes with authoritative availability/duplicate handling |
| `PATCH /api/v1/admin/movies/:tmdbId/match` | 4 | Authorized correction/merge; body specifies catalog mode and selected target |
| `/api/auth/*` | 5 | Better Auth's own documented endpoints, not a second handwritten auth protocol |
| Narrow `/api/internal/...` recipient lookup | 5 | Authenticated Python-to-server access to canonical verified recipient information |
| Existing `/api/og`, `/api/og-image`, short URLs | 3 | Preserve externally used share HTML/image URLs and route behavior |

Do not implement every suggested route if existing services can provide the same behavior with fewer endpoints. Do not expose generic table/query execution routes. Record final contracts so later PRs use the established shape.

### Contract rules

- Zod validates request inputs on the server and external JSON responses at frontend ingress. Infer internal types; avoid repeatedly parsing the same validated value inside every layer.
- Distinguish browser form refinements, public DTOs, private DTOs, database mapping, and auth-library contracts. Database rows and session secrets are never general response DTOs.
- Reuse primitives for IDs, real calendar dates, time, codes, URLs, locations, preference values, and filters. Keep trust-boundary parsing helpers and their useful contextual errors.
- Bound ranges and page sizes without preventing valid existing 180-day browsing or 62-day share-link behavior. Fetch all rows belonging to a promised complete range; never silently truncate at a database API default limit.
- Use stable ordering with a tie-breaker for any pagination. Catalog sizes currently allow complete collection responses; do not force a generic pagination UI or infinite-query rewrite merely because pagination is a convention.
- Use one consistent API error shape with a safe code/message and optional validation-field details. Map bad input, unauthenticated, forbidden, missing resources, conflicts, and server faults deliberately. Never send raw SQL, credentials, stack traces, or all Drizzle metadata to clients.
- Preserve frontend `AbortSignal` behavior for fetches. Do not claim that aborting the HTTP response guarantees the underlying SQL query was cancelled if the selected driver cannot prove that.
- Do not automatically retry writes. Map unique-constraint collisions to the intended idempotent result where relevant.
- Private responses use `no-store`. Public cache policy must respect time-sensitive showtimes and existing OG fallback behavior. No private account data in shared CDN caches.
- Reuse the composed Drizzle database and bounded pg pool appropriately for Node/serverless execution; do not create/disconnect a pool on every request. Verify runtime pooler and separate migration connection settings against the actual driver/provider versions. Shared Zod DTOs stay independent of Drizzle table inference; do not add another public-contract generator merely because an ORM offers one.

## 7. Feature integrity ledger

Maintain a compact checked-in ledger, e.g. `docs/backend-overhaul/verification.md`, with these IDs, owning PR, implementation path, evidence, and status. A row is not proved merely because it is checked off. Update changed tests/handoffs without filling the document with raw logs or credentials.

| ID | Behavior/invariant | Main owner |
| --- | --- | --- |
| F01 | Root install, workspaces, lockfile, package exports, CI/Vercel builds | 1 |
| F02 | Shared code is browser/server safe; no server code or secrets in client bundle | 1–5 |
| F03 | Catalog normalization, ordering, artwork, ratings, alternatives, pending enrichment rows | 3 |
| F04 | Catalog/code lookup and code-failure behavior; permanent code stability | 3 |
| F05 | Showtime range completeness, stable IDs/order, cancellation and deduplication | 3 |
| F06 | Broad versus targeted coverage; arbitrary jumps; refresh removes stale rows | 3 |
| F07 | City/theater joins, aliases, neighbors, map data and dynamic locations | 3 |
| F08 | Cinema-day cutoff, grace, carryover, DST and request-scoped server clock | 1, 3 |
| F09 | Short and encoded link codec, filters, 62-day date interpretation | 1, 3 |
| F10 | OG HTML includes SPA document/assets and correct metadata/fallback/cache | 3 |
| F11 | OG JPEG assets/Sharp, remote-image bounds and fallback/cache | 3 |
| F12 | Search/grid/scroller/mobile navigation still uses existing UI behavior | 3 |
| F13 | Guest preferences, theme bootstrap and local/cross-tab filter persistence | 1, 4, 5 |
| F14 | Signup-location priority, preference initialization/repair, per-field persistence | 4, 5 |
| F15 | Optimistic preferences, coalescing, rollback and stale-account guards | 4, 5 |
| F16 | Verified identity, private reads, ownership and server admin enforcement | 4, 5 |
| F17 | Admin merge/reassign transactions, persistent corrections, enrichment trigger | 4 |
| F18 | Admin mutation invalidation scope and refreshed catalog/showtimes | 4 |
| F19 | Public availability: valid URLs, language fallback, preferred-city selection, expiry | 3, 4 |
| F20 | Private one-shot subscriptions, duplicate recovery, cancellation, confirmed-cache behavior | 4 |
| F21 | Python recipient lookup, delivery snapshots and Resend idempotency | 5 |
| F22 | Signup/verification/login/logout/session refresh/expiration and account gating | 5 |
| F23 | Forgot/reset password token flows, current-password change, consistent policy | 5 |
| F24 | Auth UUID references/admin bootstrap, app-owned tables and restricted access | 5 |
| F25 | Raw/final/cinematheque worker schema, cleanup, run locks, timing, realtime remain compatible | 2, 4, 5 |
| F26 | Dev versus production credentials, preview origins/cookies, hosted dev seed/migrations | 2–5 |
| F27 | SQL baseline + future migrations replay correctly; no competing migration owners | 2–5 |
| F28 | Real Postgres integration, real-backend browser tests, no production-test writes | 2–5 |
| F29 | PR 2 Prisma-to-Drizzle conversion, observable endpoint parity, clean package/build graph | 2 |
| F30 | SQL/Drizzle mapping parity, native type semantics and forward-migration replay without drift | 2–5 |

## 8. Verification and handoff rules shared by all five PRs

### Evidence levels

- Unit/contract tests: pure functions, validation, mappers, cache semantics, controller/service boundaries with controlled dependencies.
- API tests: Supertest invokes the real Express app; targeted repository/identity failures may be injected to prove error handling. Test 401/403/404 and invalid input, not only successful JSON.
- DB integration: real Drizzle with disposable Postgres for mappings, constraints, transactions, and final auth persistence. API authorization tests must include users A and B; one active production user does not remove the need to prove ownership.
- Browser: fixtures help local regression checks; at least the critical migrated flows also run against the real Express/Drizzle stack in CI. Hosted dev/preview testing confirms deployed routing/assets/cookies/provider integration that fixtures cannot establish.
- Python: focused tests use existing repository/HTTP injection points and shared behavior fixtures; never scrape cinema sites or send mail as a test dependency.
- Build/deployment: validate frontend, server, shared package, root adapters, compiled Drizzle schemas/queries and assets. Builds must not require a database, Prisma engines or generated Prisma output. Distinguish local build success from a verified Preview URL.

Root `verify` should offer fast deterministic lint/format/typecheck/unit/build/bundle checks without needing database secrets. Expose separate mandatory CI commands for DB integration and browser end-to-end tests; those commands must fail clearly when prerequisites are absent, not silently skip and report green. Exact script names may adapt, but document them and use them consistently.

Use fixtures tied to a fixed clock for deterministic tests. Reuse focused existing tests rather than writing large suites that mirror implementation details. Stop widening test runs once required checks pass unless subsequent changes/failures justify another run. Do not remove tests, raise bundle budgets, relax validation/permissions, or disable CI to make a PR look successful.

Test bootstrap scripts accept a dedicated test URL, not an automatic fallback to root `.env`/production. Destructive commands should require an explicit test target and verify its identity. Keep this small and practical: one test database guard and separate configuration, not a new safety framework.

If plain Postgres needs Supabase roles or `auth.users` to apply the application schema, isolate minimal test-only compatibility definitions from deployable SQL. They do not prove GoTrue/PostgREST/Realtime behavior. Verify those integrations separately in hosted dev with its real Supabase services.

### Each chat's working rhythm

1. Identify repo root, branch, status, remote/base, instructions and active PR number. Preserve unrelated user changes. Prefer the attached checkout; create an isolated branch/worktree only as needed and permitted.
2. Read the predecessor's handoff and verify actual merged code. If the required previous PR is not present, identify the missing dependency and resolve the base with Jeremy; do not rebuild it from scratch on a stale branch.
3. Make a short implementation checklist for the selected PR, mapped to ledger IDs. List newly discovered affected call sites before editing their contracts.
4. Establish baseline checks relevant to the change. Record pre-existing failures with evidence; distinguish them from regressions. Do not run the real pipeline for baseline checks.
5. Implement in coherent slices, update all consumers, and verify each changed boundary. Use current official docs where version-sensitive APIs matter.
6. Re-read the whole diff and search for old imports, direct DB access, stale config and unhandled callers. Verify both branches of important conditions and plausible failure paths.
7. Run required gates and fix issues caused by the PR. When a check cannot run, state exactly why and the strongest substitute evidence; leave its status unverified rather than claiming it passed.
8. Update architecture/environment documentation, ledger, and the selected PR handoff. Commit/push only task changes and create/update one draft PR if access permits. Attach it to the Codex chat with available app tooling. Do not add reviewers or merge.
9. Final response: concrete behavior change, actual checks/results, PR link, deployment/migration status, outstanding external action, and the next PR's readiness. Do not equate a draft PR with deployed functionality.

### When code differs from this plan

Use current instructions, Jeremy's latest decisions, the real code/schema, and the plan's intended behavior in that order. Prefer the smallest sound adaptation. Record changed assumptions and downstream consequences in the handoff/decision log. Update the plan when a small finding invalidates a future instruction so the next chat does not follow stale guidance.

Ask Jeremy before changing a product behavior, adding a new hosted cost, replacing the selected stack, deleting non-rebuildable state, or executing an unapproved production cutover. Continue independent work while an answer is pending. Do not get stuck repeatedly retrying an inaccessible service or silently expanding scope to a framework rewrite.

An empty successful collection can be legitimate during rebuilding; decide and document its UI contract instead of preserving an accidental exception forever. Missing tables/config and malformed data are different failures and must not be disguised as an empty catalog.

## 9. PR 1 — npm workspaces and shared Zod foundation (existing predecessor)

Recorded PR: [#165](https://github.com/jeremyjacob101/Kartiseret/pull/165), branch `codex/backend-01-workspaces-contracts`, implementation commit `c5145a8250eacafb76806a10321a6cab317b3cdb`. PR 2 is already based on the workspace foundation. Inspect actual main/history if needed; do not reopen, rebuild or renumber this stage because the ORM changed.

### Objective and retained result

Root private npm workspaces, a single root lockfile, `packages/contracts`, explicit browser/server-safe ESM/type exports, shared Zod normalized models/primitives, pure date/filter/link/preference helpers, updated frontend/OG imports, root scripts, CI and Vercel root install/build. Existing frontend and Python paths stay in place. Authentication, database schema and product behavior were outside this structural stage.

### Read first

`docs/backend-overhaul/pr-1-handoff.md`, current workspace manifests/exports, Vercel/CI build commands, shared imports and affected existing tests. Use the implemented paths and script names, not the original suggested layout.

### Preservation checks for PR 2 and beyond

- Build shared contracts before consumers; npm workspace iteration is not an automatic dependency-graph build system.
- Keep explicit exports and independently importable emitted ESM. A Vite-only successful import is not evidence that Node/Vercel can resolve it.
- No ORM/server/auth instances, Node-only modules, DOM/storage initialization, secrets or map/Sharp dependencies in shared/browser imports.
- Keep provider DB-row parsing and browser persistence with their appropriate owners until their owning stage moves them.
- Preserve the custom import formatting, one lockfile, narrow lint/format scopes and dependency declarations per workspace.
- Preserve the existing 210 KiB gzip eager bundle budget unless a material measured change is explicitly justified; do not raise it to hide accidental dependencies.

### Evidence carried forward

The PR 1 handoff reports a clean lock-preserving install, root verification, six Node-importable contract subpaths, 488 existing frontend tests and a 207.5 KiB gzip eager bundle. PR 2 later reports 207.3 KiB. These are historical measurements; rerun relevant gates for the final Drizzle branch rather than reporting them as new results.

### Handoff continuity

Retain the existing PR 1 handoff and ledger rows F01/F02/F08/F09/F13. Do not rewrite its historical Prisma-era future expectations as if Drizzle was already implemented then. Add a current decision note pointing to this revision where useful.

## 10. PR 2 — finish Express/SQL/hosted-dev foundation, then convert Prisma to Drizzle

**Current existing PR:** [#167](https://github.com/jeremyjacob101/Kartiseret/pull/167), branch `codex/backend-02-api-prisma-foundation`. Keep that branch/PR identity even though its name contains Prisma. Update the final title to describe Express, Drizzle and PostgreSQL. Do not rename an active branch gratuitously or create a replacement PR.

### Objective and prerequisite

PR 1's workspace/contracts are already the base. PR 2's useful server/bootstrap/hosted-dev/CI code already exists. Finish and reconcile that foundation, then replace the current Prisma access layer with Drizzle as PR 2's final implementation phase. The final pushed/merge-ready PR must expose the same first API slice through Drizzle, retain all 18 table mappings and the SQL authority, preserve the unchanged browser/auth/Python behavior, and include new verification against the converted implementation.

No PR 3 public browser transport, protected feature API, Better Auth installation, auth data migration, UI redesign or production schema reset belongs here.

### Read first

The live PR's current metadata/file diff; local `git status`, branch/base and pending edits; PR 1 and PR 2 handoffs; architecture/verification docs; all server DB/repository/service/mapper/composition/env/test files; root/server manifests/lock/scripts/install allowlists/overrides; Vercel adapter and routing/asset config; CI Postgres bootstrap; baseline/legacy manifest/seed; DEV migration ledger and nonsecret environment identity; current stable Drizzle/node-postgres docs and Better Auth Drizzle compatibility. Do not dump `.env` values, credentials, sessions or private auth records.

### Phase A — preserve and finish the already written foundation

1. Inspect current main and the existing PR branch, including the latest concurrent Python changes. Establish which changes are pushed and which remain local. Preserve unrelated edits. Do not reset the worktree to the earlier GitHub snapshot or repeat PR 1.
2. Inventory the real working foundation: `createApp`, production/local startup, server-only env parsing, catalog mapper/service/repository interface, liveness/safe errors/404, root build order, explicit Vercel dispatcher, fixed OG handlers, optional Vite proxy, bootstrap/seed and required Postgres CI job. Complete any missing PR 2 behavior, without expanding into later features.
3. Reconcile the baseline version with DEV and pending local changes. DEV already records `20261015141043`; the old remote filename was `20261015122907`. Inspect final actual state and carry the intended alignment into the final PR commit. Update bootstrap references/legacy README/handoff consistently, retain checksum provenance, and do not reapply the baseline on existing DEV/production.
4. Retain the 18-table SQL snapshot, indexes/checks/grants/RLS/publication details and provider-managed prerequisites. Confirm the root/docs commands actually exist. In particular, remove or correct a historical `npm run db:test:up` example if that script does not exist; do not create Docker/local-DB setup to justify a stale example.
5. Retain DEV `jbydpmjjptwevyijarzl` and fictional fixtures. Verify final runtime-login/password/config setup status privately. Preview runtime `DATABASE_URL` must use the restricted DEV login; migration/admin credentials stay outside Vercel. No new project, billing change or reset is needed.
6. Establish a baseline of relevant existing checks/CI/Preview evidence. Preserve prior results as historical Prisma evidence. Capture deterministic expected DTOs/order/error behavior from the first catalog fixtures so the Drizzle conversion has a clear observable comparison.

### Phase B — final implementation phase of PR 2: replace Prisma with Drizzle

1. **Audit the complete Prisma surface.** Search tracked source/config/scripts/lock/CI/docs for Prisma packages/imports/generated output, `Prisma.*` types, `$connect`, `$disconnect`, `$transaction`, Prisma errors/Decimal/time assumptions and generation hooks. Record active consumers before deleting anything. Current expected callers are small, but inspect rather than assuming these are the only ones.
2. **Select compatible locked dependencies.** Add stable `drizzle-orm`; retain the existing `pg` and `@types/pg`. Add compatible `drizzle-kit` only if using explicit dev introspection/tooling. Check current package peer requirements and later Better Auth adapter compatibility. Prefer the ordinary supported stable query/relations family; docs showing `@rc` are not authorization to switch to release candidates. Do not add a second SQL driver, ORM, Zod generator or migration runner.
3. **Map all 18 existing application tables.** Add server-only Drizzle definitions under `src/db/schema` (or a coherent existing equivalent). Compare against the authoritative SQL baseline and current catalog metadata, with the old Prisma schema as a cross-check. Preserve table/column names, nullability, precision, defaults, real PK/composite keys and FK semantics. Explicitly handle nullable genres without Prisma's required-list workaround. Provider-owned auth references remain SQL-owned at this stage; any minimal reference declaration must not claim provider schema ownership or create provider objects.
4. **Prove mapping completeness.** Maintain a small table-to-definition inventory or meaningful metadata assertion that covers all 18 tables. Check more than two catalog fields: UUID/defaults, smallint/int/bigint distinctions, text ratings, numeric cinematheque fields, date/time/timestamptz/wall-time, JSONB, arrays, keys and nullable columns. Do not generate a second migration baseline or invent uniqueness to satisfy inference.
5. **Introduce the DB factory/lifecycle.** Replace `createPrismaClient` with a narrowly scoped factory returning the Drizzle handle plus pool/close capability and useful transaction types. Preserve bounded pool settings and current production `close()` behavior. Keep database creation out of shared/frontend code and side-effect-free test app imports. A warm Vercel instance reuses its composed pool; local/CI teardown ends it once. Do not disconnect after every HTTP request.
6. **Convert the existing catalog repository behind its neutral interface.** Replace `PrismaCatalogRepository` with `DrizzleCatalogRepository` or an equivalent implementation; update only composition/imports as necessary. Select the same properties with deliberate aliases so the existing mapper can retain its contract. Preserve `solo_update = false`, `popularity DESC NULLS LAST`, movie-ID ascending tie-breaker, bounded code chunks and bigint conversion. Empty lists must not produce invalid SQL. The current repository deliberately checks the codes relation even for an empty catalog; preserve that distinction or document/test a coherent readiness alternative without hiding missing schema as successful empty data.
7. **Keep observable HTTP behavior stable.** Preserve `/api/v1/catalog/now-playing`, the existing envelope/DTO/schema/error statuses, liveness semantics and unknown API JSON 404s. Browser callers have not switched yet. Preserve mapper normalization for NULL/array genres, text/numeric ratings, alternatives, pending rows and JSON-safe IDs/year. Do not change API paths merely to match old plan suggestions.
8. **Port real integration tests to Drizzle.** Replace query/transaction calls and ORM-specific representation assertions while preserving behavioral coverage: actual runtime-role success/denial, expected catalog DTO, nullable arrays, bigint precision, numeric ratings, date-only and local-time semantics, actual SQL CHECK failure and full rollback. A test requiring Prisma `Date` objects for SQL TIME or `.toNumber()` for Decimal must become a semantic assertion for the chosen Drizzle mapping. Exercise the real repository's DB error path as well as controlled service failures; a fake repository alone does not prove driver error handling.
9. **Verify transactions now.** Run an actual `db.transaction` write-and-late-failure test on the disposable admin test connection and assert no row survives. Keep the runtime connection restricted; do not grant writes merely so the foundation test can use that login. Later PR 4 adds appropriate write grants. Do not emulate transactions using sequential independent pool calls.
10. **Verify the hosted connection.** Retain the custom Supabase pooler login/host and safe TLS requirements. Inspect/remove Prisma-only URL options in examples and configured runtime settings as needed; never print or ask Jeremy to paste a secret URL. Test the first endpoint on DEV/Preview through the actual runtime credentials and Drizzle driver. If dashboard access prevents editing a variable, give exact variable/environment instructions and finish independent work first.
11. **Remove active Prisma machinery after replacement coverage works.** Remove `@prisma/client`, `@prisma/adapter-pg`, `prisma`, generated-client source/output usage, `prisma.config.ts`, `schema.prisma`, `scripts/generate-prisma.mjs`, obsolete ignore/config/lint paths and generation hooks. Remove root/server `prisma:generate`/`server:generate` dependencies; update integration/build/typecheck commands to compile or run directly. Do not leave a fake no-op generation script just to keep a stale command green. Clear ignored/stale generated output when verifying a clean build so it cannot conceal a missing import.
12. **Clean the package graph deliberately.** Update the single root lockfile with npm; do not edit it mechanically or recreate it with unrelated upgrades. Remove Prisma engine install-script allowlist entries and Prisma-only `deepmerge-ts`/`mysql2` overrides if no remaining consumer needs them. Retain unrelated source-map/sharp/esbuild fixes and other workspace dependencies. Confirm the actual resolved graph and audit results; do not claim prior zero findings necessarily persist.
13. **Keep DDL/CI/build boundaries intact.** The ORM conversion itself should leave baseline SQL/seed/application data unchanged apart from already required baseline-version reconciliation. Drizzle definitions compile without a client generator, live database or admin URL. CI uses the existing guarded disposable Postgres 17 path and real restricted runtime login; ordinary local `verify` stays database-free. Kit/introspection must never run automatically on build/install/start.
14. **Update final documentation and the SAME PR.** Save this revision, update architecture/verification/handoff/environment examples, replace active Prisma instructions and state the conversion location explicitly. Revise the PR title/body to Drizzle and remove stale provisioning claims when DEV already exists. Preserve useful historical evidence as labeled history. Commit/push only authorized PR 2 changes and update/attach its existing draft PR without requesting reviewers. Leave merge to Jeremy.

### Required evidence and acceptance gate

PR 2 is not merge-ready merely because its earlier Prisma version passed. Verify the final Drizzle commit:

- Clean Node 24 install and unchanged lockfile after reproducible `npm ci`; inspect dependency graph for absence of active Prisma packages unless a genuinely independent consumer is documented. Check fresh compiled output without ignored generated Prisma artifacts.
- Root `npm run verify`, narrow formatting/diff checks, server/contracts/frontend builds and eager bundle check pass. Frontend still uses its existing transport/auth and no Drizzle/pg/server internals leak into its bundle. Preserve the 210 KiB gzip budget.
- All 18 application table mappings are accounted for against SQL. Preserve physical nullable arrays, composite keys, provider FKs and Python schemas. SQL-only features remain represented in the authoritative SQL, not falsely omitted because a TS mapping does not express them.
- The required CI Postgres 17 job bootstraps the correct baseline/fixtures and passes Drizzle catalog/type/permission/constraint/rollback tests. Missing DB prerequisites fail clearly; no silent skip, SQLite substitute or mock-only proof.
- Supertest proves health, normalized catalog, invalid queries, DB/malformed-data errors, safe response details and unknown API 404. Compare fixture DTO/order/error behavior with the preconversion baseline; preserve code lookup semantics without an N+1 query.
- Native-type tests assert real SQL semantics under Drizzle, including large bigint values beyond the safe JS integer range where relevant, nullable genres, exact calendar/local-clock values and numeric conversions. Changing the test to assert only “some object returned” is insufficient.
- Hosted DEV/Preview verifies a real Drizzle runtime query using restricted DEV credentials; record deployment/source commit, endpoint status/content type and a recognizable fictional fixture. Preview build success alone is not runtime proof. Verify unknown API URLs do not return SPA HTML and existing SPA/OG routes still resolve.
- Search active code/scripts/config/package graph for Prisma leftovers, generated imports, missing scripts and stale URL options. Historical handoffs/plan discussion may mention Prisma; classify those deliberately instead of demanding a meaningless zero-word search.
- Run appropriate existing Python compile/tests where shared SQL/bootstrap/CI or current branch changes warrant it. Do not scrape, run watcher Git-sync behavior or send email. If no Python implementation changed, retain rather than rebuild its architecture.
- Handoff/ledger and PR metadata match the final Drizzle implementation. Report any external access/Preview limitation explicitly and distinguish code completion from operational verification; do not call an untested connection “verified.”

### PR 2 handoff must contain

Final branch/commit/PR URL; what foundation was retained; exact Prisma-to-Drizzle files and package cleanup; Drizzle/pg versions, DB factory/close/transaction types and mapping conventions; all-table inventory; first endpoint/interface/envelope; final active baseline version versus DEV ledger and historical cutoff; future migration replay method; exact root/server test/build commands; DEV identity and runtime/migration role-variable names; final CI and Preview commit/evidence; known production config/ledger steps before API-consuming deployment. Record F25–F30 and recheck F01/F02. State plainly that PR 3 starts on Drizzle and must not repeat the conversion.

## 11. PR 3 — public API reads, frontend transport, and social previews

Suggested branch: `codex/backend-03-public-data-api`.

### Objective and prerequisite

PRs 1–2 are merged, including PR 2's completed Prisma-to-Drizzle conversion. The API, actual Drizzle mappings, hosted dev, baseline, and CI Postgres exist. Verify PR 2's Drizzle gate and final handoff; if the base still uses Prisma, that prerequisite is missing and must be resolved rather than quietly postponing conversion into this stage. Move all public read consumers behind normalized API/service contracts, preserving the existing product and loading/cache semantics. Introduce meaningful Playwright coverage.

Protected preferences, subscription lists, and admin membership stay with PR 4; do not turn them into public endpoints to fit this PR.

### Read first

PR 2 final Drizzle factory/schema/transaction/error conventions, contracts/adapter/handoff and active forward SQL migration path; all of web `src/data/movieCatalog.ts`, `theaters.ts`, public availability fetches in `ticketAlerts.ts`; relevant schemas; `App.tsx`, movie/scroller/showtime/map/search consumers; both OG handlers and preview data/format/image/assets; date/filter/link helpers; existing cache/hydration and preview tests; Vercel rewrites.

### Implementation sequence

1. Verify the merged PR 2 Drizzle foundation, root/CI commands and baseline/DEV alignment. Add explicit forward SQL grants/policies for the additional public tables this PR reads; the runtime currently has only the first-slice permissions. Prove the queries using that restricted runtime login. Enumerate every public `.from(...)`/Supabase transport call in browser and OG code. Assign each caller to a feature endpoint or shared server service. Keep protected calls marked for PR 4.
2. Complete movies/coming-soon repository mappings and service contracts. Preserve ordering, normalized ratings/images/trailers/alternatives, pending enrichment filtering, and empty/error distinctions.
3. Supply permanent codes without an N+1 query per movie. The default is a bounded batched code lookup accompanying the catalog response, with the client deriving its code index from that same response. Do not invent a database FK across mismatched integer/bigint IDs. Use explicit safe joins/casts or bounded batched lookup that preserves precision and permanent codes.
4. Explicitly decide how code lookup failure is represented. Preserve usable catalog data and a completed failure/readiness state rather than leaving the page waiting forever. If simplifying the old asynchronous code hydration, replace its obsolete tests with behavior tests and compare request count/loading behavior. Do not keep a browser query to the `movieCodes` table as a hidden fallback.
5. Implement public showtime range queries with normalized wire records, full requested coverage, deterministic ordering, optional movie ID, sensible range bounds, and correct date/time serialization. Keep broad/targeted/incremental cache orchestration in TanStack Query, not as mutable per-user state inside Express.
6. Implement theater/city data using actual key/FK relationships. Preserve aliases, neighbors, map coordinates/zoom, theater links and ordering. Gracefully distinguish invalid nullable DB metadata from a lost join rather than manufacturing coordinates or hiding a failed query as no theaters.
7. Implement public ticket-availability reads independently from the city-browser cache. Preserve all-city candidates, English/Hebrew valid-link fallback, expiry and preferred-city selection. Do not accidentally narrow it to the currently selected city or the first page of showtimes.
8. Add a small typed fetch boundary using shared Zod response schemas and `AbortSignal`; avoid adding Axios or generated clients without an actual need. Keep relative `/api/v1` paths and frontend query/mutation error behavior coherent.
9. Split the old catalog file by ownership. Replace transports and database normalization with API consumers. Preserve query key dimensions, immutable merges, scoped range replacement, cancellation, targeted prefetch, arbitrary-date jumps, local search and app-state ownership.
10. Migrate OG data lookup to server movie/showtime services. Keep public OG URLs and Vercel wrappers stable. Prefer direct service calls over HTTP calls back to the same deployment. Keep server rendering and Sharp/native dependencies out of browser/shared packages.
11. If moving OG implementation into the server workspace, update every asset path, `index.html` lookup, dependency declaration, TypeScript build scope and Vercel `includeFiles` setting at the same time. Test built output from the deployed-style working directory.
12. Verify API route precedence against short codes, encoded URLs, `/reset-password`, normal SPA routes, and unknown API requests. Preserve HTML/JPEG fallback behavior and cache distinctions.
13. Add Playwright setup: deterministic fixture frontend tests where useful, real app/API/Postgres browser runs in CI, and hosted dev/preview smoke steps. Stub cinema/email endpoints and map tiles/remote posters as appropriate so availability of a third-party image server is not a basic application-test prerequisite.
14. Remove unused public Supabase row code/fallbacks/imports after all callers are migrated. Keep temporary Supabase auth and protected application-table access visible for PR 4. Update docs and ledger.

### Required product behavior

- Main catalogs still show movie information, grid/scroller views, local search rankings, artwork/trailers/ratings, and coming-soon date ordering.
- Initial requests do not fetch all cities and 180 days of showtimes. Preserve one-day initial city loading and existing incremental/targeted behavior.
- A movie-targeted fetch never marks the entire city/date window broadly loaded. A future jump does not falsely cover preceding dates. Refreshing a scope removes stale/deleted rows.
- Unknown or failed code resolution has a proper page state; plain/encoded codes remain case-sensitive. Now-playing versus coming-soon route preference remains deterministic.
- Dates are real ISO calendar dates; time serialization is independent of server timezone. Server current time is evaluated per request or provided through an injected clock, not a module-level fixed instant.
- The cutoff is 01:05 Jerusalem time with fifteen-minute showtime grace and correct post-midnight carryover/DST behavior. Browser/OG/Python link semantics continue to agree.
- The 62-day encoded-link window, filter masks, city fallback, relative versus absolute share paths, and invalid-link behavior remain coherent.
- Normalized API records can have a stable application name even if physical columns are snake_case. Do not make every UI component a Drizzle consumer.
- Use indexed/batched reads. Avoid per-movie sequential lookups and duplicated full datasets in the response. Preserve the eager bundle budget.

### Required evidence and acceptance gate

1. The merged predecessor already uses Drizzle. All added public-table grants/policies are explicit forward SQL, replay in CI, and queries succeed as the real runtime role. All-table schema mappings still agree with SQL after any changes.
2. Unit/contract tests cover all touched mappers, codes, native date/time/bigint conversion and malformed row behavior. Existing codec/date/property-style tests still pass against shared helpers.
3. Supertest plus real DB tests cover both catalogs, direct lookup if added, range boundaries/optional ID/invalid input, more than one page of listings, city joins, public availability URL fallback, and DB error behavior.
4. Cache tests prove existing broad/targeted readiness, replacement on refetch, deduplication, cancellation, and movie-code failure/readiness behavior through the new transport.
5. Playwright runs catalog/search, grid/detail, city/date/filter browsing, additional range loading, one direct short link, one encoded link, and an appropriate small/mobile viewport. Focus on changed data/navigation, not brittle pixel-perfect animation timing.
6. OG tests cover valid now-playing/coming-soon previews, expired/filter-selected listings, unknown/invalid links, escaped metadata, SPA fallback HTML, actual JPEG output, asset packaging, and guarded remote-image fallbacks. External URL fetches use fixtures for automated tests.
7. Build/package tests prove both static assets and server handlers resolve from a clean build. A hosted dev preview smoke verifies the intended URL paths, HTML/JPEG content types, image/fonts and source of DEV data; no API route returns SPA fallback HTML.
8. Compare request counts and representative payload sizes against the old loading path. Record observed timings if measured on comparable inputs; do not claim an API layer inherently makes the app faster. Avoid a new sequential HTTP hop in share-data access.
9. All existing frontend checks, server/contracts checks, integration and browser CI gates pass. Public Supabase browser/OG database transport is gone, with remaining private calls explicitly assigned to PR 4.

### PR 3 handoff must contain

Final public endpoints/DTOs and error contracts; catalog/code-hydration decision; client query/cache changes; OG implementation/dependency/asset locations; Vercel rewrite verification; Playwright fixture/real-backend commands and evidence; representative payload/request observations; remaining direct private Supabase calls. Update F03–F12/F19/F26/F28 with actual test or preview evidence.

## 12. PR 4 — protected application API, transactional admin edits, and persistence

Suggested branch: `codex/backend-04-protected-workflows`.

### Objective and prerequisite

PRs 1–3 are merged. Public data already uses Express. Move every protected application-table read/write to server services while continuing to use Supabase Auth sessions temporarily. Establish provider-neutral identity so PR 5 is an auth replacement rather than another feature rewrite.

### Read first

PR 3 transport/contracts and remaining private-call list; current Supabase identity/session behavior; full preferences store and definitions/default builder/save policy; account/signup UI; `adminStatus.ts`, current admin correction branches and invalidation rules; ticket subscription schemas/service/UI; actual constraints/FKs/policies; Python `MovieCodes`, correction maps, realtime watcher and targeted update stages.

### Implementation sequence

1. Enumerate protected operations, including hidden writes during preference initialization/default repair and protected reads. Current browser `.from(...)` calls must all be accounted for by the end of this PR.
2. Add a narrow server identity adapter that verifies Supabase access tokens using supported methods and returns an application-owned identity type. Never authorize from a decoded-but-unverified token, caller-provided user ID, or editable metadata. Feature services depend on the neutral identity/authorization interface.
3. Update the frontend API transport to attach the current Supabase access token on protected requests only. Preserve refresh/logout behavior and prevent stale requests from writing results into a different user's cache. Keep Supabase SDK use constrained to its temporary auth responsibility.
4. Implement own-account/admin projection, preferences read/initialize/partial-update, subscription list/create/cancel, and admin correction endpoints. Add `no-store` to private responses and authorization before privileged repository work.
5. Move preference default creation and missing-column repair into the service. Make initialization idempotent and preserve existing nonempty settings. Use a clear explicit initialization operation or documented service-side read-repair; do not hide a generic browser upsert behind the old store.
6. Keep the frontend's cohesive guest/theme/optimistic/coalescing/rollback protocol until there is a concrete reason to refactor it as a whole. Change its persistence boundary and neutral user type, not its source of truth piecemeal. Ensure per-field PATCH requests cannot clobber independently changed values.
7. Move authoritative subscription availability checking and duplicate handling into the service. Preserve all-city ticket validity, account-only one-shot semantics, existing sent-alert records, and cancellation behavior. Return only intended subscription summaries.
8. Implement admin membership checks on the server. Use a narrow correction command, never an arbitrary table-update body. Apply persistent `tableFixes`, source catalog changes, and affected showtime reassignment/deletion in a real Drizzle transaction.
9. Cover both correction branches: target already exists (merge), and new target (clear/re-enrich). Preserve source-aware now-playing/coming-soon behavior and realtime `solo_update` triggering. Keep metadata enrichment external to the HTTP response; no Selenium/TMDb crawl inside the transaction.
10. Reconcile current client behavior with real constraints. In particular the audited client clears coming-soon `release_date` to null, while observed `finalSoons.release_date` is NOT NULL. Fix this deliberately, preferably retaining the existing date while the row is flagged/hidden pending enrichment, rather than copying a known invalid write. Do not silently weaken the database constraint.
11. Reinspect `finalSoons` movie-ID uniqueness before selecting/updating a target. Use its real UUID PK for row-specific writes. If duplicate movie-ID targets are possible, define/test deterministic selection or a conflict result; do not use an arbitrary un-ordered `limit(1)` or update all matches accidentally. Do not add uniqueness merely to mimic the old Prisma API.
12. Preserve TanStack invalidation rules: now-playing correction invalidates its catalog, resets showtimes and invalidates public ticket availability; coming-soon correction affects its catalog; private subscription lists are not a generic admin-edit invalidation target.
13. Remove direct browser application-table access and obsolete transport tests. Keep Supabase signup/login/logout/recovery APIs functioning until PR 5, with signup default persistence now calling the API.
14. Prepare/apply explicit forward DEV grant/policy changes for protected tables and the migrated browser access model. The restricted runtime role is not automatically authorized by a browser Supabase token; enforce account/admin predicates in services and use the intended SQL permissions. Preserve Python service-role Data API and realtime functionality. Inspect realtime publications and replica identity before assuming a direct Drizzle update will reach the existing watcher. Do not disable Realtime or the Data API globally.
15. Run the existing Python updater/repository code against controlled fixtures or DEV only as needed to prove the admin signal contract. Tests must not trigger Git sync/push or launch a real Selenium job. Document the production job pause/restart sequence only if an actual schema operation requires one.

### Preference and auth-transition details

The app stores `user` in its preferences protocol today and uses Supabase user metadata to carry signup location. During this PR the adapter may retain that provider data internally for defaults, but components should consume a minimal neutral user identity. Signup metadata may select an ordinary preference; it must not grant admin access.

Test explicit instant signup and first confirmed login. If an existing DB trigger creates defaults, chosen signup location must still take the intended precedence without repeatedly overwriting established preferences. Distinguish guest location/site-color cache behavior and account-only rating-source behavior from server persistence.

On identity change, cancel/invalidate or remove private queries for the departing account and discard delayed private results. Keep public caches reusable. The API must independently enforce ownership even if the UI supplies the wrong cache key.

### Transaction and race details

- Failures midway through correction roll back every related SQL change, including the persistent fix row. Prove this with an injected late DB failure/constraint in integration tests, not only a mocked transaction callback.
- Avoid adding account-alert FK dependencies on ephemeral catalog records: the current schema intentionally keys alerts by movie ID without requiring a current catalog row.
- Handle duplicate subscription insertion through its real composite key using scoped conflict SQL or a correctly recovered PostgreSQL unique violation. If a unique violation occurs inside a transaction, do not issue the recovery SELECT on the aborted transaction without rollback/savepoint. Check the actual driver SQLSTATE/constraint through any error wrapping, not old Prisma error codes; recover the existing result. Do not turn a harmless duplicate into a 500 or automatically resend a notification.
- A pre-insert availability check is not globally atomic with asynchronous publication. Define acceptable semantics: show available immediately when detected; otherwise store a pending subscription which the dispatcher will pick up on a later run. Do not promise impossible exactly-once availability detection or introduce a queue system.
- Preserve existing delivery IDs/snapshots/attempt state and Resend idempotency. Do not reset sent subscriptions to pending in ordinary API saves.
- Admin corrections should preserve permanent-code storage rather than regenerate the code table. Any new aliasing semantics for previously incorrect movie matches require an explicit product decision; do not invent a URL migration system in this PR.

### Required evidence and acceptance gate

- Forward SQL grants/policies and protected-table mappings replay from the PR 2 baseline in CI. Drizzle transactions and ownership predicates use the intended runtime connection, not an all-powerful test substitute.
- Supertest covers missing/expired/invalid tokens, authenticated access, user A versus B ownership, non-admin denial, body mass-assignment rejection, validation failures, proper statuses, and private cache headers.
- Exercise the production token-verification adapter with controlled signed tokens or mocked provider responses at its boundary. Keep injection in test composition; do not add a production `TEST_MODE` endpoint or environment bypass that accepts arbitrary identities.
- Real Postgres tests cover preference initialization/partial updates/constraints, duplicate subscription races, both admin branches, rollback after a late failure, and actual `solo_update`/row outputs for Python.
- Existing preference tests still prove optimistic rollback, rapid-save coalescing, latest-intent wins, signup-location defaults and account generation guards using the new transport.
- Alert tests prove confirmed-cache merge, no automatic write retries, sent-record behavior, server precheck, duplicate recovery and cancellation failure behavior.
- Playwright against the real app/API in CI covers a controlled account's settings, failed save UX, subscription create/list/cancel, non-admin behavior, and an admin correction with stubbed enrichment. Hosted dev additionally verifies real Supabase session verification and a controlled realtime signal without running production jobs.
- Repository search confirms no browser application-table reads/writes remain. Document any remaining SDK calls as auth-only. Public/OG regressions and bundle/build checks remain green.
- Permissions rehearsal in hosted dev shows browser direct table access has the intended restrictions while Python's service-side compatibility is preserved. A test as database superuser alone is not evidence that grants are correct.

### PR 4 handoff must contain

Neutral identity shape/provider adapter; remaining Supabase auth-only calls; protected routes/contracts; preference initialization and save protocol; transactional correction semantics/constraint fixes; worker/realtime signal evidence; grants/policies to transition in production; private cache behavior; CI/hosted dev evidence; exact remaining auth FKs/triggers/metadata dependencies for PR 5. Update F13–F20/F25–F28.

## 13. PR 5 — Better Auth and app-owned accounts

Suggested branch: `codex/backend-05-better-auth`.

### Objective and prerequisite

PRs 1–4 are merged. All browser application data goes through Express; only authentication still uses Supabase SDK APIs. Replace that identity provider with Better Auth inside Express, preserve application authorization contracts, and update every remaining dependency on Supabase Auth, especially database user references and Python notification recipients.

This is a replacement of authentication, not a redesign of account settings or a new authentication protocol written from scratch.

### Read first

PR 4 identity/persistence handoff; current frontend auth-only call list; auth-related schemas/forms/store/bootstrap; current Better Auth Express/Drizzle/database/session/cookie/email documentation; actual `auth.users` FKs, triggers and policies; Vercel Preview/Production origin/secret configuration; Python notification repository and Resend transport; all existing signup/recovery/auth tests.

### Implementation sequence

1. Verify all protected feature services accept neutral verified identity. Inventory any leftover Supabase `User`, `Session`, user-metadata, auth-admin, callback and table-reference assumptions across TypeScript, SQL, scripts and Python. Fix only necessary stragglers from the migration boundary.
2. Add compatible stable Better Auth core/Drizzle adapter packages to the server and its appropriate browser client to the frontend. Verify the installed-version package/import path, PostgreSQL provider option, Drizzle schema mapping, transaction support and relations API before using examples. Current official documentation shows `@better-auth/drizzle-adapter`; earlier versions may expose different paths. Choose one compatible family and lock it. Do not install or reintroduce Prisma. Keep server initialization/secrets entirely outside browser exports.
3. Generate/review the required user/account/session/verification Drizzle tables and configure UUID IDs. Use a distinct non-exposed application namespace such as `app_auth` when the selected adapter/pgSchema mapping supports it; NEVER reuse or take ownership of Supabase's provider-managed `auth` schema. Otherwise use explicitly restricted app tables with anonymous/authenticated Data API grants revoked. Supply the adapter's expected model-key/physical-table mapping and any required relation metadata. Keep auth timestamp modes compatible with the adapter; they need not match cinema-date string modes. Validate types/keys/defaults/indexes and tested schema-qualified queries rather than assuming naming protects data.
4. Add auth SQL only through the established timestamped Supabase migration workflow and keep Drizzle definitions in sync. The pinned Better Auth CLI may generate schema source into a reviewed scratch/output path; it must not overwrite the full application schema or run migrations automatically. Do not use Drizzle Kit push/migrate, a runtime migrator, Prisma Migrate or an independent Better Auth migration engine. Extend CI to replay every forward auth/FK/grant migration and test upgrading from PR 4 state as well as a fresh bootstrap.
5. Mount the Better Auth handler at `/api/auth/*` using the selected Express version's catch-all syntax, before JSON body parsing as required. Keep `/api/v1`, OG and static SPA routes functioning, and make sure Vercel forwards the full auth path correctly.
6. Keep authentication minimal: email/password, verification/reset, ordinary database-backed cookie sessions, expiry/revocation, secure origins/cookies and built-in abuse protections. Do not add social providers, organizations, passkeys, a JWT plugin, access/refresh-token rotation machinery, session cookie caching, Redis or optional auth plugins without a concrete need. Confirm the Drizzle adapter's transaction option is supported/enabled where needed; test actual auth persistence and rollback instead of assuming the adapter uses a transaction because application services do. For Vercel, use a supported persistent/database-backed auth limiter or verified platform protection rather than assuming one process's memory coordinates all instances; no Redis service is required by this plan. Apply middleware/session lookup only where needed; public catalogs should not incur an auth database query on every request.
7. Implement verification/reset mail callbacks using the existing Resend service and a small injectable server transport; Node's fetch is sufficient if no SDK is needed. Use separate dev/prod sender/recipient configuration. Tests capture emails/tokens; secrets, reset URLs/tokens and passwords must not appear in routine logs or committed artifacts.
8. Preserve the custom React account menu and forms. Replace Supabase sign-up/sign-in/sign-out/forgot-password/update-password calls with the Better Auth client. Keep provider details behind a small auth client/session boundary and feed the existing neutral identity/preference protocol. Do not create a second competing session store.
9. Implement real reset-token handling on `/reset-password`. It must support a valid reset link while signed out, invalid/expired/consumed tokens, confirmation/mismatch validation, and appropriate post-reset behavior. A current session alone is not proof that a reset token is valid.
10. Align frontend Zod schemas, HTML input constraints/messages, server policy and tests. Current change-password UI allows six characters; Better Auth defaults to eight. Use a clear documented policy, normally the library's sensible default, and apply it consistently to signup/change/reset. Existing signup has no name input: derive a safe default display name or configure a supported compatible model instead of adding a needless required UI field.
11. Preserve signup-location defaults and guest behavior through the new lifecycle. Explicitly carry ordinary signup location through allowed input/hook logic and initialize preferences idempotently at a suitable lifecycle point. Require verified identity for authenticated operations and a verified canonical email for ticket delivery. Server-owned admin status must never be editable signup metadata.
12. Implement the account-data transition with the simple approach described below: preserve UUID references when practical, allow the active account to establish credentials/reset/login again, and deliberately handle all existing FK-referenced rows. Do not migrate session tokens or password hashes merely to avoid one user logging in again.
13. Repoint application FKs to app-owned users, update any old signup/default triggers and relevant RLS/grants, and update the explicit admin bootstrap workflow. Keep Supabase's provider-managed `auth` tables intact unless Jeremy separately requests deletion; retiring their application use does not require destroying them.
14. Switch the server identity adapter to Better Auth sessions and remove temporary Supabase bearer verification and browser auth SDK use. Old Supabase access tokens must not continue authorizing the new application API through an undocumented compatibility path.
15. Update Python's recipient lookup and its environment as described below. Keep its other Supabase table access, existing dispatcher scheduling, delivery snapshots, retry behavior and email idempotency intact.
16. Remove obsolete frontend Supabase client/config/identity schemas, Vite public-key injection/resource hints, dead auth callback assumptions, and SDK dependencies where no longer used. Keep Python Supabase and Realtime configuration. Verify root API dependencies and generated types still package correctly.
17. Rehearse the final migration and active-account setup in hosted dev, test real preview cookies/callbacks, and produce the short production cutover checklist. Complete code/CI verification before requesting any production operation not already authorized.

### Account transition: simple, explicit, and referentially complete

The active user can sign in again, so preserving current sessions or converting password hashes is unnecessary. The goal is reliable identity links and a controlled way to establish credentials, not a general migration product.

Prefer UUID identity continuity if supported by a tested import/bootstrap process. Otherwise create the new active user and transactionally map their preferences, admin membership, and subscriptions to the new UUID. Use trusted existing identity information and supported library/seed APIs; never ask Jeremy to paste a password into chat or commit a default password.

Inventory all application rows referencing old auth IDs. Observed metadata had several preference rows even though Jeremy is the only active user. Either preserve minimal corresponding app-owned identity records without importing sessions/passwords, or obtain an explicit decision about discarding known obsolete rows. A new FK cannot be applied while unexplained referenced IDs are left orphaned. Do not bulk-delete account rows as an inferred shortcut.

Seed admin membership only for a deliberately selected trusted identity through a documented operator script or reviewed migration. No public bootstrap endpoint, first-signup-is-admin behavior, hardcoded privileged password, or editable metadata flag may grant admin access.

For production, a compact sequence is sufficient: export wanted small reference/account tables; pause only an affected notification job if necessary; apply reviewed schema/data transition; deploy compatible auth code/config; establish the active account/admin mapping; check login/settings/alerts; resume the job. Adapt ordering to actual SQL/deploy dependencies. Record what is irreversible and the previous known-good deployment/config. Do not construct a long-lived dual-auth or dual-write mechanism.

### Python recipient lookup after Supabase Auth

Current `get_canonical_auth_email` calls `supabase.auth.admin.get_user_by_id`. It will be wrong once application users belong to Better Auth. This must be changed in the same PR as the identity cutover.

Default design: a narrowly scoped internal Express endpoint, such as `POST /api/internal/ticket-alert-recipients`, reads only canonical user ID/email/verification status through Drizzle. Authenticate it with a separate server-to-server secret, validate/bound requested UUIDs, return `no-store`, and expose no password/session/account-provider data. An internal batch lookup is useful but a simple controlled lookup with per-run memoization is sufficient for the current single-user scale.

The Python repository already has a `canonical_email` boundary and injected HTTP/repository dependencies. Adapt it using existing `requests`, finite timeouts and useful failure reporting. Configure a required API base URL and internal credential in the Python environment; dev must not default to the production endpoint. Keep `SITE_URL` for generated email links and the lookup base URL clearly distinguished if needed.

If unavailable, unverified, missing or malformed recipient data is returned, record a delivery failure/retryable state using the existing dispatcher machinery. Do not fall back to an arbitrary client-provided email or the retired Supabase auth lookup. Do not issue a new delivery ID on every retry.

An explicitly justified alternative is a suitably restricted direct database recipient lookup. Use that only if it reduces the real deployment complexity, with dependencies/permissions documented and no auth-table exposure through the public Data API. Do not create both lookup architectures.

### Hosted dev and cookies

- Preview uses the dev database and dev auth secret/base URL; production uses its own values. Keep session cookies environment-specific and do not set a broad shared parent-domain cookie unnecessarily.
- Verify exact callback and trusted-origin behavior for the actual Vercel preview deployment. A current preview URL is not the production origin; do not assume a secret named `SITE_URL` alone configures every library behavior.
- Optional Vite development uses a same-origin API proxy and explicitly allowed local origin with the dev backend/database; no local Postgres is needed.
- Keep Better Auth's session/CSRF/origin protections enabled appropriately. Test session-expiry/revocation and state changes through cookies; cookie caching is an optional performance tradeoff with revocation implications, not a default substitute for authorization.
- Use local/CI captured mail for automated reset/verification tests. A controlled hosted-dev mailbox check can verify real delivery when explicitly configured, without sending to production recipients or running the full ticket pipeline.

### Required evidence and acceptance gate

1. Real Postgres migration tests apply the app-owned auth schema and new account FKs from the PR 4 state. Verify data mapping, correct keys, constraints, indexes, restricted grants and absence of orphaned references.
2. Real Better Auth + Drizzle-adapter integration tests exercise account creation, verified/unverified states, session creation and expiry, logout/revocation, password setup/change/reset, and one-time/expired verification/reset tokens. Use the library's actual handlers and an injected mail capture with deterministic tokens/clock where supported.
3. Supertest proves all PR 4 private endpoints still enforce ownership/admin checks with the new session adapter. An old Supabase bearer token, another user's identifier, and an unsigned/fabricated cookie do not gain access. Public endpoints still work without a session.
4. Playwright against the real app/API/Postgres proves signup and captured verification, login, refresh/session restoration, settings defaults, alert create/list/cancel, logout, signed-out `/user` gating, forgot/reset password including signed-out token flow, and current-password change. At least one failed/expired flow is visible to the user correctly.
5. Preference race/coalescing/rollback and account-specific cache tests still pass. Public catalog/search/showtime/direct-link/OG flows remain green after removal of the browser Supabase SDK.
6. Python unit tests prove app-owned canonical recipient lookup, verification/missing-user/error behavior, finite HTTP timeouts, preserved existing delivery ID/idempotency on retry, and unchanged link/date fixtures. Mail tests use injected transports and never send live messages.
7. Hosted dev/preview acceptance verifies the actual deployed auth route, cookie flags/origin handling, verification/reset callback destinations, login/logout/page refresh, private API access, and the internal recipient endpoint with dev-only credentials. This is the provider/deployment evidence that CI fixture compatibility cannot replace.
8. Repository search finds no active frontend Supabase auth/database client, no application calls to `auth.admin.get_user_by_id`, no obsolete application FK to `auth.users`, and no accidental browser import of Drizzle/Better Auth server internals. Historical SQL/provider-managed state may still mention Supabase Auth; distinguish history from active dependencies.
9. Python service-role Data API and Realtime remain configured. Do not claim all Supabase services were removed. Main catalogs, cinematic worker tables, correction maps, run locks/metrics, and existing scripts remain compatible.
10. Full workspace checks, DB integration, browser CI and targeted Python checks pass. Record final client bundle size and real preview verification. Document production cutover state separately.

### PR 5 handoff must contain

Final auth configuration and server/client boundary; app-owned table/schema names and UUID policy; account transition/admin bootstrap procedure; migrations/FK/grant changes; mail policy/callbacks; Python endpoint/lookup/env changes; removed Supabase browser dependencies; actual CI/preview results; whether production cutover happened and under what authorization; any operator steps left. Close F21–F24 and reverify all shared ledger rows affected by the final transition.

## 14. Cross-PR release checklist

This is a practical compatibility guide, not a demand for separate infrastructure or elaborate releases.

| After PR | What must be true before shipping its changed live behavior |
| --- | --- |
| 1 | Root install/build/lockfile changes work in Vercel and existing SPA/OG paths still package correctly. |
| 2 | Final pushed PR uses Drizzle, has new real-DB/Preview evidence and aligned baseline history. Existing browser/auth/Python transport remains compatible; production API runtime config is deliberately prepared before any production API use. |
| 3 | Public API endpoints, server assets and rewrites are deployed together with the frontend transport change. Root/short/encoded/OG routes work; data is not silently truncated. |
| 4 | Temporary Supabase session verification works in production config; transactional writes and Python enrichment expectations agree; intended browser grant changes do not block the remaining auth calls or worker. |
| 5 | App-owned auth tables, all needed user mappings/FKs, mail callbacks, cookies/origins, admin setup, and Python recipient lookup are ready for the coordinated cutover. |

Merging may trigger an existing Vercel deployment. Every PR description must state whether it is immediately production-compatible and which environment variables or migrations must be applied before merging. If automatic deployment would expose incompatible code, leave the PR ready but unmerged with concrete ordering instructions; do not assume documentation alone configured the live environment.

Database migration and application deployment are distinct operations. Test migration-before-code/code-before-migration ordering for the affected change. Prefer additive changes and a short explicit switch over a framework for backward compatibility. Do not require a rescrape when preserving the current physical schema already avoids the need.

## 15. Proof of completeness: required final searches and checks

Use targeted searches and inspect every result; do not rely on a filename inventory or a single broad green command. Adapt paths to the actual tree.

| Check | What to inspect |
| --- | --- |
| Browser DB access | Supabase `.from`, `.rpc`, direct REST/table URLs; by end PR 4 none should remain for application data. |
| Browser auth access | Supabase client initialization, `auth.*`, `User`/`Session` types, Vite injected globals; by end PR 5 active browser dependencies should be removed. |
| Server/private leaks | Shared/client imports of Drizzle, server auth handlers, Sharp, Node-only modules or secrets; inspect actual emitted bundle. |
| Auth references | `auth.users`, `auth.uid`, auth trigger functions and FK definitions; distinguish historical SQL from deployed active schema. |
| Python identity | `auth.admin`, `get_user_by_id`, recipient source and URL defaults; active recipient logic must use app-owned identity after PR 5. |
| Worker contracts | Physical table names, primary/upsert keys, `solo_update`, correction helpers, realtime publication, cleanup scripts and run-lock/timing assumptions. |
| Route/config | API before SPA fallback, short/encoded links, auth/recovery route, forward headers, Vercel function paths/assets, env scope and CI cache paths. |
| Native types | Drizzle/pg mappings versus SQL, nullable arrays, numeric strings, bigint precision, calendar/local time versus instants/wall time, request-scoped clock, Jerusalem cutoff/grace/DST. |
| ORM transition | No active Prisma packages/generated imports/generation hooks/error codes; classify historical mentions. PR 2 final handoff and CI evidence must describe Drizzle. |
| Migration replay | Baseline applied once, correct DEV version, every forward SQL migration included in fresh CI bootstrap and upgrade tests; no competing Drizzle migration ledger. |
| Error/empty behavior | Unauthorized and invalid requests, valid empty result, malformed external data, unavailable DB/mail, partial transaction failures. |
| Tests | Required integration/e2e jobs actually ran; no empty-suite success, broad skips, production seed/reset, or fake auth routes in deployed code. |

Evidence should include exact command names, exit/results, CI run link/commit when available, preview URL/commit, and specific behavior assertions. Large raw logs, credentials, screenshot collections without assertions, and checklist ticks are not substitutes for a conclusion supported by a test.

No single PR must prove the entire future system before that system exists. Each must prove its own changed contracts and keep predecessor gates passing. PR 5 performs the final end-to-end closure across the ledger.

## 16. Required PR handoff template

Save one concise durable handoff per PR under `docs/backend-overhaul/pr-N-handoff.md`. Use the actual files/commands/URLs; leave unknown/unverified fields explicit.

```text
PR number/title:
Base branch/commit:
Implementation branch/commit:
Draft PR URL:
Implemented scope and user-visible behavior:

Architecture/contracts introduced or changed:
- Final endpoints, request/response shapes, identity/cache ownership.
- Exact package/script/import locations the next PR should use.

Database:
- Schema/migration files, baseline cutoff and replay path.
- Dev application status; production application status.
- Runtime/migration permissions and connection-variable names.
- Data preserved/reset/remapped and any outstanding operation.

Hosting/environment:
- Vercel adapter, route and asset details.
- Dev project/preview identity, safe config variable names, mail policy.
- Production configuration/ordering required before merge/deploy.

Verification:
- Commands and observed results, with relevant behavior covered.
- CI run/commit; preview URL/commit and flows actually checked.
- Ledger IDs satisfied or remaining.
- Explicitly distinguish mocked, real DB, hosted-provider and production evidence.

Adaptations/discoveries:
- What differed from the master plan and why.
- Which future instruction/contract was updated as a result.

Next PR readiness:
- Preconditions met.
- Remaining blockers or user actions with concrete reasons.
- No hidden TODO that leaves the current PR's promised feature incomplete.
```

Draft PR descriptions should lead with the problem/result and relevant validation. Include deployment/migration ordering when material. Avoid dumping the entire plan into the PR description. Do not request reviewers, add reviewer mentions, auto-merge, or use a review bot merely because a PR was created.

## 17. Decisions the implementing agents may make without asking again

- Precise module/file names and small function signatures that fit the real repository.
- Compatible stable dependency patch versions after checking current docs and locking them.
- DTO decomposition, explicit internal helper boundaries and removal of obsolete transport-only code.
- A small number of meaningful fixture records/tests and deterministic failure injections.
- Drizzle table/property/module names, explicit native-type modes and narrow pg query helpers preserving the physical SQL schema and public DTO behavior.
- Reasonable API error/status mapping and bounded inputs preserving valid app behavior.
- Cleanup of newly dead imports/config generated by the selected PR.
- Reconciling the already pending baseline filename/version correction with the actual DEV ledger, with evidence; extending clean CI bootstrap to include future SQL. Applied migration contents are not rewritten to smuggle in new DDL.

Get Jeremy's decision for a new billable service, reuse/deletion of an existing hosted project, destructive production data changes, a material product change, a different auth/database/framework choice, or unapproved production operations. Explain the concrete reason and finish independent work before asking for a final operational approval. Do not repeatedly ask for authorization he already supplied.

## 18. Current documentation references

Verify version-sensitive behavior when implementing rather than pasting examples blindly. These are source references, not instructions to add every product they mention.

- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- [Express routing/security/middleware](https://expressjs.com/en/guide/routing/)
- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel environment scope](https://vercel.com/docs/environment-variables)
- [Drizzle with node-postgres](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle on an existing database](https://orm.drizzle.team/docs/get-started/postgresql-existing)
- [Drizzle PostgreSQL types](https://orm.drizzle.team/docs/column-types)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Drizzle/Supabase integration](https://orm.drizzle.team/docs/connect-supabase)
- [Supabase hosted environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase billing/project eligibility](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [GitHub Actions Postgres services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [Better Auth Express](https://better-auth.com/docs/integrations/express)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — verify package/import and relations family for the locked versions; optional CLI migration examples do not override the single SQL authority.
- [Better Auth schema/UUIDs](https://better-auth.com/docs/concepts/database)
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management)
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password)
- Better Auth: [cookies](https://better-auth.com/docs/concepts/cookies) and [rate limiting](https://better-auth.com/docs/concepts/rate-limit).
- [Playwright](https://playwright.dev/docs/intro)
- [Supertest](https://github.com/forwardemail/supertest)

## 19. Start instruction for the implementation chat

Execute only the PR number Jeremy selected. Current starting instruction is to FINISH THE EXISTING PR 2, adding the Prisma-to-Drizzle conversion as its final implementation phase before final push/merge readiness. Preserve its useful foundation and latest local baseline/DEV updates. For later PRs, require the merged Drizzle predecessor. Begin by stating the selected scope, inspecting the actual checkout/live PR/predecessor handoff, and identifying the first concrete slice. Implement and verify it through the selected PR's acceptance gate. Adapt to evidence, preserve existing feature contracts, and leave a clear handoff rather than blindly following stale paths or declaring the entire overhaul complete early.
