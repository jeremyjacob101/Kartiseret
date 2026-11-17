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

    func testReleaseCategoryUsesTheWebThreeYearBoundary() {
        XCTAssertEqual(ShowtimeLogic.releaseCategory(for: makeMovie(id: "2023", title: "Older", year: 2023), currentYear: 2026), .reReleases)
        XCTAssertEqual(ShowtimeLogic.releaseCategory(for: makeMovie(id: "2024", title: "Current", year: 2024), currentYear: 2026), .newReleases)
        XCTAssertEqual(ShowtimeLogic.releaseCategory(for: makeMovie(id: "0", title: "Unknown", year: 0), currentYear: 2026), .newReleases)
    }

    func testSavedShowtimeFiltersMatchWebCanonicalGroups() {
        var screening = makeShowtime(city: "Jerusalem", cinema: "Jerusalem Cinematheque")
        screening = Showtime(tmdbId: screening.tmdbId, screeningCity: screening.screeningCity, dateOfShowing: screening.dateOfShowing, cinema: screening.cinema, showtime: screening.showtime, englishHref: screening.englishHref, hebrewHref: screening.hebrewHref, screeningTech: "3D + IMAX + Atmos", screeningType: "Business Light", dubLanguage: "Hebrew")
        var state = AccountPreferences.Showtime.FilterState()

        XCTAssertTrue(ShowtimeLogic.matchesSavedFilters(screening, state: state))
        state.unchecked.screeningTech = ["IMAX", "Atmos"]
        XCTAssertFalse(ShowtimeLogic.matchesSavedFilters(screening, state: state))

        state.unchecked.screeningTech = ["IMAX"]
        state.unchecked.showType = ["VIP Light"]
        XCTAssertTrue(ShowtimeLogic.matchesSavedFilters(screening, state: state))
        state.unchecked.showType.append("VIP")
        XCTAssertFalse(ShowtimeLogic.matchesSavedFilters(screening, state: state))
    }

    func testCinemaIdentityResolvesTheSharedCanonicalName() {
        XCTAssertEqual(CinemaIdentity.forScreening(city: "Jerusalem", cinema: "Jerusalem Cinematheque")?.id, "smBcm2HtRvQA")
        XCTAssertNil(CinemaIdentity.forScreening(city: "Jerusalem", cinema: "Unknown Cinema"))
        XCTAssertEqual(CinemaIdentity.forScreening(city: "Ｊｅｒｕｓａｌｅｍ", cinema: "Ｃｉｎｅｍａｔｈｅｑｕｅ")?.id, "smBcm2HtRvQA")
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

    func testCinemathequeRequestUsesCityDateRangeAndPublicationHeader() async throws {
        let body = #"{"data":{"movies":[],"movieCodesStatus":"ready","showtimes":[]},"error":null}"#
        let transport = StubTransport(responses: [httpResponse(body, headers: ["X-Kartiseret-Publication": "35"])])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let snapshot = try await api.loadCinematheques(city: "Tel Aviv", startDate: "2026-11-04", endDate: "2026-11-17", publicationRevision: "35")

        XCTAssertEqual(snapshot.publicationRevision, "35")
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        let components = try XCTUnwrap(URLComponents(url: request.url, resolvingAgainstBaseURL: false))
        let values = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).compactMap { item in
            item.value.map { (item.name, $0) }
        })
        XCTAssertEqual(components.path, "/api/v1/cinematheques")
        XCTAssertEqual(values["city"], "Tel Aviv")
        XCTAssertEqual(values["startDate"], "2026-11-04")
        XCTAssertEqual(values["endDate"], "2026-11-17")
        XCTAssertEqual(request.headers["X-Kartiseret-Publication"], "35")
    }

    func testCinemaPageRequestUsesAValidatedIdentityRoute() async throws {
        let body = #"{"data":{"id":"smBcm2HtRvQA","displayName":"Jerusalem Cinematheque","city":"Jerusalem","address":"11 Hebron Road","mapUrl":"https://maps.example/cinema","latitude":31.77,"longitude":35.21,"screenings":[]},"error":null}"#
        let transport = StubTransport(responses: [httpResponse(body)])
        let api = URLSessionKartiseretAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let page = try await api.loadCinemaPage(id: "smBcm2HtRvQA", publicationRevision: nil)

        XCTAssertEqual(page.data.displayName, "Jerusalem Cinematheque")
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/api/v1/cinemas/smBcm2HtRvQA")
        do {
            _ = try await api.loadCinemaPage(id: "bad", publicationRevision: nil)
            XCTFail("Expected unknown cinema identities to be rejected before sending")
        } catch let error as APIClientError {
            XCTAssertEqual(error.localizedDescription, APIClientError.invalidURL.localizedDescription)
        }
    }

    func testNativeEmailSignInReadsBetterAuthBearerTokenHeader() async throws {
        let response = #"{"token":null,"user":{"id":"user-1","email":"person@example.com"}}"#
        let transport = StubTransport(responses: [httpResponse(response, headers: ["set-auth-token": "opaque-session-token"])])
        let api = NativeAccountAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let token = try await api.signIn(email: "person@example.com", password: "passphrase")

        XCTAssertEqual(token, "opaque-session-token")
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/api/auth/sign-in/email")
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.headers["Origin"], "https://seret.site")
        let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.body ?? Data()) as? [String: String])
        XCTAssertEqual(payload["email"], "person@example.com")
        XCTAssertEqual(payload["password"], "passphrase")
    }

    func testNativeGoogleSignInSendsIDAndAccessTokensToBetterAuth() async throws {
        let response = #"{"token":null,"user":{"id":"user-1","email":"person@example.com"}}"#
        let transport = StubTransport(responses: [httpResponse(response, headers: ["set-auth-token": "google-session-token"])])
        let api = NativeAccountAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let token = try await api.signInWithGoogle(identityToken: "signed-id-token", accessToken: "google-access-token")

        XCTAssertEqual(token, "google-session-token")
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.url.path, "/api/auth/sign-in/social")
        let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: request.body ?? Data()) as? [String: Any])
        XCTAssertEqual(payload["provider"] as? String, "google")
        let idToken = try XCTUnwrap(payload["idToken"] as? [String: String])
        XCTAssertEqual(idToken["token"], "signed-id-token")
        XCTAssertEqual(idToken["accessToken"], "google-access-token")
    }

    func testNativePrivateRequestsAttachBearerAndAccountIdentity() async throws {
        let body = ##"{"data":{"ratingSources":["imdbRating"],"location":"Tel Aviv","siteColor":"#ed4c57","hideReReleases":true,"showtimePreferences":{"screeningFilters":{"version":3,"unchecked":{"showType":["VIP"],"screenFormat":[],"screeningTech":[],"dubLanguage":[]}},"excludedCinemaIds":["cinema-1"]}},"error":null}"##
        let transport = StubTransport(responses: [httpResponse(body)])
        let api = NativeAccountAPI(baseURL: URL(string: "https://seret.site")!, transport: transport)

        let preferences = try await api.loadPreferences(token: "opaque-session-token", accountID: "user-1", fallbackLocation: "Jerusalem")

        XCTAssertEqual(preferences.location, "Tel Aviv")
        XCTAssertEqual(preferences.siteColor, "#ed4c57")
        XCTAssertTrue(preferences.hideReReleases)
        XCTAssertEqual(preferences.showtimePreferences.screeningFilters.unchecked.showType, ["VIP"])
        XCTAssertEqual(preferences.showtimePreferences.excludedCinemaIds, ["cinema-1"])
        let requests = await transport.capturedRequests()
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.headers["Authorization"], "Bearer opaque-session-token")
        XCTAssertEqual(request.headers["X-Kartiseret-Account-Id"], "user-1")
        XCTAssertEqual(request.url.path, "/api/v1/preferences/initialize")
    }

    @MainActor
    func testExpiredAccountSessionClearsPrivatePreferencesAndStoredCredential() async throws {
        let previousColor = UserDefaults.standard.string(forKey: "kartiseret.account.siteColor")
        defer {
            if let previousColor { UserDefaults.standard.set(previousColor, forKey: "kartiseret.account.siteColor") }
            else { UserDefaults.standard.removeObject(forKey: "kartiseret.account.siteColor") }
        }
        let preferences = ##"{"data":{"ratingSources":["tmdbRating"],"location":"Tel Aviv","siteColor":"#ed4c57","hideReReleases":true,"showtimePreferences":{"screeningFilters":{"version":3,"unchecked":{"showType":[],"screenFormat":[],"screeningTech":[],"dubLanguage":[]}},"excludedCinemaIds":["cinema-1"]}},"error":null}"##
        let transport = StubTransport(responses: [
            httpResponse(#"{"token":null,"user":{"id":"user-1","email":"person@example.com"}}"#, headers: ["set-auth-token": "opaque-session-token"]),
            httpResponse(#"{"data":{"user":{"id":"user-1","email":"person@example.com"},"isAdmin":false},"error":null}"#),
            httpResponse(preferences),
            httpResponse(#"{"data":{"preferences":[],"nextCursor":null},"error":null}"#),
            httpResponse("", statusCode: 401),
        ])
        let credentials = MemorySessionCredentialStore()
        let store = AccountStore(
            api: NativeAccountAPI(baseURL: URL(string: "https://seret.site")!, transport: transport),
            credentials: credentials
        )

        try await store.signIn(email: "person@example.com", password: "passphrase", fallbackLocation: "Jerusalem")
        XCTAssertEqual(store.preferences.location, "Tel Aviv")
        XCTAssertEqual(UserDefaults.standard.string(forKey: "kartiseret.account.siteColor"), "#ed4c57")

        do {
            _ = try await store.requestPrivate(path: "/api/v1/account", method: "GET", as: AccountData.self)
            XCTFail("Expected the expired bearer session to be rejected")
        } catch let error as APIClientError {
            XCTAssertEqual(error.localizedDescription, APIClientError.unauthorized.localizedDescription)
        }

        XCTAssertEqual(store.state, .guest)
        XCTAssertNil(store.identity)
        XCTAssertNil(credentials.read())
        XCTAssertEqual(store.preferences.location, AccountPreferences().location)
        XCTAssertEqual(store.preferences.ratingSources, AccountPreferences().ratingSources)
        XCTAssertFalse(store.preferences.hideReReleases)
        XCTAssertNil(UserDefaults.standard.string(forKey: "kartiseret.account.siteColor"))
    }

    @MainActor
    func testUnavailableStoredSessionCanBeRetried() async throws {
        let previousColor = UserDefaults.standard.string(forKey: "kartiseret.account.siteColor")
        defer {
            if let previousColor { UserDefaults.standard.set(previousColor, forKey: "kartiseret.account.siteColor") }
            else { UserDefaults.standard.removeObject(forKey: "kartiseret.account.siteColor") }
        }
        let preferences = ##"{"data":{"ratingSources":["imdbRating"],"location":"Jerusalem","siteColor":"#a66ae3","hideReReleases":false,"showtimePreferences":{"screeningFilters":{"version":3,"unchecked":{"showType":[],"screenFormat":[],"screeningTech":[],"dubLanguage":[]}},"excludedCinemaIds":[]}},"error":null}"##
        let transport = StubTransport(responses: [
            httpResponse("", statusCode: 503),
            httpResponse(#"{"data":{"user":{"id":"user-1","email":"person@example.com"},"isAdmin":false},"error":null}"#),
            httpResponse(preferences),
            httpResponse(#"{"data":{"preferences":[],"nextCursor":null},"error":null}"#),
        ])
        let credentials = MemorySessionCredentialStore()
        try credentials.save("stored-session-token")
        let store = AccountStore(
            api: NativeAccountAPI(baseURL: URL(string: "https://seret.site")!, transport: transport),
            credentials: credentials
        )

        await store.restore(fallbackLocation: "Jerusalem")
        guard case .unavailable = store.state else { return XCTFail("Expected a recoverable network error") }
        await store.restore(fallbackLocation: "Jerusalem")

        XCTAssertEqual(store.state, .signedIn)
        XCTAssertEqual(store.identity?.id, "user-1")
        XCTAssertEqual(store.preferences.location, "Jerusalem")
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

private final class MemorySessionCredentialStore: SessionCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var credential: String?

    func read() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return credential
    }

    func save(_ credential: String) throws {
        lock.lock()
        defer { lock.unlock() }
        self.credential = credential
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        credential = nil
    }
}

private func httpResponse(_ string: String, statusCode: Int = 200, headers: [String: String] = [:]) -> APIHTTPResponse {
    APIHTTPResponse(statusCode: statusCode, headers: headers, body: Data(string.utf8))
}

private func makeMovie(id: String = "1", title: String = "Sample", year: Int = 2026) -> Movie {
    Movie(tmdbId: id, title: title, year: year, releaseDate: nil, genres: [], runtime: 90)
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
