# Backend overhaul verification ledger

PR 1 evidence is limited to the workspace and shared-contract foundation. Rows assigned to later PRs remain unverified until their implementations exist.

| ID | Owner | PR 1 status | Implementation and evidence |
| --- | --- | --- | --- |
| F01 | 1 | Verified | Root npm workspace, one root lockfile, explicit package build order, root lint/format/typecheck/test/build/verify scripts, root CI install, and root Vercel install/build. A clean root `npm ci --offline` succeeded after removing the nested web lockfile; its SHA-256 remained unchanged. |
| F02 | 1–5 | Structural check passed | Contract sources contain no browser globals, provider clients, Node-only imports, or secrets. Node 24 imported all six emitted package subpaths. The production build and eager bundle scan found no server-only markers in shared contract sources or eager client chunks. |
| F08 | 1, 3 | Shared module verified; server clock deferred | Existing fixed-clock cinema-day, cutoff, grace, carryover, and timezone tests now import `@kartiseret/contracts/showtime-day`; they passed in the 488-test suite. No request-scoped server clock is introduced in PR 1. |
| F09 | 1, 3 | Shared module verified | Existing codec, filter-mask, encoded-link, and 62-day-window tests now import `@kartiseret/contracts/showtime-links`; they passed in the 488-test suite. No route behavior was changed. |
| F13 | 1, 4, 5 | Shared values verified; persistence deferred | Preference constants, schemas, and pure normalizers live in `@kartiseret/contracts/preferences`. Storage, theme changes, and synchronization remain in frontend modules. Existing preference-schema and store tests passed; server persistence is deferred. |

## Measured bundle

Using the base commit (`60a242df`) and its original lockfile, the eager client bundle measured **205.9 KiB gzip**. The PR 1 build measured **207.5 KiB gzip**, a **1.6 KiB** increase under the unchanged **210 KiB** budget. The existing Vite warning for a large lazy map chunk remains; it is not part of the eager bundle measurement.
