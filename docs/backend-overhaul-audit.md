# Backend overhaul: codebase audit

> Current implementation guidance is [the revised Drizzle master plan](backend-overhaul-master-plan-drizzle.md), which accounts for the existing PR 1/PR 2 work and requires completing the ORM conversion inside PR 2. References to Prisma below describe the earlier audit and are historical.

Audited on 2026-10-15 against commit `c845bcb8`.

Subsequent planning decisions and read-only schema metadata are incorporated in [the master execution plan](backend-overhaul-master-plan.md). That document supersedes this original audit where they differ: Jeremy chose a separate hosted Supabase dev environment with Vercel previews, and a later metadata inspection confirmed the public-table types and auth foreign keys. No local database is required on his Mac. The original audit below records the source-only investigation at the time it was performed.

This is preparation for a future master plan and five PR plans. It records source-code findings, dependency boundaries, and decisions those plans must cover. It is not an implementation plan or a live database audit. Application code, deployed services, accounts, and database contents were not changed.

## Agreed scope and working assumptions

- Introduce npm workspaces, shared Zod contracts, Express, Prisma, Better Auth, Supertest with existing Vitest, and Playwright.
- Keep Supabase Postgres, the React/Vite SPA, TanStack Query, Zustand, and the Python scraping/enrichment pipeline.
- Defer Docker, Pino, Sentry, uv, OpenAPI/client generation, external logging/artifact storage, and job-queue infrastructure. Helmet and additional API rate-limiting middleware remain deployment decisions. Better Auth's own protections still need deliberate configuration.
- Jeremy is the only current user. Recreating that account and signing in again is acceptable as a proposed migration approach; the exact account/data choice belongs in the later plan.
- Scraped catalog data is rebuildable. Prefer a straightforward cutover and a brief pause of affected jobs when needed, rather than dual writes, a permanent compatibility layer, or an elaborate zero-downtime migration.
- Some small tables are not equivalent to scraped listings: preserve movie-code mappings, deliberate corrections/skips, and curated geography data, or export/reseed them intentionally.
- Do not request PR reviews or assign reviewers unless Jeremy explicitly asks.

## Verdict on the five PRs

The proposed order is sound. The main clarification is that PR 3 covers public reads; protected reads move with their writes in PR 4.

| PR | Boundary | Dependencies and completion meaning |
| --- | --- | --- |
| 1: workspaces and shared Zod | Package structure, pure shared contracts/helpers, root install/build/CI wiring | Existing behavior remains available; frontend and existing share functions can import shared code without server or browser side effects crossing package boundaries. |
| 2: Express and Prisma foundation | API composition, environment/error handling, database representation/migration authority, first public read and API tests | Existing Supabase Postgres is usable through Prisma. Establish local/deployed API entrypoints and test-database strategy here, not after frontend integration. |
| 3: public reads | Catalogs, movie codes/lookup, showtime ranges, cities/theaters, ticket availability, share-preview data | Browser public reads use API contracts. Share HTML/JPEG handlers use the same server data services. Existing query coverage, route codecs, and presentation remain coherent. |
| 4: protected reads and writes | Preferences including creation/repair, account alert lists/mutations, admin membership/corrections | Express verifies existing Supabase sessions temporarily. Ownership derives from verified identity, corrections are transactional, browser application-table access is removed, Python enrichment still works. |
| 5: Better Auth | Auth endpoints/client, account references, email callbacks, cookie sessions, final access-policy cleanup | Replace the Supabase identity adapter, not every feature's authorization code. Update all auth-dependent Python code and remove obsolete frontend Supabase auth/config dependencies. |

Tests arrive with their feature. Supertest begins in PR 2; Playwright begins with the first migrated browser flow in PR 3 and expands in PRs 4–5. Test both temporary and final authentication at their respective boundaries, without maintaining both providers indefinitely.

## Source map and coverage ownership

Paths below are repository-relative.

| Surface | Main sources | Audit finding / PR ownership |
| --- | --- | --- |
| Package/runtime/build | root `package.json`; web `package.json`, `config/*`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`; `.gitignore` | Root package only declares ESM/Node 24, with no workspaces. Web owns dependencies and its lockfile. Root installs/lockfile, generated-file ignores, lint/typecheck/test scopes, and Vercel commands need coordinated changes in PR 1. |
| Runtime validation | web `src/validation/runtime.ts`, `src/data/applicationSchemas.ts`, `src/data/externalSchemas.ts`, `src/data/ticketAlertSchemas.ts`, `src/lib/supabaseSchemas.ts`, `docs/runtime-validation.md` | Existing Zod coverage is substantial. Extract and extend it; do not replace it wholesale. Normalized public contracts belong in shared code; physical database-row schemas and provider-specific details belong on the server after migration. |
| Shared domain code | web `src/domain/showtimeDay.ts`, `src/domain/showtimeFilters.ts`, `src/routing/showtimeLinkCodec.ts`, `src/prefs/definitions/*` | Frontend and share functions already reuse date/filter/codec helpers. Separate pure values and schemas from localStorage, DOM, theme bootstrap, and provider types. Use explicit package subpath exports, preserving the existing direct-import convention. |
| App/navigation | web `src/App.tsx`, `src/components/MoviePage.tsx`, `PosterGridPage.tsx`, `AllShowtimesPage.tsx`, `MovieSearchMenu.tsx`, scroller components | Public routes include `/`, `/movies`, `/soons`, `/showtimes`, `/attribution`, short movie links, and encoded showtime links. `/user` is protected; `/reset-password` has special loading/rendering behavior. Search is local over loaded catalogs and does not need a new search service. |
| Catalog data and admin edits | web `src/data/movieCatalog.ts` | The large file mixes database transport/normalization, pure projections, query/cache orchestration, and admin workflows. Split by ownership, not by moving the entire file into Express. PR 3 handles public reads; PR 4 handles corrections. |
| City/theater data and maps | web `src/data/theaters.ts`, `src/components/maps/*`, `AllShowtimesPage.tsx` | The query explicitly joins `theaters` to `cities` through `theaters_city_name_fkey`. Preserve alternate spellings, neighboring cities, coordinates, zoom, deterministic ordering, and map links in PR 3. |
| Account preferences | web `src/stores/userPreferencesStore.ts`, `preferenceSavePolicy.ts`, `src/prefs/initialPreferences.ts`, preference definitions | Store contains auth initialization/events plus guest/local cache behavior, default creation/repair, theme application, optimistic saves, coalescing, rollback, and stale-account guards. PR 4 changes persistence ownership; PR 5 changes session ownership. |
| Account UI and callbacks | web `src/components/UserMenu.tsx`, `PasswordSecurityForm.tsx`, `PasswordResetPage.tsx`, `UserPreferencesPage.tsx`; `src/lib/authRoutes.ts`, `authMenu.ts`; `src/App.tsx` | Signup, confirmed-email startup, sign-in/out, forgot password, in-account password change, recovery links, and `/user` gating all require explicit PR 5 coverage. Preserve existing custom UI. |
| Admin membership | web `src/data/adminStatus.ts`, `App.tsx` | Browser currently reads `admin_users`. Move this protected read in PR 4. Frontend visibility is not server-side authorization. |
| Ticket alerts in browser | web `src/data/ticketAlerts.ts`, `ticketAlertSchemas.ts`, `src/domain/ticketAlerts.ts`, `TicketAlertControl.tsx`, `UserTicketAlerts.tsx` | Public availability is distinct from private subscription state. Availability spans cities and prefers an available English ticket URL with Hebrew fallback. Read/mutation ownership and cache behavior have fixture coverage to port. |
| Share HTML/JPEG | root `api/og.ts`, `api/og-image.ts`; web `server/og/*`, including assets; `vercel.json` | Two deployed server functions query Supabase independently. HTML loads built SPA `index.html`; JPEG rendering requires Sharp, fonts, SVGs, remote-image limits, and timeouts. PR 3 must cover both handlers, assets, caching, fallbacks, and encoded route semantics. |
| Python ingestion/enrichment | `backend/scraping/BaseCinema.py`, scraping utilities and source classes; `backend/dataflow/*`; `backend/config/registry.py`, `runner.py`, `runners.py` | Python uses service-role Supabase access. Keep its database client and existing raw/final tables. Prisma is the TypeScript application's data layer, not a Python replacement. |
| Admin-to-enrichment loop | `backend/config/realtime/realtime_watcher.py`, `BaseDataflow.py`, update dataflows; frontend admin edit function | Admin changes may clear metadata and set `solo_update=true`; the realtime watcher runs the matching Python updater and clears the flag. Preserve this loop in PR 4, including publication/replica-identity requirements verified against actual DB configuration later. |
| Alert email delivery | `backend/notifications/ticket_alerts.py`; `backend/config/registry.py` | Dispatcher runs after now-playing updates. It reads preferences/listings/codes and calls `supabase.auth.admin.get_user_by_id` for recipient email. That lookup must change in PR 5. Delivery implementation already has an injectable repository and HTTP client. |
| Maintenance and operations | `backend/utils/supabase/*`, `backend/utils/log/*`, `backend/config/cron/*`, realtime launcher, `.github/workflows/*` | Cleanup, run IDs/locks, metrics, retries, artifacts, and scripts all depend on existing schema/paths. Keep them functioning; do not bundle an operations rewrite into these five PRs. |

## Behavior the API transition must account for

### Public data and frontend state

- `movieCatalog.ts` reads `finalMovies`, `finalSoons`, `finalShowtimes`, and `movieCodes`. It paginates through Supabase's row cap and retries reads without optional columns for older schemas.
- Movie rows are normalized from mixed nullable/text/numeric values. Genres can be arrays or legacy serialized strings. Alternatives, images, trailers, ratings, popularity, release year/date, and ordering are part of the actual output contract.
- Pending `solo_update` movies are omitted until enrichment completes. A temporarily blank movie title in a flagged row is intentionally tolerated at the row boundary.
- Base catalogs render before movie-code hydration. Code lookup failure currently leaves the catalog usable. A joined API response may simplify this implementation, but that should be an explicit PR 3 decision with load-time and failure behavior considered; do not add a slow extra request by accident.
- Current source loads full movie catalogs in parallel. README claims about initial preview tables do not match the current catalog fetch implementation; no preview-table generation was found in the current Python dataflow/config source. Plan against code and verified DB inventory rather than reproducing stale README descriptions.
- Public movie IDs use normalized decimal strings. Prisma may produce `bigint` and `Date` values; map these explicitly before JSON responses. Ticket-alert IDs have an additional JavaScript safe-integer constraint.
- Showtime keys include city, inclusive date range, and optional movie ID. Coverage distinguishes broad-city loads from movie-targeted loads; arbitrary future jumps do not imply all preceding dates are loaded.
- Range refresh replaces rows in that scope so deleted or edited listings disappear. Preserve request cancellation, deduplication, incremental loading, and cache ownership in TanStack Query.
- Existing defaults: first showtime window one day, extension chunks fifteen days, maximum window 180 days. Server range limits must accommodate valid browser behavior.
- Keep search ranking, filters, animations, responsive state, guest storage, map rendering/geolocation, and ordinary UI state in the frontend.
- Locations are not simply a closed enum: `appLocationSchema` currently accepts normalized nonempty strings, and the city join is data-driven. Do not reject legitimate city rows solely because they are absent from the hardcoded canonical list.

### Time and durable links

- Shared cinema-day rules use `Asia/Jerusalem`, a 01:05 day cutoff, a fifteen-minute grace period, and post-midnight carryover ordering. DST and calendar-boundary tests already exist.
- `fixedAppInstant` / `fixedAppDateString` are initialized at module load in browser catalog code. Do not copy that clock ownership into a long-lived server. Server services must receive or compute a current request/job instant.
- Movie links use permanent three-character, case-sensitive Base62 codes. Extended links encode city/date/filter/mode state; their date window is 62 days.
- The browser page, share HTML, generated image, and Python email links implement related codec/date semantics. Shared TypeScript helpers can unify browser/server behavior; Python needs compatible fixtures, not a TypeScript import.
- `movieCodes` is not disposable catalog output. Regenerating it can break previously shared URLs even if the movie data is successfully re-scraped.

### Preferences, accounts, and writes

- Preferences comprise location, rating sources, and site color. Guest persistence and cached theme bootstrap differ by preference. Keep the existing UX unless deliberately changed.
- Current signup stores `signup_location` in Supabase user metadata. Both immediate-session signup and first confirmed login initialize preferences, with chosen signup location taking precedence and missing-row creation avoiding overwriting existing values.
- Default repair is currently a browser write hidden inside a read/sync path. PR 4 must move creation/repair as well as explicit settings saves to the server.
- Per-field PATCH semantics fit the coalesced preference saves better than blindly overwriting a whole row. Retain stale-result guards across logout/account switches and protect newer optimistic intent from an older failed save.
- A small provider-neutral application identity type should replace Supabase `User` types at application boundaries. PR 4's verified Supabase identity and PR 5's Better Auth session should supply the same feature-facing identity shape.
- Treat user IDs in cache keys as frontend isolation only. Protected endpoints derive identity from the verified session rather than accepting ownership from a request body or arbitrary URL user ID.
- Clear/cancel account-specific cached requests appropriately when identity changes. Public catalogs remain public.
- Admin corrections have two branches: merge into an existing target movie, or reassign the movie ID and queue metadata enrichment. `tableFixes`, catalog rows, and affected showtimes belong to one database transaction. Preserve the persistent correction used by later scrapes and the `solo_update` behavior.
- Existing now-playing invalidation resets showtime caches and invalidates ticket availability; coming-soon edits invalidate only that catalog. Subscription lists are not invalidated by movie edits.
- Avoid assuming every catalog/showtime relationship can immediately gain a strict foreign key. Existing ingestion, cleanup, reassignment, and enrichment create ordering constraints that the actual schema inventory must establish.

### Ticket subscriptions and email delivery

- Subscription availability checks currently run in the browser immediately before insertion. PR 4 moves authoritative checks and duplicate-insert handling to the service; ordinary UI selectors can stay client-side.
- Subscriptions are account-only and one-shot, keyed by `(user_id, tmdb_id)`. No guest alerts, guest receipts, or guest-delivery RPCs are required.
- Private alert lists expose confirmed subscription/delivery-summary fields, not internal retry or delivery-control fields. Writes should preserve confirmed-save behavior and avoid automatic write retries.
- Sent alerts remain represented. Duplicate inserts recover the existing subscription. Cancellation and subscription changes are serialized by account/movie in the client today.
- Python groups newly available movies into one email per account, stores delivery snapshots, and uses a stable delivery ID as the Resend idempotency key. Preserve those existing protections; they are already implemented, not a proposed queue system.
- Latest migrations remove transitional delivery RPCs. Current dispatch uses guarded service-role REST updates. The future plan should not revive removed RPC architecture accidentally.
- With Better Auth, the recipient lookup must use the app-owned user record and the chosen verified-email policy. Do not use a browser-supplied recipient address. Keep auth tables inaccessible to anonymous/authenticated Supabase Data API roles; use a narrow server-side lookup path or suitably restricted database access for Python.

## Database inventory and migration implications

The repository contains six ticket-alert migration files, not a complete reproducible schema. There is no Prisma schema, complete table-creation baseline, or checked-in definition of existing geography/admin/preferences tables and auth initialization triggers.

Known consumers require inventory of at least:

| Group | Tables / state |
| --- | --- |
| Raw ingestion | `allShowtimes`, `allSoons`, `allTheques` |
| Enriched data | `finalShowtimes`, `finalMovies`, `finalSoons`, `finalTheques`, `finalThequeMovies` |
| Durable mappings/corrections | `movieCodes`, `tableFixes`, `tableSkips` |
| Curated geography | `theaters`, `cities`, including the named FK used by the browser |
| User/application access | `userPreferences`, `admin_users`, `ticket_alert_subscriptions` |
| Pipeline operations | `utilRunLogs`, `utilAvgTime`, including machine-specific timing columns |
| Provider state | Supabase-managed `auth` tables, triggers/policies referencing `auth.users` / `auth.uid()`, realtime publication configuration |
| Final app-owned auth | Better Auth users, accounts, sessions, and verification records, introduced in PR 5 |

PR 2 needs read-only schema inspection of the actual database or an accurate export: column types, primary/unique keys, defaults, sequences, indexes, foreign keys, triggers, RLS policies, grants, functions, and relevant realtime configuration. Actual row counts and deployment regions have not been measured by this audit.

Choose one migration authority for application schema changes. The simplest existing-structure option is to retain `supabase/migrations` as the authoritative SQL history and keep Prisma's mapped models aligned. Prisma Migrate with reviewed custom SQL is another option, but requires a deliberate baseline and handling of externally managed Supabase schemas. Do not operate competing migration histories over the same tables. Better Auth schema generation must feed whichever workflow is chosen rather than create a third migration authority.

Prisma model/field names can use `@@map` / `@map` to preserve the existing physical tables and columns used by Python. Broad table renames or catalog normalization are not prerequisites for this overhaul.

Cinematheque output tables are pipeline dependencies even though the browser catalog currently reads the main movie/showtime tables. Keep their schema and service-side behavior; adding a new cinematheque UI or merging catalogs is separate product work.

Direct Prisma connections do not inherit browser Supabase RLS identity. Configure a server database role and explicit service authorization. Supabase-managed schemas should remain provider-managed. Access restrictions must preserve Python's service-role workflows and realtime enrichment while removing unnecessary browser table privileges.

## Better Auth-specific decisions for PR 5

- Use Better Auth within Express with its Prisma adapter, existing custom React forms, and Resend for verification/reset emails. No new auth hosting service is required.
- Prefer UUID user IDs to match current application schemas and UUID account references; Better Auth supports configurable UUID generation. Verify generated column types with the selected adapter/version.
- Recreating the single account and signing in again is much simpler than migrating password hashes or preserving active sessions. Preserve or deliberately remap the small set of account-owned rows and seed the intended admin identity. Admin status must never depend on first public signup or editable profile metadata.
- Ticket subscriptions explicitly reference `auth.users` in current migrations. Inventory corresponding references/triggers for preferences and admins before replacing them with app-owned user relationships.
- Current password-change UI enforces six characters; Better Auth's documented default minimum is eight. Align the actual server policy, Zod schemas, form attributes/messages, and tests together. Existing signup has no name field; choose a compatible display-name/default behavior without silently adding an unnecessary user-facing requirement.
- Recovery currently works through a Supabase session and `updateUser`. Better Auth's reset-token flow requires a real change to `/reset-password`; swapping a method name is insufficient.
- Verification, forgot-password, reset, current-password change, logout/session invalidation, page refresh, expired sessions, signup-location defaults, and admin bootstrap all belong in the final auth verification coverage.
- Mount Better Auth's Express handler before body-parsing middleware as required by its integration. Keep trusted origins, cookies, callbacks, and CSRF behavior coherent with the actual frontend/API deployment.
- Removing Supabase Auth does not remove the Python Supabase client or Supabase Realtime. Remove obsolete browser SDK/config and old application grants/policies only after accounting for those remaining server-side uses.

## Hosting, build, and runtime details

- The repo is configured for a Vite build deployed on Vercel with root API wrappers. There is no new Express host yet. Vercel supports Express, so a same-origin Vercel adapter is a reasonable first deployment choice to evaluate; retain an ordinary independently runnable Express app for local development and portability.
- Decide the deployed entrypoint in PR 2. API routes must resolve before the SPA fallback and short-code rewrite. `/api/auth/*` and application API paths must not return `index.html` on routing mistakes.
- Existing social HTML reads the built SPA document using `process.cwd()`. Existing JPEGs load fonts/SVGs relative to the server module. Moving packages or build output requires explicit asset inclusion/path handling. Keep all Sharp/native code server-only.
- Share responses use public CDN cache headers; fallback/error paths use `no-store`. Preserve that distinction and avoid public caching of account responses.
- Use direct server services from existing share handlers where practical. A share function calling its own public API adds an avoidable network hop.
- Replace Vite Supabase resource hints/env injection as browser responsibilities move to the API/auth client. Keep database URLs, service keys, auth secrets, and email credentials out of client bundles.
- PR 1 must update root installs and lockfile cache paths in CI, Vercel install/build commands, workspace scripts, `.gitignore`, test/lint/format scopes, and shared-package resolution. Existing TypeScript builds use bundler resolution and `noEmit`; shared TS source must also work in the selected Node/Vercel execution path, not just inside Vite.
- Existing web eager-JavaScript budget is 210 KiB gzip. Preserve the budget check and inspect shared imports for server leakage; reassess a changed baseline based on actual output rather than increasing the limit automatically.
- Keep existing Python directory locations initially. Local daily/weekly scripts have hardcoded checkout paths and commit artifacts to `main`; the realtime watcher also syncs/commits. A broad repository rename would create unrelated operations changes.
- Relevant GitHub scraping/cleanup schedules are commented out; workflow dispatch remains configured. Do not assume README descriptions prove jobs are currently scheduled or running.

## Verification inventory for later planning

- Current Vitest tests use jsdom with local fixture Supabase transports or module mocks, including query cancellation, cache isolation, date/filter codecs, image boundaries, and account forms. Backend tests need a separate Node environment.
- Add Supertest endpoint checks alongside each migrated service. Preserve behavior tests while replacing tests that assert obsolete Supabase request shapes.
- Mocked repositories are useful for API boundaries but do not prove Postgres transaction rollback, constraints, column mapping, or auth persistence. Cover those with a small real-Postgres integration suite using an isolated nonproduction database.
- Docker is deferred. The usual local Supabase CLI stack needs a Docker-compatible container runtime; current documentation also offers an experimental native runtime on Linux and Apple-silicon macOS. Do not make containers a hidden prerequisite or assume the experimental alternative fits the development machine. The later plan must choose native local Postgres, an available isolated test database, an explicitly evaluated native Supabase runtime, and/or a Postgres CI service container with that distinction made explicit. Do not use the live app database for destructive integration tests.
- Playwright should cover a compact set of meaningful end-to-end flows: catalog/search, city/date/filter browsing, direct/encoded movie URLs, guest defaults, account settings, admin edits, subscription changes, and final auth/recovery behavior. Use local fixtures or the isolated test backend; stub external cinema/email/map dependencies where appropriate.
- Add a small Python notification/codec compatibility test where the PR 5 user lookup changes; existing injection points make this possible without scraping or sending mail. Current CI only compiles Python source, so it would not otherwise verify that path.
- Keep existing frontend checks and targeted Python syntax checks. Tests must not send real emails, run the real scraper, or write to the production database as incidental verification.

## Proportionate cutover assumptions

The app does not require enterprise migration machinery. A short coordinated cutover, an intentional single-account reset/remap, and re-scraping rebuildable tables can be reasonable. Small exports of durable mappings, corrections, curated data, and any wanted account settings are enough to avoid unnecessary loss. Basic authorization, credential separation, meaningful transaction tests, and correct routing still belong in the implementation.

The master plan should settle only these remaining architectural choices before expanding the five mini plans: API deployment adapter/origin; one schema migration authority and verified database inventory; shared-package runtime/build format; isolated Postgres testing without mandatory Docker; and the simple account/email-lookup cutover. Public endpoint details can then be derived from the traced consumers rather than guessed from physical table names.

## Documentation checked

- [Express on Vercel](https://vercel.com/docs/frameworks/backend/express)
- [Better Auth Express integration](https://better-auth.com/docs/integrations/express)
- [Better Auth Prisma adapter](https://better-auth.com/docs/adapters/prisma)
- [Better Auth database/schema and UUID configuration](https://better-auth.com/docs/concepts/database)
- [Better Auth email/password flows](https://better-auth.com/docs/authentication/email-password)
- [Supabase CLI and local runtime options](https://supabase.com/docs/guides/local-development/cli/getting-started)

Version-specific APIs and deployment behavior should be rechecked when implementation begins. This audit did not install dependencies, run the application/test suites, inspect credentials, query production, create PRs, or request reviewers.
