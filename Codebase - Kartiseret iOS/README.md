# Kartiseret for iOS

A native SwiftUI companion to [seret.site](https://seret.site), built for iPhone and iPad on iOS 17 and newer.

## Open and run

1. Install Xcode 26 or newer and XcodeGen.
2. From this directory, run `xcodegen generate`.
3. Open `Kartiseret.xcodeproj`, select the `Kartiseret` scheme, and run on an iOS Simulator.

The production Supabase URL and publishable client key live in `Config/Base.xcconfig`. They are public client configuration, equivalent to what ships in the web bundle. This project never contains or uses a Supabase service-role key.

Signing is intentionally left without a development team. Simulator builds work immediately; choose your own team in Xcode when running on a device.

## Architecture

- Swift 6 strict concurrency and iOS 17 Observation.
- Actor-backed Supabase repository with paged catalog/showtime reads.
- Root-owned catalog, session, preference, theme, and image stores.
- Five independent native navigation stacks: Home, Now Playing, Showtimes, Coming Soon, and Settings.
- Fixture-backed previews and UI tests; tests do not call production services.

## Test and preview data

Run the complete unit and UI suite on a booted simulator with:

```sh
xcodebuild -project Kartiseret.xcodeproj \
  -scheme Kartiseret \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

The app accepts `-FixtureMode` as a launch argument for deterministic local UI inspection. Add `-SignedIn`, `-LocationDenied`, or `-FixtureNetworkError` to inspect those states without contacting Supabase. SwiftUI previews use the same in-memory fixture clients.

For a signing-independent build check:

```sh
xcodebuild -project Kartiseret.xcodeproj \
  -scheme Kartiseret \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

## Regenerating the project

`project.yml` is the source of truth. After adding files or changing targets, run:

```sh
xcodegen generate
```

The generated Xcode project is committed so the app can also be opened without XcodeGen.
