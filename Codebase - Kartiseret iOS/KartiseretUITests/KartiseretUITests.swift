import XCTest

@MainActor
final class KartiseretUITests: XCTestCase {
    private func launchApp(
        language: String = "(en)",
        locale: String = "en_US",
        extraArguments: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-FixtureMode", "-AppleLanguages", language, "-AppleLocale", locale]
            + extraArguments
        app.launch()
        return app
    }

    private func setSwitch(_ toggle: XCUIElement, enabled: Bool) {
        let expectedValue = enabled ? "1" : "0"
        guard toggle.value as? String != expectedValue else { return }
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, expectedValue)
    }

    private func tab(_ title: String, in app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func activateMovieSearch(in app: XCUIApplication) -> XCUIElement {
        let field = app.searchFields.firstMatch
        if !field.waitForExistence(timeout: 1) {
            let searchButton = app.buttons.matching(
                NSPredicate(format: "label == %@", "Search")
            ).firstMatch
            XCTAssertTrue(searchButton.waitForExistence(timeout: 3))
            searchButton.tap()
        }
        return field
    }

    private func dismissPasswordSavePrompts(in app: XCUIApplication) {
        for _ in 0..<3 {
            let notNow = app.buttons["Not Now"]
            guard notNow.waitForExistence(timeout: 1) else { return }
            notNow.tap()
        }
    }

    func testLaunchesAndVisitsAllFiveTabs() {
        let app = launchApp()
        XCTAssertTrue(tab("Home", in: app).waitForExistence(timeout: 5))
        for title in ["Now Playing", "Showtimes", "Coming Soon", "Settings", "Home"] {
            let destination = tab(title, in: app)
            destination.tap()
            XCTAssertTrue(destination.isSelected)
        }
    }

    func testSearchOpensMovieDetailAndTrailerPresentation() {
        let app = launchApp()
        let search = activateMovieSearch(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Quiet Horizon")
        let result = app.descendants(matching: .any)["search.result.101"]
        XCTAssertTrue(result.waitForExistence(timeout: 3))
        result.tap()
        XCTAssertTrue(app.buttons["detail.trailer"].waitForExistence(timeout: 3))
        app.buttons["detail.trailer"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["fixture.browser"].waitForExistence(timeout: 3))
    }

    func testCitySelectionAndLocationDeniedState() {
        let app = launchApp(extraArguments: ["-LocationDenied"])
        tab("Showtimes", in: app).tap()
        app.buttons["showtimes.cityPicker"].tap()

        let useLocation = app.buttons["city.useLocation"]
        XCTAssertTrue(useLocation.waitForExistence(timeout: 3))
        useLocation.tap()
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Location access is denied")
            ).firstMatch.waitForExistence(timeout: 3)
        )

        let search = app.searchFields["Search supported cities"]
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("Tel Aviv")
        let telAviv = app.descendants(matching: .any)["city.option.Tel Aviv"]
        XCTAssertTrue(telAviv.waitForExistence(timeout: 3))
        telAviv.tap()
        XCTAssertTrue(app.staticTexts["Tel Aviv"].exists)
    }

    func testFiltersCanCreateAndClearEmptyState() {
        let app = launchApp()
        tab("Showtimes", in: app).tap()
        XCTAssertTrue(app.buttons["showtimes.filters"].waitForExistence(timeout: 5))
        app.buttons["showtimes.filters"].tap()
        let format = app.buttons["Format"]
        XCTAssertTrue(format.waitForExistence(timeout: 3))
        format.tap()
        let twoD = app.switches["2D"]
        let threeD = app.switches["3D"]
        XCTAssertTrue(twoD.waitForExistence(timeout: 3))
        XCTAssertTrue(threeD.waitForExistence(timeout: 3))
        setSwitch(twoD, enabled: false)
        setSwitch(threeD, enabled: false)
        app.buttons["Done"].tap()
        XCTAssertTrue(app.staticTexts["No showtimes match"].waitForExistence(timeout: 3))
    }

    func testDateSelectionAndTicketLinkPresentation() {
        let app = launchApp()
        tab("Showtimes", in: app).tap()

        let dateButtons = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "showtime.date.")
        )
        XCTAssertTrue(dateButtons.firstMatch.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(dateButtons.count, 1)
        let nextDate = dateButtons.element(boundBy: 1)
        nextDate.tap()
        XCTAssertTrue(nextDate.isSelected)

        let movie = app.descendants(matching: .any)["showtimes.movie.201"]
        XCTAssertTrue(movie.waitForExistence(timeout: 4))
        movie.tap()

        let ticket = app.buttons["showtime.17:20"]
        for _ in 0..<6 where !ticket.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(ticket.isHittable)
        ticket.tap()
        XCTAssertTrue(app.descendants(matching: .any)["fixture.browser"].waitForExistence(timeout: 3))
    }

    func testMovieSharingPresentation() {
        let app = launchApp()
        let search = activateMovieSearch(in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Quiet Horizon")
        let result = app.descendants(matching: .any)["search.result.101"]
        XCTAssertTrue(result.waitForExistence(timeout: 3))
        result.tap()

        let share = app.buttons["detail.share"]
        XCTAssertTrue(share.waitForExistence(timeout: 3))
        share.tap()
        let shareSheetPresented = app.sheets.firstMatch.waitForExistence(timeout: 3)
            || app.popovers.firstMatch.waitForExistence(timeout: 1)
        XCTAssertTrue(shareSheetPresented)
    }

    func testCreateAccountPasswordValidation() {
        let app = launchApp()
        tab("Settings", in: app).tap()
        app.buttons["settings.createAccount"].tap()
        XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 3))
        app.textFields["auth.email"].tap()
        app.textFields["auth.email"].typeText("new@example.com")
        app.secureTextFields["auth.password"].tap()
        app.secureTextFields["auth.password"].typeText("short")
        app.buttons["auth.submit"].tap()
        XCTAssertTrue(
            app.staticTexts["Use at least 8 characters for your password."].waitForExistence(timeout: 2)
        )
    }

    func testLandscapeLayoutKeepsPrimaryNavigationReachable() {
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = launchApp()
        XCTAssertTrue(tab("Home", in: app).waitForExistence(timeout: 5))
        tab("Now Playing", in: app).tap()
        XCTAssertTrue(app.navigationBars["Now Playing"].waitForExistence(timeout: 3))
    }

    func testAccessibilityDynamicTypeLaunch() {
        let app = launchApp(extraArguments: [
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"
        ])
        XCTAssertTrue(tab("Home", in: app).waitForExistence(timeout: 5))
        tab("Settings", in: app).tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["settings.login"].waitForExistence(timeout: 3))
    }

    func testRightToLeftLayoutMirrorsTabOrder() {
        let app = launchApp(
            language: "(he)",
            locale: "he_IL",
            extraArguments: ["-NSForceRightToLeftWritingDirection", "YES", "-AppleTextDirection", "YES"]
        )
        let home = tab("Home", in: app)
        let settings = tab("Settings", in: app)
        XCTAssertTrue(home.waitForExistence(timeout: 5))
        XCTAssertTrue(settings.exists)
        XCTAssertGreaterThan(home.frame.midX, settings.frame.midX)
    }

    func testLoginValidationPreferenceAndSignOutFlow() {
        let app = launchApp()
        tab("Settings", in: app).tap()
        app.buttons["settings.login"].tap()
        XCTAssertTrue(app.textFields["auth.email"].waitForExistence(timeout: 3))
        app.textFields["auth.email"].tap()
        app.textFields["auth.email"].typeText("invalid")
        app.secureTextFields["auth.password"].tap()
        app.secureTextFields["auth.password"].typeText("password")
        app.buttons["auth.submit"].tap()
        XCTAssertTrue(app.staticTexts["Enter a valid email address."].waitForExistence(timeout: 2))
        app.textFields["auth.email"].tap()
        app.textFields["auth.email"].press(forDuration: 1)
        app.menuItems["Select All"].tap()
        app.typeText("test@example.com")
        app.buttons["auth.submit"].tap()
        dismissPasswordSavePrompts(in: app)
        XCTAssertTrue(app.buttons["settings.signOut"].waitForExistence(timeout: 4))
        dismissPasswordSavePrompts(in: app)

        let orangeAccent = app.buttons["settings.accent.Orange"]
        for _ in 0..<4 where !orangeAccent.isHittable {
            dismissPasswordSavePrompts(in: app)
            app.swipeUp()
        }
        XCTAssertTrue(orangeAccent.isHittable)
        orangeAccent.tap()

        for _ in 0..<4 where !app.buttons["settings.signOut"].isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(app.buttons["settings.signOut"].isHittable)
        app.buttons["settings.signOut"].tap()
        let confirmLogOut = app.sheets.buttons["Log Out"]
        XCTAssertTrue(confirmLogOut.waitForExistence(timeout: 2))
        confirmLogOut.tap()
        XCTAssertTrue(app.buttons["settings.login"].waitForExistence(timeout: 3))
    }
}
