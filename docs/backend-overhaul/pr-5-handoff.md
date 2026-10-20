# PR 5 handoff — Better Auth and app-owned accounts

## Implementation and verification status

Branch `codex/backend-05-better-auth` starts from current main after PR4. Production has not been changed by PR5. Supabase Auth is still the deployed Production provider until the coordinated cutover.

Local `npm run verify` passes: 490 frontend tests, 72 API/unit tests, lint/format/typechecks/builds, API/OG/assets/JPEG smoke, and 174.0 KiB eager gzip JS under the 210 KiB budget. Six new Python recipient tests pass. Real PostgreSQL/browser CI and hosted DEV rehearsal are pending; this is not a completed release receipt.

## Architecture

- Better Auth 1.7.11 and `@better-auth/drizzle-adapter` 1.7.11 use existing Drizzle 0.45.4/pg. Adapter transactions are enabled. `@vercel/functions` 3.10.1 supplies supported background mail lifetime handling on Vercel.
- `app_auth` owns UUID users, credential accounts, database sessions, verification records and persistent rate-limit state. It is not exposed through the Data API; browser/service roles lack schema usage. Restricted Node runtime access is explicit. Supabase's managed `auth` schema is retained.
- Same-origin `/api/auth/*` is mounted before JSON parsing. Private feature APIs use verified cookie sessions, `Vary: Cookie`, no-store and exact-origin checks for unsafe methods. Old bearer tokens do not authorize them. Public reads do not perform session queries.
- Sessions expire after seven days, have database revocation and no cookie caching. Host-only Secure/HttpOnly cookies use environment-specific prefixes. Callback and trusted origins are exact. Auth rate limits use PostgreSQL and Vercel's overwritten `x-forwarded-for` header.
- Frontend account forms retain their UI and Zustand preference owner. Better Auth's session atom feeds the neutral identity boundary; repeated refreshes do not reset preference save queues. Password setup/change/reset consistently require 8–128 characters. Signed-out recovery submits an actual reset token.
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
