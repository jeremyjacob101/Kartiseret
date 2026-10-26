# First-availability notification cutover

Manual ticket watches, manual Coming Soon date watches, and Letterboxd sources now use `MovieNotificationDispatcher` and the shared `movie_notification_events` / `movie_notification_deliveries` ledger. The registered post-publication job runs once after both selected catalog updates commit. If either selected update fails, notification collection is skipped.

## User behavior

- `cities: null` follows `userPreferences.location`, falling back to Jerusalem for missing or unsupported locations. Changing the preferred city updates inherited alert selection. Explicit lists stay selected; “All cities” stores the complete explicit list. Legacy null per-title city overrides are removed so the title inherits account defaults.
- `notificationMode` defaults to `first_any_city`. That mode closes after the first qualifying city is covered. `first_per_city` covers each selected city once. A title can override the account's mode, cities, or filter groups.
- Availability is detected as soon as the published catalog has a valid, future, matching ticket link. The earliest qualifying screening is included; notification delivery does not wait until that screening's performance day.
- Additional sessions, dates, cinemas, links, or changed filters do not reopen completed scopes. Switching to per-city mode or adding a selected city can enable a previously uncovered city. Switching to any-city mode closes the film if any city was already covered.
- The initial Letterboxd sync silently covers currently qualifying dates and showtimes. Nonmatching screenings do not close a scope. Manual per-city watches silently cover cities already available at creation and watch the remaining cities.
- Coming Soon notification history covers the first local `finalSoons` date, independently of ticket availability. Later release-date changes do not repeat this first-date alert. A date-only manual watch does not automatically create a ticket watch.
- The daily digest contains separate date and ticket sections, omits empty sections, and counts films. Each film appears once per section, with at most one earliest screening per newly qualifying city.

## Deployment order

1. Pause scheduled notification/pipeline runs and let any running legacy jobs finish. Disable standalone legacy ticket/date/Letterboxd sender invocations too. Do not run old and new workers together.
2. Apply `20261025145312_shared_first_availability_notifications.sql` through the normal reviewed migration process. It creates the shared ledger and restricted worker functions, adds the mode and manual baseline fields, and backfills existing history. Existing explicit city arrays and filters are preserved. Null city settings now follow the preferred city.
3. Deploy this revision's API and frontend together, then update every pipeline runner to this revision. The city-null semantics change requires this coordinated cutover. New worker functions must be exposed through the project's existing public Data API schema; execution is restricted to `service_role`. Browser/runtime accounts cannot forge notification history or delivery batches.
4. Resume pipeline runs. Verify the `Movie notifications:` summary, inspect shared ledger/delivery statuses, and confirm one registered dispatcher runs after publication. Do not manually replay legacy batches.

Sent and silently baselined session records are collapsed by user/film/city. Date history is collapsed by user/film. Historical raw records remain available for audit. Legacy pending Letterboxd events are cancelled. Unattempted work is collected again under current preferences; already-attempted legacy scopes are silently closed because provider acceptance may be uncertain. No migration sends email or resets completed scopes.

Delivery snapshots include the exact subject, HTML, text, sender and verified recipient from the first attempt. Retries reuse that snapshot and the same `movie-notification-<delivery UUID>` provider key. Unconfirmed attempts older than 23 hours are retired as suppressed rather than retried after the provider's idempotency window. Inspect their `last_error` before any manual intervention.

Removing a watch cancels pending events only when no remaining source supports that notification type. An unattempted mixed batch can release its still-supported events into a new batch. If a mixed batch was already attempted, removing support retires that batch and silently closes its still-supported events to prevent an ambiguous resend with altered contents; this can intentionally omit an unconfirmed alert.

Rolling back the worker alone is unsafe: the legacy system interprets null city settings differently and does not honor the shared ledger. Keep notification jobs paused until API, worker, and migration state are compatible.

## Verification

Regression coverage includes both notification modes, preferred-city selection, filters and overrides, repeated pipeline runs, silent baselines, overlapping sources, mixed digest formatting, migrated historical state, cancellation, concurrent claims, and immutable provider retries. Integration tests use disposable local PostgreSQL only; the bootstrap seeds historical fixtures before applying the cutover migration.
