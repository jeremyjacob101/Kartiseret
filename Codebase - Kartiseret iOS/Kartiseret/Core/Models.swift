import Foundation

enum CatalogMode: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
    case nowPlaying
    case comingSoon

    var id: Self { self }

    var title: String {
        switch self {
        case .nowPlaying: "Now Playing"
        case .comingSoon: "Coming Soon"
        }
    }

    var endpoint: String {
        switch self {
        case .nowPlaying: "/api/v1/catalog/now-playing"
        case .comingSoon: "/api/v1/catalog/coming-soon"
        }
    }
}

struct Movie: Decodable, Hashable, Identifiable, Sendable {
    let tmdbId: String
    let title: String
    let year: Int
    let releaseDate: String?
    let genres: [String]
    let runtime: Int
    var movieCode: String? = nil
    var imageSrc: String? = nil
    var imageSrcSet: String? = nil
    var backdropSrc: String? = nil
    var backdropSrcSet: String? = nil
    var trailerKey: String? = nil
    var imdbRating: Double? = nil
    var rtAudienceRating: Double? = nil
    var rtAudienceVotes: Double? = nil
    var rtCriticRating: Double? = nil
    var rtCriticVotes: Double? = nil
    var lbRating: Double? = nil
    var tmdbRating: Double? = nil
    var imdbId: String? = nil
    var rtId: String? = nil
    var lbId: String? = nil

    var id: String { tmdbId }
}

struct City: Decodable, Hashable, Identifiable, Sendable {
    let name: String
    var altSpellings: [String]? = nil
    var latitude: Double? = nil
    var longitude: Double? = nil
    var zoomLayer: Double? = nil
    var neighboringCities: [String]? = nil

    var id: String { name }
}

struct MovieCatalogData: Decodable, Sendable {
    let mode: CatalogMode
    let movies: [Movie]
    let movieCodesStatus: String
}

struct TheaterData: Decodable, Sendable {
    let cities: [City]
    var theaters: [Theater]? = nil
}

struct Theater: Decodable, Hashable, Identifiable, Sendable {
    var city: City? = nil
    var chain: String? = nil
    var address: String? = nil
    var theaterName: String? = nil
    var location: String? = nil
    var lat: Double? = nil
    var lng: Double? = nil

    var id: String { [city?.name, chain, theaterName, location].compactMap { $0 }.joined(separator: "|") }
}

struct CinemathequeData: Decodable, Sendable {
    let movies: [Movie]
    let movieCodesStatus: String
    let showtimes: [Showtime]
}

struct CinemaPageData: Decodable, Sendable {
    let id: String
    let displayName: String
    let city: String
    let address: String
    let mapUrl: URL
    let latitude: Double
    let longitude: Double
    let screenings: [CinemaScreening]
}

struct CinemaScreening: Decodable, Sendable {
    let movie: Movie
    let screening: Showtime
}

struct Showtime: Decodable, Hashable, Identifiable, Sendable {
    let tmdbId: String
    let screeningCity: String
    let dateOfShowing: String
    let cinema: String
    let showtime: String
    let englishHref: String?
    let hebrewHref: String?
    let screeningTech: String
    let screeningType: String
    let dubLanguage: String?

    var id: String {
        [
            tmdbId,
            screeningCity,
            dateOfShowing,
            cinema,
            showtime,
            screeningTech,
            screeningType,
            dubLanguage ?? "",
            englishHref ?? "",
            hebrewHref ?? "",
        ].joined(separator: "|")
    }

    var bookingURL: URL? {
        for candidate in [englishHref, hebrewHref].compactMap({ $0 }) {
            guard let url = URL(string: candidate),
                  let scheme = url.scheme?.lowercased(),
                  scheme == "https" || scheme == "http" else { continue }
            return url
        }
        return nil
    }

    var displayTime: String {
        String(showtime.prefix(5))
    }

    var formatLabels: [String] {
        [screeningType, screeningTech, dubLanguage.map { "\($0) Dub" }]
            .compactMap { value in
                guard let value else { return nil }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty || trimmed.lowercased() == "regular" ? nil : trimmed
            }
    }
}

struct ShowtimesData: Decodable, Sendable {
    let showtimes: [Showtime]
}

struct CatalogSnapshot: Sendable {
    let data: MovieCatalogData
    let publicationRevision: String?
}

struct ShowtimesSnapshot: Sendable {
    let showtimes: [Showtime]
    let publicationRevision: String?
}

struct CinemathequeSnapshot: Sendable {
    let data: CinemathequeData
    let publicationRevision: String?
}

struct CinemaPageSnapshot: Sendable {
    let data: CinemaPageData
    let publicationRevision: String?
}

struct MovieRoute: Hashable, Sendable {
    let mode: CatalogMode
    let movieID: String
    var movie: Movie? = nil
    var sharedShowtimeContext: SharedShowtimeLinkContext? = nil
}

enum MovieLinkResolution: Sendable {
    case route(MovieRoute)
    case unavailable
    case networkFailure
}

struct CinemaRoute: Hashable, Sendable {
    let cinemaID: String
}

struct ShowtimeRequest: Hashable, Sendable {
    let mode: CatalogMode
    let city: String
    let day: CinemaDay
    let movieID: String?
    let publicationRevision: String?

    func with(revision: String?) -> ShowtimeRequest {
        ShowtimeRequest(
            mode: mode,
            city: city,
            day: day,
            movieID: movieID,
            publicationRevision: revision
        )
    }
}

struct CinemaShowtimes: Identifiable, Sendable {
    let name: String
    let showtimes: [Showtime]

    var id: String { name }
}

struct MovieShowtimes: Identifiable, Sendable {
    let movie: Movie
    let cinemas: [CinemaShowtimes]

    var id: String { movie.tmdbId }
}
