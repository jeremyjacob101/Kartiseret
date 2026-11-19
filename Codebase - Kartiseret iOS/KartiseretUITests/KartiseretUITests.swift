import XCTest

@MainActor
final class KartiseretUITests: XCTestCase {
    func testNowPlayingDetailCanChangeCityAndDay() {
        let app = launchFixture()
        let movie = app.buttons["movie.9100001"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))
        movie.tap()

        XCTAssertTrue(app.staticTexts["movie.details.title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.descendants(matching: .any)["IMDb rating 8.1"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["booking.9100001.1830"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["movie.ticketAlert"].exists)
        assertHorizontallyContained(app.buttons["selectedCityButton"], in: app)
        assertHorizontallyContained(app.buttons["selectedDayButton"], in: app)
        assertHorizontallyContained(app.buttons["booking.9100001.1830"], in: app)
        app.buttons["selectedCityButton"].tap()
        app.buttons["city.tel-aviv"].tap()
        app.buttons["day.next"].tap()

        XCTAssertTrue(app.staticTexts["Tel Aviv Screens"].waitForExistence(timeout: 5))
    }

    func testComingSoonMovieOpensDetailWithCityAndDayControls() {
        let app = launchFixture()
        app.buttons["discover.comingSoon"].tap()
        let movie = app.buttons["movie.9100101"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))
        movie.tap()

        XCTAssertTrue(app.staticTexts["movie.details.title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["selectedCityButton"].exists)
        app.buttons["day.next"].tap()
        XCTAssertTrue(app.staticTexts["Future Cinema"].waitForExistence(timeout: 5))
    }

    func testAllShowtimesOpensMovieDetails() {
        let app = launchFixture()
        app.tabBars.buttons["Showtimes"].tap()
        let movie = app.buttons["showtimes.movie.link.9100001"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))
        movie.tap()

        XCTAssertTrue(app.staticTexts["movie.details.title"].waitForExistence(timeout: 5))
    }

    func testAllShowtimesCanChangeCityAndDay() {
        let app = launchFixture()
        app.tabBars.buttons["Showtimes"].tap()
        XCTAssertTrue(app.buttons["selectedCityButton"].waitForExistence(timeout: 5))

        app.buttons["selectedCityButton"].tap()
        app.buttons["city.tel-aviv"].tap()
        app.buttons["day.next"].tap()

        XCTAssertTrue(app.staticTexts["Tel Aviv Screens"].waitForExistence(timeout: 5))
    }

    func testCatalogPostersStayWithinPhoneWidth() {
        let app = launchFixture()
        app.buttons["discover.nowPlaying"].tap()

        let movie = app.buttons["movie.9100001"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))
        assertHorizontallyContained(movie, in: app)
        let title = app.staticTexts["movie.title.9100001"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(title.frame.height, 30, "Catalog titles should reserve a two-line title slot")
        XCTAssertFalse(app.descendants(matching: .any)["IMDb rating 8.1"].exists)
    }

    func testHomeMovieShelvesReserveTwoLineTitlesWithoutRatings() {
        let app = launchFixture()
        let movie = app.buttons["movie.9100001"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))

        let title = app.staticTexts["movie.title.9100001"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(title.frame.height, 30, "Home shelf titles should reserve a two-line title slot")
        XCTAssertFalse(app.descendants(matching: .any)["IMDb rating 8.1"].exists)
    }

    func testBookingActionOpensTheSelectedFixtureLink() {
        let app = launchFixture()
        app.tabBars.buttons["Showtimes"].tap()
        let booking = app.buttons["booking.9100001.1830"]
        XCTAssertTrue(booking.waitForExistence(timeout: 5))
        booking.tap()

        XCTAssertTrue(app.staticTexts["booking.opened"].waitForExistence(timeout: 5))
    }

    func testHelpTabShowsPrivacyAndSupportLinks() {
        let app = launchFixture()
        app.tabBars.buttons["You"].tap()
        app.buttons["account.help"].tap()

        let supportLink = app.descendants(matching: .any)["help.support"].firstMatch
        let privacyLink = app.descendants(matching: .any)["help.privacyPolicy"].firstMatch
        XCTAssertTrue(supportLink.waitForExistence(timeout: 5))
        XCTAssertTrue(privacyLink.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Support"].exists)
        XCTAssertTrue(app.staticTexts["Privacy Policy"].exists)
    }

    func testCinemathequesShowsUpcomingProgrammeAndCinemaPage() {
        let app = launchFixture()
        app.tabBars.buttons["Cinematheques"].tap()

        let cinema = app.buttons["cinematheques.cinema.smBcm2HtRvQA"]
        XCTAssertTrue(cinema.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Fixture Feature"].exists)
        cinema.tap()
        XCTAssertTrue(app.staticTexts["Upcoming showtimes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["View on map"].exists)
    }

    func testShowtimeFilterSheetProvidesSavedFilterGroups() {
        let app = launchFixture()
        app.tabBars.buttons["Showtimes"].tap()
        app.buttons["showtimes.filters"].tap()

        XCTAssertTrue(app.staticTexts["Showtime filters"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Show type"].exists)
        app.swipeUp()
        XCTAssertTrue(app.staticTexts["Jerusalem cinemas"].exists)
        app.buttons["Done"].tap()
    }

    private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FixtureMode", "-ResetPreferences"]
        app.launch()
        return app
    }

    private func assertHorizontallyContained(
        _ element: XCUIElement,
        in app: XCUIApplication,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let elementFrame = element.frame
        let windowFrame = app.windows.firstMatch.frame
        XCTAssertTrue(elementFrame.width > 0, "Expected the UI element to be laid out", file: file, line: line)
        XCTAssertGreaterThanOrEqual(elementFrame.minX, windowFrame.minX - 0.5, file: file, line: line)
        XCTAssertLessThanOrEqual(elementFrame.maxX, windowFrame.maxX + 0.5, file: file, line: line)
    }
}
