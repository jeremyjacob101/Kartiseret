<p align="center">
  <img src="Codebase%20-%20Kartiseret%20Web/public/docs/images/logo.png" alt="Kartiseret logo" width="140">
</p>

<h1 align="center">Kartiseret</h1>

<p align="center">
  One place to see what's playing, what's coming next, and where to catch it across Israeli cinemas.
</p>

<p align="center">
  <img alt="React 19.2.7" src="https://img.shields.io/badge/React-19.2.7-0F172A?style=for-the-badge&logo=react&logoColor=61DAFB">
  <img alt="TypeScript 6.0.3" src="https://img.shields.io/badge/TypeScript-6.0.3-1D4ED8?style=for-the-badge&logo=typescript&logoColor=white">
  <img alt="Vite 8.1.4" src="https://img.shields.io/badge/Vite-8.1.4-111827?style=for-the-badge&logo=vite&logoColor=FBBF24">
  <img alt="Zustand 5" src="https://img.shields.io/badge/Zustand-5-433E38?style=for-the-badge">
  <img alt="TanStack Query 5" src="https://img.shields.io/badge/TanStack_Query-5-EF4444?style=for-the-badge">
  <img alt="Python 3.14+" src="https://img.shields.io/badge/Python-3.14%2B-166534?style=for-the-badge&logo=python&logoColor=white">
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-Platform-0F172A?style=for-the-badge&logo=supabase&logoColor=3ECF8E">
  <img alt="License MIT" src="https://img.shields.io/badge/License-MIT-15803D?style=for-the-badge">
</p>

> Most cinema sites answer one theater at a time.
> Kartiseret is built around a different question: what is playing, where can I watch it, and what should I open first?

<p align="center">
  <a href="https://www.seret.site/">Take me there →</a>
</p>

<p align="center">
  <img src="Codebase%20-%20Kartiseret%20Web/public/docs/images/ks1.gif" alt="Kartiseret demo" width="500">
</p>

## Overview

Kartiseret is a movie discovery and showtimes platform built to make cinema browsing feel unified instead of fragmented. On the product side, it powers a motion-heavy React + TypeScript single-page app for browsing now-playing films, coming-soon releases, city and theater options, trailers, ratings, and user preferences. On the data side, it relies on a Python scraping and enrichment pipeline that collects listings from cinema websites, cleans inconsistent titles and metadata, enriches records with TMDb and other external sources, and writes the results into Supabase.

The goal is simple: reduce the friction between "I want to watch a movie tonight" and "here are the real options."

## Why This Exists

Going to the movies should not require opening six tabs, guessing which listings are stale, and manually comparing showtimes city by city.

Kartiseret exists to make that flow calmer and more useful:

- aggregate listings across multiple cinema chains and cinematheques
- show now-playing and coming-soon movies in one coherent browsing experience
- make city and theater selection feel visual instead of tedious
- surface trailers, ratings, and metadata without burying showtimes
- keep the data pipeline transparent and maintainable

## Highlights

- Custom React + TypeScript frontend focused on now-playing and coming-soon discovery.
- Animated homepage scrollers with a custom detail mode instead of a third-party carousel.
- Client-side search across both current and upcoming movies, with title and year-aware ranking.
- MapLibre-based city and theater picker with search, geolocation, focus controls, and theater marker popups.
- Better Auth cookie-session user menu with saved preferences for location, rating sources, and site accent color.
- Zod runtime validation at browser, storage, Supabase, route, environment, and server request boundaries.
- First-availability alerts for manually watched and Letterboxd films, grouped into one email per account with separate Coming Soon date and ticket sections.
- Guest-friendly local caching for location and theme color.
- Selenium scrapers for major Israeli cinema chains plus several cinematheques.
- Multi-stage backend dataflow for cleaning, TMDb matching, metadata enrichment, deduplication, and preview-table generation.
- Failure artifacts that capture screenshots, text traces, and CSV snapshots of scraped rows.
- Daily cleanup automation for expired showtimes and old soon entries.

## Platform Snapshot

Kartiseret currently spans two connected layers:

1. A browser app that reads directly from Supabase using only a publishable key.
2. A Python pipeline that scrapes source sites, enriches records, and maintains the tables the frontend depends on.

### Frontend Experience

- Built as a client-side React 19.2.7 + TypeScript 6.0.3 SPA with Vite 8.1.4.
- Uses React Router for browser navigation and standalone movie/share routes.
- Uses Zustand for shared synchronous client state, TanStack Query for remote server state, and focused React state for component-local interactions.
- Styles are global CSS-driven, accent-color-driven, and motion-heavy rather than Tailwind-based.
- Code-splits secondary screens with `React.lazy` and `Suspense`.
- Reads movie data directly from Supabase in the browser rather than through a separate API layer.
- Derives TypeScript models from Zod schemas where practical and rejects malformed external rows before they enter application state.
- Loads data in stages for perceived speed: now-playing preview, coming-soon preview, then full datasets and showtimes.
- Loads movie collections in parallel, then fetches showtimes incrementally by city and date window.
- Supports homepage, `/movies`, `/soons`, `/showtimes`, and `/user` routes.
- Provides a full `/showtimes` browser with incremental day loading, city switching, filters, and nearby-city suggestions.
- Gates `/user` behind authentication and keeps the auth UI inside the user menu rather than on a dedicated auth page.

### Frontend State Architecture

State ownership follows one rule: the system that owns the source of truth also owns its loading, error, freshness, and update lifecycle. Remote data is never copied into a Zustand cache.

- TanStack Query (React Query, `@tanstack/react-query`) owns movie collections, permanent movie-code indexes, city/theater data, admin membership, ticket-alert subscriptions/availability, and all showtime request/cache state. Each vertical slice co-locates its query-key factory, fetcher, `queryOptions`, selectors, freshness policy, and invalidation rules.
- Movie collection queries are keyed by catalog mode. Their data includes both the ordered movie list and its code index, so route lookups cannot drift from the rendered catalog.
- Showtime network queries are keyed by city, inclusive start/end dates, and a normalized optional TMDb ID. Identical requests deduplicate automatically. Results merge immutably into a per-city Query cache that records broad and movie-targeted coverage separately; a targeted load therefore cannot mark the full city catalog ready.
- Incremental showtime extension, targeted movie prefetch, and arbitrary-date jumps all reuse those range queries. Coverage metadata prevents known dates from being requested again, while exact range keys handle in-flight request sharing.
- Admin movie edits use a TanStack mutation. Coming-soon edits invalidate only that collection; now-playing edits invalidate that collection, reset the showtime subtree, and invalidate ticket availability because movie identifiers can change. Account alert subscriptions are not invalidated by movie edits.
- Ticket alerts are one vertical slice in `src/data/ticketAlerts.ts`. The movie control and settings list share a paginated, user-keyed subscription query. Availability reads are keyed by normalized movie ID and cinema date, span all cities, and stay separate from the city browser's coverage cache. City preference and movie-code links are selectors over raw availability rows, not extra request keys or persisted derived state. Queries have one-minute freshness, five-minute garbage collection, and abortable reads.
- Account alert mutations use per-user/movie keys and serialization. Subscription creation rechecks current availability and membership through those same queries. Successful changes merge the confirmed row into the affected user's list and invalidate only that list; failures leave confirmed data unchanged. Writes are not automatically retried. This deliberately preserves the existing confirmed-save UX instead of adding optimistic notification state or rollback bookkeeping.
- `useShowtimeFiltersStore` remains Zustand state because saved filter selections are synchronous, shared by unrelated screens, and synchronized through local storage across tabs.
- `useDeviceStore` remains Zustand state because responsive/user-agent classification is synchronous and shared by multiple distant consumers.
- Catalog view mode, jump requests, forms, dialogs, animation phases, gestures, measurements, and other single-owner values remain local React state.

`useUserPreferencesStore` is a deliberate synchronization exception. Better Auth session updates, the active account, guest preference persistence, cached theme bootstrap, immediate theme application, optimistic saves, rollback, auth-generation guards, and rapid-save coalescing form one small protocol. Splitting the authenticated preference row into a query plus a second client store would create two competing owners and make rollback ordering harder to trace. Verified accounts initialize missing preferences through the API, honoring ordinary signup location before guest location without overwriting existing choices. Admin membership is not part of that protocol and is therefore a normal user-keyed query. Revisit the preference exception only if the entire synchronization protocol can move as one vertical slice without weakening guest behavior or save coalescing.

Run JavaScript workspace commands from the repository root: `npm test`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, or the complete `npm run verify`. `npm test` includes the PostgreSQL-backed API integration suite; `npm run verify` also runs the Chromium browser acceptance tests. The database-backed commands start real PostgreSQL 17 through the pinned `embedded-postgres` package, create a fresh cluster under the system temp directory, replay the migrations and fixtures, and stop and remove that cluster afterward. They need no Docker daemon or preinstalled PostgreSQL service. Install the browser once with `npx playwright install chromium` before running `npm run web:e2e` or `npm run verify`. Run `npm run web:coverage` when you want an on-demand V8 line, branch, and function report for all web source files, including files no test imports; the HTML report is written to `coverage/web/index.html`. Coverage does not run in the regular CI test path and has no percentage gate, so it can guide targeted tests without slowing every build or rewarding test count. Focused tests cover query-key dimensions, immutable showtime/alert cache merging, request deduplication/cancellation, targeted invalidation, account isolation, failed account writes, signup defaults, and preference rollback/coalescing policy. Unit tests inject API/auth transports. Integration and Playwright suites exercise real Express/Better Auth handlers and captured mail. Hosted acceptance uses isolated DEV accounts with explicit authorization; never use Production accounts or send live mail as a fixture test.

### Frontend UX Details

- Homepage leads with animated "Now Playing" and "Coming Soon" scrollers.
- Search is client-side only and returns up to 10 ranked results across both catalogs.
- Opening a movie transitions from card to detail mode with a ghost-poster handoff animation.
- Detail mode supports keyboard arrows, swipe gestures, wheel-based horizontal navigation, Escape to close, and adjacent poster previews.
- Now-playing detail view emphasizes showtimes by day and theater.
- Coming-soon detail view emphasizes release date and trailer presentation.
- Ratings can surface from IMDb, Rotten Tomatoes, Letterboxd, and TMDb when IDs and scores are available.
- The city picker uses MapLibre GL with the CARTO Dark Matter style and supports nearest-city geolocation.

<details>
<summary><strong>Current canonical locations used by the frontend</strong></summary>

Ashdod, Ashkelon, Ayalon, Beer Sheva, Carmiel, Chadera, Even Yehuda, Givataim, Glilot, Haifa, Herziliya, Jerusalem, Kfar Saba, Kiryat Bialik, Kiryat Ono, Modiin, Nahariya, Netanya, Omer, Petach Tikvah, Raanana, Ramat Hasharon, Rehovot, Rishon Letzion, Tel Aviv, Zichron Yaakov.

</details>

### Backend Pipeline

- Written in Python and currently pinned only through `requirements.txt`, with GitHub Actions using Python `3.14.2`.
- Uses Selenium + Chrome for source scraping.
- Uploads data into Supabase using the service-role key.
- Uses TMDb for movie matching and core metadata enrichment.
- Enriches now-playing movies further with IMDb, Rotten Tomatoes, and Letterboxd data when available.
- Retries individual scraper/dataflow jobs up to three times before marking the run as failed.
- Stores run logs, timing metadata, and failure artifacts under `backend/utils/log/logger_artifacts/`.

### Source Coverage In This Repo

- Now playing scrapers: `Lev Cinema`, `Rav Hen`, `MovieLand`, `Hot Cinema`, `Yes Planet`, `Cinema City`
- Coming-soon scrapers: `Lev Cinema`, `Yes Planet`, `Cinema City`, `Hot Cinema`, `MovieLand`
- Cinematheque coverage: `Jaffa Cinema`, `Sam Spiegel Cinema`, `Holon Cinematheque`, `Herziliya Cinematheque`, `Haifa Cinematheque`, `Jerusalem Cinematheque`, `Tel Aviv Cinematheque`

### Backend Flow

The default run plan is:

1. Scrape `allSoons`
2. Scrape `allShowtimes`
3. Scrape `allTheques`
4. Run coming-soon dataflows
5. Run now-playing dataflows
6. Run cinematheque dataflows

Within that plan, the backend currently does the following:

1. Scrapes raw source rows into Supabase tables like `allShowtimes`, `allSoons`, and `allTheques`.
2. Normalizes titles, removes obviously bad rows, and performs source-specific cleanup.
3. Matches films against TMDb, moves accepted rows into final tables, and marks processed source rows as added.
4. Enriches final movie records with posters, backdrops, trailers, genres, ratings, and popularity metadata.
5. Deduplicates final showtimes, movies, and soon entries using table-specific preference rules.
6. Builds preview tables so the frontend can render small "fast first paint" scrollers before the full catalog finishes loading.

## Supabase Shape

<details>
<summary><strong>Current table snapshot</strong></summary>

**Backend raw ingest**

- `allShowtimes`
- `allSoons`
- `allTheques`

**Final / enriched tables**

- `finalShowtimes`
- `finalMovies`
- `finalSoons`
- `finalTheques`
- `finalThequeMovies`
- `movieCodes` maps each TMDb ID to its permanent three-character Base62 code.
- `theaters`
- `userPreferences`
- `ticket_alert_subscriptions` stores one-shot Coming Soon alert requests and retry-safe delivery snapshots.

**Helper / ops tables**

- `tableFixes`
- `tableSkips`
- `utilRunLogs`
- `utilAvgTime`

This repo includes generic Supabase table utilities in `backend/utils/supabase/supabase_tables.py`.

`movieCodes` is created by the SQL migration chain; do not create it ad hoc or replay the baseline on an existing project. The Python dataflow then fills the empty table from the current final rows and reuses the same code for every TMDb ID on later runs.

</details>

## Run Locally

### Backend In This Repo

Requirements:

- Python 3.14 or newer
- Google Chrome installed locally
- A Supabase project and service-role key
- A TMDb API key

Environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TMDB_API_KEY`
- `RESEND_API_KEY` (required only when a pending alert is ready to send)
- `TICKET_ALERT_RECIPIENT_API_URL` (explicit app origin; DEV must not default to Production)
- `TICKET_ALERT_INTERNAL_API_SECRET` (matches that app environment’s server-only `INTERNAL_API_SECRET`)
- `RESEND_FROM_EMAIL` optional; defaults to `Kartiseret <notifications@seret.site>`
- `SITE_URL` optional; defaults to `https://seret.site`
- `RUNNER_MACHINE` optional, but useful for local timing statistics

Setup and run:

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

export PYTHONPATH="$PWD"
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
export TMDB_API_KEY="your-tmdb-api-key"
export RESEND_API_KEY="re_your_resend_api_key"
export RUNNER_MACHINE="local"
export TICKET_ALERT_RECIPIENT_API_URL="https://your-dev-app.example"
# Supply TICKET_ALERT_INTERNAL_API_SECRET privately before dispatching alerts.

python -m backend.config.runner
```

Local runs open an interactive Rich terminal menu, so you can choose a full run or a narrower subset of scrapers/dataflows. In GitHub Actions and weekly shell runs, the default plan runs headlessly.

Cleanup expired data:

```bash
. .venv/bin/activate
export PYTHONPATH="$PWD"
python backend/utils/supabase/clear_old_entries.py
```

### Frontend

The frontend lives in `Codebase - Kartiseret Web/` and calls same-origin `/api/v1` and `/api/auth`. It needs no Supabase browser key. The server owns restricted database access, Better Auth secrets and Resend configuration; copy the DEV settings in [`.env.example`](.env.example) into a private root `.env`.

Setup and run in separate terminals:

```bash
npm ci
npm run server:dev
```

```bash
npm run dev
```

The example's Vite proxy targets the local API. Use DEV database credentials and exact local auth origins, never a Production runtime or service-role key in the browser. Production’s coordinated identity migration/configuration gate is in the [PR5 handoff](docs/backend-overhaul/pr-5-handoff.md).

Run the fixture-only runtime-validation suite and the full production build with:

```bash
npm test
npm run typecheck
npm run build
npm run bundle:check
```

These commands run from the repository root. Shared contracts are exported through explicit `@kartiseret/contracts/*` subpaths and built before frontend or Vercel functions consume them. The validation architecture and one-parse-per-boundary convention are documented in [`Codebase - Kartiseret Web/docs/runtime-validation.md`](Codebase%20-%20Kartiseret%20Web/docs/runtime-validation.md). Run `npm run verify` for the complete lint, formatting, typecheck, fixture-test, build, and eager-bundle validation sequence.

Both the root and web-workspace `verify` commands remove `Codebase - Kartiseret Web/dist/` only after all their checks pass. Failed verification preserves the output for debugging. Run `npm run build` before previewing, inspecting, or measuring the built bundle again; the build command retains its output for deployment. You can also remove the web bundle manually with root `npm run clean:web-build`. The contracts and server `dist/` folders stay available for editor imports and development sessions. VS Code hides all three generated output folders from its Explorer.

Email/password signups use Better Auth inside Express and require verification before private features. Signup/change/reset share an 8–128 character policy. Signed-out recovery consumes an actual reset token. Existing imported accounts retain their UUID/private records and establish a new credential through password reset; provider passwords and sessions are not imported.

### Movie Notifications

SQL under `supabase/migrations/` is the only schema authority. Existing projects must not replay the baseline; use the current migration ledger and reviewed [PR5 cutover](docs/backend-overhaul/pr-5-handoff.md). Browser subscription operations go through protected Express APIs. Python retains guarded service-role table updates, stable delivery IDs and Resend idempotency, but obtains canonical verified recipient email only through the separately authenticated internal application endpoint.

Movie notifications require an upcoming showtime with a valid ticket URL. Unset city criteria follow the account’s preferred city, falling back to Jerusalem; explicit city lists select one or more cities. “All cities” saves an explicit list. The default notification mode sends once per film when any selected city first has a qualifying screening. Users can instead choose first availability separately for each selected city, with optional per-title overrides and the existing showtime filters under `/user`. Later dates, sessions, cinemas, and ticket-link changes do not repeat a completed scope. Manual watches and Letterboxd sources share delivery history and one digest per account per run, with separate Coming Soon date and ticket-availability sections. See [the notification cutover guide](docs/first-availability-notifications.md) before deployment.

Signed-in users can also search TMDb and watch titles before they appear in the local Coming Soon catalog. The title search key stays on the server. A date notification uses only the date first published to the local `finalSoons` catalog, never TMDb's general release date. Existing local dates are shown without creating a date alert. Newly published dates are grouped into one email per account after the Coming Soon update commits. These watches and their retry state are separate from ticket alerts.

Users can track public Letterboxd watchlists and lists, including lists visible to anyone with a share link, without connecting a Letterboxd account or sharing sign-in credentials. Sources sync during the daily catalog pipeline; the first sync quietly records the existing films. A film must match one unique local English title and release year before its local Coming Soon date or eligible future ticket showtimes can trigger an alert. Showtime alerts use the account's city selection, notification mode, ticket filters, and any saved per-title override. Each film’s first local Coming Soon date is a separate notification scope. Removing a source cancels pending source alerts after the film leaves every tracked source, while manual title watches remain independent.

Keep `RESEND_API_KEY` server-side in the local runner or GitHub Actions secret store. Never prefix it with `VITE_`. The runner sends movie notifications; Vercel uses its own server-side Resend configuration for account verification/reset mail. Production delivery from the default address also requires `seret.site` to be verified in Resend. Resend's shared `resend.dev` domain can only send to the Resend account owner.

Set `TMDB_API_KEY` as a server-only variable for the Express API in each deployed environment that should provide movie search. The same variable is used by the Python catalog pipeline. Do not expose it through a `VITE_` browser variable. If the API key is absent, title search returns a safe unavailable response.

Follow the coordinated [PR5 Production checklist](docs/backend-overhaul/pr-5-handoff.md): prepare app/worker configuration, reconcile/export accounts, apply the single auth transition during the release window, deploy, verify real recovery/private flows, then resume affected runs.

## Automation

- `.github/workflows/full_checks.yml` runs the frontend lint, formatting, test, build, and bundle-budget suite, Python compile/tests, real PostgreSQL 17 migration/API integration, and Chromium browser acceptance on every push and pull request. Database-backed checks use the same disposable embedded PostgreSQL lifecycle as local commands and do not require a PostgreSQL service or hosted database credentials.
- `.github/workflows/run_main.yml` runs the main backend pipeline manually in GitHub Actions and uploads run artifacts.
- `.github/workflows/daily_sweep.yml` clears old showtimes and soon entries on a daily schedule.
- `backend/config/cron/run_weekly.sh` is a local weekly shell runner that syncs the repo, runs the full job, commits artifacts/logs, and pushes them back to `main`.
- `backend/config/cron/run_daily.sh` is a local daily shell runner that performs the same default headless run, writes separate daily logs, and pushes artifacts/logs back to `main`.
- Both local cron runners commit and push artifacts and the completed log even when the Python runner fails, record its exit code in the log and commit message, and then exit with that code. Code-sync, log-writing, and Git publication errors remain fatal.
- `backend/config/realtime/start_realtime_watcher_background.sh` starts/restarts a local realtime listener for `finalMovies`, `finalThequeMovies`, and `finalSoons`, loads Supabase credentials from the project-root `.env`, and writes logs to `backend/config/cron/run_realtime_logs/realtime_watcher.log`.
  - watcher-triggered update runs use `solo_update` mode (`SOLO_UPDATE_ONLY=true`) and process only rows where `solo_update = true`, then reset `solo_update` back to `false` on processed rows.
  - watcher-triggered runs write `utilRunLogs.run_from` as `np_solo_update` (for `finalMovies`), `theque_solo_update` (for `finalThequeMovies`), or `cs_solo_update` (for `finalSoons`).
  - regular daily/weekly/manual runs are unchanged and still process full tables.

## Project Tour

<details>
<summary><strong>Structure</strong></summary>

```text
.
├── .github/workflows/          GitHub Actions for main runs, cleanup, and license maintenance
├── backend/
│   ├── config/                 Runner entrypoints, registries, and cron helpers
│   ├── scraping/               Selenium scrapers for chains, coming-soon pages, and cinematheques
│   ├── dataflow/               Cleaning, TMDb matching, enrichment, dedupe, and preview generation
│   └── utils/                  Console UI, logging artifacts, and Supabase helpers
├── packages/contracts/         Shared Zod contracts and pure domain helpers
│   └── src/                    Explicitly exported ESM contract modules
├── Codebase - Kartiseret Web/  React + TypeScript frontend SPA
│   ├── config/                 Vite, TypeScript, and prettier config
│   ├── src/                    App source: components, data, lib, prefs
│   ├── public/
│   │   └── docs/images/        README assets
│   ├── index.html
│   ├── eslint.config.js
│   ├── tsconfig.json
│   └── package.json
├── package.json                Root npm workspace and verification commands
├── package-lock.json           Single npm workspace lockfile
├── .env                        Shared environment variables (Supabase keys, etc.)
├── LICENSE.md
├── README.md
└── requirements.txt
```

</details>

### Key Files

- `backend/config/registry.py` defines the scraper registries and the staged dataflow registries.
- `backend/config/runner.py` is the main entry point for local, weekly, and GitHub Actions runs.
- `backend/config/job_supervisor.py` gives each selected pipeline run (starting after the local plan menu) and each realtime solo Update a whole-process deadline. Defaults are 4h 30m and 30m; `PIPELINE_JOB_DEADLINE_SECONDS` and `PIPELINE_SOLO_UPDATE_DEADLINE_SECONDS` override them. On timeout or shutdown, the supervisor stops the worker process group, escalates to a kill after a bounded grace period, and makes a bounded best-effort attempt to release an allocated run lock. `PIPELINE_TERMINATION_GRACE_SECONDS` controls the default 20-second shutdown window, including up to 5 seconds reserved for run-lock cleanup.
- `backend/config/runners.py` runs selected scrapers through six timing-aware workers, then coordinates the shared Clean → TMDB → Update dataflow stages and runtime reporting.
- `backend/scraping/BaseCinema.py` defines the base Selenium scraping contract used across all cinema sources.
- `backend/dataflow/nowplayings/NowPlayingsTmdb.py` handles now-playing grouping, TMDb matching, and movement into final showtime/movie tables.
- `backend/dataflow/nowplayings/NowPlayingsUpdate.py` performs richer metadata enrichment for now-playing movies.
- `backend/dataflow/comingsoons/ComingSoonsTmdb.py` matches and enriches coming-soon titles before final dedupe.
- `backend/utils/log/artifact_logging.py` writes screenshots and text diagnostics whenever a run fails.
- `backend/utils/supabase/clear_old_entries.py` removes expired showtimes and stale soon entries from Supabase.

## Current Limitations

- SQL/Python retain existing physical database names; shared DTOs isolate the browser from those table details.
- Real app/API/database/browser flows are covered; third-party scraper coverage remains limited.
- Scrapers depend on third-party cinema DOMs, so upstream site changes can break individual sources without warning.

## Links

- Netlify: https://subtle-malabi-cb16ed.netlify.app/
- Localhost: http://localhost:5173/
- Localhost Mobile: http://10.100.102.11:5173/

## Assets For This README

Place your PNGs here:

| Asset | Path | Used for |
| --- | --- | --- |
| Logo | `Codebase - Kartiseret Web/public/docs/images/logo.png` | Centered logo at the top of the README |
| Demo GIF | `Codebase - Kartiseret Web/public/docs/images/ks1.gif` | Centered hero media rendered at `500px` width |

## Notes For Contributors

- Keep the Supabase contract in mind whenever backend tables or frontend assumptions change.
- If you touch TMDb matching, dedupe rules, or title normalization, verify both now-playing and coming-soon flows.
- Use run artifacts when debugging scraper failures; the screenshot + text + CSV bundle is part of the intended workflow.
- Treat source-site changes as expected maintenance, not exceptional events.
- UI changes should be checked for keyboard navigation, motion fallbacks, mobile layout, and auth/preference behavior.

## License

This project is available under the [MIT License](LICENSE.md).
