# Kartiseret Android

Native Android companion for Kartiseret, built with Kotlin, Jetpack Compose, Navigation Compose, and the existing `/api/v1` and Better Auth APIs. The main screens cover Discover, Now Playing and Coming Soon catalogs, searchable film details, showtimes, cinema and cinematheque schedules, account preferences, ticket alerts, Coming Soon watches, Letterboxd sources, and account deletion.

The app compiles and targets Android 16 (API 36); Android 12 (API 31) is the minimum supported version.

## Open and run

Open this folder in Android Studio and select one of these build variants:

| Variant | Application ID | Data source |
| --- | --- | --- |
| `fixtureDebug` | `com.jj.kartiseret.fixture` | Deterministic fictional data; works offline and has no Internet permission |
| `stagingDebug` | `com.jj.kartiseret.staging` | Staging API; defaults to `https://staging.seret.site` |
| `productionDebug` | `com.jj.kartiseret` | Production API at `https://seret.site` |

The fixture build is the easiest way to explore the UI before staging credentials and app-link association are configured. Its ticket and map URLs point to reserved example domains and do not represent real bookings.

## Build and verification

Run these commands from this folder:

```sh
./gradlew testStagingDebugUnitTest testFixtureDebugUnitTest
./gradlew lintStagingDebug lintFixtureDebug
./gradlew assembleStagingDebug assembleFixtureDebug assembleProductionDebug
```

Unit tests cover the shared showtime-link vectors, link parsing, canonical cinema identity matching, offline fixture data, and the Jerusalem cinema-day/carryover rules. The link-vector test reads `packages/contracts/test-data/showtime-link-vectors.json` from the repository root.

## Staging configuration

Staging has safe build defaults, so the Android project compiles without Google or signing credentials. Override values with Gradle properties (for local builds, keep private values in a local Gradle properties file rather than committing them):

```properties
KARTISERET_STAGING_API_BASE_URL=https://staging.seret.site
KARTISERET_STAGING_LINK_HOST=staging.seret.site
KARTISERET_GOOGLE_WEB_CLIENT_ID=
```

Pass a property at build time with `-PKEY=value`, or add it to the user's `~/.gradle/gradle.properties`. `KARTISERET_STAGING_LINK_HOST` must be the host serving the corresponding Android Digital Asset Links file; it is intentionally configurable independently from the API origin.

### Registrations needed for real account sign-in

- **Email and password:** the selected API origin must have Better Auth email/password sign-in enabled. Signup verification and password reset emails must be configured by the server.
- **Google:** register an Android OAuth client with the staging package name and the SHA-1 signing-certificate fingerprint used to install the build. Configure the server-side Google OAuth credentials in Better Auth. Set `KARTISERET_GOOGLE_WEB_CLIENT_ID` to the Google **Web** client ID used as the Credential Manager server client ID. Do not put a Google client secret, Better Auth secret, bearer token, or private key in this repository.
- **Apple:** Apple sign-in and account-provider management continue through the Kartiseret website in a Custom Tab; no native Apple sign-in credential is configured in this Android module.
- **Universal links:** after choosing the staging host and signing certificate, publish `/.well-known/assetlinks.json` on that HTTPS host with package `com.jj.kartiseret.staging` and the SHA-256 fingerprint of the signing certificate. Production needs its own association for `com.jj.kartiseret` and its production host/signing certificate. The app validates the host and supported routes before acting on a link.
- **Release distribution:** before publishing, create and protect the Android release signing key, configure Play App Signing, and register the final Play signing certificate in Google OAuth and Digital Asset Links. Keep keystore files and passwords outside source control.

The staging API URL and staging link host can point at an existing environment; no registration is required to build or run the offline fixture. Production sign-in and verified links become usable once the matching server configuration, OAuth clients, and Digital Asset Links association exist.

## Implementation notes

- Account bearer tokens are encrypted with AES-GCM; the key is stored in Android Keystore. API requests use only the configured HTTPS origin and do not follow redirects.
- Fixture mode has a separate app ID and manifest overlay that removes Internet permission. It never falls back to production data or sends account requests.
- Google credentials are obtained with Credential Manager. Email signup/sign-in use the Better Auth endpoints. Apple sign-in and password reset open the configured website.
- Showtime sharing uses the same route-code, date, filter-mask, and cinema identity contract as the iOS/web app. The canonical cinema identity table is generated from `packages/contracts/src/cinema-identities.ts` with `tools/generate_cinema_identities.py`.
