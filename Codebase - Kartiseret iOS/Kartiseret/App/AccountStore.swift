import Foundation
import Observation
import CryptoKit

enum AccountState: Equatable {
    case restoring
    case guest
    case signedIn
    case unavailable(String)
}

@MainActor
@Observable
final class AccountStore {
    private static let guestShowtimePreferencesKey = "kartiseret.guest.showtimePreferences"
    private static let siteColorKey = "kartiseret.account.siteColor"
    private static let offlineIdentityKey = "kartiseret.account.offlineIdentity"
    private(set) var state: AccountState = .restoring
    private(set) var identity: AccountIdentity?
    private(set) var preferences = AccountPreferences()
    private(set) var movieDisplayRules: [String: MovieDisplayRule] = [:]
    private(set) var isSaving = false
    private(set) var appleSignInAvailable = false
    private(set) var googleSignInAvailable = false
    private(set) var pushDeviceRegistered = false
    private(set) var feedback: String?

    @ObservationIgnored private let api: NativeAccountAPI
    @ObservationIgnored private let credentials: any SessionCredentialStore
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var saveGenerations: [String: Int] = [:]
    @ObservationIgnored private var confirmedSaveGenerations: [String: Int] = [:]
    @ObservationIgnored private var confirmedPreferences = AccountPreferences()
    @ObservationIgnored private var activeSaveCount = 0

    init(api: NativeAccountAPI, credentials: any SessionCredentialStore) {
        self.api = api
        self.credentials = credentials
        if let data = UserDefaults.standard.data(forKey: Self.guestShowtimePreferencesKey),
           let saved = try? JSONDecoder().decode(AccountPreferences.Showtime.self, from: data) {
            preferences.showtimePreferences = saved
        }
    }

    func useGuestMode() {
        guard state == .restoring else { return }
        state = .guest
    }

    func restore(fallbackLocation: String) async {
        switch state {
        case .restoring, .unavailable:
            state = .restoring
        case .guest, .signedIn:
            return
        }
        guard let savedToken = credentials.read() else {
            UserDefaults.standard.removeObject(forKey: Self.offlineIdentityKey)
            state = .guest
            return
        }
        token = savedToken
        do {
            try await loadIdentityAndPreferences(token: savedToken, fallbackLocation: fallbackLocation)
        } catch APIClientError.unauthorized {
            if token == savedToken { clearAccountSession() }
        } catch {
            guard token == savedToken else { return }
            identity = Self.cachedIdentity(for: savedToken)
            state = .unavailable(error.localizedDescription)
        }
    }

    func loadSignInProviders() async {
        do {
            let providers = try await api.loadProviders()
            appleSignInAvailable = providers.contains("apple")
            googleSignInAvailable = providers.contains("google") &&
                AppConfiguration.googleIOSClientID != nil &&
                AppConfiguration.googleServerClientID != nil
        } catch {
            appleSignInAvailable = false
            googleSignInAvailable = false
        }
    }

    func signIn(email: String, password: String, fallbackLocation: String) async throws {
        let session = try await api.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
        try await activate(session, fallbackLocation: fallbackLocation)
    }

    func signUp(name: String, email: String, password: String, fallbackLocation: String) async throws -> Bool {
        switch try await api.signUp(name: name, email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, location: fallbackLocation) {
        case .verificationRequired:
            feedback = "Check your email to verify your account, then sign in."
            return false
        case .session(let token):
            try await activate(token, fallbackLocation: fallbackLocation)
            return true
        }
    }

    func signInWithApple(identityToken: String, nonce: String, authorizationCode: String, fallbackLocation: String) async throws {
        let session = try await api.signInWithApple(identityToken: identityToken, nonce: nonce, authorizationCode: authorizationCode)
        try await activate(session, fallbackLocation: fallbackLocation)
    }

    func signInWithGoogle(identityToken: String, accessToken: String, fallbackLocation: String) async throws {
        let session = try await api.signInWithGoogle(identityToken: identityToken, accessToken: accessToken)
        try await activate(session, fallbackLocation: fallbackLocation)
    }

    func confirmAccountDeletion(confirmationToken: String) async throws -> Bool {
        guard state == .signedIn, let token else { throw APIClientError.unauthorized }
        let needsManualAppleRevocation = try await api.confirmAccountDeletion(sessionToken: token, confirmationToken: confirmationToken)
        if self.token == token { clearAccountSession() }
        return needsManualAppleRevocation
    }

    func requestAccountDeletion() async throws {
        guard state == .signedIn, let token else { throw APIClientError.unauthorized }
        do {
            try await api.requestAccountDeletion(token: token)
        } catch APIClientError.unauthorized {
            if self.token == token { expireSession() }
            throw APIClientError.unauthorized
        }
    }

    private(set) var isSigningOut = false
    private(set) var signOutError: String?
    private var isUpdatingPushRegistration = false

    func signOut() async {
        guard !isSigningOut, let oldToken = token, let identity else { return }
        signOutError = nil
        if case .unavailable = state {
            clearAccountSession()
            signOutError = "Signed out on this iPhone. Reconnect later to remove it from movie alerts."
            return
        }
        guard !isUpdatingPushRegistration else {
            signOutError = "Notifications are still being updated. Try signing out again in a moment."
            return
        }
        isSigningOut = true
        defer { isSigningOut = false }

        if let deviceToken = PushNotificationRegistration.storedDeviceToken {
            do {
                _ = try await api.unregisterPushDevice(
                    token: oldToken,
                    accountID: identity.id,
                    deviceToken: deviceToken
                )
            } catch {
                signOutError = "Couldn’t remove this device from movie alerts. Check your connection and try signing out again."
                return
            }
        }
        guard token == oldToken else { return }
        clearAccountSession()
        await api.signOut(token: oldToken)
    }

    func saveNotificationDelivery(_ value: AccountPreferences.NotificationDelivery) async {
        await save(key: "notificationDelivery", value: value, apply: {
            $0.notificationDelivery = value
        })
        guard confirmedPreferences.notificationDelivery == value else { return }
        await syncPushDeviceRegistration()
    }

    func refreshPushDeviceStatus() async {
        guard state == .signedIn, let token, let identity else {
            pushDeviceRegistered = false
            return
        }
        guard let deviceToken = PushNotificationRegistration.storedDeviceToken else {
            pushDeviceRegistered = false
            return
        }
        do {
            let status = try await api.pushDeviceStatus(
                token: token,
                accountID: identity.id,
                deviceToken: deviceToken
            )
            guard self.token == token else { return }
            pushDeviceRegistered = status.registered
        } catch {
            guard self.token == token else { return }
            pushDeviceRegistered = false
        }
    }

    func registerPushDevice(deviceToken: String, environment: String, previousToken: String?) async {
        guard state == .signedIn, let token, let identity,
              preferences.notificationDelivery.includesIPhone,
              await PushNotificationRegistration.notificationsAuthorized(),
              self.token == token, preferences.notificationDelivery.includesIPhone,
              !isSigningOut, !isUpdatingPushRegistration else { return }
        isUpdatingPushRegistration = true
        defer { isUpdatingPushRegistration = false }
        do {
            let status = try await api.registerPushDevice(
                token: token,
                accountID: identity.id,
                deviceToken: deviceToken,
                environment: environment
            )
            guard self.token == token else { return }
            pushDeviceRegistered = status.registered
            if let previousToken, previousToken != deviceToken {
                _ = try? await api.unregisterPushDevice(token: token, accountID: identity.id, deviceToken: previousToken)
            }
        } catch {
            guard self.token == token else { return }
            pushDeviceRegistered = false
            feedback = "iPhone notifications couldn’t be enabled. Try again shortly."
        }
    }

    func syncPushDeviceRegistration() async {
        guard state == .signedIn, let token, let identity else {
            pushDeviceRegistered = false
            return
        }
        let authorized = await PushNotificationRegistration.notificationsAuthorized()
        guard self.token == token, !isSigningOut, !isUpdatingPushRegistration else { return }
        if preferences.notificationDelivery.includesIPhone && authorized {
            await PushNotificationRegistration.registerForRemoteNotifications()
        } else if let deviceToken = PushNotificationRegistration.storedDeviceToken {
            isUpdatingPushRegistration = true
            defer { isUpdatingPushRegistration = false }
            _ = try? await api.registerPushDevice(
                token: token,
                accountID: identity.id,
                deviceToken: deviceToken,
                environment: PushNotificationRegistration.environment
            )
            _ = try? await api.unregisterPushDevice(
                token: token,
                accountID: identity.id,
                deviceToken: deviceToken
            )
            guard self.token == token else { return }
            pushDeviceRegistered = false
        } else {
            await refreshPushDeviceStatus()
        }
    }

    func saveLocation(_ value: String) async { await save(key: "location", value: value, apply: { $0.location = value }) }
    func saveSiteColor(_ value: String) async { await save(key: "siteColor", value: value, apply: { $0.siteColor = value }) }
    func saveRatingSources(_ value: [String]) async { await save(key: "ratingSources", value: value, apply: { $0.ratingSources = value }) }
    func saveHideReReleases(_ value: Bool) async { await save(key: "hideReReleases", value: value, apply: { $0.hideReReleases = value }) }
    func saveShowtimePreferences(_ value: AccountPreferences.Showtime) async {
        guard state == .signedIn else {
            preferences.showtimePreferences = value
            if let data = try? JSONEncoder().encode(value) {
                UserDefaults.standard.set(data, forKey: Self.guestShowtimePreferencesKey)
            }
            return
        }
        await save(key: "showtimePreferences", value: value, apply: { $0.showtimePreferences = value })
    }

    func requestPrivate<Value: Decodable & Sendable>(path: String, method: String, body: Data? = nil, as type: Value.Type) async throws -> Value {
        guard state == .signedIn, let token, let identity else { throw APIClientError.unauthorized }
        do {
            return try await api.requestPrivate(token: token, accountID: identity.id, path: path, method: method, body: body, as: type)
        } catch APIClientError.unauthorized {
            if self.token == token { expireSession() }
            throw APIClientError.unauthorized
        }
    }

    func requestPrivate(path: String, method: String, body: Data? = nil) async throws -> Data {
        guard state == .signedIn, let token, let identity else { throw APIClientError.unauthorized }
        do {
            return try await api.requestPrivateRaw(token: token, accountID: identity.id, path: path, method: method, body: body)
        } catch APIClientError.unauthorized {
            if self.token == token { expireSession() }
            throw APIClientError.unauthorized
        }
    }

    func requestPrivateFile(path: String, contentType: String) async throws -> Data {
        guard state == .signedIn, let token, let identity else { throw APIClientError.unauthorized }
        do {
            return try await api.requestPrivateFile(
                token: token,
                accountID: identity.id,
                path: path,
                contentType: contentType
            )
        } catch APIClientError.unauthorized {
            if self.token == token { expireSession() }
            throw APIClientError.unauthorized
        }
    }

    func displayedMovie(_ movie: Movie) -> Movie? {
        guard let rule = movieDisplayRules[movie.tmdbId] else { return movie }
        guard rule.treatment != "remove" else { return nil }
        var displayed = movie
        displayed.imageSrc = ""
        displayed.imageSrcSet = nil
        if rule.hideBackdrop {
            displayed.backdropSrc = nil
            displayed.backdropSrcSet = nil
        }
        return displayed
    }

    func displayedMovies(_ movies: [Movie], mode: CatalogMode) -> [Movie] {
        movies.compactMap(displayedMovie).filter { movie in
            mode != .nowPlaying || !preferences.hideReReleases ||
                ShowtimeLogic.releaseCategory(for: movie) == .newReleases
        }
    }

    func refreshMovieDisplayRules() async {
        guard state == .signedIn, let sessionToken = token else { movieDisplayRules = [:]; return }
        do {
            var cursor: String?
            var seen = Set<String>()
            var all: [MovieDisplayRule] = []
            repeat {
                let suffix = cursor.map { "?after=\($0)" } ?? ""
                let page: MovieDisplayRulePage = try await requestPrivate(
                    path: "/api/v1/preferences/movie-display\(suffix)",
                    method: "GET",
                    as: MovieDisplayRulePage.self
                )
                all.append(contentsOf: page.preferences)
                guard let next = page.nextCursor else { break }
                guard next != cursor, seen.insert(next).inserted else { throw APIClientError.invalidResponse }
                cursor = next
            } while cursor != nil
            guard token == sessionToken, state == .signedIn else { return }
            movieDisplayRules = Dictionary(all.map { ($0.tmdbId, $0) }, uniquingKeysWith: { _, new in new })
        } catch {
            // Movie display choices are an enhancement; public browsing stays available.
        }
    }

    func searchTitles(_ query: String) async throws -> [TitleSearchResult] {
        try await api.searchTitles(query)
    }

    private func activate(_ value: String, fallbackLocation: String) async throws {
        try credentials.save(value)
        token = value
        do {
            try await loadIdentityAndPreferences(token: value, fallbackLocation: fallbackLocation)
        } catch APIClientError.unauthorized {
            if token == value { clearAccountSession() }
            throw APIClientError.unauthorized
        } catch {
            if token == value {
                identity = Self.cachedIdentity(for: value)
                state = .unavailable(error.localizedDescription)
            }
            throw error
        }
    }

    private func loadIdentityAndPreferences(token: String, fallbackLocation: String) async throws {
        let account = try await api.loadAccount(token: token)
        let loadedPreferences = try await api.loadPreferences(token: token, accountID: account.id, fallbackLocation: fallbackLocation)
        guard self.token == token else { throw CancellationError() }
        Self.cacheIdentity(account, for: token)
        identity = account
        preferences = loadedPreferences
        confirmedPreferences = loadedPreferences
        confirmedSaveGenerations.removeAll()
        UserDefaults.standard.set(loadedPreferences.siteColor, forKey: Self.siteColorKey)
        state = .signedIn
        feedback = nil
        await syncPushDeviceRegistration()
        await refreshMovieDisplayRules()
    }

    private func expireSession() {
        clearAccountSession()
    }

    private func clearAccountSession() {
        credentials.clear()
        token = nil
        identity = nil
        UserDefaults.standard.removeObject(forKey: Self.offlineIdentityKey)
        pushDeviceRegistered = false
        saveGenerations.removeAll()
        confirmedSaveGenerations.removeAll()
        movieDisplayRules = [:]
        preferences = AccountPreferences()
        confirmedPreferences = AccountPreferences()
        if let data = UserDefaults.standard.data(forKey: Self.guestShowtimePreferencesKey),
           let saved = try? JSONDecoder().decode(AccountPreferences.Showtime.self, from: data) {
            preferences.showtimePreferences = saved
        }
        UserDefaults.standard.removeObject(forKey: Self.siteColorKey)
        feedback = nil
        state = .guest
    }

    private struct OfflineIdentity: Codable {
        let identity: AccountIdentity
        let credentialDigest: String
    }

    private static func cacheIdentity(_ identity: AccountIdentity, for token: String) {
        let cached = OfflineIdentity(identity: identity, credentialDigest: digest(token))
        guard let data = try? JSONEncoder().encode(cached) else { return }
        UserDefaults.standard.set(data, forKey: offlineIdentityKey)
    }

    private static func cachedIdentity(for token: String) -> AccountIdentity? {
        guard let data = UserDefaults.standard.data(forKey: offlineIdentityKey),
              let cached = try? JSONDecoder().decode(OfflineIdentity.self, from: data),
              cached.credentialDigest == digest(token) else { return nil }
        return cached.identity
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private func save<Value: Encodable & Sendable>(key: String, value: Value, apply: (inout AccountPreferences) -> Void) async {
        guard state == .signedIn, let token, let identity else { return }
        let generation = (saveGenerations[key] ?? 0) + 1
        saveGenerations[key] = generation
        apply(&preferences)
        if key == "siteColor" { UserDefaults.standard.set(preferences.siteColor, forKey: Self.siteColorKey) }
        activeSaveCount += 1
        isSaving = activeSaveCount > 0
        feedback = nil
        defer {
            activeSaveCount -= 1
            isSaving = activeSaveCount > 0
        }
        do {
            let encoded = try JSONEncoder().encode(value)
            let object = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed])
            let patch = try JSONSerialization.data(withJSONObject: [key: object])
            _ = try await api.savePreferences(token: token, accountID: identity.id, patch: patch)
            guard self.token == token else { return }
            if generation >= (confirmedSaveGenerations[key] ?? 0) {
                apply(&confirmedPreferences)
                confirmedSaveGenerations[key] = generation
            }
        } catch {
            guard self.token == token else { return }
            if let apiError = error as? APIClientError, case .unauthorized = apiError {
                expireSession()
                feedback = "Your session expired. Sign in again to save preferences."
                return
            }
            guard saveGenerations[key] == generation else { return }
            restorePreference(key, from: confirmedPreferences)
            if key == "siteColor" { UserDefaults.standard.set(preferences.siteColor, forKey: Self.siteColorKey) }
            feedback = "Couldn’t save this preference. \(error.localizedDescription)"
        }
    }

    private func restorePreference(_ key: String, from saved: AccountPreferences) {
        switch key {
        case "location": preferences.location = saved.location
        case "siteColor": preferences.siteColor = saved.siteColor
        case "ratingSources": preferences.ratingSources = saved.ratingSources
        case "hideReReleases": preferences.hideReReleases = saved.hideReReleases
        case "notificationDelivery": preferences.notificationDelivery = saved.notificationDelivery
        case "showtimePreferences": preferences.showtimePreferences = saved.showtimePreferences
        default: break
        }
    }
}
