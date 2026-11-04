# Kartiseret for iOS

A small native SwiftUI app for browsing Now Playing, Coming Soon, and regular cinema showtimes. It targets iOS 17 and uses the existing public API at `https://seret.site`.

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

## Data and scope

Catalogs and showtimes are loaded from the public API. The selected city is saved on device and defaults to Jerusalem; the selected cinema day uses the website's `Asia/Jerusalem` cutoff rules. There are no sign-in flows or location permissions.

`project.yml` is the XcodeGen source of truth. Regenerate the committed Xcode project after changing targets or adding files:

```sh
xcodegen generate
```
