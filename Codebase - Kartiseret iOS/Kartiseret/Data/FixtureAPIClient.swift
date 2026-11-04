import Foundation

actor FixtureAPIClient: KartiseretAPI {
    static let referenceInstant = ISO8601DateFormatter().date(from: "2026-11-04T12:00:00Z") ?? .now

    private let nowPlaying = MovieCatalogData(
        mode: .nowPlaying,
        movies: [
            Movie(
                tmdbId: "9100001",
                title: "Fixture Feature",
                year: 2026,
                releaseDate: "2026-10-30",
                genres: ["Drama", "Mystery"],
                runtime: 112
            ),
            Movie(
                tmdbId: "9100002",
                title: "Another Screening",
                year: 2025,
                releaseDate: nil,
                genres: ["Comedy"],
                runtime: 94
            ),
        ],
        movieCodesStatus: "ready"
    )

    private let comingSoon = MovieCatalogData(
        mode: .comingSoon,
        movies: [
            Movie(
                tmdbId: "9100101",
                title: "Future Feature",
                year: 2027,
                releaseDate: "2027-02-12",
                genres: ["Adventure"],
                runtime: 105
            ),
        ],
        movieCodesStatus: "ready"
    )

    func loadCatalog(_ mode: CatalogMode) async throws -> CatalogSnapshot {
        let data = mode == .nowPlaying ? nowPlaying : comingSoon
        return CatalogSnapshot(data: data, publicationRevision: "fixture-1")
    }

    func loadCities() async throws -> [City] {
        [City(name: "Jerusalem"), City(name: "Haifa"), City(name: "Tel Aviv")]
    }

    func loadShowtimes(
        city: String,
        day: CinemaDay,
        movieID: String?,
        publicationRevision: String?
    ) async throws -> ShowtimesSnapshot {
        let selectedMovies = movieID.map { [$0] } ?? nowPlaying.movies.map(\.tmdbId)
        let fixtures: [(String, String, String, String, String?)] = [
            ("9100001", "Jerusalem", "Fixture Cinema", "18:30", "https://tickets.example/feature"),
            ("9100001", "Tel Aviv", "Tel Aviv Screens", "20:15", "https://tickets.example/tel-aviv"),
            ("9100002", "Jerusalem", "Downtown Cinema", "00:30", nil),
            ("9100101", "Jerusalem", "Future Cinema", "17:30", "https://tickets.example/future"),
        ]
        let rows = fixtures.compactMap { item -> Showtime? in
            guard item.1 == city, selectedMovies.contains(item.0) else { return nil }
            return Showtime(
                tmdbId: item.0,
                screeningCity: item.1,
                dateOfShowing: day.isoDate,
                cinema: item.2,
                showtime: item.3,
                englishHref: item.4,
                hebrewHref: nil,
                screeningTech: item.0 == "9100001" ? "IMAX" : "Standard",
                screeningType: "Regular",
                dubLanguage: nil
            )
        }
        return ShowtimesSnapshot(showtimes: rows, publicationRevision: publicationRevision ?? "fixture-1")
    }
}
