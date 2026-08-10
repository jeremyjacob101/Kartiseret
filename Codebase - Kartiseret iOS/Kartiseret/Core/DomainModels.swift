import Foundation

enum LoadState<Value: Sendable>: Sendable {
    case idle
    case loading(previous: Value?)
    case loaded(Value)
    case empty
    case failed(message: String, previous: Value?)

    var value: Value? {
        switch self {
        case .loaded(let value), .loading(let value?), .failed(_, let value?):
            value
        case .idle, .loading(nil), .empty, .failed(_, nil):
            nil
        }
    }

    var isLoading: Bool {
        if case .loading = self { true } else { false }
    }
}

enum MovieMode: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case nowPlaying
    case comingSoon

    var id: Self { self }
    var title: String {
        switch self {
        case .nowPlaying: "Now Playing"
        case .comingSoon: "Coming Soon"
        }
    }
}

struct Movie: Identifiable, Hashable, Codable, Sendable {
    let tmdbID: String
    var movieCode: String?
    var imdbID: String?
    var rottenTomatoesID: String?
    var letterboxdID: String?
    var title: String
    var year: Int
    var releaseDate: String?
    var genres: [String]
    var posterURL: URL?
    var backdropURL: URL?
    var trailerKey: String?
    var imdbRating: Double?
    var letterboxdRating: Double?
    var letterboxdVotes: Double?
    var tmdbRating: Double?
    var tmdbVotes: Double?
    var rottenTomatoesCriticRating: Double?
    var rottenTomatoesCriticVotes: Double?
    var rottenTomatoesAudienceRating: Double?
    var rottenTomatoesAudienceVotes: Double?
    var runtimeMinutes: Int
    var popularity: Double
    var alternatives: [MovieAlternative]
    var mode: MovieMode

    var id: String { "\(mode.rawValue):\(tmdbID)" }

    var metadataLine: String {
        [year > 0 ? String(year) : nil, runtimeLabel, genres.prefix(2).joined(separator: " · ")]
            .compactMap { value in
                guard let value, !value.isEmpty else { return nil }
                return value
            }
            .joined(separator: "  ·  ")
    }

    var runtimeLabel: String? {
        guard runtimeMinutes > 0 else { return nil }
        let hours = runtimeMinutes / 60
        let minutes = runtimeMinutes % 60
        return hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
    }

    var releaseDateValue: Date? {
        releaseDate.flatMap { CinemaClock.date(fromISO: $0) }
    }

    var trailerURL: URL? {
        guard let trailerKey = trailerKey?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trailerKey.isEmpty else { return nil }
        if let directURL = URL(string: trailerKey), directURL.scheme != nil {
            return directURL.isSafeExternalURL ? directURL : nil
        }
        var components = URLComponents(string: "https://www.youtube.com/watch")
        components?.queryItems = [URLQueryItem(name: "v", value: trailerKey)]
        return components?.url
    }
}

struct MovieAlternative: Hashable, Codable, Sendable {
    let tmdbID: String
    let title: String
    let year: Int?
    let posterURL: URL?
}

enum RatingSource: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case imdb = "imdbRating"
    case rottenTomatoesAudience = "rtAudienceRating"
    case rottenTomatoesCritic = "rtCriticRating"
    case letterboxd = "lbRating"
    case tmdb = "tmdbRating"

    var id: Self { self }

    var title: String {
        switch self {
        case .imdb: "IMDb"
        case .rottenTomatoesAudience: "Rotten Tomatoes Audience"
        case .rottenTomatoesCritic: "Rotten Tomatoes Critics"
        case .letterboxd: "Letterboxd"
        case .tmdb: "TMDb"
        }
    }

    var shortTitle: String {
        switch self {
        case .imdb: "IMDb"
        case .rottenTomatoesAudience: "Audience"
        case .rottenTomatoesCritic: "Critics"
        case .letterboxd: "Letterboxd"
        case .tmdb: "TMDb"
        }
    }

    var systemImage: String {
        switch self {
        case .imdb: "star.fill"
        case .rottenTomatoesAudience: "popcorn.fill"
        case .rottenTomatoesCritic: "leaf.fill"
        case .letterboxd: "square.grid.3x3.fill"
        case .tmdb: "chart.bar.fill"
        }
    }

    func logoAssetName(in movie: Movie) -> String {
        switch self {
        case .imdb:
            "RatingIMDb"
        case .letterboxd:
            "RatingLetterboxd"
        case .tmdb:
            "RatingTMDb"
        case .rottenTomatoesAudience:
            if (movie.rottenTomatoesAudienceRating ?? 0) >= 90,
               (movie.rottenTomatoesAudienceVotes ?? 0) >= 500 {
                "RatingRTAudienceHot"
            } else if (movie.rottenTomatoesAudienceRating ?? 0) >= 60 {
                "RatingRTAudienceGood"
            } else {
                "RatingRTAudienceBad"
            }
        case .rottenTomatoesCritic:
            if (movie.rottenTomatoesCriticRating ?? 0) >= 75,
               (movie.rottenTomatoesCriticVotes ?? 0) >= 80 {
                "RatingRTCriticHot"
            } else if (movie.rottenTomatoesCriticRating ?? 0) >= 60 {
                "RatingRTCriticGood"
            } else {
                "RatingRTCriticBad"
            }
        }
    }

    func scoreDescription(in movie: Movie) -> String {
        switch self {
        case .imdb, .letterboxd, .tmdb:
            return title
        case .rottenTomatoesAudience:
            if (movie.rottenTomatoesAudienceRating ?? 0) >= 90,
               (movie.rottenTomatoesAudienceVotes ?? 0) >= 500 {
                return "Rotten Tomatoes Audience, Verified Hot"
            }
            return (movie.rottenTomatoesAudienceRating ?? 0) >= 60
                ? "Rotten Tomatoes Audience, Full Popcorn Bucket"
                : "Rotten Tomatoes Audience, Spilled Popcorn Bucket"
        case .rottenTomatoesCritic:
            if (movie.rottenTomatoesCriticRating ?? 0) >= 75,
               (movie.rottenTomatoesCriticVotes ?? 0) >= 80 {
                return "Rotten Tomatoes Critics, Certified Fresh"
            }
            return (movie.rottenTomatoesCriticRating ?? 0) >= 60
                ? "Rotten Tomatoes Critics, Fresh"
                : "Rotten Tomatoes Critics, Rotten"
        }
    }

    func value(in movie: Movie) -> Double? {
        switch self {
        case .imdb: movie.imdbRating
        case .rottenTomatoesAudience: movie.rottenTomatoesAudienceRating
        case .rottenTomatoesCritic: movie.rottenTomatoesCriticRating
        case .letterboxd: movie.letterboxdRating
        case .tmdb: movie.tmdbRating
        }
    }

    func formattedValue(in movie: Movie) -> String? {
        guard let value = value(in: movie), value.isFinite else { return nil }
        switch self {
        case .rottenTomatoesAudience, .rottenTomatoesCritic:
            return "\(Int(value.rounded()))%"
        case .imdb, .tmdb:
            return String(format: "%.1f", value)
        case .letterboxd:
            return String(format: "%.1f", value)
        }
    }

    func externalURL(for movie: Movie) -> URL? {
        switch self {
        case .imdb:
            guard let id = movie.imdbID, !id.isEmpty else { return nil }
            return URL(string: "https://www.imdb.com/title/\(id)/")
        case .rottenTomatoesAudience, .rottenTomatoesCritic:
            guard let id = movie.rottenTomatoesID, !id.isEmpty else { return nil }
            return URL(string: "https://www.rottentomatoes.com/m/\(id)")
        case .letterboxd:
            guard let id = movie.letterboxdID, !id.isEmpty else { return nil }
            if id.hasPrefix("http") { return URL(string: id) }
            return URL(string: "https://letterboxd.com/film/\(id)/")
        case .tmdb:
            return URL(string: "https://www.themoviedb.org/movie/\(movie.tmdbID)")
        }
    }
}

struct ShowtimeEntry: Identifiable, Hashable, Codable, Sendable {
    var time: String
    var ticketURL: URL?
    var screeningTechnology: String
    var screeningType: String
    var dubLanguage: String?

    var id: String {
        [time, screeningTechnology.lowercased(), screeningType.lowercased(), dubLanguage?.lowercased() ?? ""]
            .joined(separator: "::")
    }
}

struct TheaterShowtimes: Identifiable, Hashable, Codable, Sendable {
    var theater: String
    var showtimes: [ShowtimeEntry]
    var id: String { theater }
}

struct MovieShowtimeDay: Identifiable, Hashable, Codable, Sendable {
    var date: String
    var theaters: [TheaterShowtimes]
    var id: String { date }
}

struct ShowtimeRecord: Identifiable, Hashable, Codable, Sendable {
    var tmdbID: String
    var city: String
    var date: String
    var theater: String
    var entry: ShowtimeEntry

    var id: String { [tmdbID, city, date, theater, entry.id].joined(separator: "::") }
}

struct City: Identifiable, Hashable, Codable, Sendable {
    var name: String
    var alternateSpellings: [String]
    var latitude: Double?
    var longitude: Double?
    var zoomLevel: Double?
    var neighboringCities: [String]
    var id: String { name }
}

struct Theater: Identifiable, Hashable, Codable, Sendable {
    var name: String
    var chain: String
    var address: String
    var location: String
    var latitude: Double?
    var longitude: Double?
    var cityName: String
    var id: String { [cityName, chain, name, address].joined(separator: "::") }
}

struct CatalogBundle: Sendable {
    var nowPlaying: [Movie]
    var comingSoon: [Movie]
}

struct AppPreferences: Equatable, Codable, Sendable {
    var city: String
    var ratingSources: [RatingSource]
    var accent: AccentChoice

    static let defaults = AppPreferences(
        city: "Jerusalem",
        ratingSources: [.imdb, .rottenTomatoesAudience, .rottenTomatoesCritic],
        accent: .purple
    )

    func normalized(supportedCities: Set<String> = Set(KartiseretConstants.supportedCityNames)) -> AppPreferences {
        let normalizedCity = supportedCities.contains(city) ? city : Self.defaults.city
        let normalizedRatings = Array(ratingSources.uniqued().filter { RatingSource.allCases.contains($0) })
        return AppPreferences(
            city: normalizedCity,
            ratingSources: normalizedRatings.isEmpty ? Self.defaults.ratingSources : normalizedRatings,
            accent: AccentChoice(rawValue: accent.rawValue) ?? .purple
        )
    }
}

struct UserSession: Equatable, Codable, Sendable {
    let userID: UUID
    let email: String
}

enum AuthMode: String, CaseIterable, Identifiable, Sendable {
    case logIn
    case createAccount
    var id: Self { self }
    var title: String { self == .logIn ? "Log In" : "Create Account" }
    var actionTitle: String { title }
}

enum AppServiceError: LocalizedError, Equatable, Sendable {
    case missingConfiguration(String)
    case malformedResponse(String)
    case unavailable(String)
    case authentication(String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .missingConfiguration(let message), .malformedResponse(let message),
             .unavailable(let message), .authentication(let message), .network(let message):
            message
        }
    }
}

extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}

extension URL {
    var isSafeExternalURL: Bool {
        guard let scheme = scheme?.lowercased() else { return false }
        return scheme == "https" || scheme == "http"
    }
}
