import SwiftUI

@main
@MainActor
struct KartiseretApp: App {
    @State private var store: AppStore

    init() {
        let fixtureMode = AppConfiguration.fixtureMode
        let api: any KartiseretAPI = fixtureMode
            ? FixtureAPIClient()
            : URLSessionKartiseretAPI(baseURL: AppConfiguration.apiBaseURL)
        _store = State(initialValue: AppStore(
            api: api,
            now: fixtureMode ? FixtureAPIClient.referenceInstant : .now,
            fixtureMode: fixtureMode,
            resetPreferences: AppConfiguration.resetPreferences
        ))
    }

    var body: some Scene {
        WindowGroup {
            if store.fixtureMode {
                AppRootView()
                    .environment(store)
                    .environment(\.openURL, OpenURLAction { url in
                        store.captureFixtureBookingURL(url)
                        return .handled
                    })
            } else {
                AppRootView().environment(store)
            }
        }
    }
}
