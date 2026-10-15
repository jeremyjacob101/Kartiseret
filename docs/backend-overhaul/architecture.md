# Backend overhaul architecture decisions

## PR 1: workspace and contract boundaries

- The repository root owns one private npm workspace and one lockfile. PR 1 added `packages/contracts` and the existing `Codebase - Kartiseret Web` folder; PR 2 adds `packages/server`. Python, Supabase SQL, and Vercel API paths stay where they are.
- `@kartiseret/contracts` emits ESM and TypeScript declarations into ignored `dist/` output. Its package exports are explicit subpaths (`runtime`, `movies`, `showtime-day`, `showtime-filters`, `showtime-links`, and `preferences`); there is no broad barrel export.
- Zod is the only runtime dependency of the shared package. It has no browser globals, Node-only imports, provider clients, UI state, or secrets. Existing server OG functions import the same emitted helpers as the browser.
- Reusable runtime primitives, normalized movie/city/theater models, pure cinema-day/filter/link helpers, and pure preference values/schemas/normalizers live in the shared package. Provider row parsing, authentication contracts, forms, database-row initialization, browser storage, theme changes, and cross-tab state remain with their existing owners.
- Root scripts build shared contracts before server and frontend consumers. Vercel installs from the root lock and builds the existing SPA and API functions from their respective workspaces.

## PR 2: server and data foundation

- `@kartiseret/server` owns the Express app, Prisma client, server-only environment parsing, normalized catalog mapping, and tests. Shared contracts compile before the API workspace and the web workspace. Importing `createApp` is side-effect free and takes a repository dependency; production DB composition is explicit.
- Prisma is a query/client mapping only. The sole DDL authority is timestamped Supabase SQL. The 2026-10-15 baseline is a current-state clean-project bootstrap, not an instruction to replay legacy files against the existing app project.
- Provider-owned `auth`, `realtime`, extension and publication objects stay outside the baseline. CI provides minimal test-only auth roles/schema/function; these do not claim to emulate Supabase Auth or Realtime.
- The runtime group role is read-only for the first public catalog slice. A separate login inherits it. Migration/admin credentials are distinct and are never read by a build or app runtime.
- Express exposes the first now-playing catalog read as a stable normalized contract. Existing frontend reads and OG code paths remain unchanged through this PR; PR 3 owns browser transport.
- Vercel packages a single catch-all Express API function alongside the two OG functions and existing SPA routes. Vite's `/api` proxy is opt-in through `VITE_API_PROXY_TARGET`.
- Disposable PostgreSQL 17 in CI is the source of truth for SQL replay and Prisma integration; the fast local verification command remains database-free. A bootstrap refuses remote and non-empty targets.

## Lockfile

The root lockfile is the only npm lock. Existing frontend resolution is preserved while Express, Prisma 7, the PostgreSQL adapter, and server tooling are added. Install-script approval is narrowly recorded for Prisma engine setup and the esbuild binaries used by the workspaces.
