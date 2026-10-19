Warning: truncated output (original token count: 29364)
Total output lines: 820

# Kartiseret backend overhaul — revised Drizzle master execution plan

Prepared 2026-10-15 for Jeremy. Intended executor: Jeremy's selected GPT-6 Luna chat with Max reasoning effort. This is a complete replacement for the earlier Prisma master plan, adapted to the work already completed. It contains the overall architecture, preservation requirements, all five PR stages, implementation sequences, verification gates, release ordering, and handoff requirements.

**Current status (2026-10-19): PR 1 and PR 2 are merged to `main`; PR 2's Drizzle conversion is complete. PR 3 is implemented and remains an unmerged draft. Full checks and authenticated Preview API/OG smoke pass on the current PR head. Production's schema, restricted runtime roles/grants, and all three migration records are verified. After Jeremy updated the Production `kartiseret_api` password and Production-only `DATABASE_URL` and redeployed, the live Production `/api/v1/catalog/now-playing` route returned HTTP 200. Production `/api/v1/health` also returned 200; the PR 3-only `/api/v1/catalog/coming-soon` and `/api/v1/theaters` routes still return 404 because PR 3 is not deployed to Production yet. GitHub reports PR #170 mergeable/clean against current `main`; it is two commits behind, and those main-only changes touch `.gitignore` and generated backend log artifacts with no file overlap. No Production credential work remains before merge; verify the PR 3 routes after deployment.** The original preparation snapshot and PR-specific implementation instructions below are retained as historical context; where their “right now” wording conflicts with this status, follow the current PR 3 handoff and current repository state.

The project has completed the workspace/shared-contract foundation and the Express/SQL/hosted-DEV/PostgreSQL CI/Drizzle foundation. PR 2 merged as `c10cd50f2b98992edbaeb9f49b903fe827b81d94`. PR 3 moves public reads and social previews behind Express + Drizzle, preserves protected client operations for later PRs, and adds real-PostgreSQL/browser acceptance coverage. Better Auth remains the selected authentication library for PR 5, using its Drizzle adapter; this does not select the separate OpenAuth project or introduce handwritten authentication.

This document is an implementation specification with an evidence-backed status snapshot. It does not assert that PR 3 is merged or deployed. Recheck the PR 3 handoff for current evidence and exact post-deployment Production smoke steps.

## 0. How Jeremy should use this revised document

### Current stage: PR 3

Use `docs/backend-overhaul/pr-3-handoff.md` as the current stage handoff. PR 3's code, current CI, and Preview acceptance pass. Production schema/role/migration preparation is complete, and the now-playing database API returned HTTP 200 on `main` after the Production credential update and redeploy. GitHub reports the PR mergeable/clean against current `main`; its two newer commits only touch `.gitignore` and generated backend log artifacts, with no overlap. Check PR 3's newly added routes after deployment. PR 3 remains a draft until Jeremy decides to merge it. Do not request reviewers.

The PR 2 instructions and Drizzle-conversion details later in this document are retained as historical specification/evidence. Do not restart PR 2 or repeat its conversion.

### Later: one chat for each remaining PR

After Jeremy merges the preceding completed PR, open the next implementation chat on the updated base. Paste or attach this entire revised plan and prepend:

> Implement PR N only from the attached revised Drizzle backend-overhaul master plan. Read the actual merged repository, applicable instructions, verification ledger, and previous handoffs first. PR 2 must already contain Drizzle; verify that prerequisite before implementing later stages. Complete this PR's implementation and verification, update its handoff, and create a draft PR if repository access permits. Adapt justified details to the code and document deviations. Do not implement later PRs, merge, or request reviewers.

Replace N with 3, 4, or 5. Supply the whole document so the executor sees the shared constraints and future dependencies. It may read the plan from the repository instead if the same revision is committed and available. A file saved only in another worktree is not automatically present in a fresh chat/worktree.

Canonical revised filename: `docs/backend-overhaul-master-plan-drizzle.md`. The old `docs/backend-overhaul-master-plan.md` and `docs/backend-overhaul-audit.md` are historical context. This revision superseded conflicting Prisma instructions and old assumptions that PR 2 had not started or DEV did not exist. Its original preparation snapshot is intentionally preserved below; the status block at the top and `docs/backend-overhaul/pr-3-handoff.md` are the current source of truth. Keep useful predecessor handoffs and label older evidence as historical.

### Five-PR sequence and present status

| Stage | Scope | How to treat it now |
| --- | --- | --- |
| PR 1 | npm workspaces and shared Zod/domain foundation | Existing predecessor; verify its merged result, do not rebuild it |
| PR 2 | Express, SQL baseline, hosted DEV, Postgres CI, first public read; Drizzle | Merged into `main` as `c10cd50f`; conversion complete |
| PR 3 | Complete public reads, frontend transport, social previews, Playwright | Implemented on PR 2's merged base; CI/Preview pass; Production health and existing now-playing API return HTTP 200 after credential update/redeploy; PR 3 routes await deployment; remains a draft |
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
6. Generate/names new SQL migration files using the current Supabase CLI convention (`--help` first); do not require Docker or nati…13364 tokens truncated… pause/restart sequence only if an actual schema operation requires one.

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

Execute only the PR number Jeremy selected. **Current stage: PR 3**, with PR 1 and PR 2 already merged to `main`. Start from the actual current checkout and the PR 3 handoff, verify the merged Drizzle predecessor, and implement/verify only PR 3. Keep PR 3 unmerged until refreshed CI, authenticated Preview acceptance, and the documented Production preparation gate are complete. Do not request reviewers. Adapt to evidence, preserve existing feature contracts, and leave a clear handoff rather than blindly following stale historical snapshots or declaring the entire overhaul complete early.
