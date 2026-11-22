# Kartiseret Android

Native Kotlin and Jetpack Compose companion app for Kartiseret. Open this folder in Android Studio and run the `stagingDebug` configuration. Public data defaults to `https://seret.site`. The staging and production application IDs are `com.jj.kartiseret.staging` and `com.jj.kartiseret`.

Google sign-in is prepared with Credential Manager dependencies. Configure a Web OAuth client ID as `GOOGLE_WEB_CLIENT_ID` for the Android build after registering the Android package and signing certificate. The signed staging certificate SHA-256 is required to publish `/.well-known/assetlinks.json` at the chosen staging origin. Never put an OAuth client secret or auth token in source control.

Email signup, Apple sign-in, password reset, and browser-based account settings are available through the website. Android account sessions use Better Auth bearer tokens. Public catalog requests use the existing `/api/v1` routes.

Run `./gradlew testDebugUnitTest lintDebug assembleStagingDebug` for local checks.
