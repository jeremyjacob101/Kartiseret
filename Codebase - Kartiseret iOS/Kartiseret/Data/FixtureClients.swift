import Foundation

enum FixtureData {
    static let nowPlaying: [Movie] = [
        movie("101", code: "K1A", title: "The Quiet Horizon", year: 2026, genres: ["Drama", "Mystery"], runtime: 127, popularity: 99, ratings: (8.2, 91, 87)),
        movie("102", code: "K2B", title: "Midnight in Jaffa", year: 2026, genres: ["Romance", "Comedy"], runtime: 104, popularity: 94, ratings: (7.6, 84, 92)),
        movie("103", code: "K3C", title: "Orbit Seven", year: 2025, genres: ["Science Fiction", "Adventure"], runtime: 141, popularity: 90, ratings: (7.9, 88, 82)),
        movie("104", code: "K4D", title: "Paper Kingdom", year: 2026, genres: ["Animation", "Family"], runtime: 96, popularity: 82, ratings: (7.4, 79, 95)),
        movie("105", code: "K5E", title: "Last Train North", year: 2025, genres: ["Thriller"], runtime: 113, popularity: 75, ratings: (7.1, 76, 81)),
        movie("106", code: "K6F", title: "Salt & Starlight", year: 2026, genres: ["Documentary"], runtime: 89, popularity: 67, ratings: (8.0, 93, 89))
    ]

    static let comingSoon: [Movie] = [
        movie("201", code: "S1A", title: "A Map of Tomorrow", year: 2026, releaseDate: futureDate(12), genres: ["Drama"], runtime: 118, popularity: 92, mode: .comingSoon, ratings: (nil, nil, nil)),
        movie("202", code: "S2B", title: "Wild Signals", year: 2026, releaseDate: futureDate(28), genres: ["Adventure", "Comedy"], runtime: 106, popularity: 88, mode: .comingSoon, ratings: (nil, nil, nil)),
        movie("203", code: "S3C", title: "The Glass Orchard", year: 2026, releaseDate: futureDate(41), genres: ["Fantasy", "Romance"], runtime: 124, popularity: 79, mode: .comingSoon, ratings: (nil, nil, nil)),
        movie("204", code: "S4D", title: "Red Sea Blue", year: 2027, releaseDate: futureDate(65), genres: ["Documentary"], runtime: 91, popularity: 72, mode: .comingSoon, ratings: (nil, nil, nil))
    ]

    static var cities: [City] {
        let known: [String: (Double, Double, [String])] = [
            "Jerusalem": (31.7683, 35.2137, ["Modiin", "Tel Aviv"]),
            "Tel Aviv": (32.0853, 34.7818, ["Givatayim", "Glilot", "Herziliya", "Jerusalem"]),
            "Haifa": (32.7940, 34.9896, ["Kiryat Bialik", "Carmiel", "Zichron Yaakov"]),
            "Beer Sheva": (31.2529, 34.7915, ["Omer", "Ashkelon"]),
            "Modiin": (31.8969, 34.8186, ["Jerusalem", "Rishon Letzion"]),
            "Holon": (32.0158, 34.7790, ["Tel Aviv", "Rishon Letzion"])
        ]
        return KartiseretConstants.supportedCityNames.map { name in
            let values = known[name]
            return City(
                name: name,
                alternateSpellings: [],
                latitude: values?.0,
                longitude: values?.1,
                zoomLevel: values == nil ? nil : 10,
                neighboringCities: values?.2 ?? []
            )
        }.sorted { $0.name < $1.name }
    }

    static let theaters: [Theater] = [
        Theater(name: "Jerusalem", chain: "Yes Planet", address: "4 Naomi Street", location: "Jerusalem", latitude: 31.7515, longitude: 35.2237, cityName: "Jerusalem"),
        Theater(name: "Cinema City Jerusalem", chain: "Cinema City", address: "10 Yitzhak Rabin Boulevard", location: "Jerusalem", latitude: 31.7879, longitude: 35.2033, cityName: "Jerusalem"),
        Theater(name: "Jerusalem Cinematheque", chain: "Jerusalem Cinematheque", address: "11 Hebron Road", location: "Jerusalem", latitude: 31.7680, longitude: 35.2260, cityName: "Jerusalem"),
        Theater(name: "Dizengoff", chain: "Lev Cinema", address: "50 Dizengoff Street", location: "Tel Aviv", latitude: 32.0754, longitude: 34.7741, cityName: "Tel Aviv"),
        Theater(name: "Glilot", chain: "Cinema City", address: "Glilot Junction", location: "Glilot", latitude: 32.1466, longitude: 34.8072, cityName: "Glilot"),
        Theater(name: "Haifa", chain: "Yes Planet", address: "Grand Canyon", location: "Haifa", latitude: 32.7890, longitude: 35.0082, cityName: "Haifa")
    ]

    static func showtimes(city: String, start: String, end: String, tmdbID: String?) -> [ShowtimeRecord] {
        let dates = dates(from: start, through: end)
        let movies = nowPlaying + comingSoon.prefix(1)
        let cityTheaters = theaters.filter { $0.cityName == city }
        let availableTheaters = cityTheaters.isEmpty
            ? [Theater(name: city, chain: "Cinema City", address: "City Center", location: city, latitude: nil, longitude: nil, cityName: city)]
            : cityTheaters
        var rows: [ShowtimeRecord] = []
        for (dayIndex, date) in dates.enumerated() {
            for (movieIndex, movie) in movies.enumerated() where tmdbID == nil || movie.tmdbID == tmdbID {
                guard (dayIndex + movieIndex) % 4 != 3 else { continue }
                for (theaterIndex, theater) in availableTheaters.prefix(2).enumerated() {
                    let chain = theater.chain.isEmpty ? theater.name : theater.chain
                    let times = theaterIndex == 0 ? ["17:20", "20:10", "23:40"] : ["18:45", "21:30", "00:35"]
                    for (timeIndex, time) in times.enumerated() {
                        rows.append(
                            ShowtimeRecord(
                                tmdbID: movie.tmdbID,
                                city: city,
                                date: date,
                                theater: chain,
                                entry: ShowtimeEntry(
                                    time: time,
                                    ticketURL: URL(string: "https://example.com/tickets/\(movie.tmdbID)/\(date)/\(time.replacingOccurrences(of: ":", with: ""))"),
                                    screeningTechnology: timeIndex == 1 ? "IMAX 2D Atmos" : (timeIndex == 2 ? "3D" : "2D"),
                                    screeningType: timeIndex == 2 ? "VIP" : "Regular",
                                    dubLanguage: movieIndex == 3 && timeIndex == 0 ? "Hebrew" : nil
                                )
                            )
                        )
                    }
                }
            }
        }
        return rows
    }

    static let signedInUser = UserSession(
        userID: UUID(uuidString: "11111111-2222-3333-4444-555555555555")!,
        email: "moviegoer@example.com"
    )

    private static func movie(
        _ id: String,
        code: String,
        title: String,
        year: Int,
        releaseDate: String? = nil,
        genres: [String],
        runtime: Int,
        popularity: Double,
        mode: MovieMode = .nowPlaying,
        ratings: (Double?, Double?, Double?)
    ) -> Movie {
        Movie(
            tmdbID: id,
            movieCode: code,
            imdbID: "tt0000\(id)",
            rottenTomatoesID: title.lowercased().replacingOccurrences(of: " ", with: "_"),
            letterboxdID: title.lowercased().replacingOccurrences(of: " ", with: "-"),
            title: title,
            year: year,
            releaseDate: releaseDate,
            genres: genres,
            posterURL: nil,
            backdropURL: nil,
            trailerKey: "dQw4w9WgXcQ",
            imdbRating: ratings.0,
            letterboxdRating: ratings.0.map { min(5, $0 / 2) },
            letterboxdVotes: ratings.0 == nil ? nil : 24_000,
            tmdbRating: ratings.0,
            tmdbVotes: ratings.0 == nil ? nil : 8_000,
            rottenTomatoesCriticRating: ratings.1,
            rottenTomatoesCriticVotes: ratings.1 == nil ? nil : 180,
            rottenTomatoesAudienceRating: ratings.2,
            rottenTomatoesAudienceVotes: ratings.2 == nil ? nil : 2_400,
            runtimeMinutes: runtime,
            popularity: popularity,
            alternatives: [],
            mode: mode
        )
    }

    private static func futureDate(_ days: Int) -> String {
        CinemaClock.addingDays(days, to: CinemaClock.cinemaDay()) ?? CinemaClock.cinemaDay()
    }

    private static func dates(from start: String, through end: String) -> [String] {
        var result: [String] = []
        var current = start
        while current <= end, result.count <= KartiseretConstants.showtimeWindowDays {
            result.append(current)
            guard let next = CinemaClock.addingDays(1, to: current) else { break }
            current = next
        }
        return result
    }
}

actor FixtureCatalogRepository: CatalogRepository {
    private let shouldFail: Bool
    private(set) var catalogRequestCount = 0
    private(set) var showtimeRequestCount = 0

    init(shouldFail: Bool = ProcessInfo.processInfo.arguments.contains("-FixtureNetworkError")) {
        self.shouldFail = shouldFail
    }

    func loadCatalog(_ mode: MovieMode, forceRefresh: Bool) async throws -> [Movie] {
        catalogRequestCount += 1
        try await delay()
        return mode == .nowPlaying ? FixtureData.nowPlaying : FixtureData.comingSoon
    }

    func loadShowtimes(city: String, startDate: String, endDate: String, tmdbID: String?, forceRefresh: Bool) async throws -> [ShowtimeRecord] {
        showtimeRequestCount += 1
        try await delay()
        return FixtureData.showtimes(city: city, start: startDate, end: endDate, tmdbID: tmdbID)
    }

    func loadCities() async throws -> [City] { try await delay(); return FixtureData.cities }
    func loadTheaters() async throws -> [Theater] { try await delay(); return FixtureData.theaters }
    func invalidateShowtimeCache() {}
    func invalidateAll() {}

    private func delay() async throws {
        try await Task.sleep(for: .milliseconds(80))
        try Task.checkCancellation()
        if shouldFail { throw AppServiceError.network("Fixture network error") }
    }
}

actor FixtureAuthClient: AuthClient {
    private var session: UserSession?

    init(signedIn: Bool = ProcessInfo.processInfo.arguments.contains("-SignedIn")) {
        session = signedIn ? FixtureData.signedInUser : nil
    }

    func currentSession() -> UserSession? { session }

    func sessionChanges() -> AsyncStream<UserSession?> {
        let value = session
        return AsyncStream { continuation in
            continuation.yield(value)
            continuation.finish()
        }
    }

    func signIn(email: String, password: String) async throws -> UserSession {
        try await Task.sleep(for: .milliseconds(180))
        guard password != "wrong" else { throw AppServiceError.authentication("Invalid email or password.") }
        let value = UserSession(userID: FixtureData.signedInUser.userID, email: email)
        session = value
        return value
    }

    func signUp(email: String, password: String, signupCity: String) async throws -> AuthSignUpResult {
        try await Task.sleep(for: .milliseconds(180))
        let value = UserSession(userID: FixtureData.signedInUser.userID, email: email)
        session = value
        return AuthSignUpResult(user: value, isSignedIn: true)
    }

    func signOut() async throws { session = nil }
}

actor FixturePreferencesClient: PreferencesClient {
    private var value: AppPreferences?
    private let failSaves: Bool
    private(set) var updateCount = 0

    init(
        initial: AppPreferences? = ProcessInfo.processInfo.arguments.contains("-SignedIn")
            ? AppPreferences(city: "Jerusalem", ratingSources: RatingSource.allCases, accent: .purple)
            : nil,
        failSaves: Bool = false
    ) {
        value = initial
        self.failSaves = failSaves
    }

    func load(userID: UUID) async throws -> AppPreferences? { value }
    func initialize(userID: UUID, preferences: AppPreferences) async throws { value = preferences }
    func update(userID: UUID, key: PreferenceKey, preferences: AppPreferences) async throws {
        updateCount += 1
        try await Task.sleep(for: .milliseconds(80))
        if failSaves { throw AppServiceError.network("Fixture save failed") }
        value = preferences
    }

    func snapshot() -> AppPreferences? { value }
}

extension AppDependencies {
    static func fixtures(
        catalog: (any CatalogRepository)? = nil,
        auth: (any AuthClient)? = nil,
        preferences: (any PreferencesClient)? = nil
    ) -> AppDependencies {
        AppDependencies(
            catalogRepository: catalog ?? FixtureCatalogRepository(),
            authClient: auth ?? FixtureAuthClient(),
            preferencesClient: preferences ?? FixturePreferencesClient()
        )
    }
}
