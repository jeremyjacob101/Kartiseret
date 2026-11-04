import XCTest

@MainActor
final class KartiseretUITests: XCTestCase {
    func testNowPlayingDetailCanChangeCityAndDay() {
        let app = launchFixture()
        let movie = app.buttons["movie.9100001"]
        XCTAssertTrue(movie.waitForExistence(timeout: 5))
        movie.tap()

        XCTAssertTrue(app.staticTexts["movie.details.title"].waitForExistence(timeout: 5))
        app.buttons["selectedCityButton"].tap()
        app.buttons["city.tel-aviv"].tap()
        app.buttons["day.next"].tap()

        XCTAssertTrue(app.staticTexts["Tel Aviv Screens"].waitForExistence(timeout: 5))
    }

    func testComingSoonMovieOpensDetailWithCityAndDayControls() {
        let app = launchFixture()
        app.tabBars.buttons["Coming Soon"].tap()
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

    func testBookingActionOpensTheSelectedFixtureLink() {
        let app = launchFixture()
        app.tabBars.buttons["Showtimes"].tap()
        let booking = app.buttons["booking.9100001"]
        XCTAssertTrue(booking.waitForExistence(timeout: 5))
        booking.tap()

        XCTAssertTrue(app.staticTexts["booking.opened"].waitForExistence(timeout: 5))
    }

    private func launchFixture() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-FixtureMode", "-ResetPreferences"]
        app.launch()
        return app
    }
}
