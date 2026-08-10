import Foundation
import Observation

enum PreferenceSyncState: Equatable, Sendable {
    case guest
    case loading
    case synced
    case saving
    case failed(String)

    var label: String {
        switch self {
        case .guest: "Saved on this device"
        case .loading: "Loading preferences…"
        case .synced: "Synced"
        case .saving: "Saving…"
        case .failed: "Not synced"
        }
    }
}

@MainActor
@Observable
final class PreferencesStore {
    private(set) var preferences: AppPreferences
    private(set) var syncState: PreferenceSyncState = .guest
    var message: String?

    @ObservationIgnored private let client: any PreferencesClient
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let theme: Theme
    @ObservationIgnored private var session: UserSession?
    @ObservationIgnored private var committed: AppPreferences
    @ObservationIgnored private var saveTasks: [PreferenceKey: Task<Void, Never>] = [:]

    private static let guestCityKey = "kartiseret.guest-city.v1"

    init(client: any PreferencesClient, theme: Theme, defaults: UserDefaults = .standard) {
        self.client = client
        self.theme = theme
        self.defaults = defaults
        let guestCity = defaults.string(forKey: Self.guestCityKey) ?? AppPreferences.defaults.city
        let initial = AppPreferences(city: guestCity, ratingSources: AppPreferences.defaults.ratingSources, accent: .purple).normalized()
        preferences = initial
        committed = initial
        theme.accent = initial.accent
    }

    var city: String { preferences.city }
    var ratingSources: [RatingSource] { preferences.ratingSources }
    var accent: AccentChoice { preferences.accent }
    var isAuthenticated: Bool { session != nil }

    func attach(to session: UserSession?) async {
        saveTasks.values.forEach { $0.cancel() }
        saveTasks.removeAll()
        self.session = session
        message = nil
        guard let session else {
            let guestCity = defaults.string(forKey: Self.guestCityKey) ?? preferences.city
            preferences = AppPreferences(
                city: guestCity,
                ratingSources: AppPreferences.defaults.ratingSources,
                accent: .purple
            ).normalized()
            committed = preferences
            theme.accent = preferences.accent
            syncState = .guest
            return
        }
        syncState = .loading
        do {
            if let remote = try await client.load(userID: session.userID) {
                preferences = remote.normalized()
            } else {
                preferences = AppPreferences(
                    city: preferences.city,
                    ratingSources: AppPreferences.defaults.ratingSources,
                    accent: .purple
                ).normalized()
                try await client.initialize(userID: session.userID, preferences: preferences)
            }
            defaults.set(preferences.city, forKey: Self.guestCityKey)
            committed = preferences
            theme.accent = preferences.accent
            syncState = .synced
        } catch {
            syncState = .failed(error.localizedDescription)
            message = "Your local choices are available, but account preferences could not be loaded."
        }
    }

    func initializeNewAccount(_ result: AuthSignUpResult) async {
        guard result.isSignedIn else { return }
        let initial = AppPreferences(
            city: preferences.city,
            ratingSources: AppPreferences.defaults.ratingSources,
            accent: .purple
        )
        do {
            try await client.initialize(userID: result.user.userID, preferences: initial)
            preferences = initial
            committed = initial
            theme.accent = initial.accent
            syncState = .synced
        } catch {
            syncState = .failed(error.localizedDescription)
            message = "Your account is ready, but its preferences could not be initialized yet."
        }
    }

    func selectCity(_ city: String) {
        guard KartiseretConstants.supportedCityNames.contains(city), city != preferences.city else { return }
        preferences.city = city
        defaults.set(city, forKey: Self.guestCityKey)
        guard session != nil else {
            committed.city = city
            syncState = .guest
            return
        }
        scheduleSave(.city)
    }

    @discardableResult
    func toggleRatingSource(_ source: RatingSource, enabled: Bool) -> Bool {
        guard session != nil else {
            message = "Log in to save rating preferences."
            return false
        }
        var sources = Set(preferences.ratingSources)
        if enabled { sources.insert(source) } else { sources.remove(source) }
        preferences.ratingSources = RatingSource.allCases.filter(sources.contains)
        scheduleSave(.ratingSources)
        return true
    }

    @discardableResult
    func selectAccent(_ accent: AccentChoice) -> Bool {
        guard session != nil else {
            message = "Log in to save an accent color."
            return false
        }
        guard preferences.accent != accent else { return true }
        preferences.accent = accent
        theme.accent = accent
        scheduleSave(.accent)
        return true
    }

    func clearMessage() { message = nil }

    private func scheduleSave(_ key: PreferenceKey) {
        guard let session else { return }
        saveTasks[key]?.cancel()
        syncState = .saving
        let attempted = preferences
        saveTasks[key] = Task { [weak self, client] in
            do {
                try await Task.sleep(for: .milliseconds(250))
                try Task.checkCancellation()
                try await client.update(userID: session.userID, key: key, preferences: attempted)
                guard let self, !Task.isCancelled else { return }
                commit(attempted, key: key)
                saveTasks[key] = nil
                syncState = saveTasks.isEmpty ? .synced : .saving
            } catch is CancellationError {
                return
            } catch {
                guard let self else { return }
                rollback(key)
                saveTasks[key] = nil
                syncState = .failed(error.localizedDescription)
                message = "That preference could not be saved. Your previous choice was restored."
            }
        }
    }

    private func commit(_ value: AppPreferences, key: PreferenceKey) {
        switch key {
        case .city: committed.city = value.city
        case .ratingSources: committed.ratingSources = value.ratingSources
        case .accent: committed.accent = value.accent
        }
    }

    private func rollback(_ key: PreferenceKey) {
        switch key {
        case .city:
            preferences.city = committed.city
            defaults.set(committed.city, forKey: Self.guestCityKey)
        case .ratingSources:
            preferences.ratingSources = committed.ratingSources
        case .accent:
            preferences.accent = committed.accent
            theme.accent = committed.accent
        }
    }
}
