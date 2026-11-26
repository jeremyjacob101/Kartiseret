import SwiftUI
import GoogleSignIn
import UIKit
import UserNotifications

extension Notification.Name {
    static let kartiseretAPNSToken = Notification.Name("kartiseret.apnsToken")
    static let kartiseretPushURL = Notification.Name("kartiseret.pushURL")
}

@MainActor
final class KartiseretAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        let environment = PushNotificationRegistration.environment
        let previousToken = PushNotificationRegistration.storedDeviceToken
        UserDefaults.standard.set(token, forKey: PushNotificationRegistration.deviceTokenKey)
        UserDefaults.standard.set(environment, forKey: PushNotificationRegistration.environmentKey)
        NotificationCenter.default.post(
            name: .kartiseretAPNSToken,
            object: nil,
            userInfo: ["token": token, "environment": environment, "previousToken": previousToken ?? token]
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("Kartiseret APNs registration failed: %@", error.localizedDescription)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let request = response.notification.request
        if request.identifier.hasPrefix(TicketReminderManager.identifierPrefix),
           let ticketID = request.content.userInfo["ticketId"] as? String {
            Task { @MainActor in
                NotificationCenter.default.post(name: .kartiseretTicketReminderTapped, object: ticketID)
            }
        }
        let urlString = response.notification.request.content.userInfo["url"] as? String
        if let urlString {
            Task { @MainActor in
                PushNotificationRegistration.pendingURL = URL(string: urlString)
                NotificationCenter.default.post(
                    name: .kartiseretPushURL,
                    object: nil,
                    userInfo: ["url": urlString]
                )
            }
        }
        completionHandler()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

@MainActor
enum PushNotificationRegistration {
    static let deviceTokenKey = "kartiseret.apns.deviceToken"
    static let environmentKey = "kartiseret.apns.environment"
    private static let pendingURLKey = "kartiseret.apns.pendingURL"

    static var environment: String {
        #if DEBUG
        "development"
        #else
        "production"
        #endif
    }

    static var storedDeviceToken: String? {
        UserDefaults.standard.string(forKey: deviceTokenKey)
    }

    static var pendingURL: URL? {
        get {
            guard let value = UserDefaults.standard.string(forKey: pendingURLKey) else { return nil }
            UserDefaults.standard.removeObject(forKey: pendingURLKey)
            return URL(string: value)
        }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: pendingURLKey) }
    }

    static func notificationsAuthorized() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    static func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let authorized: Bool
        if settings.authorizationStatus == .notDetermined {
            authorized = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        } else {
            authorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        }
        if authorized { await registerForRemoteNotifications() }
        return authorized
    }

    static func registerForRemoteNotifications() async {
        UIApplication.shared.registerForRemoteNotifications()
    }
}

@main
@MainActor
struct KartiseretApp: App {
    @UIApplicationDelegateAdaptor(KartiseretAppDelegate.self) private var appDelegate
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
        }
    }
}
