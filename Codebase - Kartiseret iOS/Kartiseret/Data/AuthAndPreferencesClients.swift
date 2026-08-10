import Foundation
@preconcurrency import Supabase

struct AuthSignUpResult: Equatable, Sendable {
    let user: UserSession
    let isSignedIn: Bool
}

protocol AuthClient: Sendable {
    func currentSession() async -> UserSession?
    func sessionChanges() async -> AsyncStream<UserSession?>
    func signIn(email: String, password: String) async throws -> UserSession
    func signUp(email: String, password: String, signupCity: String) async throws -> AuthSignUpResult
    func signOut() async throws
}

actor SupabaseAuthService: AuthClient {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    func currentSession() -> UserSession? {
        Self.map(client.auth.currentSession?.user)
    }

    func sessionChanges() -> AsyncStream<UserSession?> {
        let auth = client.auth
        return AsyncStream { continuation in
            let task = Task {
                for await (_, session) in auth.authStateChanges {
                    if Task.isCancelled { break }
                    continuation.yield(Self.map(session?.user))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func signIn(email: String, password: String) async throws -> UserSession {
        let session = try await client.auth.signIn(email: email, password: password)
        guard let mapped = Self.map(session.user) else {
            throw AppServiceError.authentication("Your account did not include a usable email address.")
        }
        return mapped
    }

    func signUp(email: String, password: String, signupCity: String) async throws -> AuthSignUpResult {
        let response = try await client.auth.signUp(
            email: email,
            password: password,
            data: ["signup_location": .string(signupCity)]
        )
        guard let mapped = Self.map(response.user) else {
            throw AppServiceError.authentication("The account was created without a usable email address.")
        }
        return AuthSignUpResult(user: mapped, isSignedIn: response.session != nil)
    }

    func signOut() async throws {
        try await client.auth.signOut()
    }

    private nonisolated static func map(_ user: Supabase.User?) -> UserSession? {
        guard let user, let email = user.email?.trimmingCharacters(in: .whitespacesAndNewlines), !email.isEmpty else { return nil }
        return UserSession(userID: user.id, email: email)
    }
}

enum PreferenceKey: String, Hashable, Sendable {
    case city
    case ratingSources
    case accent
}

protocol PreferencesClient: Sendable {
    func load(userID: UUID) async throws -> AppPreferences?
    func initialize(userID: UUID, preferences: AppPreferences) async throws
    func update(userID: UUID, key: PreferenceKey, preferences: AppPreferences) async throws
}

actor SupabasePreferencesService: PreferencesClient {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    func load(userID: UUID) async throws -> AppPreferences? {
        let rows: [JSONRow] = try await client
            .from("userPreferences")
            .select("user_id,rating_sources,location,site_color")
            .eq("user_id", value: userID.uuidString)
            .limit(1)
            .execute()
            .value
        return SupabaseRowNormalizer.preferences(row: rows.first)
    }

    func initialize(userID: UUID, preferences: AppPreferences) async throws {
        let normalized = preferences.normalized()
        let payload: JSONRow = [
            "user_id": .string(userID.uuidString),
            "rating_sources": .array(normalized.ratingSources.map { .string($0.rawValue) }),
            "location": .string(normalized.city),
            "site_color": .string(normalized.accent.rawValue)
        ]
        try await client
            .from("userPreferences")
            .upsert(payload, onConflict: "user_id")
            .execute()
    }

    func update(userID: UUID, key: PreferenceKey, preferences: AppPreferences) async throws {
        let value: JSONRow = switch key {
        case .city: ["location": .string(preferences.city)]
        case .ratingSources: ["rating_sources": .array(preferences.ratingSources.map { .string($0.rawValue) })]
        case .accent: ["site_color": .string(preferences.accent.rawValue)]
        }
        try await client
            .from("userPreferences")
            .update(value)
            .eq("user_id", value: userID.uuidString)
            .execute()
    }
}
