import Foundation

enum ShowtimeLinkCodec {
    static let urlAlphabet = Array("1iljIt23457fkrsvxyzFJLT0689abcdeghnopquABCDEGHKNOPQRSUVXYZmwMW")
    static let dateAlphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    static let currentCityCode: Character = "1"
    static let allFiltersShortcut: Character = "j"
    static let editMarker: Character = "i"
    static let filterMaskWidth = 4
    static let filterBitCount = 20
    static let dateWindowCount = 62

    static let cityByCode: [Character: String] = [
        "i": "Jerusalem", "l": "Tel Aviv", "j": "Glilot", "I": "Modiin", "t": "Herziliya",
        "2": "Afula", "3": "Ashdod", "4": "Ashkelon", "5": "Ayalon", "7": "Beer Sheva",
        "f": "Carmiel", "k": "Chadera", "r": "Even Yehuda", "s": "Givatayim", "v": "Haifa",
        "x": "Kfar Saba", "y": "Kiryat Bialik", "z": "Kiryat Ono", "F": "Nahariya",
        "J": "Netanya", "L": "Omer", "T": "Petach Tikvah", "0": "Raanana",
        "6": "Ramat Hasharon", "8": "Rehovot", "9": "Rishon Letzion",
        "a": "Zichron Yaakov", "b": "Holon"
    ]

    static var cityCodeByName: [String: Character] {
        Dictionary(uniqueKeysWithValues: cityByCode.map { ($0.value, $0.key) })
    }

    enum RouteMode: Sendable { case share, edit }
    enum ParsedRoute: Equatable, Sendable {
        case plain(movieCode: String)
        case encoded(movieCode: String, cityCode: Character, dateCode: Character, filterMask: Int, mode: RouteMode, usedShortcut: Bool)
    }

    struct ShareState: Equatable, Sendable {
        var movieCode: String
        var city: String
        var date: String
        var filters: ShowtimeFilterState
    }

    private struct BitAssignment: Sendable {
        var bit: Int
        var group: ShowtimeFilterGroup
        var value: String
    }

    private static let assignments: [BitAssignment] = [
        .init(bit: 0, group: .showType, value: "Not Just Cinema"),
        .init(bit: 1, group: .showType, value: "Premium"),
        .init(bit: 2, group: .showType, value: "Lounge"),
        .init(bit: 3, group: .showType, value: "Prime"),
        .init(bit: 4, group: .showType, value: "Upgrade"),
        .init(bit: 5, group: .showType, value: "VIP Light"),
        .init(bit: 6, group: .showType, value: "VIP"),
        .init(bit: 7, group: .screeningTechnology, value: "4DX"),
        .init(bit: 8, group: .screeningTechnology, value: "ScreenX"),
        .init(bit: 9, group: .screeningTechnology, value: "ONYX"),
        .init(bit: 10, group: .screeningTechnology, value: "Atmos"),
        .init(bit: 11, group: .screeningTechnology, value: "HFR"),
        .init(bit: 12, group: .screenFormat, value: "3D"),
        .init(bit: 13, group: .dubLanguage, value: "French"),
        .init(bit: 14, group: .dubLanguage, value: "Hebrew"),
        .init(bit: 15, group: .screeningTechnology, value: "IMAX"),
        .init(bit: 16, group: .dubLanguage, value: "Original"),
        .init(bit: 17, group: .screenFormat, value: "2D"),
        .init(bit: 18, group: .screeningTechnology, value: "Standard"),
        .init(bit: 19, group: .showType, value: "Regular")
    ]

    static func encodeDate(_ isoDate: String) -> Character? {
        let parts = isoDate.split(separator: "-")
        guard parts.count == 3, let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day)),
              calendar.component(.year, from: date) == year,
              calendar.component(.month, from: date) == month,
              calendar.component(.day, from: date) == day else { return nil }
        let epoch = calendar.startOfDay(for: Date(timeIntervalSince1970: 0))
        let epochDay = calendar.dateComponents([.day], from: epoch, to: date).day ?? 0
        let index = ((epochDay % dateAlphabet.count) + dateAlphabet.count) % dateAlphabet.count
        return dateAlphabet[index]
    }

    static func decodeDate(_ code: Character, today: String) -> String? {
        guard dateAlphabet.contains(code), CinemaClock.date(fromISO: today) != nil else { return nil }
        for offset in 0..<dateWindowCount {
            guard let candidate = CinemaClock.addingDays(offset, to: today) else { continue }
            if encodeDate(candidate) == code { return candidate }
        }
        return nil
    }

    static func encodeBase62(_ value: Int, width: Int) -> String? {
        guard value >= 0, width > 0 else { return nil }
        let capacity = Int(pow(Double(urlAlphabet.count), Double(width)))
        guard value < capacity else { return nil }
        var remaining = value
        var digits = Array(repeating: urlAlphabet[0], count: width)
        for index in stride(from: width - 1, through: 0, by: -1) {
            digits[index] = urlAlphabet[remaining % urlAlphabet.count]
            remaining /= urlAlphabet.count
        }
        return String(digits)
    }

    static func decodeBase62(_ value: String) -> Int? {
        guard !value.isEmpty else { return nil }
        var decoded = 0
        for character in value {
            guard let index = urlAlphabet.firstIndex(of: character) else { return nil }
            let (product, overflow1) = decoded.multipliedReportingOverflow(by: urlAlphabet.count)
            let (sum, overflow2) = product.addingReportingOverflow(index)
            guard !overflow1, !overflow2 else { return nil }
            decoded = sum
        }
        return decoded
    }

    static func filterMask(for state: ShowtimeFilterState) -> Int {
        var mask = 0
        for assignment in assignments where !state.contains(assignment.value, in: assignment.group) {
            mask |= 1 << assignment.bit
        }
        return mask
    }

    static func filters(from mask: Int) -> ShowtimeFilterState? {
        guard mask >= 0, mask < (1 << filterBitCount) else { return nil }
        var state = ShowtimeFilterState.all
        for assignment in assignments where mask & (1 << assignment.bit) != 0 {
            state.set(assignment.value, in: assignment.group, enabled: false)
        }
        return state
    }

    static func encodeRoute(
        movieCode: String,
        cityCode: Character,
        dateCode: Character,
        filterMask: Int,
        mode: RouteMode = .share
    ) -> String? {
        guard movieCode.range(of: "^[0-9A-Za-z]{3}$", options: .regularExpression) != nil,
              cityCode == currentCityCode || cityByCode[cityCode] != nil,
              dateAlphabet.contains(dateCode),
              filterMask >= 0, filterMask < (1 << filterBitCount) else { return nil }
        let filterCode = filterMask == 0 ? String(allFiltersShortcut) : encodeBase62(filterMask, width: filterMaskWidth)
        guard let filterCode else { return nil }
        return movieCode + String(cityCode) + String(dateCode) + filterCode + (mode == .edit ? String(editMarker) : "")
    }

    static func parseRoute(_ value: String) -> ParsedRoute? {
        let characters = Array(value)
        if characters.count == 3 {
            return value.range(of: "^[0-9A-Za-z]{3}$", options: .regularExpression) != nil ? .plain(movieCode: value) : nil
        }
        guard [6, 7, 9, 10].contains(characters.count) else { return nil }
        let movieCode = String(characters[0...2])
        let cityCode = characters[3]
        let dateCode = characters[4]
        guard movieCode.range(of: "^[0-9A-Za-z]{3}$", options: .regularExpression) != nil,
              cityCode == currentCityCode || cityByCode[cityCode] != nil,
              dateAlphabet.contains(dateCode) else { return nil }
        let shortcut = characters.count == 6 || characters.count == 7
        let mode: RouteMode = (characters.count == 7 || characters.count == 10) ? .edit : .share
        if shortcut {
            guard characters[5] == allFiltersShortcut,
                  mode != .edit || characters[6] == editMarker else { return nil }
            return .encoded(movieCode: movieCode, cityCode: cityCode, dateCode: dateCode, filterMask: 0, mode: mode, usedShortcut: true)
        }
        if mode == .edit, characters[9] != editMarker { return nil }
        let maskText = String(characters[5...8])
        guard let mask = decodeBase62(maskText), mask < (1 << filterBitCount) else { return nil }
        return .encoded(movieCode: movieCode, cityCode: cityCode, dateCode: dateCode, filterMask: mask, mode: mode, usedShortcut: false)
    }

    static func shareURL(for state: ShareState, origin: URL = KartiseretConstants.siteOrigin) -> URL? {
        guard let cityCode = cityCodeByName[state.city],
              let dateCode = encodeDate(state.date),
              let route = encodeRoute(
                movieCode: state.movieCode,
                cityCode: cityCode,
                dateCode: dateCode,
                filterMask: filterMask(for: state.filters)
              ) else { return nil }
        return origin.appending(path: route)
    }

    static func movieURL(for movie: Movie) -> URL? {
        guard let code = movie.movieCode,
              code.range(of: "^[0-9A-Za-z]{3}$", options: .regularExpression) != nil else { return nil }
        return KartiseretConstants.siteOrigin.appending(path: code)
    }

    static func resolvedCity(code: Character, currentCity: String) -> String? {
        code == currentCityCode ? currentCity : cityByCode[code]
    }
}
