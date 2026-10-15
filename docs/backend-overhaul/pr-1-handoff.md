# PR 1 handoff — npm workspaces and shared Zod foundation

- **Base branch/commit:** `main` / `60a242df` (`origin/main` at start)
- **Implementation branch/commit:** `codex/backend-01-workspaces-contracts` / `c5145a8250eacafb76806a10321a6cab317b3cdb`
- **Draft PR:** [#165](https://github.com/jeremyjacob101/Kartiseret/pull/165)

## Implemented scope and user-visible behavior

Added a root npm workspace and `@kartiseret/contracts`. The current frontend, tests, and OG preview functions consume shared contracts through explicit package subpaths. No product screen, physical database schema, Python path, or auth flow was intentionally changed.

## Architecture and contracts

- Shared exports: `@kartiseret/contracts/runtime`, `/movies`, `/showtime-day`, `/showtime-filters`, `/showtime-links`, and `/preferences`.
- Package sources live in `packages/contracts/src/`; `npm run contracts:build` emits Node-importable ESM and declarations to ignored `packages/contracts/dist/`.
- Root commands: `npm run dev`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, `npm run bundle:check`, and `npm run verify`.
- Build order: shared contracts first, then the existing `kartiseret-web` workspace. npm workspace links resolve `@kartiseret/contracts` locally.
- Provider-specific row schemas, auth schemas, and preference form/storage/theme behavior remain in the web workspace. PR 2 should add a real server workspace when Express code is introduced; no placeholder server package exists yet.

## Database

- No database schema, SQL migrations, RLS policy, or data was changed.
- No Prisma/runtime/migration credentials or hosted development project were added.
- Nothing was reset, remapped, or exported.

## Hosting and environment

- `vercel.json` now runs root `npm ci` and `npm run build`; the SPA output remains `Codebase - Kartiseret Web/dist` and both OG function configurations remain present.
- GitHub's full-check workflow installs and verifies from the root lockfile. Node is pinned to 24 in CI and root/web manifests.
- Static config and emitted SPA output were checked locally. No Vercel preview was deployed or verified.
- No environment variables, mail transport, preview origin, or hosted Supabase project were changed.

## Verification

- A clean root `npm ci --offline` succeeded under Node 24.19.0 after removal of the nested web lockfile. SHA-256 of `package-lock.json` was unchanged across the install: `d51196329bcf8fadc653cccff91789fdd06dde2f2ab1a15c10fa3bcb0b36a7cc`.
- `npm run verify` under Node 24.19.0 passed: web and contracts lint, Prettier checks, contracts/web typechecks, **45 test files / 488 tests**, production build, and the eager bundle gate.
- A plain Node 24 ESM process resolved and exercised all six emitted contract subpaths.
- Static Vercel assertions passed for root install/build commands, SPA output, and existing OG asset inclusion. No preview URL or CI run is claimed.
- Eager bundle: base commit **205.9 KiB gzip**; PR 1 **207.5 KiB gzip**; existing budget **210 KiB**. The Vite large-map-chunk warning remains for the lazy map chunk.
- The online install output reported two high-severity npm audit findings in the inherited dependency set. PR 1 preserves the prior package versions and does not attempt unrelated dependency upgrades; the advisories were not triaged here.

## Adaptations and discoveries

- Added a TypeScript-only ESLint config for the shared package because ESLint does not apply the web config to sibling workspace files. The frontend lint scope remains its existing workspace.
- Kept the root dependency graph pinned to the existing web lock. A first lock generation from semver ranges selected Vite 8.3.4 and Zod 4.6.7 and measured 223.7 KiB gzip, above budget. That generated lock was discarded; the final root lock preserves every pre-existing package version, resolution, and integrity hash while adding workspace metadata and the local package link.
- No server workspace was created because PR 1 introduces no server implementation. PR 2 may add it with Express.

## Next PR readiness

- PR 1 contracts, root commands, Vercel root build, CI lock path, and verification ledger are present for PR 2 to build upon.
- PR 2 still needs its own database inventory/bootstrap, Prisma mapping, disposable PostgreSQL CI service, Express workspace, and real database tests. PR 1 does not satisfy those later gates.
- No hosted-dev or production operation is outstanding from PR 1.
