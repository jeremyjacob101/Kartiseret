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
    let imageSrc: String
    let backdropSrc: String?
    let runtime: Int

    var id: String { tmdbId }
}

struct City: Decodable, Hashable, Identifiable, Sendable {
    let name: String

    var id: String { name }
}

struct MovieCatalogData: Decodable, Sendable {
    let mode: CatalogMode
    let movies: [Movie]
    let movieCodesStatus: String
}

struct TheaterData: Decodable, Sendable {
    let cities: [City]
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

struct MovieRoute: Hashable, Sendable {
    let mode: CatalogMode
    let movieID: String
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
