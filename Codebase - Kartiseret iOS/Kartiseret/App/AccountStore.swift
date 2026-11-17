import Foundation
import Observation

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
    private(set) var state: AccountState = .restoring
    private(set) var identity: AccountIdentity?
    private(set) var preferences = AccountPreferences()
    private(set) var movieDisplayRules: [String: MovieDisplayRule] = [:]
    private(set) var isSaving = false
    private(set) var appleSignInAvailable = false
    private(set) var googleSignInAvailable = false
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
        guard let savedToken = credentials.read() else { state = .guest; return }
        token = savedToken
        do {
            try await loadIdentityAndPreferences(token: savedToken, fallbackLocation: fallbackLocation)
        } catch APIClientError.unauthorized {
            clearAccountSession()
        } catch {
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

    func signInWithApple(identityToken: String, nonce: String, fallbackLocation: String) async throws {
        let session = try await api.signInWithApple(identityToken: identityToken, nonce: nonce)
        try await activate(session, fallbackLocation: fallbackLocation)
    }

    func signInWithGoogle(identityToken: String, accessToken: String, fallbackLocation: String) async throws {
        let session = try await api.signInWithGoogle(identityToken: identityToken, accessToken: accessToken)
        try await activate(session, fallbackLocation: fallbackLocation)
    }

    func signOut() async {
        let oldToken = token
        clearAccountSession()
        if let oldToken { await api.signOut(token: oldToken) }
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
            expireSession()
            throw APIClientError.unauthorized
        }
    }

    func requestPrivate(path: String, method: String, body: Data? = nil) async throws -> Data {
        guard state == .signedIn, let token, let identity else { throw APIClientError.unauthorized }
        do {
            return try await api.requestPrivateRaw(token: token, accountID: identity.id, path: path, method: method, body: body)
        } catch APIClientError.unauthorized {
            expireSession()
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
        guard state == .signedIn else { movieDisplayRules = [:]; return }
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
            clearAccountSession()
            throw APIClientError.unauthorized
        } catch {
            state = .unavailable(error.localizedDescription)
            throw error
        }
    }

    private func loadIdentityAndPreferences(token: String, fallbackLocation: String) async throws {
        let account = try await api.loadAccount(token: token)
        let loadedPreferences = try await api.loadPreferences(token: token, accountID: account.id, fallbackLocation: fallbackLocation)
        identity = account
        preferences = loadedPreferences
        confirmedPreferences = loadedPreferences
        confirmedSaveGenerations.removeAll()
        UserDefaults.standard.set(loadedPreferences.siteColor, forKey: Self.siteColorKey)
        state = .signedIn
        feedback = nil
        await refreshMovieDisplayRules()
    }

    private func expireSession() {
        clearAccountSession()
    }

    private func clearAccountSession() {
        credentials.clear()
        token = nil
        identity = nil
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
            let object = try JSONSerialization.jsonObject(with: encoded)
            let patch = try JSONSerialization.data(withJSONObject: [key: object])
            _ = try await api.savePreferences(token: token, accountID: identity.id, patch: patch)
            if generation >= (confirmedSaveGenerations[key] ?? 0) {
                apply(&confirmedPreferences)
                confirmedSaveGenerations[key] = generation
            }
        } catch {
            if saveGenerations[key] == generation {
                restorePreference(key, from: confirmedPreferences)
                if key == "siteColor" { UserDefaults.standard.set(preferences.siteColor, forKey: Self.siteColorKey) }
                feedback = "Couldn’t save this preference. Try again."
            }
        }
    }

    private func restorePreference(_ key: String, from saved: AccountPreferences) {
        switch key {
        case "location": preferences.location = saved.location
        case "siteColor": preferences.siteColor = saved.siteColor
        case "ratingSources": preferences.ratingSources = saved.ratingSources
        case "hideReReleases": preferences.hideReReleases = saved.hideReReleases
        case "showtimePreferences": preferences.showtimePreferences = saved.showtimePreferences
        default: break
        }
    }
}
