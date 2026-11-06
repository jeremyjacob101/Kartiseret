# Current-main integration — 2026-11-06

Merged main at `c1bf99bd675de3a9910569c78d503115b96860ad` into the Requests transition branch. Main was fetched again before committing and had not advanced. The existing remote PR commits through `51d16857` were also merged and preserved, including their transport-diagnostics storage test and metadata compatibility.

The integration preserves main's scheduler, runner retry behavior, guarded Supabase client, atomic publication, target leases, heartbeat and takeover handling, R2 budgets, cleanup guards, and storage watermarks. There are no additional changes to those modules relative to main.

Requests-specific compatibility adjustments:

- Replace the removed local artifact-directory dependency with main's D1 text-artifact writer for transport diagnostics. Snapshot and attempt IDs distinguish HTTP failures from browser fallback; the existing writer provides redaction, lease checks, and recovery envelopes.
- Keep main's upload/D1/snapshot-completion ordering and storage-error handling around the transport collector. Infrastructure failures are not eligible for the Requests-to-Selenium source fallback.
- Reset the uploaded-row cache for a fresh attempt and preserve main's captured timing weekday across transport fallback.
- Retain main's shared publication requirements file instead of duplicating its pinned PostgreSQL dependency.
- Update branch parser tests to isolate D1 writes and expect main's canonical Infinity Vision type/technology normalization.

Six transport integration tests cover Requests success, whole-result browser fallback, distinct snapshot diagnostics, D1 failures before/after upload, infrastructure errors during collection, and stale uploaded-row buffers. These use mocks and perform no hosted database writes.

Validation on the merged branch:

- Backend: **629 tests passed**.
- All `npm run verify` stages passed under Node 24: lint, formatting, type checks, builds, SSR/browser/OG/bundle checks, **604 web tests**, **157 server tests**, **99 database integration tests (1 skipped)**, and **12 end-to-end tests**.
- Database integration and end-to-end checks used disposable local PostgreSQL. The first database attempt lacked the local Python `psycopg` dependency; rerunning with the pinned publication dependencies available passed.
- `git diff --check origin/main` passed for the PR changes.

This integration does not provide new live-site parity or speed measurements. Existing transport defaults and the outstanding MovieLand/Hot Cinema showtime parity limitations remain as recorded in the November 4 report.

## Latest-main follow-up

Merged main again at `bde12fffe1027834633289e3bab633d56e4fb7b3` to include the Hot Cinema coming-soon upload projection and movie-notification poster lookup fix. Both fixes and their tests are retained exactly as they are on main. Removed the obsolete local transport-diagnostics ignore rule because this branch now uses main's D1 storage path.

The remaining diff against main is the Requests collectors, lazy browser/fallback lifecycle, related fixtures/tests and dependencies, the prior scraper correctness/coverage fixes, and scraping documentation/evidence. Main's runner, publication, notification, lease, budget, and cleanup implementations have no additional diff.

Backend validation after this follow-up: **633 tests passed**. The preceding Node 24 verification remains applicable; the new main commit changes Python code and tests only. No new live-site benchmarks were performed.
