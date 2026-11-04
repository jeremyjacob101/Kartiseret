import Foundation
import XCTest
@testable import Kartiseret

final class CoreAndAPITests: XCTestCase {
    func testCinemaDayUsesJerusalemOneOhFiveCutoff() throws {
        let before = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T23:04:00Z"))
        let atCutoff = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T23:05:00Z"))

        XCTAssertEqual(CinemaDay.current(at: before).isoDate, "2026-11-04")
        XCTAssertEqual(CinemaDay.current(at: atCutoff).isoDate, "2026-11-05")
    }

    func testScreeningGracePeriodAndPostMidnightSort() throws {
        let day = try XCTUnwrap(CinemaDay(isoDate: "2026-11-04"))
        let screening = makeShowtime(time: "00:30", date: day.isoDate)
        let withinGrace = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T22:45:00Z"))
        let outsideGrace = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T22:46:00Z"))

        XCTAssertTrue(ShowtimeLogic.shouldInclude(screening, for: day, at: withinGrace))
        XCTAssertFalse(ShowtimeLogic.shouldInclude(screening, for: day, at: outsideGrace))
        XCTAssertGreaterThan(ShowtimeLogic.sortValue("00:30"), ShowtimeLogic.sortValue("23:00"))
    }

    func testDateRangeIsLimitedTo180DaysIncludingToday() throws {
        let today = try XCTUnwrap(CinemaDay(isoDate: "2026-11-04"))
        XCTAssertTrue(ShowtimeLogic.isWithinSelectableRange(today, today: today))
        XCTAssertTrue(ShowtimeLogic.isWithinSelectableRange(today.addingDays(179), today: today))
        XCTAssertFalse(ShowtimeLogic.isWithinSelectableRange(today.addingDays(180), today: today))
        XCTAssertFalse(ShowtimeLogic.isWithinSelectableRange(today.addingDays(-1), today: today))
    }

    func testGroupingFiltersCityAndMovieDeduplicatesAndSorts() throws {
        let day = try XCTUnwrap(CinemaDay(isoDate: "2026-11-04"))
        let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T12:00:00Z"))
        let first = makeMovie(id: "1", title: "First")
        let second = makeMovie(id: "2", title: "Second")
        let rows = [
            makeShowtime(id: "1", cinema: "Zeta", time: "00:30", date: day.isoDate),
            makeShowtime(id: "1", cinema: "Zeta", time: "23:00", date: day.isoDate),
            makeShowtime(id: "1", cinema: "Zeta", time: "23:00", date: day.isoDate),
            makeShowtime(id: "2", cinema: "Alpha", time: "18:00", date: day.isoDate),
            makeShowtime(id: "1", city: "Haifa", cinema: "Other", time: "19:00", date: day.isoDate),
        ]

        let groups = ShowtimeLogic.group(rows, movies: [first, second], city: "Jerusalem", day: day, at: now)

        XCTAssertEqual(groups.map(\.movie.tmdbId), ["1", "2"])
        XCTAssertEqual(groups[0].cinemas.map(\.name), ["Zeta"])
        XCTAssertEqual(groups[0].cinemas[0].showtimes.map(\.displayTime), ["23:00", "00:30"])
        XCTAssertEqual(groups[0].cinemas[0].showtimes.count, 2)
    }

    func testGroupingReturnsEmptyForNoMatchingShowtimes() throws {
        let day = try XCTUnwrap(CinemaDay(isoDate: "2026-11-04"))
        let instant = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-11-04T12:00:00Z"))

        XCTAssertTrue(ShowtimeLogic.group([], movies: [makeMovie()], city: "Jerusalem", day: day, at: instant).isEmpty)
    }

    func testBookingURLPrefersEnglishAndFallsBackToHebrew() {
        let english = makeShowtime(english: "https://tickets.example/en", hebrew: "https://tickets.example/he")
        let fallback = makeShowtime(english: nil, hebrew: "https://tickets.example/he")
        let invalid = makeShowtime(english: "javascript:alert(1)", hebrew: nil)

        XCTAssertEqual(english.bookingURL?.absoluteString, "https://tickets.example/en")
        XCTAssertEqual(fallback.bookingURL?.absoluteString, "https://tickets.example/he")
        XCTAssertNil(invalid.bookingURL)
    }

    func testCatalogEnvelopeAndPublicationRevisionDecode() async throws {
        let body = #"{"data":{"mode":"nowPlaying","movieCodesStatus":"ready","movies":[{"tmdbId":"123","title":"Sample","year":2026,"genres":["Drama"],"imageSrc":"https://img.example/poster.jpg","runtime":95,"altOptions":[],"popularity":1,"imdbRating":null,"lbRating":null,"lbVotes":null,"tmdbRating":null,"tmdbVotes":null,"rtCriticRating":null,"rtCriticVotes":null,"rtAudienceRating":null,"rtAudienceVotes":null} ]},"error":null}"#
        let transport = StubTransport(responses: [httpResponse(body, headers: ["X-Kartiseret-Publication": "17"])])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let snapshot = try await api.loadCatalog(.nowPlaying)

        XCTAssertEqual(snapshot.publicationRevision, "17")
        XCTAssertEqual(snapshot.data.movies.first?.title, "Sample")
    }

    func testTheatersEnvelopeDecodesCitiesAndBuildsEndpoint() async throws {
        let body = #"{"data":{"cities":[{"name":"Jerusalem"},{"name":"Tel Aviv"}]},"error":null}"#
        let transport = StubTransport(responses: [httpResponse(body)])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let cities = try await api.loadCities()

        XCTAssertEqual(cities.map(\.name), ["Jerusalem", "Tel Aviv"])
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/api/v1/theaters")
    }

    func testShowtimesRequestEncodesCityDateMovieAndPublicationHeader() async throws {
        let body = #"{"data":{"showtimes":[]},"error":null}"#
        let transport = StubTransport(responses: [httpResponse(body, headers: ["X-Kartiseret-Publication": "21"])])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)
        let day = try XCTUnwrap(CinemaDay(isoDate: "2026-11-04"))

        _ = try await api.loadShowtimes(city: "Tel Aviv", day: day, movieID: "123", publicationRevision: "21")

        let capturedRequests = await transport.capturedRequests()
        let request = try XCTUnwrap(capturedRequests.first)
        let components = try XCTUnwrap(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
        let values = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })
        XCTAssertEqual(components.path, "/api/v1/showtimes")
        XCTAssertEqual(values["city"], "Tel Aviv")
        XCTAssertEqual(values["startDate"], day.isoDate)
        XCTAssertEqual(values["endDate"], day.isoDate)
        XCTAssertEqual(values["tmdbId"], "123")
        XCTAssertEqual(request.headers["X-Kartiseret-Publication"], "21")
    }

    func testPublicationChangedIsReturnedAsTypedRemoteError() async throws {
        let body = #"{"data":null,"error":{"code":"publication_changed","message":"Reload the catalog."}}"#
        let transport = StubTransport(responses: [httpResponse(body, statusCode: 409)])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        do {
            _ = try await api.loadCatalog(.nowPlaying)
            XCTFail("Expected a publication error")
        } catch let error as APIClientError {
            XCTAssertEqual(error.code, "publication_changed")
        }
    }
}

private actor StubTransport: APITransport {
    private var responses: [APIHTTPResponse]
    private var requests: [APIHTTPRequest] = []

    init(responses: [APIHTTPResponse]) {
        self.responses = responses
    }

    func send(_ request: APIHTTPRequest) async throws -> APIHTTPResponse {
        requests.append(request)
        guard !responses.isEmpty else { throw APIClientError.transport("No response queued") }
        return responses.removeFirst()
    }

    func capturedRequests() -> [APIHTTPRequest] { requests }
}

private func httpResponse(_ string: String, statusCode: Int = 200, headers: [String: String] = [:]) -> APIHTTPResponse {
    APIHTTPResponse(statusCode: statusCode, headers: headers, body: Data(string.utf8))
}

private func makeMovie(id: String = "1", title: String = "Sample") -> Movie {
    Movie(tmdbId: id, title: title, year: 2026, releaseDate: nil, genres: [], imageSrc: "", backdropSrc: nil, runtime: 90)
}

private func makeShowtime(
    id: String = "1",
    city: String = "Jerusalem",
    cinema: String = "Cinema",
    time: String = "18:00",
    date: String = "2026-11-04",
    english: String? = nil,
    hebrew: String? = nil
) -> Showtime {
    Showtime(
        tmdbId: id,
        screeningCity: city,
        dateOfShowing: date,
        cinema: cinema,
        showtime: time,
        englishHref: english,
        hebrewHref: hebrew,
        screeningTech: "Standard",
        screeningType: "Regular",
        dubLanguage: nil
    )
}
