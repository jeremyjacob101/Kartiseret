import XCTest
@testable import Kartiseret

final class MovieRatingLogicTests: XCTestCase {
    func testRatingBadgesUseWebsiteMarksAndThresholds() throws {
        let movie = Movie(
            tmdbId: "123",
            title: "Ratings fixture",
            year: 2026,
            releaseDate: nil,
            genres: [],
            runtime: 100,
            imdbRating: 7.8,
            rtAudienceRating: 93,
            rtAudienceVotes: 500,
            rtCriticRating: 75,
            rtCriticVotes: 80,
            lbRating: 4.2,
            tmdbRating: 7.6
        )

        let badges = MovieRatingLogic.badges(
            for: movie,
            sources: ["imdbRating", "rtAudienceRating", "rtCriticRating", "lbRating", "tmdbRating"]
        )

        XCTAssertEqual(badges.map(\.logoName), [
            "RatingIMDb",
            "RatingRottenTomatoesAudienceHot",
            "RatingRottenTomatoesCriticsHot",
            "RatingLetterboxd",
            "RatingTMDb",
        ])
        XCTAssertEqual(badges.map(\.value), ["7.8", "93%", "75%", "4.2", "7.6"])
    }

    func testRottenTomatoesUsesFreshAndRottenMarksWhenHotThresholdsAreNotMet() throws {
        let movie = Movie(
            tmdbId: "123",
            title: "Ratings fixture",
            year: 2026,
            releaseDate: nil,
            genres: [],
            runtime: 100,
            rtAudienceRating: 60,
            rtAudienceVotes: 499,
            rtCriticRating: 59,
            rtCriticVotes: 1_000
        )

        let badges = MovieRatingLogic.badges(for: movie, sources: ["rtAudienceRating", "rtCriticRating"])

        XCTAssertEqual(badges.map(\.logoName), ["RatingRottenTomatoesAudienceGood", "RatingRottenTomatoesCriticsBad"])
        XCTAssertEqual(badges.map(\.accessibilityLabel), [
            "Rotten Tomatoes audience rating 60%, Full Popcorn Bucket",
            "Rotten Tomatoes critics rating 59%, Rotten",
        ])
    }

    func testCinemaThemesMatchTheWebsiteShowtimePalette() {
        XCTAssertEqual(ShowtimeTheme.forCinema("Cinema City Jerusalem"), ShowtimeTheme(startHex: 0x186BDF, endHex: 0x084CAB, accentHex: 0x186BDF))
        XCTAssertEqual(ShowtimeTheme.forCinema("Planet Cinema Rishon"), ShowtimeTheme(startHex: 0xD9710F, endHex: 0xB05806, accentHex: 0xD9710F))
        XCTAssertEqual(ShowtimeTheme.forCinema("Jerusalem Cinematheque"), .cinematheque)
    }
}
