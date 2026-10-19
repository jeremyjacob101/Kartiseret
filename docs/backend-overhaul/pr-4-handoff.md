# PR 4 handoff — protected workflows

## Branch and scope

- Base: `main` at `79d11543f415e8ecf6adc37337ba675184f77290` after deployed PR 3.
- Branch: `codex/backend-04-protected-workflows`; regular [PR #171](https://github.com/jeremyjacob101/Kartiseret/pull/171), based on updated main. No reviewers requested; not merged. Jeremy explicitly requested a regular PR.
- Preferences, account/admin projection, subscriptions and movie corrections now use authenticated same-origin Express + Drizzle services. Supabase is auth-only in the browser. PR 5 replaces that provider.

## Routes and contracts

All responses use the established `{ data, error }` envelope. Private routes use `Cache-Control: no-store`; bearer verification precedes service access. Strict request schemas reject caller-supplied user/admin/delivery fields.

| Route | Behavior |
| --- | --- |
| GET `/api/v1/account` | Neutral identity and current server-owned admin membership. |
| GET `/api/v1/preferences` | Own preferences with documented idempotent read repair. |
| POST `/api/v1/preferences/initialize` | Initialize once, with verified signup location before optional guest fallback. |
| PATCH `/api/v1/preferences` | Partial own-account preference fields only. |
| GET `/api/v1/ticket-alerts?offset=0` | Stable 1,000-row pages of own subscription summaries and `nextOffset`. |
| POST `/api/v1/ticket-alerts` | Server availability check, then insert-or-return-existing without resetting delivery state. |
| DELETE `/api/v1/ticket-alerts/:tmdbId` | Own-account cancellation, including precise PostgreSQL bigint identities. |
| POST `/api/v1/admin/movie-corrections` | Narrow validated correction command, server admin check and atomic Drizzle transaction. |

Contracts: `packages/contracts/src/private-data.ts`. Server composition: `protected/identity.ts`, `protected/router.ts`, `protected/service.ts`, `production.ts`. No production test bypass was introduced. The CI-only auth provider process exercises the actual HTTP token-verification adapter; hosted acceptance separately uses real DEV Supabase sessions.

## Behavior and database

- Existing frontend guest/theme cache, optimistic preference saves, latest-intent coalescing, rollback and generation guards remain. Private queries are canceled/removed on identity changes; delayed responses are discarded. Public caches remain reusable.
- New `userPreferences.signup_initialized` distinguishes new signup/default rows from already-established preferences. Migration marks existing rows true and defaults future rows false. Initialization changes a default/blank location to signup location once; established nonempty values and empty rating-source arrays survive.
- Each private DB operation sets `request.jwt.claim.sub` transaction-locally on the existing runtime pool. RLS checks ownership/admin membership in addition to service predicates. Runtime cannot change membership or alert delivery state.
- Admin merge/new-target branches are atomic, lock movie IDs in consistent order, preserve permanent codes, and preserve required coming-soon release dates. Ambiguous coming-soon IDs return 409; UUID row keys constrain writes. Enrichment remains external through `solo_update` and the existing publication.
- Additive migration: `supabase/migrations/20261019152448_protected_application_workflows.sql`. Applied to DEV; local version matches the provider ledger. Production is not modified by PR4 implementation.
- Post-deployment operation: `supabase/operations/pr4-retire-browser-access.sql`. Revoke browser private reads/writes and catalog mutation privileges only after the new code works. Retain Python service-role access and Realtime.
- DEV metadata confirms both `finalMovies` and `finalSoons` remain in `supabase_realtime`, with their existing replica identity. Actual hosted Realtime UPDATE events for controlled now-playing and coming-soon corrections both contained `solo_update: true`. The watcher contract remains intact; no Selenium, scrape, email, Git sync or Production job ran.

## Verification evidence — 2026-10-19

Verified runtime commit: `7aa315f6b71ca0008ebcebe57d6e97556141fe49`. Subsequent publication changes only improve an E2E selector, document evidence, and add emergency rollback SQL; final-head CI is available on PR #171.

- `npm run verify`: passed locally (Node 26.10.0), including lint, formatting, types, **495 frontend tests, 64 API tests**, builds, OG JPEG/assets/dispatcher smoke, and **206.4 KiB gzip eager JS / 210 KiB budget**.
- [Full checks #134](https://github.com/jeremyjacob101/Kartiseret/actions/runs/39282990732) passed on Node 24: web/API checks, **64 Python tests**, **26 PostgreSQL 17 integration tests**, and **6 Chromium E2E scenarios**. CI eager bundle: 206.6 KiB. All GitHub checks and Vercel reported success; PR was mergeable against fetched main. Local Docker was unavailable; hosted databases were never reset to substitute for CI.
- PostgreSQL replay uses the real restricted runtime, including final browser privilege retirement. Tests cover context isolation, account ownership, signup initialization/repair, partial saves, concurrent duplicate subscriptions, sent/delivery-state preservation, bigint precision, both correction modes/branches, ambiguous IDs and actual late SQL constraint rollback.
- Preview [deployment](https://kartiseret-bl7nzx1w1-jeremyjacob-projects.vercel.app), `dpl_2V5zkRU5pbZ5fhcH5jbxNBTc7xux`, is Ready with matching DEV database/Auth configuration. Hosted acceptance used real Supabase sessions for three disposable accounts: unauthenticated/invalid-token 401, normal/admin projections, one-time signup-location priority, empty rating array preservation, field PATCH, mass-assignment 400, cross-account isolation, duplicate/cancel alerts, non-admin 403, admin corrections, private no-store, and public health/catalog/theater 200 plus unknown-route 404.
- Hosted permissions: authenticated direct private read changed **200 → 403** after retirement. Python service-role reads of `finalMovies`/`tableFixes` returned 200, and a controlled `finalSoons` update returned 204. Both catalog Realtime UPDATE signals reached a subscriber. Runtime cannot read `auth.users`, write admin membership/delivery state, or read delivery errors. Publication/replica identities are preserved.
- DEV additive migration and retirement are applied. The rollback SQL restores legacy grants and the retirement SQL reapplies successfully. A redundant post-cleanup bearer probe returned 401 because its disposable account had already been deleted; it is not counted as rollback HTTP acceptance. Final metadata confirms browser preferences SELECT is denied. All three disposable accounts and all four correction catalog fixtures/fix rows were removed (remaining counts zero); temporary credentials/cookies were deleted after verification. One missing fictional `(9100011, D11)` permanent-code seed row was added after checking uniqueness, aligning DEV with its checked-in seed; existing codes were not changed.
- DEV security advisor reports only the existing disabled leaked-password-protection Auth warning; PR4 did not change Auth configuration. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

### Hosted browser QA

The Browser plugin was unavailable. Playwright used the existing system Chrome 155 with an isolated 1280×900 desktop context and real DEV Auth/API, without installing browsers. External map style/poster requests were stubbed; this is private-workflow acceptance, not map or visual redesign acceptance. CI separately covers public mobile routes.

| Check | Result |
| --- | --- |
| Correct page/nonblank rendering | Account settings rendered; saved Blue theme visible after refresh. |
| Framework overlay / uncaught page errors | None. |
| Console | Only the deliberately injected preference-save 503; no unexpected page error. |
| Settings | Login, `/user` refresh, preference save/reload, failed-save rollback/error display passed. |
| Alerts | Real D11 create/list/cancel passed. |
| Identity | Logout and private-route gating passed; browser made zero direct `/rest/v1` application requests. |
| Screenshot | Inspected `/private/tmp/pr4-hosted-settings.png`; account settings remained usable after rollback. |

## Adaptations

1. Restored the entire master plan from Jeremy's revised attachment (SHA-256 `17765d4a9606c968df0e29865bef908683ae3d5af6ca5c48fd743d9731ee2aa1`). The copy on main contained a literal truncation marker and omitted major sections, including most of PR4. Original requirements are preserved; current status is updated.
2. Added one signup-initialization marker because an existing default row and an established user choice otherwise cannot be reliably distinguished. This avoids repeatedly overwriting preferences from editable signup metadata.
3. Split additive DB preparation from browser privilege retirement to support database-before-code deployment without breaking the currently deployed client. The retirement SQL is versioned as an explicit, idempotent post-deployment operation, not silently run during build/start.
4. Hosted acceptance caught Drizzle INSERT default columns exceeding column-level grants; protected inserts now explicitly name allowed columns via parameterized Drizzle SQL and read back through the normal mapped SELECT so timestamp/native-type decoding is consistent. Runtime grants were not broadened.
5. Browser acceptance exposed that `/user` redirected before session restoration on refresh. Its guard now waits for the auth/preferences bootstrap before deciding a visitor is signed out; the existing redirect still applies once loading finishes.
6. Restored-session route gating and tests now wait for auth bootstrap on `/user` refresh, and the hosted browser test scopes the account menu to the page header because the settings page also has a Quick actions menu.
7. Existing local PR3 documentation edits were preserved in a named Git stash before branching from fetched main; they were not mixed into PR4 implementation.

## Production rollout (not performed)

From the final PR4 checkout, while authenticated to Supabase:

```bash
npx supabase@latest link --project-ref gsdrcyrduxbrxgsvhxvr
npx supabase@latest db push --linked --dry-run
npx supabase@latest db push --linked
```

The dry run must list only the new PR4 migration. Do not replay the baseline, change passwords, reset a database or use an admin URL in Vercel. Existing Production `DATABASE_URL`, CA, `SUPABASE_URL` and publishable key already provide the required configuration; they must all identify Production. The additive migration preserves the currently deployed browser paths.

After merge and a Ready Production deployment: log in, refresh settings, save a preference, create/list/cancel a controlled alert, and verify non-admin denial. Then retire the obsolete direct browser access:

```bash
npx supabase@latest db query --linked --project-ref gsdrcyrduxbrxgsvhxvr --file supabase/operations/pr4-retire-browser-access.sql
```

Refresh any old browser tabs after retirement. No rescrape, Python restart, new project, new environment secret or auth cutover is required. Rollback before retirement can use the previous app with the additive migration left in place. For an emergency old-app rollback after retirement, restore its narrow legacy grants **before** serving that client:

```bash
npx supabase@latest db query --linked --project-ref gsdrcyrduxbrxgsvhxvr --file supabase/operations/pr4-restore-browser-access.sql
```

The retained owner/admin RLS still applies; no anonymous private access or service-role escalation is added. Reapply retirement after the corrected PR4 app passes acceptance. Do not drop the additive column or repair migration history backward for an application rollback.

## PR 5 readiness

The identity boundary is application-owned `{ id, email }`; only the adapter/provider-facing code depends on Supabase sessions. Remaining auth dependencies: `UserMenu.tsx` SDK login/signup/logout/recovery; `PasswordSecurityForm.tsx` password update; preferences-store session bootstrap/subscription; `data/privateApi.ts` session token acquisition; server `protected/identity.ts` provider verification; provider `auth.users` FKs from `userPreferences`, `ticket_alert_subscriptions` and `admin_users`; SQL policies calling `auth.uid()` and the transaction-local `request.jwt.claim.sub` compatibility context; `signup_location` metadata for first initialization; Python canonical recipient lookup at `backend/notifications/ticket_alerts.py:421`. Read-only inspection found no application auth/default triggers in DEV or Production. Reinspect current triggers at PR5 before changing references. Better Auth and Python recipient migration are not implemented here.
