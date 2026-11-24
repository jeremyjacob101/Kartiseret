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

## Unsubscribe controls for recurring Letterboxd digests

Only a digest that still contains an event supported by a connected Letterboxd watchlist or list gets unsubscribe controls. The dispatcher checks the delivery's current event snapshot against active `letterboxd_source_films` rows, then asks the authenticated API to mint credentials. If support was removed in between those checks, the API refuses to mint and the old batch is not sent if queue reconciliation has cancelled it. A manual-only digest and account/security email do not get these controls.

The body link is **Manage Letterboxd list alerts**. It opens a public page without sign-in, shows the account's current Letterboxd sources, and requires list selection followed by an explicit confirmation. Removing a source stops only alerts that have no remaining support. A manual watch or another Letterboxd source for the same film keeps supporting its events. Opening the page, including by a mail security scanner, never changes notification state. After a list is removed, it can be connected again in account settings.

The email application's one-click unsubscribe control is broader: its `List-Unsubscribe` HTTPS target and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` request remove all current Letterboxd connections, ticket-availability watches, and Coming Soon date watches for that account. This does not delete the account or change unrelated preferences; verification and password-reset messages remain available. A later explicit watch or list reconnection starts a new request. Repeated POSTs for a completed one-click token succeed without deleting watches added after that completed action. GET requests never perform the one-click action.

Each eligible delivery gets two independent cryptographically random 256-bit credentials. Only SHA-256 hashes are stored in `app_auth.movie_notification_unsubscribe_tokens`; the worker receives each plaintext once over the internal authenticated API and places it in the immutable email snapshot. The list-management token is in the website URL fragment, so it is not sent in the initial page request. API responses disable caching and referrers, the page removes the fragment from browser history, and public operations use the shared persistent rate-limit store. Token records are restricted to the server runtime role and expire after 180 days. A broad unsubscribe revokes all other active credentials so an old email cannot remove a watch or list added later. Existing pending batches with an `email_snapshot` retain their original message and controls on retry; the dispatcher does not rewrite an already-started delivery snapshot.

The new public links require `TICKET_ALERT_RECIPIENT_API_URL` to be the intended app origin, `TICKET_ALERT_INTERNAL_API_SECRET` to match that deployment's server-only `INTERNAL_API_SECRET`, and `SITE_URL` to identify the intended HTTPS website origin (or rely on the existing `https://seret.site` default). Invalid or missing API credentials fail the digest closed rather than sending a Letterboxd-supported digest with a broken management link. In non-production runs, ensure the target API and website are the same test environment and use HTTPS-accessible origins for links that recipients will open.

### Unsubscribe deployment and verification

1. Pause scheduled notification/pipeline jobs and wait for any active dispatch to finish. Keep legacy standalone email senders disabled.
2. Apply `20261104160313_movie_notification_unsubscribe.sql` using the normal reviewed Supabase migration process, after `20261104160127_ticket_alert_delivery_filter_mask.sql`. It creates hashed-token storage, tightly scoped security-definer operations, row-level restrictions, and delivery-start locking.
3. Deploy the API and website together. The API must include `/api/v1/unsubscribe/letterboxd` (GET and POST), `/api/v1/unsubscribe/one-click/:token` (POST only), and the authenticated internal token-issuance route. The website must serve `/unsubscribe/letterboxd` directly. Confirm both public routes use HTTPS, no-store and no-referrer responses, and persistent rate limiting.
4. Configure the pipeline worker with the matching API origin/internal secret and website origin. Run a non-production test digest and verify the visible body link, plain-text link, both Resend headers, and the complete footer inside the stored `email_snapshot`.
5. With disposable test data, open the body link while signed out; verify it lists sources without exposing account details, preserves other lists/manual watches, confirms before deleting, and shows removed list names. POST a form body of `List-Unsubscribe=One-Click` to the header URL and verify that all current alert sources and both manual watch types are removed. Verify that GET does nothing and repeated POSTs are harmless.
6. Resume only the updated dispatcher after API, web, migration, and worker versions are compatible. Do not run an old worker beside it: an older dispatcher may send without the new controls. Previously sent email snapshots cannot be amended to add links.

Source deletion, manual-watch deletion, queue collection, delivery claims, and delivery start share the existing notification locks. Unattempted mixed deliveries are retired and still-supported events are released into a fresh batch. Attempted deliveries with uncertain provider acceptance retain the existing conservative suppression behavior. A provider-accepted message, or a request already in flight to the provider when unsubscribe commits, cannot be recalled; this narrow race is not represented as a guaranteed cancellation.

Rolling back the worker alone is unsafe: the legacy system interprets null city settings differently and does not honor the shared ledger. Keep notification jobs paused until API, worker, and migration state are compatible.

## Email and iPhone delivery

Signed-in users choose **Email**, **iPhone**, **Both**, or **Neither** in the Notifications settings on the website or iPhone app. Existing accounts keep the email behavior through the migration default. This applies to the shared ticket availability, Coming Soon, and Letterboxd movie digest. Account verification and password-reset mail are unchanged.

The iPhone app requests notification permission after the user selects iPhone delivery. It registers its APNs token through the authenticated API, re-registers after sign-in, and removes the registration on sign-out. The website reports whether an iPhone is registered and directs users to finish setup in the app. Tapping a one-film alert opens that movie. A multi-film alert opens Showtimes.

Email continues to use `movie_notification_deliveries`. The migration adds independent email state and one `movie_notification_push_deliveries` row per target device. APNs payloads are immutable after the first attempt. A confirmed APNs response completes that device delivery. APNs 429 and 5xx responses retry after 15 minutes, invalid device tokens are deactivated, and network failures without a response are retired as uncertain to avoid duplicate lock-screen alerts. The dispatcher processes each channel independently, so a failed push does not resend a successful email.

### APNs setup and deployment

1. Apply `20261124120000_ios_push_notification_delivery.sql` after the existing shared notification and unsubscribe migrations. Deploy the API and website revision with the migration.
2. Enable Push Notifications for the `com.jj.kartiseret` App ID and add the Push Notifications capability to the iOS signing configuration. The app entitlement is in `Codebase - Kartiseret iOS/Kartiseret/Kartiseret.entitlements`.
3. Create an APNs authentication key. Set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, and `APNS_PRIVATE_KEY_BASE64` for each pipeline target. Base64 encode the `.p8` key for the last value. Keep development and production credentials in their matching `DEV_` and `PROD_` profiles.
4. Deploy the updated iOS app. Test both development and TestFlight devices with their corresponding APNs environment. Verify a locked-screen delivery, account sign-out, one-film tap-through, multi-film tap-through, and email-only delivery.
5. Configure the updated pipeline runner with the matching target APNs values before enabling iPhone or Both preferences for users.

## Verification

Regression coverage includes both notification modes, preferred-city selection, filters and overrides, repeated pipeline runs, silent baselines, overlapping sources, mixed digest formatting, migrated historical state, cancellation, concurrent claims, and immutable provider retries. Integration tests use disposable local PostgreSQL only; the bootstrap seeds historical fixtures before applying the cutover migration.
