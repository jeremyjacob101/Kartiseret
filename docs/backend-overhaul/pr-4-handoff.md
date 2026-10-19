# PR 4 handoff — protected workflows

## Branch and scope

- Base: `main` at `79d11543f415e8ecf6adc37337ba675184f77290` after deployed PR 3.
- Branch: `codex/backend-04-protected-workflows`. Jeremy requested a regular PR; no reviewer requests or merge are authorized.
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
- DEV metadata confirms both `finalMovies` and `finalSoons` remain in `supabase_realtime`, with their existing replica identity. Hosted signal acceptance and CI status will be recorded below after completion.

## Verification status

- Local full workspace gate passed on Node 26.10.0: lint, formatting, all typechecks, 493 frontend tests, 64 API tests, builds, OG JPEG/assets smoke and 206.4 KiB gzip eager bundle under the 210 KiB limit. Node 24 CI remains the target-version gate. The final bigint cancellation and safe-error refinements are included in this passing run.
- Local Docker daemon is unavailable. Disposable PostgreSQL 17 integration and Chromium scenarios run in GitHub CI; they never reset hosted DEV.
- CI/Preview/hosted acceptance: pending at initial implementation publication; update with exact final commit and results before completion.

## Adaptations

1. Restored the entire master plan from Jeremy's revised attachment (SHA-256 `17765d4a9606c968df0e29865bef908683ae3d5af6ca5c48fd743d9731ee2aa1`). The copy on main contained a literal truncation marker and omitted major sections, including most of PR4. Original requirements are preserved; current status is updated.
2. Added one signup-initialization marker because an existing default row and an established user choice otherwise cannot be reliably distinguished. This avoids repeatedly overwriting preferences from editable signup metadata.
3. Split additive DB preparation from browser privilege retirement to support database-before-code deployment without breaking the currently deployed client. The retirement SQL is versioned as an explicit, idempotent post-deployment operation, not silently run during build/start.
4. Hosted acceptance caught Drizzle INSERT default columns exceeding column-level grants; protected inserts now explicitly name allowed columns via parameterized Drizzle SQL and read back through the normal mapped SELECT so timestamp/native-type decoding is consistent. Runtime grants were not broadened.
5. Existing local PR3 documentation edits were preserved in a named Git stash before branching from fetched main; they were not mixed into PR4 implementation.

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

Refresh any old browser tabs after retirement. No rescrape, Python restart, new project, new environment secret or auth cutover is required. Rollback before retirement can use the previous app with the additive migration left in place. After retirement, an old app rollback also needs deliberate restoration of its legacy grants; prefer correcting/rolling forward and keep this ordering explicit.

## PR 5 readiness

The identity boundary is application-owned `{ id, email }`; only the adapter/provider-facing code depends on Supabase sessions. Remaining auth dependencies: browser SDK login/signup/refresh/logout/password recovery; provider `auth.users` FKs from preferences, subscriptions and admin membership; `signup_location` metadata for first initialization; Python canonical recipient lookup. DEV currently has no application auth/default triggers. Reinspect Production triggers read-only at PR5 before changing references. Better Auth and Python recipient migration are not implemented here.
