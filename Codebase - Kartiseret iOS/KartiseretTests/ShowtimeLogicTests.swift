import XCTest
@testable import Kartiseret

final class ShowtimeLogicTests: XCTestCase {
    func testGroupingDeduplicatesAndPreservesTicketURL() throws {
        let instant = localDate(2026, 8, 10, 12, 0)
        let url = URL(string: "https://example.com/ticket")!
        let first = record(theater: "Cinema City", time: "20:00", url: url)
        let duplicate = record(theater: "Cinema City", time: "20:00", url: nil)
        let grouped = ShowtimeGrouper.group(records: [first, duplicate], now: instant)
        let entries = try XCTUnwrap(grouped["42"]?.first?.theaters.first?.showtimes)
        XCTAssertEqual(entries.count, 1)
        XCTAssertEqual(entries.first?.ticketURL, url)
    }

    func testTheaterAndCarryoverOrdering() throws {
        let instant = localDate(2026, 8, 10, 12, 0)
        let records = [
            record(theater: "Cinema City", time: "00:30"),
            record(theater: "Yes Planet", time: "23:45"),
            record(theater: "Yes Planet", time: "18:00")
        ]
        let day = try XCTUnwrap(ShowtimeGrouper.group(records: records, now: instant)["42"]?.first)
        XCTAssertEqual(day.theaters.map(\.theater), ["Yes Planet", "Cinema City"])
        XCTAssertEqual(day.theaters.first?.showtimes.map(\.time), ["18:00", "23:45"])
        XCTAssertEqual(day.theaters.last?.showtimes.map(\.time), ["00:30"])
    }

    func testExactFilterCanonicalization() {
        let entry = ShowtimeEntry(
            time: "20:00", ticketURL: nil,
            screeningTechnology: "IMAX / Atmos 3D", screeningType: "VIP Light + Business", dubLanguage: "Hebrew"
        )
        let meta = ShowtimeFilterEngine.canonicalMetadata(for: entry)
        XCTAssertEqual(meta.screenFormat, "3D")
        XCTAssertEqual(meta.screeningTechnologies, ["IMAX", "Atmos"])
        XCTAssertTrue(meta.showTypes.isSuperset(of: ["VIP", "VIP Light"]))
        XCTAssertEqual(meta.dubLanguage, "Hebrew")
        XCTAssertTrue(ShowtimeFilterEngine.matches(entry, filters: .all))
        var filters = ShowtimeFilterState.all
        filters.set("Hebrew", in: .dubLanguage, enabled: false)
        XCTAssertFalse(ShowtimeFilterEngine.matches(entry, filters: filters))
    }

    func testCinemaDayCutoffAndGracePeriod() {
        XCTAssertEqual(CinemaClock.cinemaDay(for: localDate(2026, 8, 10, 1, 4)), "2026-08-09")
        XCTAssertEqual(CinemaClock.cinemaDay(for: localDate(2026, 8, 10, 1, 5)), "2026-08-10")
        XCTAssertTrue(CinemaClock.shouldInclude(cinemaDay: "2026-08-10", showtime: "12:00", at: localDate(2026, 8, 10, 12, 15)))
        XCTAssertFalse(CinemaClock.shouldInclude(cinemaDay: "2026-08-10", showtime: "12:00", at: localDate(2026, 8, 10, 12, 16)))
    }

    func testPostMidnightCarryoverAndDSTBoundaryDates() {
        XCTAssertEqual(CinemaClock.effectiveDate(cinemaDay: "2026-08-10", showtime: "00:45"), "2026-08-11")
        XCTAssertEqual(CinemaClock.sortValue(for: "00:45"), 1_485)
        XCTAssertTrue(CinemaClock.shouldInclude(cinemaDay: "2026-08-10", showtime: "00:45", at: localDate(2026, 8, 11, 0, 59)))
        XCTAssertFalse(CinemaClock.shouldInclude(cinemaDay: "2026-08-10", showtime: "00:45", at: localDate(2026, 8, 11, 1, 1)))

        XCTAssertEqual(CinemaClock.cinemaDay(for: localDate(2026, 3, 27, 0, 30)), "2026-03-26")
        XCTAssertEqual(CinemaClock.cinemaDay(for: localDate(2026, 10, 25, 1, 30)), "2026-10-25")
    }

    private func record(theater: String, time: String, url: URL? = nil) -> ShowtimeRecord {
        ShowtimeRecord(
            tmdbID: "42", city: "Jerusalem", date: "2026-08-10", theater: theater,
            entry: ShowtimeEntry(time: time, ticketURL: url, screeningTechnology: "2D", screeningType: "Regular", dubLanguage: nil)
        )
    }

    private func localDate(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        CinemaClock.calendar().date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }
}
