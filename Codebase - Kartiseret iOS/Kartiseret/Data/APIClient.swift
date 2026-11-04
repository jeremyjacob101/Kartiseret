import Foundation

struct APIHTTPRequest: Sendable {
    let url: URL
    let headers: [String: String]
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
        urlRequest.httpMethod = "GET"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        request.headers.forEach { urlRequest.setValue($1, forHTTPHeaderField: $0) }

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
        }
    }
}
