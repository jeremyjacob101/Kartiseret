import SwiftUI
import GoogleSignIn

@main
@MainActor
struct KartiseretApp: App {
    @State private var store: AppStore
    @State private var accountStore: AccountStore

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
        _accountStore = State(initialValue: AccountStore(
            api: NativeAccountAPI(baseURL: AppConfiguration.apiBaseURL),
            credentials: KeychainSessionCredentialStore(apiOrigin: AppConfiguration.apiOrigin)
        ))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if store.fixtureMode {
                    AppRootView()
                        .environment(store)
                        .environment(accountStore)
                        .environment(\.openURL, OpenURLAction { url in
                            store.captureFixtureBookingURL(url)
                            return .handled
                        })
                } else {
                    AppRootView().environment(store).environment(accountStore)
                }
            }
            .onOpenURL { _ = GIDSignIn.sharedInstance.handle($0) }
        }
    }
}
