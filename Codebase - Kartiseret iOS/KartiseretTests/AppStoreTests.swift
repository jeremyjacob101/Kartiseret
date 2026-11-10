import Foundation
import XCTest
@testable import Kartiseret

@MainActor
final class AppStoreTests: XCTestCase {
    func testCityDefaultsToJerusalemPersistsAndRepairsUnknownCity() async {
        let domain = "KartiseretTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: domain)!
        defaults.set("Atlantis", forKey: AppStore.cityDefaultsKey)
        let api = ScriptedAPI()
        let store = AppStore(api: api, defaults: defaults, now: FixtureAPIClient.referenceInstant)

        XCTAssertEqual(store.selectedCity, "Atlantis")
        await store.loadCities()
        XCTAssertEqual(store.selectedCity, "Jerusalem")
        store.selectCity("Tel Aviv")
        XCTAssertEqual(defaults.string(forKey: AppStore.cityDefaultsKey), "Tel Aviv")
        defaults.removePersistentDomain(forName: domain)
    }

    func testPublicationChangeRefreshesCatalogAndRetriesShowtimesOnce() async {
        let old = makeSnapshot(.nowPlaying, revision: "10")
        let new = makeSnapshot(.nowPlaying, revision: "11")
        let api = ScriptedAPI(
            catalogReplies: [.nowPlaying: [old, new]],
            showtimeFailures: [.remote(code: "publication_changed", message: "Reload", statusCode: 409)]
        )
        let store = AppStore(api: api, defaults: isolatedDefaults(), now: FixtureAPIClient.referenceInstant)

        await store.loadCatalog(.nowPlaying)
        let oldRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
        await store.loadShowtimes(oldRequest)
        let refreshedRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)

        XCTAssertEqual(refreshedRequest.publicationRevision, "11")
        XCTAssertNotNil(store.showtimes[refreshedRequest])
        let sent = await api.capturedShowtimeRequests()
        XCTAssertEqual(sent.map(\.publicationRevision), ["10", "11"])
    }

    func testSlowOldCityResponseCannotReplaceCurrentCityResults() async {
        let api = ScriptedAPI(slowCities: ["Jerusalem"])
        let store = AppStore(api: api, defaults: isolatedDefaults(), now: FixtureAPIClient.referenceInstant)
        await store.loadCatalog(.nowPlaying)
        let oldRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
        let oldTask = Task { await store.loadShowtimes(oldRequest) }
        await Task.yield()

        store.selectCity("Tel Aviv")
        let currentRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
        await store.loadShowtimes(currentRequest)
        await oldTask.value

        XCTAssertEqual(store.showtimes[currentRequest]?.first?.screeningCity, "Tel Aviv")
        XCTAssertEqual(store.showtimes[oldRequest]?.first?.screeningCity, "Jerusalem")
    }

    func testSlowOldDayResponseCannotReplaceCurrentDayResults() async {
        let api = ScriptedAPI(slowDays: [CinemaDay.current(at: FixtureAPIClient.referenceInstant)])
        let store = AppStore(api: api, defaults: isolatedDefaults(), now: FixtureAPIClient.referenceInstant)
        await store.loadCatalog(.nowPlaying)
        let oldRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
        let oldTask = Task { await store.loadShowtimes(oldRequest) }
        try? await Task.sleep(for: .milliseconds(10))

        store.moveDay(by: 1)
        let currentRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
        await store.loadShowtimes(currentRequest)
        await oldTask.value

        XCTAssertEqual(store.selectedDay, currentRequest.day)
        XCTAssertEqual(store.showtimes[currentRequest]?.first?.dateOfShowing, currentRequest.day.isoDate)
        XCTAssertEqual(store.showtimes[oldRequest]?.first?.dateOfShowing, oldRequest.day.isoDate)
    }

    func testShowtimesCanRetryAfterRequestFailure() async {
        let api = ScriptedAPI(showtimeFailures: [.transport("Temporary connection failure")])
        let store = AppStore(api: api, defaults: isolatedDefaults(), now: FixtureAPIClient.referenceInstant)
        await store.loadCatalog(.nowPlaying)
        let request = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)

        await store.loadShowtimes(request)
        XCTAssertEqual(store.showtimeErrors[request], "Temporary connection failure")
        XCTAssertNil(store.showtimes[request])

        await store.loadShowtimes(request, forceRefresh: true)
        XCTAssertNil(store.showtimeErrors[request])
        XCTAssertEqual(store.showtimes[request]?.first?.screeningCity, request.city)
    }
}

private actor ScriptedAPI: KartiseretAPI {
    private var catalogReplies: [CatalogMode: [CatalogSnapshot]]
    private var showtimeFailures: [APIClientError]
    private let slowCities: Set<String>
    private let slowDays: Set<CinemaDay>
    private var showtimeRequests: [ShowtimeRequest] = []

    init(
        catalogReplies: [CatalogMode: [CatalogSnapshot]] = [:],
        showtimeFailures: [APIClientError] = [],
        slowCities: Set<String> = [],
        slowDays: Set<CinemaDay> = []
    ) {
        self.catalogReplies = catalogReplies
        self.showtimeFailures = showtimeFailures
        self.slowCities = slowCities
        self.slowDays = slowDays
    }

    func loadCatalog(_ mode: CatalogMode) async throws -> CatalogSnapshot {
        if var replies = catalogReplies[mode], !replies.isEmpty {
            let result = replies.removeFirst()
            catalogReplies[mode] = replies.isEmpty ? [result] : replies
            return result
        }
        return makeSnapshot(mode, revision: "1")
    }

    func loadCities() async throws -> [City] {
        [City(name: "Jerusalem"), City(name: "Tel Aviv")]
    }

    func loadShowtimes(
        city: String,
        day: CinemaDay,
        movieID: String?,
        publicationRevision: String?
    ) async throws -> ShowtimesSnapshot {
        let request = ShowtimeRequest(mode: .nowPlaying, city: city, day: day, movieID: movieID, publicationRevision: publicationRevision)
        showtimeRequests.append(request)
        if !showtimeFailures.isEmpty { throw showtimeFailures.removeFirst() }
        if slowCities.contains(city) || slowDays.contains(day) {
            try await Task.sleep(for: .milliseconds(100))
        }
        let row = Showtime(
            tmdbId: "1",
            screeningCity: city,
            dateOfShowing: day.isoDate,
            cinema: "Cinema",
            showtime: "18:00",
            englishHref: nil,
            hebrewHref: nil,
            screeningTech: "Standard",
            screeningType: "Regular",
            dubLanguage: nil
        )
        return ShowtimesSnapshot(showtimes: [row], publicationRevision: publicationRevision)
    }

    func capturedShowtimeRequests() -> [ShowtimeRequest] { showtimeRequests }
}

private func makeSnapshot(_ mode: CatalogMode, revision: String) -> CatalogSnapshot {
    CatalogSnapshot(
        data: MovieCatalogData(mode: mode, movies: [], movieCodesStatus: "ready"),
        publicationRevision: revision
    )
}

private func isolatedDefaults() -> UserDefaults {
    let domain = "KartiseretTests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: domain)!
    defaults.removePersistentDomain(forName: domain)
    return defaults
}
