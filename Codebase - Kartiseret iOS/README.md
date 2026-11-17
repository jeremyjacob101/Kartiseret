# Kartiseret for iOS

Kartiseret for iOS is the native SwiftUI companion to [seret.site](https://seret.site). It targets iOS 17+, uses the shared public and protected APIs, and keeps the website’s catalog, showtime, preference, filtering, and notification behavior aligned while using native navigation, forms, sheets, sharing, and Sign in with Apple.

## What the app supports

- **Discover:** browse Now Playing and Coming Soon, search titles and years, filter the Now Playing catalog by New Releases and Re-Releases, and open film details.
- **Film details:** view artwork, synopsis and available ratings; share a film; open its trailer; choose screening filters; and manage ticket alerts or Coming Soon date watches.
- **Showtimes:** choose a city and day, filter screenings using the website’s canonical screening metadata, hide selected cinemas, and open ticket links.
- **Cinematheques:** browse a two-week schedule by city and date, visit cinema details, and open booking links for screenings.
- **Your Kartiseret:** create an account or sign in with email and password, Sign in with Apple, or Sign in with Google when both the server and app have the provider configured. Signed-in account preferences sync with the website. Guests can use local showtime filters.
- **Preferences:** set the default city, accent color, enabled rating providers, and whether Re-Releases should be hidden.
- **Personalization:** customize film artwork and title-card treatment, manage account-wide and per-film ticket alert cities/timing/filters, manage Coming Soon watches, and manage Letterboxd sources.

Account data stays behind the existing protected API. The iOS client stores the opaque Better Auth bearer session in Keychain and sends it over TLS; the web client continues to use its cookie session. Passwords and session tokens are never stored in app preferences.

## Open and run

1. Install Xcode and XcodeGen.
2. From this directory, run `xcodegen generate`.
3. Open `Kartiseret.xcodeproj`, select the `Kartiseret` scheme, and run on an iOS Simulator.

For a signing-independent simulator build:

```sh
xcodebuild -project Kartiseret.xcodeproj \
  -scheme Kartiseret \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

Run unit and UI tests on a simulator with:

```sh
xcodebuild -project Kartiseret.xcodeproj \
  -scheme Kartiseret \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

The API base URL defaults to `https://seret.site`. Set `KARTISERET_API_BASE_URL` in the app process environment to use another server during local development. The UI test suite launches with `-FixtureMode` and `-ResetPreferences` to use deterministic in-memory sample data without contacting production.

## Authentication configuration

Email/password authentication uses the server’s existing Better Auth configuration and verification flow. Native Apple sign-in also needs all of the following:

1. Enable the Sign in with Apple capability for the `com.jj.kartiseret` App ID in Apple Developer settings and use a matching provisioning profile when signing.
2. Configure the server’s existing Apple OAuth credentials (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`).
3. Set `APPLE_APP_BUNDLE_IDENTIFIER=com.jj.kartiseret` in the server environment so the server validates native identity tokens for the app’s bundle identifier.
4. Keep `https://seret.site` (and any local development origin) in the server’s trusted origins as required by the auth configuration.

The app queries `/api/v1/auth/providers` before displaying Apple or Google buttons. The Apple button stays hidden if Apple sign-in is not configured on the server. Google sign-in also needs an iOS OAuth client ID in the Google Cloud project already used by the website, plus the web/server client ID used to retrieve a backend-verifiable Google ID token:

1. Add `GOOGLE_IOS_CLIENT_ID` to the server environment alongside `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The server accepts both web and iOS ID token audiences while retaining the existing web client for browser OAuth.
2. In Xcode Build Settings for `Kartiseret`, set `GOOGLE_IOS_CLIENT_ID` to the iOS OAuth client ID, `GOOGLE_SERVER_CLIENT_ID` to the same web client ID used by the server, and `GOOGLE_IOS_REVERSED_CLIENT_ID` to the reversed iOS client ID shown in Google Cloud Console. The checked-in placeholder URL scheme is inert until both client IDs are configured.
3. Regenerate the project with `xcodegen generate` and build again so those values are included in the app’s Info.plist.

When either Google client ID is absent, the native Google button remains hidden. Apple and email sign-in continue to work. Account protection and session restoration use the same protected routes as the web app; no separate iOS preferences database or auth endpoint is introduced.

## Universal Links

The app handles HTTPS links on `seret.site` for Discover, the movie catalogs, showtimes, the account tab, cinema details, and movie links. Movie showtime share links keep their city, date, filters, and excluded cinemas for that screen without changing saved account preferences. Password reset, account deletion, unsubscribe, attribution, API, and edit links remain website routes.

Universal Links require the `Associated Domains` capability on the `com.jj.kartiseret` App ID and a signed build with `applinks:seret.site`. The website serves the Apple association document at `https://seret.site/.well-known/apple-app-site-association`; Vercel serves it from the web project's public asset. No App Store Connect field or environment variable is required. The `appIDs` value in that JSON must use the App ID Prefix shown for the app in Apple Developer, followed by `.com.jj.kartiseret`; this prefix can differ from the Team ID. The file uses the verified prefix `UZ7YLA6V9D`.

Before public testing:

1. In Apple Developer > Certificates, Identifiers & Profiles > Identifiers, enable Associated Domains for the explicit `com.jj.kartiseret` App ID. Refresh a manually managed provisioning profile; automatic signing will refresh its profile as needed.
2. Deploy the web change to the production Vercel deployment for `seret.site`. A preview deployment does not update the production domain's association file.
3. Install a newly signed app build, then tap a supported HTTPS link in Messages or Notes. Typing the URL into Safari's address bar does not test Universal Link opening behavior. Apple caches association data; its CDN requests the file within 24 hours and devices check for updates about once per week.

## Data and behavior notes

Public catalog and cinema data is fetched from the existing API. The selected cinema day follows the website’s `Asia/Jerusalem` cutoff rules. Cinema identity records are generated from the shared contract source so the iOS filter list and cinema detail routes use the same canonical IDs as the website.

For guests, showtime filters are saved on the current device. For signed-in users, city, accent color, rating sources, Re-Release visibility, showtime filters, excluded cinemas, title display rules, ticket alert criteria, Coming Soon watches, and Letterboxd sources are loaded from or saved to the account API. Ticket-alert city and filter choices follow the same semantics as the website: omitted per-film values inherit account defaults, an empty city list sends no alerts, and filter values represent unchecked exclusions.

No location permission is required. Users choose a city in preferences.

`project.yml` is the XcodeGen source of truth. Regenerate the committed Xcode project after changing targets or adding files:

```sh
xcodegen generate
```

`Scripts/generate_cinema_identities.py` regenerates the Swift cinema identity table from `packages/contracts/src/cinema-identities.ts` at the repository root. Run it after editing the shared cinema identity source, then run `xcodegen generate`.

The iOS unit tests cover API request construction and decoding, native bearer authentication headers, cinema identity and schedule routes, release categories, and canonical showtime filtering. The UI tests cover the Discover catalog, account flows in fixture mode, showtime filtering, and cinema schedules.
