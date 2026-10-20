# PR 5 handoff — Better Auth and app-owned accounts

## Implementation and verification status

Branch `codex/backend-05-better-auth` starts from current main after PR4. Production has not been changed by PR5. Supabase Auth is still the deployed Production provider until the coordinated cutover.

Local `npm run verify` passes: 492 frontend tests, 73 API/unit tests, lint/format/typechecks/builds, API/OG/assets/JPEG smoke, and 174.2 KiB eager gzip JS under the 210 KiB budget. Seven new Python recipient tests and the complete 71-test Python suite pass. Real PostgreSQL 17 integration (38 tests) and Chromium browser CI (7 scenarios) pass in [Full checks #39386951496](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39386951496). The final account-switch and transient-session guards add regression coverage; current counts are 492 web and 73 API/unit tests. Code-head CI and hosted acceptance results are recorded below; subsequent cache-header/documentation completion is covered by the PR’s current checks. This is not a Production release receipt.

## Architecture

- Better Auth 1.7.11 and `@better-auth/drizzle-adapter` 1.7.11 use existing Drizzle 0.45.4/pg. Adapter transactions are enabled. `@vercel/functions` 3.10.1 supplies supported background mail lifetime handling on Vercel.
- `app_auth` owns UUID users, credential accounts, database sessions, verification records and persistent rate-limit state. It is not exposed through the Data API; browser/service roles lack schema usage. Restricted Node runtime access is explicit. Supabase's managed `auth` schema is retained.
- Same-origin `/api/auth/*` is mounted before JSON parsing. Private feature APIs use verified cookie sessions, `Vary: Cookie`, no-store and exact-origin checks for unsafe methods. Old bearer tokens do not authorize them. `X-Kartiseret-Account-Id` detects a changed cookie account before a private read/write; the cookie session alone determines authorization. Session verification outages stay retryable availability failures rather than being mislabeled as logout. Public reads do not perform session queries.
- Sessions expire after seven days, have database revocation and no cookie caching. Host-only Secure/HttpOnly cookies use environment-specific prefixes. Callback and trusted origins are exact. Auth rate limits use PostgreSQL and Vercel's overwritten `x-forwarded-for` header.
- Frontend account forms retain their UI and Zustand preference owner. Better Auth's session atom feeds the neutral identity boundary; repeated refreshes do not reset preference save queues, and transient session outages preserve identity and pending writes. Password setup/change/reset consistently require 8–128 characters. Signed-out recovery submits an actual reset token.
- Browser Supabase SDK/config/resource hints are removed. Python service-side Supabase table access and Realtime remain.

## SQL and identity continuity

`20261020065120_better_auth_accounts.sql` is the sole forward migration. It imports minimal canonical identity records from Supabase users, preserving UUIDs and verification state, with no passwords or sessions. Every referenced identity must have an email; migration failure rolls back rather than dropping orphaned rows. Existing preferences, membership and subscriptions retain their IDs and values. The three application FKs now reference app-owned users. Existing Supabase Auth tables remain intact.

Application RLS reads transaction-local `app.user_id` through a narrowly granted function. Legacy provider-based application policies are removed. All five private auth tables have RLS and explicit server-only grants. Real integration tests rehearse upgrading from PR4 with existing preference, admin and sent-alert records; fresh bootstrap replays the complete SQL chain.

Existing accounts establish a new credential through the library's password-reset flow, then sign in again. No session/hash conversion is attempted. If a new explicit admin assignment is needed, a trusted operator runs the reviewed `packages/server/scripts/set-admin.mjs` with an admin `MIGRATION_DATABASE_URL` and CA after the selected UUID exists and is verified. It never uses the runtime connection or a public bootstrap endpoint.

## Mail and recipients

Auth mail uses existing Resend through a bounded injectable fetch transport. Preview has an explicit recipient allowlist; an empty allowlist blocks live delivery. Tests capture mail in memory, never through a deployed capture endpoint. Vercel background callbacks have an explicit lifetime handler. No passwords, tokens, reset URLs or provider response bodies are logged routinely.

Better Auth verification links are signed, expiring library tokens. With automatic sign-in disabled, replay after verification is an idempotent no-op and creates no session. Reset tokens are database-backed and single-use; the actual adapter is tested for token/password/session rollback and concurrent consumption. No custom authentication token protocol is introduced.

`POST /api/internal/ticket-alert-recipients` requires a separate secret, validates 1–100 UUIDs, returns no-store and only ID/canonical email/verification state. Python uses existing requests with finite timeouts and redirects disabled; it rejects missing/unverified/malformed recipients and memoizes only successful lookups per dispatcher. Delivery IDs and Resend idempotency keys are retained across retries.

Python configuration required at cutover:

- `TICKET_ALERT_RECIPIENT_API_URL`: explicit application origin (DEV must never default to Production).
- `TICKET_ALERT_INTERNAL_API_SECRET`: matches that environment's Node `INTERNAL_API_SECRET`.
- Keep existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, Resend settings and `SITE_URL` for worker tables, Realtime and email links.

## Production gate — not performed

Before merging, prepare environment-specific `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, `BETTER_AUTH_URL=https://seret.site`, exact `AUTH_TRUSTED_ORIGINS`, Resend key/from address, and the matching Python recipient configuration. Preview credentials must never be copied to Production.

Use a short coordinated release window: back up wanted identity/reference tables; pause only the affected notification job; apply the reviewed migration without baseline replay; deploy the compatible app/config; establish the active account using reset mail; verify login/settings/alerts/admin and canonical recipient lookup; resume the job. Existing UUID/admin links should survive without manual remapping. Record the exact deployment and live verification before declaring release complete.

The FK/policy transition means an old-app rollback after cutover requires deliberate identity/FK/policy reconciliation, particularly once new accounts exist. Do not blindly replay an old grant restore script or drop app-owned auth data. Previous PR4 Ready deployment: `dpl_9zYJpnMNd12iqLdgDc2MD9R4xrkp`.

## Scope carried forward

This PR includes the previously authorized small PR4 follow-ups: correct oversized-body 413 handling, the mobile navigation wrapping adjustment and accurate PR4 release documentation. No production migration or credential change is included in those follow-ups.

## Copyable Production cutover procedure (requires a coordinated release)

Do not merge first and configure later. PR5 initialization requires the auth secrets, and the database transition changes the identity FKs/RLS used by private features. Keep the old signup flow unavailable during the short migration/deploy window so a provider-only account cannot be created after the identity copy. Pause the affected ticket-alert run while the endpoint and worker credential switch together; do not run the notification pipeline as a smoke test.

The checked-in `Run Main` workflow is currently manual-only (its schedule is commented out). Before this window, confirm no affected run is active and avoid starting one until acceptance is complete: `gh run list --workflow run_main.yml --limit 5`. No permanent scheduler redesign or pipeline pause mechanism is added.

1. Prepare **Production only** in Vercel: keep the existing restricted Production `DATABASE_URL` and CA; add independently generated `BETTER_AUTH_SECRET` and `INTERNAL_API_SECRET` (32+ random characters each), `BETTER_AUTH_URL=https://seret.site`, `AUTH_TRUSTED_ORIGINS=https://seret.site,https://www.seret.site`, `RESEND_API_KEY`, and a verified `AUTH_EMAIL_FROM`. Clear any Production test recipient allowlist. Never reuse Preview secrets. Use `npx vercel@latest env add NAME production` and enter each value interactively; use `env update` if the key already exists.
2. Set GitHub Actions repository variable `TICKET_ALERT_RECIPIENT_API_URL=https://seret.site` and repository secret `TICKET_ALERT_INTERNAL_API_SECRET` to that Production `INTERNAL_API_SECRET`. The main worker workflow passes these explicitly. Other existing worker/service-role/Resend configuration stays in place.
3. From a clean PR5 checkout, run the read-only preflight and save the reviewed reference export outside Git. Stop if any unresolved references, duplicate normalized emails or unexpected triggers appear. The baseline must not be replayed:

```bash
npx supabase@latest link --project-ref gsdrcyrduxbrxgsvhxvr
npx supabase@latest db query --linked --project-ref gsdrcyrduxbrxgsvhxvr --file supabase/operations/pr5-preflight.sql
umask 077
npx supabase@latest db query --linked --project-ref gsdrcyrduxbrxgsvhxvr --file supabase/operations/pr5-export-account-references.sql > /private/tmp/kartiseret-pr5-account-backup.json
npx supabase@latest db push --linked --project-ref gsdrcyrduxbrxgsvhxvr --dry-run --skip-vault
```

4. During the coordinated window, confirm the dry run contains **only** `20261020065120_better_auth_accounts.sql`, then apply it and merge/deploy the compatible PR5 build:

```bash
npx supabase@latest db push --linked --project-ref gsdrcyrduxbrxgsvhxvr --skip-vault --yes
npx supabase@latest migration list --linked
npx supabase@latest db query --linked --project-ref gsdrcyrduxbrxgsvhxvr --file supabase/operations/pr5-postflight.sql
```

5. Use **Forgot password** for the existing active email to establish its new credential. Verify actual delivery from the configured sender, signed-out reset, login, page refresh, preferences, alerts and retained admin access. New signups must verify their email. If a deliberately selected verified UUID needs membership, build the server and run `node packages/server/scripts/set-admin.mjs grant <trusted-user-uuid>` with a private operator `MIGRATION_DATABASE_URL` and CA; imported memberships need no new grant.
6. Verify the internal endpoint with the separate server credential using a private script, check public/OG routes, record the Ready Production deployment and resume the paused job. Do not paste credentials/reset links into logs or PR comments. Remove the temporary personal-data export after the agreed retention period.

This is a forward identity transition, not a zero-downtime dual-auth deployment. The transaction rolls back SQL failures, but reverting to an old deployment after successful cutover needs deliberate reconciliation. A full automatic downgrade, password/session import, optional auth plugins and a new migration engine are intentionally outside the plan.

## Final DEV and code acceptance

- Final code head `9a8d133f` passes [Full checks #39387977073](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39387977073): all three jobs, including 38 real PostgreSQL17 tests and seven real Chromium scenarios. Final local full verification, all 71 Python tests and zero-vulnerability dependency audit pass.
- DEV migration `20261020065120` applied after a dry run listing that migration only. Security advisor: no warning/error issues. Hosted checks confirm five private RLS auth tables and all three application UUID FKs target app-owned users.
- Ready Preview `dpl_CFpkKyTkfX3wiH5f7poC8cgB3cb9`: [open application](https://kartiseret-htrh8zi4e-jeremyjacob-projects.vercel.app). Actual signup/verification/login, Secure/HttpOnly/SameSite host-only cookies, exact callback origins, unverified denial, private defaults/partial save/empty ratings, account-cookie race rejection, duplicate alerts/isolation/cancellation and canonical internal recipient response pass.
- System Chrome proves deployed login/refresh, preference persistence, visible injected failed-save rollback, current-password change/revocation, logout, signed-out reset and consumed/invalid-token feedback. Zero browser page errors and zero direct browser table requests. Desktop settings and settled 390px mobile navigation are visually inspected; no horizontal overflow or wrapped Showtimes label.
- Test mail is captured locally through the actual Better Auth API using DEV database/secret; captured links are followed through deployed callbacks. Preview's empty recipient allowlist blocks real mail. Live Resend delivery is **not** verified and remains part of Production setup/acceptance.
- Additional hosted checks pass for a deliberately assigned verified DEV admin (safe no-op correction), actual Python canonical-recipient HTTP lookup and database session expiry. Read-only postflight confirms browser/worker auth-schema access is denied, runtime admin writes are denied, service-role alert table access remains, and Realtime retains `finalMovies`/`finalSoons`.
- Disposable DEV users/private cascades are cleaned up. Production account data, credentials, schema, deployment and scheduled jobs were not changed by this work.

### Justified adaptations

The installed stable adapter exposes UUID generation, schema mapping, relations and transactions directly, so no auth CLI/schema generator or second migration engine is necessary. Database-backed rate limits add a fifth small private auth table; Vercel's supported background task lifetime uses `@vercel/functions`. Better Auth's verification replay is its harmless signed-token no-op with automatic sign-in disabled, while password resets are strictly one-time and tested concurrently. The expected-account header preserves the existing stale-account guarantee after switching from bearer credentials to mutable browser cookies; it is not an authorization credential. Local/CI captured mail avoids sending live messages during hosted acceptance.
