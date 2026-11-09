# Timing history by transport — November 9, 2026

Timing history now keys each rolling last-five by **scraper class × runner machine × Jerusalem start weekday × transport**. The three scraper transports are `requests`, `selenium`, and `requests_selenium_fallback`.

## Existing last-fives and migration

Migration [`20261109081746_util_avg_time_transport_history.sql`](../../supabase/migrations/20261109081746_util_avg_time_transport_history.sql) adds a non-null transport column with default `legacy`, then extends the existing primary key. Every existing array and `updated_at` is preserved unchanged. Nothing is deleted, copied into multiple buckets, or guessed to be Requests/Selenium. The new buckets start with tagged successful runs.

The existing four-argument `append_util_avg_time_history` RPC remains usable and writes to `legacy`. This preserves older workers and unchanged dataflow timing. Updated scrapers use a distinct `append_util_avg_time_transport_history` RPC with an explicit transport, avoiding ambiguous overload resolution. Each bucket independently retains its newest five samples through an atomic upsert, including concurrent writers.

The table remains private with its existing service-role-only RLS/grants. Both RPCs use `SECURITY INVOKER`, an empty search path, validated inputs and service-role-only execution. The application schema mapping is updated without exposing the table to the public application runtime.

**Rollout:** apply the migration through the normal database release process before deploying the updated workers. This PR adds/tests the migration locally; it does not apply it to a hosted database. Until the schema/RPC is available, timing reads use the existing default estimate and noncritical timing-write failures are logged without failing an already-published scrape. Lease/storage-budget failures still propagate.

## Recording and ETA

- A successful HTTP collection writes only the `requests` bucket.
- Forced/default Selenium writes only `selenium`.
- An HTTP attempt followed by successful whole-browser fallback writes only `requests_selenium_fallback`, with the failed HTTP and browser work included in the same elapsed duration. Partial/failed HTTP time is not added to either pure-transport history.
- Failed attempts do not write a successful timing sample. Read-only parity/benchmark runs still do not update timing history. Existing GitHub Actions and solo-dataflow recording exclusions remain unchanged.
- Dataflow timing continues using its existing legacy scope and four-argument RPC.

Initial scraper ETA uses its configured preferred transport: `auto` and forced Requests use Requests history; browser-default/forced Selenium uses browser history. Missing Requests history uses the existing 60-second default rather than mixing in legacy/browser timings. A first successful tagged sample is enough to start learning; five samples are the cap, not a minimum.

When fallback actually starts, a worker emits a transport event. The scheduled and interactive runners update the estimate on the UI thread. They use the matching fallback history when available. If fallback history is absent, the estimate uses actual failed-HTTP elapsed time plus a Selenium estimate (or the existing 60-second default). Reads are cached for the current run and remain scoped to the worker's captured weekday, including midnight/fresh retry transitions. Normal attempt retry limits, source collection, upload and publication behavior remain unchanged.

## Focused verification

- **60 Python tests passed** for history lookup/writes, Requests/Selenium/fallback classification, fallback-inclusive timing, cold estimates, live scheduler ETA changes, weekday rollover, advisory timing outages versus lease failures, clean collection/publication boundaries, and no-browser success/fallback across the enabled fleet.
- **30 focused PostgreSQL tests passed**, including private schema/permission checks and five new timing tests: migration over an existing five-sample row with an unchanged timestamp, older RPC compatibility, independent rolling windows/machine/day scopes, concurrent updates, invalid-input rejection and trusted versus anonymous execution.
- TypeScript integration type checking, targeted ESLint/Prettier, Python compilation and `git diff --check` passed.
- Supabase security advisors against disposable **local** PostgreSQL reported no issues. No hosted schema, history rows, notifications, or publication were modified. No scraper reruns or full test suites were needed for this timing-only change.

Receipts: [`timing/`](evidence/2026-11-09/timing/).
