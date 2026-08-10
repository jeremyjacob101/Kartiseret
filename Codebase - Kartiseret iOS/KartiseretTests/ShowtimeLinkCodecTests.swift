import XCTest
@testable import Kartiseret

final class ShowtimeLinkCodecTests: XCTestCase {
    func testWebCompatibleDateAndBase62Fixtures() {
        XCTAssertEqual(ShowtimeLinkCodec.encodeDate("2026-08-10"), "D")
        XCTAssertEqual(ShowtimeLinkCodec.encodeDate("2026-08-11"), "E")
        XCTAssertEqual(ShowtimeLinkCodec.encodeBase62(0, width: 4), "1111")
        XCTAssertEqual(ShowtimeLinkCodec.encodeBase62(42, width: 4), "111D")
        XCTAssertEqual(ShowtimeLinkCodec.encodeBase62(524_288, width: 4), "lk6x")
        XCTAssertEqual(ShowtimeLinkCodec.decodeBase62("I6Oe"), 1_048_575)
    }

    func testWebCompatibleShareURLAndRoundTrip() throws {
        let state = ShowtimeLinkCodec.ShareState(
            movieCode: "K1A", city: "Jerusalem", date: "2026-08-10", filters: .all
        )
        let url = try XCTUnwrap(ShowtimeLinkCodec.shareURL(for: state))
        XCTAssertEqual(url.absoluteString, "https://seret.site/K1AiDj")
        XCTAssertEqual(ShowtimeLinkCodec.parseRoute("K1AiDj"), .encoded(movieCode: "K1A", cityCode: "i", dateCode: "D", filterMask: 0, mode: .share, usedShortcut: true))
    }

    func testFilterMaskRoundTrip() throws {
        var filters = ShowtimeFilterState.all
        filters.set("VIP", in: .showType, enabled: false)
        filters.set("IMAX", in: .screeningTechnology, enabled: false)
        filters.set("Hebrew", in: .dubLanguage, enabled: false)
        let mask = ShowtimeLinkCodec.filterMask(for: filters)
        XCTAssertEqual(mask, (1 << 6) | (1 << 15) | (1 << 14))
        XCTAssertEqual(try XCTUnwrap(ShowtimeLinkCodec.filters(from: mask)), filters)
        let route = try XCTUnwrap(ShowtimeLinkCodec.encodeRoute(movieCode: "Ab3", cityCode: "l", dateCode: "D", filterMask: mask))
        guard case .encoded(let code, let city, let date, let decodedMask, _, _) = ShowtimeLinkCodec.parseRoute(route) else {
            return XCTFail("Expected encoded route")
        }
        XCTAssertEqual(code, "Ab3")
        XCTAssertEqual(city, "l")
        XCTAssertEqual(date, "D")
        XCTAssertEqual(decodedMask, mask)
    }

    func testRejectsMalformedRoutes() {
        XCTAssertNil(ShowtimeLinkCodec.parseRoute("bad-route"))
        XCTAssertNil(ShowtimeLinkCodec.parseRoute("A!1"))
        XCTAssertNil(ShowtimeLinkCodec.encodeRoute(movieCode: "long", cityCode: "i", dateCode: "D", filterMask: 0))
    }
}
