import XCTest
@testable import Kartiseret

final class RowDecodingTests: XCTestCase {
    func testTolerantMovieDecodingHandlesStringsNumbersAndGenreFormats() throws {
        let rows: [JSONRow] = [[
            "tmdb_id": .number(42),
            "english_title": .string("  \"A  Good Movie\"  "),
            "release_year": .string("2026"),
            "solo_update": .string("false"),
            "genres": .string("[\"Drama\", \"Mystery\", \"Drama\"]"),
            "en_poster": .string("https://images.example/poster.jpg"),
            "backdrop": .null,
            "imdbRating": .string("7.8"),
            "rtAudienceRating": .number(91),
            "runtime": .string("127"),
            "popularity": .string("123.45"),
            "alt_options": .array([
                .object(["tmdb": .number(99), "title": .string("Alternate"), "year": .string("2025"), "poster_url": .null])
            ])
        ]]

        let movies = SupabaseRowNormalizer.movies(rows: rows, codes: ["42": "Ab3"], mode: .nowPlaying)
        let movie = try XCTUnwrap(movies.first)
        XCTAssertEqual(movie.tmdbID, "42")
        XCTAssertEqual(movie.movieCode, "Ab3")
        XCTAssertEqual(movie.title, "A Good Movie")
        XCTAssertEqual(movie.year, 2026)
        XCTAssertEqual(movie.genres, ["Drama", "Mystery"])
        XCTAssertEqual(movie.imdbRating, 7.8)
        XCTAssertEqual(movie.runtimeMinutes, 127)
        XCTAssertEqual(movie.alternatives.first?.tmdbID, "99")
        XCTAssertEqual(movie.posterURL?.host, "images.example")
        XCTAssertEqual(movie.backdropURL, movie.posterURL)
    }

    func testMalformedAndSoloRowsAreDiscarded() {
        let rows: [JSONRow] = [
            ["tmdb_id": .string("1"), "english_title": .string("Hidden"), "solo_update": .bool(true)],
            ["tmdb_id": .null, "english_title": .string("Missing ID")],
            ["tmdb_id": .string("2"), "english_title": .string("  ")]
        ]
        XCTAssertTrue(SupabaseRowNormalizer.movies(rows: rows, codes: [:], mode: .nowPlaying).isEmpty)
    }

    func testCatalogSortRules() {
        let nowRows: [JSONRow] = [
            movieRow(id: "1", title: "Lower", popularity: 10, releaseDate: nil),
            movieRow(id: "2", title: "Higher", popularity: 50, releaseDate: nil)
        ]
        XCTAssertEqual(SupabaseRowNormalizer.movies(rows: nowRows, codes: [:], mode: .nowPlaying).map(\.title), ["Higher", "Lower"])

        let soonRows: [JSONRow] = [
            movieRow(id: "3", title: "Later", popularity: 90, releaseDate: "2026-10-01"),
            movieRow(id: "4", title: "Sooner", popularity: 10, releaseDate: "2026-09-01")
        ]
        XCTAssertEqual(SupabaseRowNormalizer.movies(rows: soonRows, codes: [:], mode: .comingSoon).map(\.title), ["Sooner", "Later"])
    }

    func testShowtimeURLRejectsUnsafeSchemesAndDefaultsOptionalMetadata() throws {
        let rows: [JSONRow] = [[
            "tmdb_id": .string("42"), "screening_city": .string("Jerusalem"),
            "date_of_showing": .string("2026-08-10"), "cinema": .string("Cinema City"),
            "showtime": .string("20:15:00"), "english_href": .string("javascript:alert(1)")
        ]]
        let record = try XCTUnwrap(SupabaseRowNormalizer.showtimes(rows: rows).first)
        XCTAssertEqual(record.entry.time, "20:15")
        XCTAssertNil(record.entry.ticketURL)
        XCTAssertEqual(ShowtimeFilterEngine.canonicalMetadata(for: record.entry).screenFormat, "2D")
    }

    private func movieRow(id: String, title: String, popularity: Double, releaseDate: String?) -> JSONRow {
        var row: JSONRow = [
            "tmdb_id": .string(id), "english_title": .string(title), "popularity": .number(popularity),
            "release_year": .number(2026), "solo_update": .bool(false)
        ]
        if let releaseDate { row["release_date"] = .string(releaseDate) }
        return row
    }
}
