import Foundation

struct AccountIdentity: Codable, Equatable, Sendable {
    let id: String
    let email: String?
}

struct AccountPreferences: Codable, Equatable, Sendable {
    struct FilterExclusions: Codable, Equatable, Sendable {
        var showType: [String] = []
        var screenFormat: [String] = []
        var screeningTech: [String] = []
        var dubLanguage: [String] = []
    }

    struct Showtime: Codable, Equatable, Sendable {
        var screeningFilters: FilterState = .init()
        var excludedCinemaIds: [String] = []

        struct FilterState: Codable, Equatable, Sendable {
            var version: Int = 3
            var unchecked: FilterExclusions = .init()
        }
    }

    var ratingSources: [String] = ["imdbRating", "rtAudienceRating", "rtCriticRating"]
    var location = "Jerusalem"
    var siteColor = "#a66ae3"
    var hideReReleases = false
    var showtimePreferences = Showtime()

    static let ratingSourceOptions = ["imdbRating", "rtAudienceRating", "rtCriticRating", "lbRating", "tmdbRating"]
    static let colorOptions: [(String, String)] = [
        ("Pink", "#e269ba"), ("Red", "#ed4c57"), ("Orange", "#d97f3a"),
        ("Yellow", "#bebe2d"), ("Green", "#63ae3d"), ("Teal", "#3caa8e"),
        ("Blue", "#69b0e2"), ("Indigo", "#4375d9"), ("Purple", "#a66ae3"),
    ]
}

struct AccountAPIEnvelope<Value: Decodable & Sendable>: Decodable, Sendable {
    let data: Value?
    let error: AccountAPIError?
}

struct AccountAPIError: Decodable, Error, Sendable {
    let code: String
    let message: String
}

struct SignInResponse: Decodable, Sendable {
    let token: String?
    let user: AccountIdentity
}

struct AccountData: Decodable, Sendable {
    let user: AccountIdentity
    let isAdmin: Bool
}

struct TitleSearchResult: Decodable, Identifiable, Sendable {
    let tmdbId: String
    let title: String
    let releaseYear: Int?
    let posterPath: String?
    let comingSoonDate: String?

    var id: String { tmdbId }
}

enum SignUpResult: Sendable {
    case verificationRequired
    case session(token: String)
}

actor NativeAccountAPI {
    private let baseURL: URL
    private let transport: any APITransport

    init(baseURL: URL, transport: any APITransport = URLSessionAPITransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func signIn(email: String, password: String) async throws -> String {
        let response = try await send(path: "/api/auth/sign-in/email", method: "POST", body: try jsonData(["email": email, "password": password]))
        try check(response)
        return try sessionToken(from: response)
    }

    func signUp(name: String, email: String, password: String, location: String) async throws -> SignUpResult {
        let response: APIHTTPResponse = try await send(
            path: "/api/auth/sign-up/email",
            method: "POST",
            body: try jsonData(["name": name, "email": email, "password": password, "signupLocation": location])
        )
        try check(response)
        guard let token = response.header("set-auth-token"), !token.isEmpty else {
            return .verificationRequired
        }
        return .session(token: token)
    }

    func signInWithApple(identityToken: String, nonce: String) async throws -> String {
        let response = try await send(
            path: "/api/auth/sign-in/social",
            method: "POST",
            body: try JSONSerialization.data(withJSONObject: ["provider": "apple", "idToken": ["token": identityToken, "nonce": nonce]] as [String: Any])
        )
        try check(response)
        return try sessionToken(from: response)
    }

    func signInWithGoogle(identityToken: String, accessToken: String) async throws -> String {
        let response = try await send(
            path: "/api/auth/sign-in/social",
            method: "POST",
            body: try JSONSerialization.data(withJSONObject: [
                "provider": "google",
                "idToken": ["token": identityToken, "accessToken": accessToken],
            ] as [String: Any])
        )
        try check(response)
        return try sessionToken(from: response)
    }

    func loadProviders() async throws -> [String] {
        guard let url = URL(string: "/api/v1/auth/providers", relativeTo: baseURL)?.absoluteURL else { throw APIClientError.invalidURL }
        let response = try await transport.send(APIHTTPRequest(url: url, headers: ["Accept": "application/json"]))
        try check(response)
        let envelope: AccountAPIEnvelope<ProviderData>
        do { envelope = try JSONDecoder().decode(AccountAPIEnvelope<ProviderData>.self, from: response.body) }
        catch { throw APIClientError.invalidResponse }
        if let error = envelope.error { throw error }
        return envelope.data?.providers ?? []
    }

    func loadAccount(token: String) async throws -> AccountIdentity {
        let result: AccountData = try await protectedRequest(path: "/api/v1/account", token: token, method: "GET", body: nil)
        return result.user
    }

    func loadPreferences(token: String, accountID: String, fallbackLocation: String) async throws -> AccountPreferences {
        let result: AccountPreferences = try await protectedRequest(
            path: "/api/v1/preferences/initialize",
            token: token,
            accountID: accountID,
            method: "POST",
            body: try jsonData(["fallbackLocation": fallbackLocation])
        )
        return result
    }

    func savePreferences(token: String, accountID: String, patch: Data) async throws -> AccountPreferences {
        try await protectedRequest(path: "/api/v1/preferences", token: token, accountID: accountID, method: "PATCH", body: patch)
    }

    func requestPrivate<Value: Decodable & Sendable>(token: String, accountID: String, path: String, method: String, body: Data?, as type: Value.Type) async throws -> Value {
        try await protectedRequest(path: path, token: token, accountID: accountID, method: method, body: body)
    }

    func requestPrivateRaw(token: String, accountID: String, path: String, method: String, body: Data?) async throws -> Data {
        let response = try await send(path: path, method: method, body: body, token: token, accountID: accountID)
        try check(response)
        guard let value = try? JSONSerialization.jsonObject(with: response.body) as? [String: Any],
              value["error"] is NSNull,
              let data = value["data"],
              JSONSerialization.isValidJSONObject(data),
              let encoded = try? JSONSerialization.data(withJSONObject: data) else {
            throw APIClientError.invalidResponse
        }
        return encoded
    }

    func searchTitles(_ query: String) async throws -> [TitleSearchResult] {
        guard var components = URLComponents(url: baseURL.appending(path: "/api/v1/tmdb/search"), resolvingAgainstBaseURL: false) else { throw APIClientError.invalidURL }
        components.queryItems = [URLQueryItem(name: "query", value: query)]
        guard let url = components.url else { throw APIClientError.invalidURL }
        let response = try await transport.send(APIHTTPRequest(url: url, headers: ["Accept": "application/json"]))
        try check(response)
        let envelope: AccountAPIEnvelope<TitlesData>
        do { envelope = try JSONDecoder().decode(AccountAPIEnvelope<TitlesData>.self, from: response.body) }
        catch { throw APIClientError.invalidResponse }
        if let error = envelope.error { throw error }
        return envelope.data?.titles ?? []
    }

    func requestAccountDeletion(token: String) async throws {
        let response = try await send(path: "/api/auth/delete-user", method: "POST", body: try jsonData([String: String]()), token: token)
        if let error = try? JSONDecoder().decode(BetterAuthError.self, from: response.body), error.code == "SESSION_EXPIRED" {
            throw APIClientError.remote(code: "SESSION_EXPIRED", message: "Sign out and sign back in with your usual method, then request deletion again. Apple and Google work too; no Kartiseret password is required.", statusCode: response.statusCode)
        }
        try check(response)
    }

    func signOut(token: String) async {
        _ = try? await send(path: "/api/auth/sign-out", method: "POST", body: try? jsonData([String: String]()), token: token)
    }

    private func protectedRequest<Value: Decodable & Sendable>(path: String, token: String, accountID: String? = nil, method: String, body: Data?) async throws -> Value {
        let response = try await send(path: path, method: method, body: body, token: token, accountID: accountID)
        try check(response)
        let envelope: AccountAPIEnvelope<Value>
        do { envelope = try JSONDecoder().decode(AccountAPIEnvelope<Value>.self, from: response.body) }
        catch { throw APIClientError.invalidResponse }
        if let error = envelope.error { throw error }
        guard let data = envelope.data else { throw APIClientError.invalidResponse }
        return data
    }

    private func send(path: String, method: String, body: Data?, token: String? = nil, accountID: String? = nil) async throws -> APIHTTPResponse {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { throw APIClientError.invalidURL }
        var headers = ["Origin": baseURL.originString]
        if let token { headers["Authorization"] = "Bearer \(token)" }
        if let accountID { headers["X-Kartiseret-Account-Id"] = accountID }
        if body != nil {
            headers["Content-Type"] = "application/json"
        }
        return try await transport.send(APIHTTPRequest(url: url, headers: headers, method: method, body: body))
    }

    private func jsonData<Value: Encodable>(_ value: Value) throws -> Data { try JSONEncoder().encode(value) }

    private func check(_ response: APIHTTPResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            if let authError = try? JSONDecoder().decode(BetterAuthError.self, from: response.body),
               authError.code == "INVALID_EMAIL_OR_PASSWORD" || authError.code == "INVALID_CREDENTIALS" {
                throw APIClientError.invalidCredentials
            }
            if response.statusCode == 401 { throw APIClientError.unauthorized }
            if let envelope = try? JSONDecoder().decode(APIEnvelope<EmptyResponse>.self, from: response.body), let error = envelope.error {
                if error.code == "invalid_credentials" || error.code == "INVALID_EMAIL_OR_PASSWORD" { throw APIClientError.invalidCredentials }
                throw APIClientError.remote(code: error.code, message: error.message, statusCode: response.statusCode)
            }
            throw APIClientError.http(statusCode: response.statusCode)
        }
    }

    private func sessionToken(from response: APIHTTPResponse) throws -> String {
        // Better Auth's bearer plug-in exposes the opaque session token only in this header.
        guard let token = response.header("set-auth-token"), !token.isEmpty else {
            throw APIClientError.invalidResponse
        }
        return token
    }
}

private struct EmptyResponse: Decodable, Sendable {}
private struct TitlesData: Decodable, Sendable { let titles: [TitleSearchResult] }
private struct ProviderData: Decodable, Sendable { let providers: [String] }
private struct BetterAuthError: Decodable { let code: String? }

private extension URL {
    var originString: String {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)!
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.string!
    }
}
