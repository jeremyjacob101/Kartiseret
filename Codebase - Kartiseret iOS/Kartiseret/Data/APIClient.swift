import Foundation

struct APIHTTPRequest: Sendable {
    let url: URL
    let headers: [String: String]
    var method: String = "GET"
    var body: Data? = nil
}

struct APIHTTPResponse: Sendable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data

    func header(_ name: String) -> String? {
        headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
}

protocol APITransport: Sendable {
    func send(_ request: APIHTTPRequest) async throws -> APIHTTPResponse
}

actor URLSessionAPITransport: APITransport {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func send(_ request: APIHTTPRequest) async throws -> APIHTTPResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        // Native authentication uses bearer tokens; never attach browser session cookies.
        urlRequest.httpShouldHandleCookies = false
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }
        urlRequest.httpBody = request.body

        do {
            let (data, response) = try await session.data(for: urlRequest)
            guard let response = response as? HTTPURLResponse else {
                throw APIClientError.invalidResponse
            }
            var headers: [String: String] = [:]
            for (key, value) in response.allHeaderFields {
                if let key = key as? String { headers[key] = String(describing: value) }
            }
            return APIHTTPResponse(statusCode: response.statusCode, headers: headers, body: data)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as APIClientError {
            throw error
        } catch {
            throw APIClientError.transport(error.localizedDescription)
        }
    }
}

protocol KartiseretAPI: Sendable {
    func loadCatalog(_ mode: CatalogMode) async throws -> CatalogSnapshot
    func loadCities() async throws -> [City]
    func loadShowtimes(
        city: String,
        day: CinemaDay,
        movieID: String?,
        publicationRevision: String?
    ) async throws -> ShowtimesSnapshot
    func hasTicketAvailability(movieID: String, at instant: Date) async throws -> Bool
    func loadCinematheques(
        city: String,
        startDate: String,
        endDate: String,
        publicationRevision: String?
    ) async throws -> CinemathequeSnapshot
    func loadCinemaPage(id: String, publicationRevision: String?) async throws -> CinemaPageSnapshot
    func resolvePublicRouteRenderPath(code: String) async throws -> String
    func createPublicRouteShare(_ request: PublicRouteShareRequest) async throws -> String
}

extension KartiseretAPI {
    func hasTicketAvailability(movieID: String, at instant: Date) async throws -> Bool {
        throw APIClientError.unsupported
    }

    func loadCinematheques(
        city: String,
        startDate: String,
        endDate: String,
        publicationRevision: String?
    ) async throws -> CinemathequeSnapshot {
        throw APIClientError.unsupported
    }

    func loadCinemaPage(id: String, publicationRevision: String?) async throws -> CinemaPageSnapshot {
        throw APIClientError.unsupported
    }

    func resolvePublicRouteRenderPath(code: String) async throws -> String {
        throw APIClientError.unsupported
    }

    func createPublicRouteShare(_ request: PublicRouteShareRequest) async throws -> String {
        throw APIClientError.unsupported
    }
}

struct PublicRouteShareRequest: Codable, Hashable, Sendable {
    let movieCode: String
    let city: String
    let date: String
    let filterMask: Int
    let excludedCinemaIds: [String]
}

struct URLSessionKartiseretAPI: KartiseretAPI {
    let baseURL: URL
    private let transport: any APITransport

    init(baseURL: URL, transport: any APITransport = URLSessionAPITransport()) {
        self.baseURL = baseURL
        self.transport = transport
    }

    func loadCatalog(_ mode: CatalogMode) async throws -> CatalogSnapshot {
        let (data, response) = try await get(MovieCatalogData.self, path: mode.endpoint)
        guard data.mode == mode else { throw APIClientError.invalidResponse }
        return CatalogSnapshot(data: data, publicationRevision: response.header("X-Kartiseret-Publication"))
    }

    func loadCities() async throws -> [City] {
        let (data, _) = try await get(TheaterData.self, path: "/api/v1/theaters")
        return data.cities
    }

    func loadShowtimes(
        city: String,
        day: CinemaDay,
        movieID: String?,
        publicationRevision: String?
    ) async throws -> ShowtimesSnapshot {
        let url = try Self.showtimesURL(baseURL: baseURL, city: city, day: day, movieID: movieID)
        var headers: [String: String] = [:]
        if let publicationRevision {
            headers["X-Kartiseret-Publication"] = publicationRevision
        }
        let (data, response) = try await get(ShowtimesData.self, url: url, headers: headers)
        return ShowtimesSnapshot(showtimes: data.showtimes, publicationRevision: response.header("X-Kartiseret-Publication"))
    }

    func hasTicketAvailability(movieID: String, at instant: Date) async throws -> Bool {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidURL
        }
        components.path = "/api/v1/ticket-availability"
        components.queryItems = [
            URLQueryItem(name: "tmdbId", value: movieID),
            URLQueryItem(name: "fromDate", value: CinemaDay.current(at: instant).isoDate),
        ]
        guard let url = components.url else { throw APIClientError.invalidURL }
        let (data, _) = try await get(TicketAvailabilityData.self, url: url, headers: [:])
        return data.showtimes.contains { screening in
            guard let day = CinemaDay(isoDate: screening.dateOfShowing) else { return false }
            return ShowtimeLogic.shouldInclude(time: screening.showtime, for: day, at: instant)
        }
    }

    private struct TicketAvailabilityData: Decodable {
        struct Screening: Decodable {
            let dateOfShowing: String
            let showtime: String
        }

        let showtimes: [Screening]
    }

    func loadCinematheques(
        city: String,
        startDate: String,
        endDate: String,
        publicationRevision: String?
    ) async throws -> CinemathequeSnapshot {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidURL
        }
        components.path = "/api/v1/cinematheques"
        components.queryItems = [
            URLQueryItem(name: "city", value: city),
            URLQueryItem(name: "startDate", value: startDate),
            URLQueryItem(name: "endDate", value: endDate),
        ]
        guard let url = components.url else { throw APIClientError.invalidURL }
        var headers: [String: String] = [:]
        if let publicationRevision { headers["X-Kartiseret-Publication"] = publicationRevision }
        let (data, response) = try await get(CinemathequeData.self, url: url, headers: headers)
        return CinemathequeSnapshot(data: data, publicationRevision: response.header("X-Kartiseret-Publication"))
    }

    func loadCinemaPage(id: String, publicationRevision: String?) async throws -> CinemaPageSnapshot {
        guard CinemaIdentity.byID(id) != nil,
              let escapedID = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
              let url = URL(string: "/api/v1/cinemas/\(escapedID)", relativeTo: baseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        var headers: [String: String] = [:]
        if let publicationRevision { headers["X-Kartiseret-Publication"] = publicationRevision }
        let (data, response) = try await get(CinemaPageData.self, url: url, headers: headers)
        return CinemaPageSnapshot(data: data, publicationRevision: response.header("X-Kartiseret-Publication"))
    }

    func resolvePublicRouteRenderPath(code: String) async throws -> String {
        guard code.utf8.count == 8,
              code.utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) }) else {
            throw APIClientError.invalidURL
        }
        let (data, _) = try await get(PublicRouteResolutionData.self, path: "/api/v1/public-routes/\(code)")
        guard Self.isSafePublicRouteRenderPath(data.renderPath) else { throw APIClientError.invalidResponse }
        return data.renderPath
    }

    func createPublicRouteShare(_ request: PublicRouteShareRequest) async throws -> String {
        let body: Data
        do {
            body = try JSONEncoder().encode(request)
        } catch {
            throw APIClientError.invalidResponse
        }
        guard let url = URL(string: "/api/v1/public-routes/shares", relativeTo: baseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        let response = try await transport.send(APIHTTPRequest(
            url: url,
            headers: ["Content-Type": "application/json"],
            method: "POST",
            body: body
        ))
        let decoder = JSONDecoder()
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIEnvelope<PublicRoutePathData>.self, from: response.body),
               let error = envelope.error {
                throw APIClientError.remote(code: error.code, message: error.message, statusCode: response.statusCode)
            }
            throw APIClientError.http(statusCode: response.statusCode)
        }
        let envelope: APIEnvelope<PublicRoutePathData>
        do {
            envelope = try decoder.decode(APIEnvelope<PublicRoutePathData>.self, from: response.body)
        } catch {
            throw APIClientError.invalidResponse
        }
        if let error = envelope.error {
            throw APIClientError.remote(code: error.code, message: error.message, statusCode: response.statusCode)
        }
        guard let data = envelope.data, Self.isOpaquePublicPath(data.path) else {
            throw APIClientError.invalidResponse
        }
        return data.path
    }

    private static func isOpaquePublicPath(_ path: String) -> Bool {
        path.utf8.count == 9 && path.hasPrefix("/") &&
            path.utf8.dropFirst().allSatisfy { (48...57).contains($0) || (97...122).contains($0) }
    }

    private static func isSafePublicRouteRenderPath(_ path: String) -> Bool {
        guard path.utf8.count <= 2_048,
              path.hasPrefix("/"),
              !path.hasPrefix("//"),
              !path.contains("#"),
              !path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              let components = URLComponents(string: path),
              components.scheme == nil,
              components.host == nil else { return false }
        return true
    }

    static func showtimesURL(baseURL: URL, city: String, day: CinemaDay, movieID: String?) throws -> URL {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIClientError.invalidURL
        }
        components.path = "/api/v1/showtimes"
        var queryItems = [
            URLQueryItem(name: "city", value: city),
            URLQueryItem(name: "startDate", value: day.isoDate),
            URLQueryItem(name: "endDate", value: day.isoDate),
        ]
        if let movieID { queryItems.append(URLQueryItem(name: "tmdbId", value: movieID)) }
        components.queryItems = queryItems
        guard let url = components.url else { throw APIClientError.invalidURL }
        return url
    }

    private func get<Response: Decodable>(
        _ type: Response.Type,
        path: String,
        headers: [String: String] = [:]
    ) async throws -> (Response, APIHTTPResponse) {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIClientError.invalidURL
        }
        return try await get(type, url: url, headers: headers)
    }

    private func get<Response: Decodable>(
        _ type: Response.Type,
        url: URL,
        headers: [String: String]
    ) async throws -> (Response, APIHTTPResponse) {
        let response = try await transport.send(APIHTTPRequest(url: url, headers: headers))
        let decoder = JSONDecoder()
        guard (200..<300).contains(response.statusCode) else {
            if let envelope = try? decoder.decode(APIEnvelope<Response>.self, from: response.body),
               let error = envelope.error {
                throw APIClientError.remote(code: error.code, message: error.message, statusCode: response.statusCode)
            }
            throw APIClientError.http(statusCode: response.statusCode)
        }
        let envelope: APIEnvelope<Response>
        do {
            envelope = try decoder.decode(APIEnvelope<Response>.self, from: response.body)
        } catch {
            throw APIClientError.invalidResponse
        }
        if let error = envelope.error {
            throw APIClientError.remote(code: error.code, message: error.message, statusCode: response.statusCode)
        }
        guard let data = envelope.data else { throw APIClientError.invalidResponse }
        return (data, response)
    }
}

private struct PublicRouteResolutionData: Decodable {
    let renderPath: String
}

private struct PublicRoutePathData: Decodable {
    let path: String
}

struct APIEnvelope<Response: Decodable>: Decodable {
    let data: Response?
    let error: RemoteAPIError?
}

struct RemoteAPIError: Decodable, Sendable {
    let code: String
    let message: String
}

enum APIClientError: Error, LocalizedError, Sendable {
    case invalidURL
    case invalidResponse
    case http(statusCode: Int)
    case remote(code: String, message: String, statusCode: Int)
    case transport(String)
    case unauthorized
    case invalidCredentials
    case unsupported

    var code: String? {
        if case let .remote(code, _, _) = self { return code }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .invalidURL, .invalidResponse:
            "The server returned an unexpected response."
        case let .http(statusCode):
            "The request failed (\(statusCode)). Please try again."
        case let .remote(_, message, _):
            message
        case let .transport(message):
            message.isEmpty ? "Could not connect. Check your connection and try again." : message
        case .unauthorized:
            "Your session has expired. Sign in again to continue."
        case .invalidCredentials:
            "The email or password is incorrect. Check your details and try again."
        case .unsupported:
            "This feature is unavailable in the current data source."
        }
    }
}
