# PR 5 handoff — Better Auth and app-owned accounts

## Implementation and verification status

Regular [PR #172](https://github.com/jeremyjacob101/Kartiseret/pull/172), branch `codex/backend-05-better-auth`, merged into `main` on 2026-10-20 as `a6d0cf9e6c845ae4aa1e0b9e6100375a1e5b2c29` (final code head `8088eff7e0d01048d8afce683652b5d25bb7c169`). The merged code is deployed to Production in Ready deployment `dpl_ASJSugAxTpoLijG8ur8nzRYbqW53` at [seret.site](https://seret.site). Post-merge [Full checks #39402664758](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39402664758) passed all three jobs. This handoff records the completed Production cutover and Jeremy's confirmed sign-in after the password reset.

Local `npm run verify` passes: 492 frontend tests, 73 API/unit tests, lint/format/typechecks/builds, API/OG/assets/JPEG smoke, and 174.2 KiB eager gzip JS under the 210 KiB budget. Seven new Python recipient tests and the complete 71-test Python suite pass. Real PostgreSQL 17 integration (38 tests) and Chromium browser CI (7 scenarios) pass in [Full checks #39386951496](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39386951496). The final account-switch and transient-session guards add regression coverage; current counts are 492 web and 73 API/unit tests. Code-head CI and hosted acceptance results are recorded below; subsequent cache-header/documentation completion is covered by the PR’s current checks. 

## Architecture

- Better Auth 1.7.11 and `@better-auth/drizzle-adapter` 1.7.11 use existing Drizzle 0.45.4/pg. Adapter transactions are enabled. `@vercel/functions` 3.10.1 supplies supported background mail lifetime handling on Vercel.
- `app_auth` owns UUID users, credential accounts, database sessions, verification records and persistent rate-limit state. It is not exposed through the Data API; browser/service roles lack schema usage. Restricted Node runtime access is explicit. Supabase's managed `auth` schema is retained.
- Same-origin `/api/auth/*` is mounted before JSON parsing. Private feature APIs use verified cookie sessions, `Vary: Cookie`, no-store and exact-origin checks for unsafe methods. Old bearer tokens do not authorize them. `X-Kartiseret-Account-Id` detects a changed cookie account before a private read/write; the cookie session alone determines authorization. Session verification outages stay retryable availability failures rather than being mislabeled as logout. Public reads do not perform session queries.
- Sessions expire after seven days, have database revocation and no cookie caching. Host-only Secure/HttpOnly cookies use environment-specific prefixes. Callback and trusted origins are exact. Auth rate limits use PostgreSQL and Vercel's overwritten `x-forwarded-for` header.
- Frontend account forms retain their UI and Zustand preference owner. Better Auth's session atom feeds the neutral identity boundary; repeated refreshes do not reset preference save queues, and transient session outages preserve identity and pending writes. Password setup/change/reset consistently require 8–128 characters. Signed-out recovery submits an actual reset token.
- Browser Supabase SDK/config/resource hints are removed. Python service-side Supabase table access and Realtime remain.

## SQL and identity continuity

`20261020065120_better_auth_accounts.sql` is the sole forward migration. It imports minimal canonical identity records from Supabase users, preserving UUIDs and verification state, with no passwords or sessions. Every referenced identity must have an email; migration failure rolls back rather than dropping orphaned rows. Existing preferences, membership and subscriptions retain their IDs and values. The three application FKs now reference app-owned users. The managed Supabase Auth schema remains; after cutover, the two explicitly identified testing users were removed from both Auth providers while the admin identity was preserved.

Application RLS reads transaction-local `app.user_id` through a narrowly granted function. Legacy provider-based application policies are removed. All five private auth tables have RLS and explicit server-only grants. Real integration tests rehearse upgrading from PR4 with existing preference, admin and sent-alert records; fresh bootstrap replays the complete SQL chain.

Existing accounts establish a new credential through the library's password-reset flow, then sign in again. No session/hash conversion is attempted. If a new explicit admin assignment is needed, a trusted operator runs the reviewed `packages/server/scripts/set-admin.mjs` with an admin `MIGRATION_DATABASE_URL` and CA after the selected UUID exists and is verified. It never uses the runtime connection or a public bootstrap endpoint.

## Mail and recipients

Auth mail uses existing Resend through a bounded injectable fetch transport. Preview has an explicit recipient allowlist; an empty allowlist blocks live delivery. Tests capture mail in memory, never through a deployed capture endpoint. Vercel background callbacks have an explicit lifetime handler. No passwords, tokens, reset URLs or provider response bodies are logged routinely.

Better Auth verification links are signed, expiring library tokens. With automatic sign-in disabled, replay after verification is an idempotent no-op and creates no session. Reset tokens are database-backed and single-use; the actual adapter is tested for token/password/session rollback and concurrent consumption. No custom authentication token protocol is introduced.

`POST /api/internal/ticket-alert-recipients` requires a separate secret, validates 1–100 UUIDs, returns no-store and only ID/canonical email/verification state. Python uses existing requests with finite timeouts and redirects disabled; it rejects missing/unverified/malformed recipients and memoizes only successful lookups per dispatcher. Delivery IDs and Resend idempotency keys are retained across retries.

Python Production configuration (verified after cutover):

- `TICKET_ALERT_RECIPIENT_API_URL`: explicit application origin (DEV must never default to Production).
- `TICKET_ALERT_INTERNAL_API_SECRET`: matches that environment's Node `INTERNAL_API_SECRET`.
- Keep existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Resend settings and `SITE_URL` for worker tables, Realtime and email links.

## Production release — completed 2026-10-20

- **Deployment:** Production deployment `dpl_ASJSugAxTpoLijG8ur8nzRYbqW53` is Ready at [seret.site](https://seret.site), created from merged PR #172.
- **Database:** a dry run listed only `20261020065120_better_auth_accounts.sql`; that migration was applied to Production and appears in the ledger. The baseline was not replayed. Signup through the retired Supabase Auth provider was disabled during cutover.
- **Runtime configuration:** Production Vercel has `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, `BETTER_AUTH_URL`, `AUTH_TRUSTED_ORIGINS`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, `DATABASE_URL` and `DATABASE_SSL_CA_CERT`. The Production URL and exact trusted origins were verified without revealing secrets. GitHub Actions has `TICKET_ALERT_RECIPIENT_API_URL=https://seret.site` and the matching internal secret. The existing worker Resend credential remains separate.
- **Mail and account:** Jeremy confirmed receipt of the real password-reset email and completed the reset. The verified admin identity has a Better Auth credential. A database snapshot after account cleanup showed zero active Better Auth sessions; Jeremy subsequently confirmed signing in successfully after completing the password reset, so no interactive sign-in gate remains.
- **Account cleanup:** exactly two non-admin testing users were removed from `app_auth.users` and from the retired Supabase Auth `auth.users`; their app-owned preference rows cascaded. The admin account and membership remain. No active test sessions, refresh tokens, MFA factors, storage objects, alert subscriptions, or orphaned app rows were found.
- **Database postflight:** one verified admin remains in each auth identity store, all five `app_auth` tables have RLS, the expected application FKs and server-only grants remain, and no test-user preferences or alert subscriptions remain.
- **Live smoke:** `/api/v1/health`, `/api/v1/catalog/now-playing`, `/api/v1/catalog/coming-soon`, and `/api/v1/theaters` returned HTTP 200; unknown API routes returned 404; the OG image returned 200; an unauthenticated internal recipient request returned 401 as required. `/api/auth/get-session` returned the expected unauthenticated `null` response.
- **CI:** final-head PR checks #39390520035 passed, including 38 PostgreSQL 17 integration tests, seven Chromium scenarios and 71 Python tests. Post-merge main checks #39402664758 passed all three jobs. Local `npm run verify` also passed.
- **Worker:** the `Run Main` workflow remains manual-only. No ticket-alert delivery job was run as a smoke test.
- **Backup:** the access-restricted account/reference export remains outside the repository at `/private/tmp/kartiseret-pr5-account-backup.json`; remove it after the agreed retention period. It is not a release gate.

Old-application rollback after the FK/policy transition requires deliberate identity/FK/policy reconciliation. Do not replay an old grant restore script or drop app-owned auth data. The previous PR4 deployment is `dpl_9zYJpnMNd12iqLdgDc2MD9R4xrkp`.

## Scope carried forward

This PR includes the previously authorized small PR4 follow-ups: correct oversized-body 413 handling, the mobile navigation wrapping adjustment and accurate PR4 release documentation. No production migration or credential change is included in those follow-ups.

## Final DEV and code acceptance

- Final code head `9a8d133f` passes [Full checks #39387977073](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39387977073): all three jobs, including 38 real PostgreSQL17 tests and seven real Chromium scenarios. Final local full verification, all 71 Python tests and zero-vulnerability dependency audit pass.
- DEV migration `20261020065120` applied after a dry run listing that migration only. Security advisor: no warning/error issues. Hosted checks confirm five private RLS auth tables and all three application UUID FKs target app-owned users.
- Ready Preview `dpl_GcrqPuqqEY7Uqd8nqC4U8X39qRBF`: [open application](https://kartiseret-n0w03ea9c-jeremyjacob-projects.vercel.app). Actual signup/verification/login, Secure/HttpOnly/SameSite host-only cookies, exact callback origins, unverified denial, private defaults/partial save/empty ratings, account-cookie race rejection, duplicate alerts/isolation/cancellation and canonical internal recipient response pass.
- System Chrome proves deployed login/refresh, preference persistence, visible injected failed-save rollback, current-password change/revocation, logout, signed-out reset and consumed/invalid-token feedback. Zero browser page errors and zero direct browser table requests. Desktop settings and settled 390px mobile navigation are visually inspected; no horizontal overflow or wrapped Showtimes label.
- Test mail is captured locally through the actual Better Auth API using DEV database/secret; captured links are followed through deployed callbacks. At that DEV acceptance snapshot, Preview's empty recipient allowlist blocked real mail, and Production delivery had not yet been verified. Later, Jeremy configured the Resend key for both Production and Preview and added an explicit Preview recipient allowlist; Production reset-email delivery was verified. Preview delivery itself has not been exercised.
- Additional hosted checks pass for a deliberately assigned verified DEV admin (safe no-op correction), actual Python canonical-recipient HTTP lookup and database session expiry. Read-only postflight confirms browser/worker auth-schema access is denied, runtime admin writes are denied, service-role alert table access remains, and Realtime retains `finalMovies`/`finalSoons`.
- Disposable DEV users/private cascades were cleaned up during DEV acceptance. Production migration, deployment, account cleanup and mail acceptance are recorded in the Production release section above; the scheduled notification workflow was not run.

### Justified adaptations

The installed stable adapter exposes UUID generation, schema mapping, relations and transactions directly, so no auth CLI/schema generator or second migration engine is necessary. Database-backed rate limits add a fifth small private auth table; Vercel's supported background task lifetime uses `@vercel/functions`. Better Auth's verification replay is its harmless signed-token no-op with automatic sign-in disabled, while password resets are strictly one-time and tested concurrently. The expected-account header preserves the existing stale-account guarantee after switching from bearer credentials to mutable browser cookies; it is not an authorization credential. Local/CI captured mail avoids sending live messages during hosted acceptance.

Browser test clients receive distinct documentation-range IPs at the CI-only local proxy boundary so independent tests do not consume one shared login-limit bucket. The production database limiter remains enabled and its 429 behavior is independently tested; login response status is asserted before UI readiness. The final hosted receipt above uses code head `c40e875a`; later test isolation/documentation changes do not change runtime behavior.
