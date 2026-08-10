import XCTest
@testable import Kartiseret

final class SearchAndCatalogTests: XCTestCase {
    func testSearchRankingMatchesWebPriority() {
        let movies = FixtureData.nowPlaying
        let exact = MovieSearchEngine.score(movie: movies[0], query: movies[0].title)
        let prefix = MovieSearchEngine.score(movie: movies[0], query: "The Quiet")
        let word = MovieSearchEngine.score(movie: movies[0], query: "Horiz")
        let substring = MovieSearchEngine.score(movie: movies[0], query: "orizon")
        let year = MovieSearchEngine.score(movie: movies[0], query: "2026")
        XCTAssertEqual([exact, prefix, word, substring, year], [500, 400, 320, 240, 180])
    }

    func testSearchScopeAndLimit() {
        let results = MovieSearchEngine.search(
            query: "2026", nowPlaying: FixtureData.nowPlaying,
            comingSoon: FixtureData.comingSoon, scope: .comingSoon, limit: 2
        )
        XCTAssertEqual(results.count, 2)
        XCTAssertTrue(results.allSatisfy { $0.movie.mode == .comingSoon })
    }

    func testMovieCodeNormalizationRejectsInvalidCodes() {
        let rows: [JSONRow] = [
            ["tmdb_id": .number(1), "movie_code": .string("A1b")],
            ["tmdb_id": .number(2), "movie_code": .string("toolong")],
            ["tmdb_id": .number(3), "movie_code": .string("!@#")]
        ]
        XCTAssertEqual(SupabaseRowNormalizer.movieCodes(rows: rows), ["1": "A1b"])
    }

    func testRatingBrandArtworkMatchesWebThresholds() {
        var movie = FixtureData.nowPlaying[1]
        XCTAssertEqual(RatingSource.imdb.logoAssetName(in: movie), "RatingIMDb")
        XCTAssertEqual(RatingSource.rottenTomatoesAudience.logoAssetName(in: movie), "RatingRTAudienceHot")
        XCTAssertEqual(RatingSource.rottenTomatoesCritic.logoAssetName(in: movie), "RatingRTCriticHot")

        movie.rottenTomatoesAudienceVotes = 100
        movie.rottenTomatoesCriticVotes = 20
        XCTAssertEqual(RatingSource.rottenTomatoesAudience.logoAssetName(in: movie), "RatingRTAudienceGood")
        XCTAssertEqual(RatingSource.rottenTomatoesCritic.logoAssetName(in: movie), "RatingRTCriticGood")

        movie.rottenTomatoesAudienceRating = 59
        movie.rottenTomatoesCriticRating = 59
        XCTAssertEqual(RatingSource.rottenTomatoesAudience.logoAssetName(in: movie), "RatingRTAudienceBad")
        XCTAssertEqual(RatingSource.rottenTomatoesCritic.logoAssetName(in: movie), "RatingRTCriticBad")
    }

    @MainActor
    func testCatalogStoreCoalescesDuplicateLaunchLoads() async {
        let repository = FixtureCatalogRepository()
        let store = CatalogStore(repository: repository)
        async let first: Void = store.loadInitialCatalogs()
        async let second: Void = store.loadInitialCatalogs()
        _ = await (first, second)
        let requestCount = await repository.catalogRequestCount
        XCTAssertEqual(requestCount, 2, "One request per catalog should serve both callers")
        XCTAssertEqual(store.nowPlaying.count, FixtureData.nowPlaying.count)
        XCTAssertEqual(store.comingSoon.count, FixtureData.comingSoon.count)
    }
}
