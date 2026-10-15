# Backend overhaul architecture decisions

## PR 1: workspace and contract boundaries

- The repository root owns one private npm workspace and one lockfile. Workspaces are `packages/contracts` and the existing `Codebase - Kartiseret Web` folder; Python, Supabase SQL, and Vercel API paths stay where they are.
- `@kartiseret/contracts` emits ESM and TypeScript declarations into ignored `dist/` output. Its package exports are explicit subpaths (`runtime`, `movies`, `showtime-day`, `showtime-filters`, `showtime-links`, and `preferences`); there is no broad barrel export.
- Zod is the only runtime dependency of the shared package. It has no browser globals, Node-only imports, provider clients, UI state, or secrets. Existing server OG functions import the same emitted helpers as the browser.
- Reusable runtime primitives, normalized movie/city/theater models, pure cinema-day/filter/link helpers, and pure preference values/schemas/normalizers live in the shared package. Provider row parsing, authentication contracts, forms, database-row initialization, browser storage, theme changes, and cross-tab state remain with their existing owners.
- The repository does not get a placeholder `server` workspace in PR 1. PR 2 can add it alongside the actual Express implementation.
- Root scripts build contracts before frontend consumers. Vercel installs from the root lock and builds the existing SPA plus OG functions from the unchanged output directory.

## Lockfile migration

The workspace lock was bootstrapped from the existing frontend lock so this packaging change does not update application dependencies. All existing package versions, tarball resolutions, and integrity hashes are preserved; only root/workspace metadata and the local contracts link are added. The old nested frontend lockfile is removed.

An initial lock generation from package ranges selected newer Vite and Zod versions and raised the eager bundle to 223.7 KiB gzip. That lock was discarded. The final lock keeps the existing Vite 8.1.4 and Zod 4.4.3 resolutions, and the final eager bundle remains under the existing 210 KiB budget.
