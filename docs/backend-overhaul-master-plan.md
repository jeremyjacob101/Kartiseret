# Kartiseret backend overhaul — master execution plan

> Superseded on 2026-10-15 by [the revised Drizzle master plan](backend-overhaul-master-plan-drizzle.md). Jeremy requires the Prisma-to-Drizzle conversion at the end of the existing, unmerged PR 2 before its final push/merge readiness. Use the revised document for implementation; this file preserves the original planning history.

Prepared 2026-10-15 for Jeremy. Intended executor: GPT-6 Luna with Max reasoning effort, selected by Jeremy in Codex. Execute in five sequential chats, one PR per chat.

This document is deliberately self-contained. It includes the project context, target architecture, shared execution rules, feature-preservation requirements, five PR briefs, verification gates, and a handoff format. It is a specification to implement, not evidence that implementation or deployment has happened.

## 0. How Jeremy should use this document

Paste the entire document into each new implementation chat, preceded by:

> Implement PR N only from the attached Kartiseret backend-overhaul master plan. Read the current repository, applicable instructions, and previous handoffs first. Complete that PR's implementation and verification, create a draft PR if repository access permits, and leave merging to me. Adapt justified implementation details to the actual code and document deviations. Do not implement later PRs or request reviewers.

Replace N with 1, 2, 3, 4, or 5. Start each chat after the preceding PR is merged. If Jeremy explicitly chooses a different integration workflow, follow that instruction and record the actual base branch/commit.

If saved in the repository, the canonical location is `docs/backend-overhaul-master-plan.md`. The earlier source audit is `docs/backend-overhaul-audit.md`; this master plan supersedes that audit wherever subsequent user decisions differ, particularly hosted development and the database metadata observations below.

### Execution agreement for every chat

1. Work only on the selected PR, its necessary supporting changes, and defects demonstrably caused by that work. Do not perform the entire overhaul in one chat.
2. Inspect the real checkout, instructions, dependency versions, and prior handoffs. Paths and function names here describe the audited code, not an immutable future tree.
3. Proceed through ordinary implementation decisions autonomously. Adapt file names and small interfaces to the code; explain material deviations. Ask only for missing access, an unresolved product decision, a new cost, destructive changes outside scope, or a contradiction that prevents correct implementation.
4. Do not replace missing functionality with stubs, placeholder success responses, swallowed errors, production test bypasses, or empty datasets presented as successful responses.
5. Distinguish implemented, locally verified, CI verified, preview verified, and production deployed. Report actual evidence for each claim. A mock does not prove SQL behavior; a build does not prove a Vercel deployment works.
6. Jeremy prefers a useful structure and a straightforward migration. Avoid dual-write systems, prolonged dual-auth support, full catalog renames, enterprise rollout machinery, or extra technology solely for hypothetical scale.
7. The app is live. Its scraped data is rebuildable and Jeremy is the only active user. A short coordinated cutover and recreating his login are acceptable proposed approaches. Preserve or deliberately export/remap permanent codes, curated configuration, corrections, and wanted account settings. Do not infer permission to wipe the database.
8. Never request a PR review or assign/add reviewers, including Shaun-Regenbaum, without Jeremy explicitly asking. Create draft PRs with no reviewer requests; do not invoke reviewer tooling that requests review.
9. Do not merge PRs, change production credentials, apply production migrations, pause scheduled production jobs, or send real emails merely to prove tests pass. Prepare and validate the concrete change and provide a concise production operation checklist; Jeremy's explicit deployment authorization can then cover those operations.
10. Do not create additional chats, change model settings, or delegate to subagents unless Jeremy or applicable instructions explicitly authorizes that. The selected chat owns its PR and handoff.

## 1. Goal, scope, and success criteria

Create a dedicated TypeScript application backend for Kartiseret while retaining the existing React/Vite experience, Supabase-hosted PostgreSQL, and Python scraping/enrichment pipeline.

The agreed additions are:

- Shared and extended Zod contracts and validation.
- Express for the API and feature modules.
- Prisma for TypeScript database access and transactions.
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
  +--> same-origin /api/v1/* --> Express feature modules --> Prisma --> Supabase Postgres
  +--> same-origin /api/auth/* --> Better Auth ------------> Prisma --> app-owned auth tables

Existing share HTML/JPEG handlers --> same backend data services
Existing Python scrapers/dataflows --> Supabase service-role Data API --> same physical tables
Existing Supabase Realtime watcher --> targeted Python enrichment
Python notification dispatcher --> existing table operations + narrow app-owned recipient lookup
```

### Repository shape

Prefer retaining existing directories during the overhaul:

```text
package.json                     root workspace/scripts configuration
package-lock.json                one npm workspace lockfile
Codebase - Kartiseret Web/       existing frontend, kept in place
server/                          new TypeScript backend workspace
  src/
    app.ts                       createApp(dependencies); no listening side effect
    main.ts                      local Node server startup
    config/                      server-only environment parsing
    db/                          Prisma lifecycle and mapped database access
    middleware/                  identity, errors, other actual cross-cutting behavior
    modules/
      movies/
      showtimes/
      theaters/
      preferences/
      ticket-alerts/
      admin/
      auth/                      Better Auth added in PR 5
      previews/                  share-data/rendering organization as needed
    ...
  prisma/schema.prisma           mapped models; client output location chosen explicitly
packages/contracts/
  ...                            pure shared schemas/types/domain helpers; explicit exports
api/                             thin Vercel adapters, including stable OG endpoints
backend/                         existing Python tree
supabase/                        authoritative SQL history/baseline documentation
scripts/                         justified workspace/database/test utilities
docs/backend-overhaul/           architecture decisions, verification matrix, PR handoffs
```

Adapt this layout if the current checkout has already evolved. Do not move the entire repository into `apps/` just to match a convention. Expose shared modules through named package subpaths such as `@kartiseret/contracts/movies`; avoid a single barrel that pulls every schema or server dependency into the eager frontend bundle.

A feature's router declares routes/middleware; controller adapts HTTP; service owns business rules and transaction boundaries; repository owns Prisma queries and database-row mapping. Small features may combine trivial controller/service functions when another layer adds no clarity. Do not create generic base controllers, generic CRUD APIs, a dependency-injection framework, or duplicated classes for every Prisma model.

### Ownership that must stay explicit

- Server: database normalization, authoritative availability/ownership/admin checks, preference persistence/defaults, write transactions, private projections.
- Frontend: TanStack Query keys/cache/invalidation, incremental coverage, request cancellation, forms, gestures, local search, map rendering/geolocation, UI state, guest storage, immediate theme changes, save coalescing and rollback.
- Shared: normalized DTO schemas, request schemas, constants and deterministic pure domain helpers. No React, Zustand stores, Supabase client instances, Prisma, Node-only imports, secrets, localStorage, or DOM initialization.
- Python: scraping, matching, enrichment, cleanup, its current worker execution, and ticket-email delivery. Prisma is not a replacement for Python's client.

## 3. Confirmed hosting and environment strategy

Jeremy chose a hosted development environment. Do not require a local database or Docker on his Mac.

| Environment | Application | Database/auth | Intended use |
| --- | --- | --- | --- |
| Production | Existing Vercel production deployment/domain | Existing production Supabase project; Supabase Auth through PR 4, Better Auth after PR 5 cutover | Live product |
| Hosted dev / previews | Same Vercel project, Preview environment and deployment URLs | Separate hosted Supabase dev project, with separate credentials/auth state | Browser acceptance, manual testing, migration rehearsal |
| CI integration | App/tests started on GitHub-hosted Ubuntu runner | Disposable PostgreSQL service created by GitHub Actions | Repeatable SQL/transaction/auth persistence tests; destroyed with job |
| Optional local app | Node/Vite on Jeremy's Mac | Hosted DEV project when explicitly configured, or injected fixtures for unit/browser tests | App development; no local DB service required |

CI's Postgres service is a container on GitHub's runner, not a Docker installation or application-packaging requirement on Jeremy's Mac. Destructive integration tests never reset the shared hosted dev project. Browser unit/fixture tests are not the sole verification of database behavior.

### Hosted dev setup belongs in PR 2

- Inspect existing Supabase/Vercel configuration read-only; establish the real production project from deployed settings, not just a display name or stale shell script.
- Provision a distinct hosted dev Supabase project with an appropriate region and basic seed data. Check account/organization plan and current project quotas first. Do not create a paid resource or change billing without explicit approval. If free capacity/access is unavailable, document the exact constraint and ask for that specific choice while continuing independent code/CI work.
- Connected-project metadata observed on 2026-10-15: `KartiseretNew` / `gsdrcyrduxbrxgsvhxvr` was active in `eu-central-2` and matches the current realtime launcher fallback; `Kartiseret` / `vxrmpmfimpzkcvqqrsdt` was inactive. These are observations to verify, not authority to overwrite either project. Do not repurpose or delete the inactive project without Jeremy's explicit instruction.
- Use Vercel Production variables for production and Preview variables for dev. Development variables may also point to dev for optional local Node/Vite use. Document the intended project IDs in nonsecret environment metadata. Never print or commit passwords/tokens.
- Seed dev catalogs, showtimes, geography, and controlled fixture accounts. Prefer sanitized representative data and deterministic fixtures. Do not copy production auth tables, sessions, delivery tokens, or private account data into dev by default.
- Through PR 4, use the dev project's own Supabase Auth for hosted dev sessions and callback URLs. In PR 5, use separate Better Auth secrets and app-owned accounts per environment.
- Keep preview deployments from inheriting production DB/auth/email credentials. Preview/private functionality should fail clearly if dev configuration is missing, rather than silently fall back to production.
- One shared hosted dev database is sufficient for this five-PR sequence. Reconcile its schema to the active PR before acceptance testing; keep unrelated preview branches from silently mutating it. Automatic migration-on-every-build is not required.
- Default dev/test mail to an injected capture transport or a controlled mailbox/recipient allowlist. No bulk ticket delivery or real verification/reset messages to production users from tests.

### Same-origin Vercel and local routing

Retain a normal Express app plus a thin Vercel function adapter. Keep the frontend's static output and existing OG endpoints. Verify the current supported way to combine them; do not switch the entire Vercel project to an Express-only framework that stops serving the SPA.

Application `/api/v1/*`, auth `/api/auth/*`, internal `/api/internal/*`, and OG endpoints must resolve before the SPA catch-all and short-link rewrites. Unknown API routes return an API 404, not a 200 HTML page. The server must see the intended original route after Vercel rewriting. Test this explicitly.

Vite should proxy `/api` to the local Express process for optional local development. The browser can continue using relative same-origin requests. Configure trusted origins, forwarded protocol/host handling, cookies, callbacks, and preview-origin handling deliberately. Do not trust every arbitrary Host/Origin header or use an unrestricted wildcard for authenticated preview requests.

## 4. Known source and live-schema facts

Source audit baseline: commit `c845bcb8`. Reinspect before implementation. The repository contains a large frontend data module and six ticket-alert SQL migrations, but no complete schema baseline or Prisma schema.

Read-only public-table metadata was inspected on the active production candidate on 2026-10-15. No data rows, passwords, sessions, or credentials were read or changed. These are initial observations, not a complete introspection of indexes, triggers, grants, policy definitions, or publication configuration:

| Table/group | Important observed facts |
| --- | --- |
| `allShowtimes`, `allSoons`, `allTheques` | UUID primary IDs, raw nullable listing fields, run/cleaned/added state; PostgreSQL date/time columns |
| `finalMovies` | `tmdb_id` integer primary key; `release_year` bigint; runtime real; genres text array; alternatives jsonb; some ratings text and others numeric; nonnull `solo_update` |
| `finalShowtimes` | UUID primary ID; nullable integer movie ID; separate date and time-without-timezone columns; nullable listing fields |
| `finalSoons` | UUID `id` primary key, integer movie ID, nonnull title/release date; do not assume movie ID is a unique Prisma selector |
| `movieCodes` | Bigint movie-ID primary key, unique three-character code, positive-ID/format checks |
| `tableFixes` | UUID primary ID; `tmdb_id` and `title_fix` are text |
| `tableSkips` | Text `name_or_tmdb_id` primary key |
| `theaters` | Primary key is `location`, not an invented numeric ID; city FK is `theaters_city_name_fkey` |
| `cities` | Name primary key, alternate spellings/neighbors arrays, nullable coordinates/zoom |
| `userPreferences` | UUID user primary key referencing `auth.users`; rating-sources array with a DB check, location/site-color fields |
| `admin_users` | UUID user primary key referencing `auth.users` |
| `ticket_alert_subscriptions` | Composite UUID user/bigint movie primary key; user FK to `auth.users`; delivery snapshots, attempts, idempotency state |
| `utilRunLogs` | Integer run primary key; timestamp WITHOUT timezone stores Jerusalem wall time; running lock and selected-runner JSON |
| `utilAvgTime` | Name primary key, machine-specific timing/count columns |
| `finalTheques`, `finalThequeMovies` | Separate cinematheque schedule/catalog with their own constraints; preserve even though current main frontend reads other tables |

All 18 observed public tables had RLS enabled. Metadata showed more than one preferences row; Jeremy's statement about being the only active user is still the product assumption, not permission to delete every other row. Do not store or expose an account listing unnecessarily.

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

Use `supabase/migrations` as the single authoritative SQL migration history, with Prisma's mapped schema kept in sync. This fits the existing Python clients, RLS, custom constraints/functions, and Realtime. Prisma is the ORM; Prisma Migrate is not an additional authority in this design. Do not run `prisma migrate dev`, `prisma db push`, or a separate Better Auth migration engine against the same application tables.

If the real repository has already established a different coherent migration authority, evaluate it before changing anything and record a justified amendment. Do not spend a PR building two frameworks or maintaining competing histories.

### Baseline the existing database, not an imagined replacement

- Obtain a read-only schema inventory/export covering application tables, types, constraints, defaults, sequences, indexes, functions/triggers, RLS/grants, and relevant realtime settings. Keep Supabase-managed schemas provider-managed.
- Record the existing remote migration history and distinguish it from dashboard-created schema. Existing alert migrations cannot alone bootstrap the app.
- Build a documented clean-bootstrap path for a fresh hosted dev Supabase project and an isolated CI Postgres database. A current-state baseline snapshot may be paired with an explicit cutoff/manifest and only subsequent migrations; do not bootstrap a snapshot containing ticket tables and then blindly rerun historic CREATE TABLE migrations over it.
- Preserve historical files/history unless a carefully documented baseline mechanism requires repository organization changes. Do not repair production migration-history entries merely to satisfy a test runner.
- The bootstrap/seed path must be genuinely exercised on a clean disposable database. A SQL snapshot that has never been applied is insufficient.
- New migrations are explicit reviewed SQL, generated/named via the current Supabase CLI convention where available. Verify CLI commands with help. Avoid Docker-dependent CLI diff/restore commands on Jeremy's machine; use appropriate database catalog queries, native tools if available, or CI tooling instead.
- Better Auth's Prisma schema generator may help produce models; translate the required SQL into this same migration workflow and verify the result. It must not become a third schema-change authority.
- Apply dev migrations with the dev migration connection/role. Runtime connections should have only needed app permissions. Do not ship admin/superuser credentials in the browser or turn the runtime role into a schema owner just to hide an RLS error.

### Mapping and compatibility

Preserve physical names and types used by Python. Use Prisma `@map`/`@@map` and explicit schema annotations where appropriate. Do not add made-up IDs/uniqueness, rename all tables, or add cascading catalog relationships without checking ingestion/cleanup ordering.

Handle these conversions explicitly: bigint IDs/year/votes, Decimal values where present, PostgreSQL date-only values, time-without-timezone values, text ratings, real runtimes, arrays and JSON alternatives. Public movie IDs stay normalized decimal strings. A date/time must not acquire an accidental server timezone shift. Return bounded JSON-safe numbers only where the contract actually calls for them; never globally patch BigInt JSON serialization.

Prisma database connections do not inherit a Supabase browser user's RLS context. Feature services enforce ownership/admin permission using verified server identity. Keep provider-managed auth state outside Prisma's application migration ownership until it is intentionally replaced by app-owned tables in PR 5.

Do not disable the Supabase Data API globally: Python and its realtime workflows still use it after the frontend stops using it. Remove unnecessary browser grants/table exposure at the correct PR boundary while preserving the service-role operations.

## 6. API and shared-contract conventions

Suggested endpoint families, adjustable to the current code without duplicating APIs:

| Endpoint | Owner PR | Contract intent |
| --- | --- | --- |
| `GET /api/v1/health` | 2 | Process/config readiness without secrets; optionally separate DB readiness |
| `GET /api/v1/movies?mode=nowPlaying|comingSoon` | 2 first slice, complete 3 | Ordered normalized collection; stable movie codes or explicit code-readiness behavior |
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
- Use one consistent API error shape with a safe code/message and optional validation-field details. Map bad input, unauthenticated, forbidden, missing resources, conflicts, and server faults deliberately. Never send raw SQL, credentials, stack traces, or all Prisma metadata to clients.
- Preserve frontend `AbortSignal` behavior for fetches. Do not claim that aborting the HTTP response guarantees the underlying SQL query was cancelled if the selected driver cannot prove that.
- Do not automatically retry writes. Map unique-constraint collisions to the intended idempotent result where relevant.
- Private responses use `no-store`. Public cache policy must respect time-sensitive showtimes and existing OG fallback behavior. No private account data in shared CDN caches.
- Reuse a module-level Prisma client appropriately for Node/serverless execution; do not create/disconnect a connection pool on every request. Verify pooled runtime versus migration connection configuration against the selected stable Prisma/Supabase versions.

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

## 8. Verification and handoff rules shared by all five PRs

### Evidence levels

- Unit/contract tests: pure functions, validation, mappers, cache semantics, controller/service boundaries with controlled dependencies.
- API tests: Supertest invokes the real Express app; targeted repository/identity failures may be injected to prove error handling. Test 401/403/404 and invalid input, not only successful JSON.
- DB integration: real Prisma with disposable Postgres for mappings, constraints, transactions, and final auth persistence. API authorization tests must include users A and B; one active production user does not remove the need to prove ownership.
- Browser: fixtures help local regression checks; at least the critical migrated flows also run against the real Express/Prisma stack in CI. Hosted dev/preview testing confirms deployed routing/assets/cookies/provider integration that fixtures cannot establish.
- Python: focused tests use existing repository/HTTP injection points and shared behavior fixtures; never scrape cinema sites or send mail as a test dependency.
- Build/deployment: validate frontend, server, shared package, root adapters, generated Prisma client and assets. Distinguish a successful local build from a verified preview URL.

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

## 9. PR 1 — npm workspaces and shared Zod foundation

Suggested branch: `codex/backend-01-workspaces-contracts`.

### Objective and prerequisite

Begin from the current functioning application. Introduce the package boundaries and shared contracts needed by later PRs while preserving existing behavior and deployment. This PR does not introduce the new API, Prisma, Better Auth, or a hosted database migration.

### Read first

Root/web manifests and lockfiles; Vite, TypeScript, Vitest, ESLint and custom Prettier configuration; root Vercel adapters/config; `.gitignore`; full-checks workflow; existing boundary schemas; preference definitions and runtime-validation documentation; server OG imports of frontend helpers; the bundle checker and affected tests.

### Implementation sequence

1. Inventory install/build/import ownership. Record existing scripts and baseline failures. Keep existing web and Python folder paths.
2. Establish the root private npm workspace, one root lockfile, and a `packages/contracts` workspace. Set package identities explicitly; reserve/create the server workspace only if useful without introducing a fake backend implementation.
3. Choose and prove a shared package build/export format that works in Vite, Vitest, Node 24, and Vercel function bundling. A small emitted ESM/declaration package with explicit subpaths is the default; build it before consumers. Do not assume Vite's source-TS resolution proves Node can execute those imports.
4. Move reusable primitives and normalized model schemas/types into shared ownership. Add only contracts already well understood from the source; later PRs refine actual endpoint DTOs. Keep provider-specific identity schemas and legacy database-row normalization local until their owning PR.
5. Extract pure date/filter/link and preference constants/schemas where server sharing requires them. Keep browser storage/events/theme mutations in web modules. Avoid a rewrite of every preference component or copying its entire definition module into the server.
6. Update frontend and existing OG imports, including TypeScript inclusion paths. Preserve direct-import/subpath conventions and existing trust-boundary parsing behavior.
7. Define a small neutral identity/public-account contract if useful, but do not activate a second auth state owner. Preserve UUID expectations as application identity rather than naming the shared primitive after Supabase.
8. Update root scripts, install instructions, lockfile paths/caches, lint/format/test scopes, Vercel install/build commands, and generated-output ignores. Use explicit build ordering; npm workspace script iteration is not automatically a dependency-graph build system.
9. Keep the custom import-formatting behavior where used. Do not expand prettier/lint into Python artifact directories or generated Prisma/build outputs. Do not retain two competing lockfiles for the same npm workspace install.
10. Create/update the architecture decision note and verification ledger. Document where schemas, browser persistence, and provider-specific parsing now live.

### Important boundaries

- Do not change password requirements or auth behavior in a structural refactor. PR 5 owns the policy alignment.
- Keep normalized and external-row schema differences meaningful. Shared public types are not a mass export of database/private fields.
- New shared imports must not eagerly include map code, image processing, server secrets, Node-only modules, or all auth machinery.
- Existing server functions must still obtain Sharp and all referenced modules/assets after root installs. Dependency hoisting is not a substitute for each workspace declaring what it uses.
- Do not add OpenAPI, new validation libraries, monorepo orchestration frameworks, or a second package manager.

### Required evidence and acceptance gate

- A clean root npm install using the lockfile resolves workspace imports and leaves the lockfile unchanged afterward.
- Root lint/format/typecheck/unit/build commands and the existing eager bundle check pass, or a pre-existing failure is clearly isolated and does not hide a regression.
- Shared contract/date/filter/link tests run against the shared module. Existing frontend and OG tests continue to pass through the changed imports.
- Shared package can be imported by an ordinary Node process using the intended emitted exports. Check application entrypoints from a clean build, not only a warmed dev server.
- Inspect built client output/dependency graph for server-only imports. Keep the existing 210 KiB gzip eager budget unless an intentional justified baseline change is actually measured.
- Validate Vercel build configuration still produces the SPA and packages the existing API wrappers. A real preview check is useful if deployment access exists; otherwise record the unverified deployment item without claiming success.
- No application feature, physical DB table, Python path, or auth flow is intentionally changed.

### PR 1 handoff must contain

Root/workspace script names; package names/exports and build order; lockfile/install change; moved schema/helper locations; Vercel/CI updates; baseline bundle size; checks and preview status; any contract decisions left for PR 2. Ledger rows F01/F02/F08/F09/F13 should identify the structural evidence, without claiming later behavior has already migrated.

## 10. PR 2 — Express, Prisma, hosted dev, and real-Postgres test foundation

Suggested branch: `codex/backend-02-api-prisma-foundation`.

### Objective and prerequisite

PR 1 is merged and verified. Establish a real API workspace, Prisma mapping of the current app database, an authoritative SQL bootstrap/migration workflow, hosted dev configuration, and meaningful API/DB tests. Implement one useful public catalog read slice to prove the stack. The browser's broad transport migration belongs to PR 3; protected workflows remain unchanged.

### Read first

PR 1 handoff and shared exports; root `api/*`/`vercel.json`; production/development environment descriptions; current Supabase table metadata and migration history; Python table utilities/registries/MovieCodes/cleanup/run logging; web catalog contracts and normalization; current official Express, Prisma/Supabase connection, and Vercel integration docs.

### Implementation sequence

1. Verify the predecessor's code, establish a clean branch, and map the first catalog contract to actual rows. Confirm selected stable package versions support Node 24, TypeScript, the deployment adapter, and the later Better Auth integration. Pin/lock compatible versions; do not automatically select preview ORM releases or provisioning-oriented CLI defaults.
2. Add the server workspace, plain local Node startup, and `createApp` composition with narrow injectable dependencies. Default production composition uses real services. Importing the app in Supertest must not bind a port, query production, or require unrelated UI code.
3. Add server-only environment validation and a clear configuration reference with placeholders. Typical roles: runtime `DATABASE_URL`, an explicit migration/admin connection, Supabase URL/public config for the temporary auth stage, site/API origin, and future email/auth secrets. Separate deployment env from test env; never load test destructive targets through root production fallbacks.
4. Read the real deployed production configuration and DB schema non-destructively. If access is missing, use connected tooling or request a schema-only export/access, not passwords pasted into chat. Do not invent table types, policies, or uniqueness from frontend TypeScript.
5. Establish the SQL authority and baseline/bootstrap mechanism described in section 5. Capture all app tables and dependencies, including Python-only/cinematheque/ops tables. Keep provider-owned schema separate. Record what existing migration IDs represent and how new projects avoid replay conflicts.
6. Add Prisma mapped models and generated-client lifecycle. Preserve `finalSoons.id`, `theaters.location`, composite subscription keys, UUIDs, int/bigint differences, arrays/json, and native date/time/Decimal semantics. Use non-unique lookups where the actual DB does not promise uniqueness.
7. Configure pooled runtime connections appropriately for Vercel concurrency; keep schema-management credentials separate. Prefer an app runtime role with necessary DML and explicit feature authorization in later PRs. Do not grant unrestricted schema-management privileges as a runtime convenience.
8. Implement health/error handling and the first normalized public catalog endpoint, preferably now-playing movies. Move only its actual repository/mapping logic to server ownership; leave existing browser behavior working until PR 3 switches callers. Avoid a generic arbitrary-table repository API.
9. Add a Vercel adapter alongside the SPA/OG functions, explicit route precedence, and Vite's optional local `/api` proxy. Verify `/api/v1/health` and an unknown API path resolve as API responses rather than SPA HTML.
10. Set up hosted dev: verify free/project capacity and organization billing, create a distinct dev project if authorized and free, bootstrap schema, seed representative catalogs/geography, and configure Preview environment variables. Leave the inactive existing project alone. If creating the project would incur a charge, prepare the exact proposed setup and ask before that action.
11. Seed a small controlled dev Supabase Auth account only for the pre-Better-Auth stages when needed; avoid real email delivery by default. Keep dev signup/recovery callback settings distinct from production. The full application auth transition is PR 5.
12. Add a GitHub Actions Postgres service with health checks and a pinned major matching production where practical (observed production engine was Postgres 17). Apply test-only provider compatibility prerequisites, the app bootstrap, and future SQL through the documented path, then seed deterministic records.
13. Add Supertest/Vitest Node tests and real Prisma integration tests. Use distinct scripts so local fast verification works without a DB while CI integration is required and cannot silently skip. A local native DB is not a prerequisite; hosted dev is the interactive DB.
14. Document dev refresh, fixture seeding, migration rehearsal, connection pooling, preview variable scope, and the exact production operations eventually needed. Do not automatically migrate production when Vercel builds.

### First data slice must prove real mapping

Exercise a representative movie row containing nullable metadata, numeric/text ratings, an alternatives JSON array, native genres array, bigint release year, and a pending `solo_update` row. Show a JSON-safe DTO. The endpoint must distinguish a legitimate empty catalog from a missing table, bad configuration, failed SQL, or malformed data.

Do not claim all public API behavior is implemented because the first catalog endpoint works. The first slice is the foundation for PR 3, with a stable response/error style.

### CI versus hosted dev

- Disposable CI Postgres proves SQL replay, Prisma type mapping, constraints and transaction capability without production secrets.
- Minimal `auth.users`/role/function compatibility objects in CI are test-only and do not establish that Supabase Auth or Realtime works. Hosted dev is used for those provider-specific checks.
- Applying tests that drop schema/reset data is permitted only on the explicitly disposable CI target. Hosted dev migration/seed commands are deliberate, bounded operations; do not reset it from every browser-test job.
- If full schema bootstrap requires an extension unavailable in plain Postgres, identify the actual requirement and choose a suitable CI image or isolate truly provider-managed prerequisites. Do not silently drop application constraints or rewrite tables into SQLite for tests.
- Include a useful dev seed with city/theater relations and normal/edge-case movies/showtimes. Python run/metrics tables require appropriate seed rows if a manual dev pipeline run is to be supported; empty `utilRunLogs` / class timing tables may break code that expects a prior row. Do not run the real scraper in CI to create fixture data.

### Required evidence and acceptance gate

- PR 1 verification remains green; server lint/typecheck/unit/build checks are included.
- Fresh CI DB bootstrap succeeds, then the first real Prisma catalog query returns the normalized expected DTO. Assert bigint/date/time conversions where relevant.
- Add a real rollback/constraint capability test through the selected Prisma connection so PR 4's transaction design is grounded in actual Postgres behavior.
- Supertest proves health, the first catalog response, malformed requests, query failure behavior, safe errors, and unknown API 404 behavior.
- Root scripts build shared code before server/frontend; Prisma generation and Vercel packaging work from a clean install without live DB access during the build.
- Hosted dev and Preview variables are documented and configured if tools/access permit. Confirm the preview catalog endpoint reads DEV data and does not require a production secret. A placeholder project/config is not a verified hosted environment.
- Existing frontend/OG production behavior remains available and no worker-facing physical schema is casually changed.
- Connection/cost/access blockers are explicitly identified. Code completeness, green CI, and unverified external setup must be reported separately; do not mark the whole stage operationally ready if dev provisioning is still blocked.

### PR 2 handoff must contain

Actual schema inventory/baseline cutoff and bootstrap procedure; Prisma schema/model mappings and supported conversions; migration authority; runtime/migration role and connection requirements; local/Vercel app entrypoints and route adapter; first endpoint shape; hosted dev project identity and preview URL if created; credential VARIABLE NAMES only; test script names/CI results; production configuration needed before the first API-consuming release. Ledger F25–F28 must distinguish observed provider configuration from fixture assumptions.

## 11. PR 3 — public API reads, frontend transport, and social previews

Suggested branch: `codex/backend-03-public-data-api`.

### Objective and prerequisite

PRs 1–2 are merged. The API, actual Prisma mappings, hosted dev, baseline, and CI Postgres exist. Move all public read consumers behind normalized API/service contracts, preserving the existing product and loading/cache semantics. Introduce meaningful Playwright coverage.

Protected preferences, subscription lists, and admin membership stay with PR 4; do not turn them into public endpoints to fit this PR.

### Read first

PR 2 contracts/adapter/handoff; all of web `src/data/movieCatalog.ts`, `theaters.ts`, public availability fetches in `ticketAlerts.ts`; relevant schemas; `App.tsx`, movie/scroller/showtime/map/search consumers; both OG handlers and preview data/format/image/assets; date/filter/link helpers; existing cache/hydration and preview tests; Vercel rewrites.

### Implementation sequence

1. Enumerate every public `.from(...)`/Supabase transport call in browser and OG code. Assign each caller to a feature endpoint or shared server service. Keep protected calls marked for PR 4.
2. Complete movies/coming-soon repository mappings and service contracts. Preserve ordering, normalized ratings/images/trailers/alternatives, pending enrichment filtering, and empty/error distinctions.
3. Supply permanent codes without an N+1 query per movie. The default is a bounded batched code lookup accompanying the catalog response, with the client deriving its code index from that same response. Do not invent a Prisma relation/foreign key across mismatched integer/bigint types if the DB has none.
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
- Normalized API records can have a stable application name even if physical columns are snake_case. Do not make every UI component a Prisma consumer.
- Use indexed/batched reads. Avoid per-movie sequential lookups and duplicated full datasets in the response. Preserve the eager bundle budget.

### Required evidence and acceptance gate

1. Unit/contract tests cover all touched mappers, codes, native date/time/bigint conversion and malformed row behavior. Existing codec/date/property-style tests still pass against shared helpers.
2. Supertest plus real DB tests cover both catalogs, direct lookup if added, range boundaries/optional ID/invalid input, more than one page of listings, city joins, public availability URL fallback, and DB error behavior.
3. Cache tests prove existing broad/targeted readiness, replacement on refetch, deduplication, cancellation, and movie-code failure/readiness behavior through the new transport.
4. Playwright runs catalog/search, grid/detail, city/date/filter browsing, additional range loading, one direct short link, one encoded link, and an appropriate small/mobile viewport. Focus on changed data/navigation, not brittle pixel-perfect animation timing.
5. OG tests cover valid now-playing/coming-soon previews, expired/filter-selected listings, unknown/invalid links, escaped metadata, SPA fallback HTML, actual JPEG output, asset packaging, and guarded remote-image fallbacks. External URL fetches use fixtures for automated tests.
6. Build/package tests prove both static assets and server handlers resolve from a clean build. A hosted dev preview smoke verifies the intended URL paths, HTML/JPEG content types, image/fonts and source of DEV data; no API route returns SPA fallback HTML.
7. Compare request counts and representative payload sizes against the old loading path. Record observed timings if measured on comparable inputs; do not claim an API layer inherently makes the app faster. Avoid a new sequential HTTP hop in share-data access.
8. All existing frontend checks, server/contracts checks, integration and browser CI gates pass. Public Supabase browser/OG database transport is gone, with remaining private calls explicitly assigned to PR 4.

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
8. Implement admin membership checks on the server. Use a narrow correction command, never an arbitrary table-update body. Apply persistent `tableFixes`, source catalog changes, and affected showtime reassignment/deletion in a real Prisma transaction.
9. Cover both correction branches: target already exists (merge), and new target (clear/re-enrich). Preserve source-aware now-playing/coming-soon behavior and realtime `solo_update` triggering. Keep metadata enrichment external to the HTTP response; no Selenium/TMDb crawl inside the transaction.
10. Reconcile current client behavior with real constraints. In particular the audited client clears coming-soon `release_date` to null, while observed `finalSoons.release_date` is NOT NULL. Fix this deliberately, preferably retaining the existing date while the row is flagged/hidden pending enrichment, rather than copying a known invalid write. Do not silently weaken the database constraint.
11. Reinspect existing `finalSoons` movie-ID uniqueness before choosing Prisma selectors. If duplicate targets are possible, implement a documented deterministic or conflict behavior consistent with pipeline rules rather than calling `findUnique` on a non-unique field.
12. Preserve TanStack invalidation rules: now-playing correction invalidates its catalog, resets showtimes and invalidates public ticket availability; coming-soon correction affects its catalog; private subscription lists are not a generic admin-edit invalidation target.
13. Remove direct browser application-table access and obsolete transport tests. Keep Supabase signup/login/logout/recovery APIs functioning until PR 5, with signup default persistence now calling the API.
14. Prepare/apply DEV grant/policy changes appropriate to the migrated browser access model. Preserve Python service-role Data API and realtime functionality. Inspect realtime publications and replica identity before assuming a direct Prisma update will reach the existing watcher. Do not disable Realtime or the Data API globally.
15. Run the existing Python updater/repository code against controlled fixtures or DEV only as needed to prove the admin signal contract. Tests must not trigger Git sync/push or launch a real Selenium job. Document the production job pause/restart sequence only if an actual schema operation requires one.

### Preference and auth-transition details

The app stores `user` in its preferences protocol today and uses Supabase user metadata to carry signup location. During this PR the adapter may retain that provider data internally for defaults, but components should consume a minimal neutral user identity. Signup metadata may select an ordinary preference; it must not grant admin access.

Test explicit instant signup and first confirmed login. If an existing DB trigger creates defaults, chosen signup location must still take the intended precedence without repeatedly overwriting established preferences. Distinguish guest location/site-color cache behavior and account-only rating-source behavior from server persistence.

On identity change, cancel/invalidate or remove private queries for the departing account and discard delayed private results. Keep public caches reusable. The API must independently enforce ownership even if the UI supplies the wrong cache key.

### Transaction and race details

- Failures midway through correction roll back every related SQL change, including the persistent fix row. Prove this with an injected late DB failure/constraint in integration tests, not only a mocked `$transaction` call.
- Avoid adding account-alert FK dependencies on ephemeral catalog records: the current schema intentionally keys alerts by movie ID without requiring a current catalog row.
- Handle duplicate subscription insertion through its real composite unique key and recover the existing result. Do not turn a harmless duplicate into a 500 or automatically resend a notification.
- A pre-insert availability check is not globally atomic with asynchronous publication. Define acceptable semantics: show available immediately when detected; otherwise store a pending subscription which the dispatcher will pick up on a later run. Do not promise impossible exactly-once availability detection or introduce a queue system.
- Preserve existing delivery IDs/snapshots/attempt state and Resend idempotency. Do not reset sent subscriptions to pending in ordinary API saves.
- Admin corrections should preserve permanent-code storage rather than regenerate the code table. Any new aliasing semantics for previously incorrect movie matches require an explicit product decision; do not invent a URL migration system in this PR.

### Required evidence and acceptance gate

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

PR 4 identity/persistence handoff; current frontend auth-only call list; auth-related schemas/forms/store/bootstrap; current Better Auth Express/Prisma/database/session/cookie/email documentation; actual `auth.users` FKs, triggers and policies; Vercel Preview/Production origin/secret configuration; Python notification repository and Resend transport; all existing signup/recovery/auth tests.

### Implementation sequence

1. Verify all protected feature services accept neutral verified identity. Inventory any leftover Supabase `User`, `Session`, user-metadata, auth-admin, callback and table-reference assumptions across TypeScript, SQL, scripts and Python. Fix only necessary stragglers from the migration boundary.
2. Add compatible stable Better Auth core/Prisma adapter packages to the server and its appropriate browser client to the frontend. Use current verified import paths/APIs for the chosen versions. Keep server initialization/secrets entirely outside browser exports.
3. Generate/review its required user/account/session/verification models and configure UUID IDs. Put auth tables in a non-exposed application auth schema where compatible with Prisma/adapter generation; otherwise use explicitly restricted tables with anonymous/authenticated Data API grants revoked. Validate generated types/keys/defaults rather than relying on a schema name for protection.
4. Add the required auth SQL through the established authoritative migration workflow, update Prisma models, and test it. Do not invoke Better Auth's independent migration engine or Prisma Migrate over the same managed tables.
5. Mount the Better Auth handler at `/api/auth/*` using the selected Express version's catch-all syntax, before JSON body parsing as required. Keep `/api/v1`, OG and static SPA routes functioning, and make sure Vercel forwards the full auth path correctly.
6. Configure cookie sessions, origins, canonical base URL, email verification, password resets, session expiration/revocation and built-in auth rate limits. For Vercel, use a supported persistent/database-backed auth limiter or verified platform protection rather than assuming one process's memory coordinates all instances; no Redis service is required by this plan. Apply middleware/session lookup only where needed; public catalogs should not incur an auth database query on every request.
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

Default design: a narrowly scoped internal Express endpoint, such as `POST /api/internal/ticket-alert-recipients`, reads only canonical user ID/email/verification status through Prisma. Authenticate it with a separate server-to-server secret, validate/bound requested UUIDs, return `no-store`, and expose no password/session/account-provider data. An internal batch lookup is useful but a simple controlled lookup with per-run memoization is sufficient for the current single-user scale.

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
2. Better Auth/Prisma integration tests exercise account creation, verified/unverified states, session creation and expiry, logout/revocation, password setup/change/reset, and one-time/expired verification/reset tokens. Use the library's actual handlers and an injected mail capture with deterministic tokens/clock where supported.
3. Supertest proves all PR 4 private endpoints still enforce ownership/admin checks with the new session adapter. An old Supabase bearer token, another user's identifier, and an unsigned/fabricated cookie do not gain access. Public endpoints still work without a session.
4. Playwright against the real app/API/Postgres proves signup and captured verification, login, refresh/session restoration, settings defaults, alert create/list/cancel, logout, signed-out `/user` gating, forgot/reset password including signed-out token flow, and current-password change. At least one failed/expired flow is visible to the user correctly.
5. Preference race/coalescing/rollback and account-specific cache tests still pass. Public catalog/search/showtime/direct-link/OG flows remain green after removal of the browser Supabase SDK.
6. Python unit tests prove app-owned canonical recipient lookup, verification/missing-user/error behavior, finite HTTP timeouts, preserved existing delivery ID/idempotency on retry, and unchanged link/date fixtures. Mail tests use injected transports and never send live messages.
7. Hosted dev/preview acceptance verifies the actual deployed auth route, cookie flags/origin handling, verification/reset callback destinations, login/logout/page refresh, private API access, and the internal recipient endpoint with dev-only credentials. This is the provider/deployment evidence that CI fixture compatibility cannot replace.
8. Repository search finds no active frontend Supabase auth/database client, no application calls to `auth.admin.get_user_by_id`, no obsolete application FK to `auth.users`, and no accidental browser import of Prisma/Better Auth server internals. Historical SQL/provider-managed state may still mention Supabase Auth; distinguish history from active dependencies.
9. Python service-role Data API and Realtime remain configured. Do not claim all Supabase services were removed. Main catalogs, cinematic worker tables, correction maps, run locks/metrics, and existing scripts remain compatible.
10. Full workspace checks, DB integration, browser CI and targeted Python checks pass. Record final client bundle size and real preview verification. Document production cutover state separately.

### PR 5 handoff must contain

Final auth configuration and server/client boundary; app-owned table/schema names and UUID policy; account transition/admin bootstrap procedure; migrations/FK/grant changes; mail policy/callbacks; Python endpoint/lookup/env changes; removed Supabase browser dependencies; actual CI/preview results; whether production cutover happened and under what authorization; any operator steps left. Close F21–F24 and reverify all shared ledger rows affected by the final transition.

## 14. Cross-PR release checklist

This is a practical compatibility guide, not a demand for separate infrastructure or elaborate releases.

| After PR | What must be true before shipping its changed live behavior |
| --- | --- |
| 1 | Root install/build/lockfile changes work in Vercel and existing SPA/OG paths still package correctly. |
| 2 | Production API connection/config is deliberately set before production API use; hosted dev/CI schema and first endpoint are proved. Existing browser transport remains compatible. |
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
| Server/private leaks | Shared/client imports of Prisma, server auth handlers, Sharp, Node-only modules or secrets; inspect actual emitted bundle. |
| Auth references | `auth.users`, `auth.uid`, auth trigger functions and FK definitions; distinguish historical SQL from deployed active schema. |
| Python identity | `auth.admin`, `get_user_by_id`, recipient source and URL defaults; active recipient logic must use app-owned identity after PR 5. |
| Worker contracts | Physical table names, primary/upsert keys, `solo_update`, correction helpers, realtime publication, cleanup scripts and run-lock/timing assumptions. |
| Route/config | API before SPA fallback, short/encoded links, auth/recovery route, forward headers, Vercel function paths/assets, env scope and CI cache paths. |
| Date precision | Native Prisma time/date/bigint/Decimal output, fixed module-level current dates in server code, Jerusalem cutoff/grace/DST cases. |
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
- Mapped Prisma model names preserving the physical SQL schema.
- Reasonable API error/status mapping and bounded inputs preserving valid app behavior.
- Cleanup of newly dead imports/config generated by the selected PR.
- Adjusting a small baseline/bootstrap mechanism to the actual existing migration history, with evidence and documentation.

Get Jeremy's decision for a new billable service, reuse/deletion of an existing hosted project, destructive production data changes, a material product change, a different auth/database/framework choice, or unapproved production operations. Explain the concrete reason and finish independent work before asking for a final operational approval. Do not repeatedly ask for authorization he already supplied.

## 18. Current documentation references

Verify version-sensitive behavior when implementing rather than pasting examples blindly. These are source references, not instructions to add every product they mention.

- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/)
- [Express routing/security/middleware](https://expressjs.com/en/guide/routing/)
- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Vercel environment scope](https://vercel.com/docs/environment-variables)
- [Prisma with Supabase](https://supabase.com/docs/guides/database/prisma)
- [Supabase hosted environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase billing/project eligibility](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [GitHub Actions Postgres services](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [Better Auth Express](https://better-auth.com/docs/integrations/express)
- [Better Auth Prisma](https://better-auth.com/docs/adapters/prisma)
- [Better Auth schema/UUIDs](https://better-auth.com/docs/concepts/database)
- [Better Auth sessions](https://better-auth.com/docs/concepts/session-management)
- [Better Auth email/password](https://better-auth.com/docs/authentication/email-password)
- Better Auth: [cookies](https://better-auth.com/docs/concepts/cookies) and [rate limiting](https://better-auth.com/docs/concepts/rate-limit).
- [Playwright](https://playwright.dev/docs/intro)
- [Supertest](https://github.com/forwardemail/supertest)

## 19. Start instruction for the implementation chat

Execute only the PR number Jeremy selected. Begin by stating that scope, inspecting the current checkout and predecessor handoff, and identifying the first concrete implementation slice. Implement and verify it through the selected PR's acceptance gate. Adapt to evidence, preserve existing feature contracts, and leave a clear handoff rather than blindly following stale paths or declaring the entire overhaul complete early.
