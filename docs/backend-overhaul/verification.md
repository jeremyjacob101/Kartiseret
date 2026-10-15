# Backend overhaul verification ledger

PR 1 rows retain their original evidence. PR 2 rows track the initial API/database foundation only; they do not claim later frontend, auth, or production migration work.

| ID | Owner | Status after PR 2 | Implementation and evidence |
| --- | --- | --- | --- |
| F01 | 1 | Verified | Root npm workspace, one root lockfile, shared-first build order, root lint/format/typecheck/test/build/verify scripts, root CI install, and root Vercel install/build. PR 1's clean root install and unchanged baseline lock evidence is in the PR 1 handoff; PR 2 adds the API workspace and locked dependencies. |
| F02 | 1–5 | Structural check passed | Shared package still has no browser globals, provider clients, Node-only imports, or secrets. PR 1 emitted-subpath and eager-bundle evidence is retained. PR 2 server modules are not imported by frontend modules. |
| F08 | 1, 3 | Shared module verified; server clock deferred | Existing fixed-clock cinema-day, cutoff, grace, carryover, and timezone tests import `@kartiseret/contracts/showtime-day`. No request-scoped server clock is introduced in PR 2. |
| F09 | 1, 3 | Shared module verified | Existing codec, filter-mask, encoded-link, and 62-day-window tests import `@kartiseret/contracts/showtime-links`. PR 2 does not change route behavior. |
| F13 | 1, 4, 5 | Shared values verified; persistence deferred | Preference constants, schemas, and pure normalizers live in the contracts package. Storage, theme, and synchronization remain frontend-owned; server preference persistence is deferred. |
| F25 | 2, 4, 5 | Schema snapshot captured; worker behavior not exercised | The active project inventory contains all 18 raw/final/cinematheque/ops tables, FKs/checks, RLS, standalone indexes, and the two app Realtime memberships. No schema or worker change was applied to the hosted project. Fictional CI/dev fixtures include run metrics and city/theater/showtime examples; they do not invoke the Python workers or prove external Realtime behavior. |
| F26 | 2–5 | Variable boundaries documented; hosted dev pending | Runtime, migration, test, site, Supabase, and local-proxy variable names are separated. No dev Supabase project or Vercel Preview variables were created because provisioning requires Jeremy to choose an organization and confirm the quoted cost. Current active app project identity was observed; no credentials are included. |
| F27 | 2–5 | SQL authority and clean baseline verified in disposable PostgreSQL 17 CI | One timestamped current-state baseline is active. Six historical ticket-alert SQL files are checksum-preserved outside the active path because no migration ledger was recorded on the source project. Prisma migrations are not used. The required CI job replays the baseline into an empty PostgreSQL 17 database and seeds it successfully. |
| F28 | 2–5 | Unit/real-DB tests verified; local real-DB run unavailable | Supertest/Vitest covers health, normalized catalog, empty catalog, pending rows, bad query/body, safe DB/data errors, and unknown API 404. The CI integration suite passes against PostgreSQL 17 and exercises the runtime role, actual Postgres mapping, constraints and transaction rollback. This checkout has no running Docker daemon or local PostgreSQL server, so no local real-DB pass is claimed. |

## PR 1 measured bundle

Using the base commit (`60a242df`) and its original lockfile, the eager client bundle measured **205.9 KiB gzip**. The PR 1 build measured **207.5 KiB gzip**, a **1.6 KiB** increase under the unchanged **210 KiB** budget. The existing Vite warning for a large lazy map chunk remains; it is not part of the eager bundle measurement.

## PR 2 checks

Final commands, test counts, lockfile digest, CI result and Vercel deployment status are recorded in `pr-2-handoff.md`.
