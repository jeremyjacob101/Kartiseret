import Foundation

enum UniversalLinkDestination: Equatable, Sendable {
    case discover
    case catalog(CatalogMode)
    case showtimes
    case city(slug: String)
    case cinematheques
    case account
    case confirmAccountDeletion(token: String)
    case cinema(id: String)
    case movie(UniversalMovieLink)
    case publicRouteCode(String)

    static func parse(_ url: URL) -> UniversalLinkDestination? {
        parse(url, allowPublicRouteCode: true)
    }

    static func parseResolvedPath(_ url: URL) -> UniversalLinkDestination? {
        parse(url, allowPublicRouteCode: false)
    }

    private static func parse(_ url: URL, allowPublicRouteCode: Bool) -> UniversalLinkDestination? {
        guard url.scheme?.lowercased() == "https",
              url.host?.lowercased() == "seret.site",
              url.user == nil,
              url.password == nil,
              url.port == nil,
              url.fragment != "no_universal_links" else { return nil }

        if url.path == "/confirm-account-deletion" {
            guard let fragment = url.fragment,
                  let fields = URLComponents(string: "https://seret.site/?" + fragment)?.queryItems,
                  fields.filter({ $0.name == "token" }).count == 1,
                  let token = fields.first(where: { $0.name == "token" })?.value,
                  !token.isEmpty, token.utf8.count <= 4096,
                  !token.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
            return .confirmAccountDeletion(token: token)
        }
        let segments = url.path.split(separator: "/").map(String.init)
        if segments.isEmpty { return .discover }
        if segments.count == 2,
           segments[0] == "__cinema",
           CinemaIdentity.byID(segments[1]) != nil {
            return .cinema(id: segments[1])
        }
        if segments.count == 2, segments[0] == "showtimes" {
            let slug = segments[1].lowercased()
            guard slug.range(of: #"^[a-z0-9]+(?:-[a-z0-9]+)*$"#, options: .regularExpression) != nil else { return nil }
            return .city(slug: slug)
        }
        guard segments.count == 1, let route = segments.first else { return nil }
        switch route {
        case "movies": return .catalog(.nowPlaying)
        case "soons": return .catalog(.comingSoon)
        case "showtimes": return .showtimes
        case "cinematheques": return .cinematheques
        case "user": return .account
        default:
            if allowPublicRouteCode,
               route.utf8.count == 8,
               route.utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) }) {
                return .publicRouteCode(route)
            }
            guard UniversalMovieLink.isSupportedRouteCode(route) else { return nil }
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            guard query.allSatisfy({ ["date", "excludeCinemas"].contains($0.name) }),
                  Set(query.map(\.name)).count == query.count else { return nil }
            let explicitDate = query.first { $0.name == "date" }?.value
            let excludedCinemaIDs = query.first { $0.name == "excludeCinemas" }?.value
            return .movie(UniversalMovieLink(
                routeCode: route,
                explicitDate: explicitDate,
                excludedCinemaIDs: excludedCinemaIDs
            ))
        }
    }
}

struct UniversalMovieLink: Equatable, Sendable {
    let routeCode: String
    let explicitDate: String?
    let excludedCinemaIDs: String?

    var movieCode: String { String(routeCode.prefix(3)) }
    var isSharedShowtimeLink: Bool { routeCode.count == 6 || routeCode.count == 9 }

    static func citySlug(_ value: String) -> String {
        var result = ""
        var separatorPending = false
        for scalar in value.decomposedStringWithCanonicalMapping.lowercased().unicodeScalars {
            let isLetter = (97...122).contains(scalar.value)
            let isDigit = (48...57).contains(scalar.value)
            if isLetter || isDigit {
                if separatorPending && !result.isEmpty { result.append("-") }
                result.unicodeScalars.append(scalar)
                separatorPending = false
            } else if !result.isEmpty {
                separatorPending = true
            }
        }
        return result
    }

    static func isSupportedRouteCode(_ value: String) -> Bool {
        guard value.unicodeScalars.allSatisfy({
            (48...57).contains($0.value) || (65...90).contains($0.value) || (97...122).contains($0.value)
        }) else { return false }
        if value.count == 3 { return true }
        guard value.count == 6 || value.count == 9 else { return false }
        let characters = Array(value)
        guard let cityCode = characters[safe: 3], cityCode == "1" || cityNames[cityCode] != nil,
              let dateCode = characters[safe: 4], dateAlphabet.contains(dateCode) else { return false }
        if value.count == 6 { return characters[safe: 5] == "j" }
        return decodeFilterMask(String(characters[5...8])) != nil
    }

    func sharedContext(fallbackCity: String, today: CinemaDay) -> SharedShowtimeLinkContext? {
        guard isSharedShowtimeLink else { return nil }
        let characters = Array(routeCode)
        guard let cityCode = characters[safe: 3], let dateCode = characters[safe: 4],
              cityCode == "1" || Self.cityNames[cityCode] != nil else { return nil }

        let city = cityCode == "1" ? fallbackCity : Self.cityNames[cityCode]!
        let mask = routeCode.count == 6 ? 0 : Self.decodeFilterMask(String(characters[5...8]))
        guard let mask else { return nil }

        let decodedDate = Self.decodeDateCode(dateCode, today: today)
        let requestedDate = explicitDate.flatMap(CinemaDay.init(isoDate:)) ?? decodedDate
        guard var day = requestedDate else { return nil }
        if day < today { day = today }
        let lastSelectableDay = today.addingDays(ShowtimeLogic.maximumDayOffset)
        if day > lastSelectableDay { day = lastSelectableDay }

        let rawExcludedIDs = excludedCinemaIDs ?? ""
        let excludedIDs = rawExcludedIDs.utf16.count <= 2_000
            ? rawExcludedIDs.split(separator: ",").map(String.init).filter { CinemaIdentity.byID($0) != nil }
            : []
        return SharedShowtimeLinkContext(
            city: city,
            day: day,
            filterMask: mask,
            excludedCinemaIDs: Array(Set(excludedIDs)).sorted(),
            wasDateAdjusted: requestedDate != day
        )
    }

    private static let dateAlphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    private static let urlAlphabet = Array("1iljIt23457fkrsvxyzFJLT0689abcdeghnopquABCDEGHKNOPQRSUVXYZmwMW")
    private static let cityNames: [Character: String] = [
        "i": "Jerusalem", "l": "Tel Aviv", "j": "Glilot", "I": "Modiin", "t": "Herziliya",
        "2": "Afula", "3": "Ashdod", "4": "Ashkelon", "5": "Ayalon", "c": "Bat Yam",
        "7": "Beer Sheva", "f": "Carmiel", "k": "Chadera", "r": "Even Yehuda", "s": "Givatayim",
        "v": "Haifa", "x": "Kfar Saba", "y": "Kiryat Bialik", "z": "Kiryat Ono", "F": "Nahariya",
        "J": "Netanya", "L": "Omer", "T": "Petach Tikvah", "0": "Raanana", "6": "Ramat Hasharon",
        "8": "Rehovot", "9": "Rishon Letzion", "a": "Zichron Yaakov", "b": "Holon"
    ]
    private static func decodeDateCode(_ code: Character, today: CinemaDay) -> CinemaDay? {
        var utcCalendar = Calendar(identifier: .gregorian)
        utcCalendar.timeZone = TimeZone(secondsFromGMT: 0)!
        for offset in 0..<62 {
            let candidate = today.addingDays(offset)
            let parts = candidate.isoDate.split(separator: "-").compactMap { Int($0) }
            guard parts.count == 3 else { return nil }
            var dateComponents = DateComponents()
            dateComponents.year = parts[0]
            dateComponents.month = parts[1]
            dateComponents.day = parts[2]
            guard let utcDate = utcCalendar.date(from: dateComponents) else { return nil }
            let days = Int(utcDate.timeIntervalSince1970 / 86_400)
            let index = ((days % dateAlphabet.count) + dateAlphabet.count) % dateAlphabet.count
            if dateAlphabet[index] == code { return candidate }
        }
        return nil
    }

    private static let filterBitCount = 21

    private static func decodeFilterMask(_ value: String) -> Int? {
        guard value.count == 4 else { return nil }
        var decoded = 0
        for character in value {
            guard let digit = urlAlphabet.firstIndex(of: character) else { return nil }
            decoded = decoded * urlAlphabet.count + digit
        }
        return decoded < (1 << filterBitCount) ? decoded : nil
    }

}

struct SharedShowtimeLinkContext: Hashable, Sendable {
    let city: String
    let day: CinemaDay
    let filterMask: Int
    let excludedCinemaIDs: [String]
    let wasDateAdjusted: Bool

    var filterState: AccountPreferences.Showtime.FilterState {
        var result = AccountPreferences.Showtime.FilterState()
        for assignment in Self.filterAssignments where (filterMask & (1 << assignment.bit)) != 0 {
            switch assignment.group {
            case "showType": result.unchecked.showType.append(assignment.value)
            case "screenFormat": result.unchecked.screenFormat.append(assignment.value)
            case "screeningTech": result.unchecked.screeningTech.append(assignment.value)
            case "dubLanguage": result.unchecked.dubLanguage.append(assignment.value)
            default: break
            }
        }
        return result
    }

    static func filterMask(from state: AccountPreferences.Showtime.FilterState) -> Int {
        filterAssignments.reduce(into: 0) { mask, assignment in
            let values: [String]
            switch assignment.group {
            case "showType": values = state.unchecked.showType
            case "screenFormat": values = state.unchecked.screenFormat
            case "screeningTech": values = state.unchecked.screeningTech
            case "dubLanguage": values = state.unchecked.dubLanguage
            default: values = []
            }
            if values.contains(assignment.value) { mask |= 1 << assignment.bit }
        }
    }

    private struct FilterAssignment {
        let bit: Int
        let group: String
        let value: String
    }

    private static let filterAssignments: [FilterAssignment] = [
        .init(bit: 0, group: "showType", value: "Not Just Cinema"),
        .init(bit: 1, group: "showType", value: "Premium"),
        .init(bit: 2, group: "showType", value: "Lounge"),
        .init(bit: 3, group: "showType", value: "Prime"),
        .init(bit: 4, group: "showType", value: "Upgrade"),
        .init(bit: 5, group: "showType", value: "VIP Light"),
        .init(bit: 6, group: "showType", value: "VIP"),
        .init(bit: 7, group: "screeningTech", value: "4DX"),
        .init(bit: 8, group: "screeningTech", value: "ScreenX"),
        .init(bit: 9, group: "screeningTech", value: "ONYX"),
        .init(bit: 10, group: "screeningTech", value: "Atmos"),
        .init(bit: 11, group: "screeningTech", value: "HFR"),
        .init(bit: 12, group: "screenFormat", value: "3D"),
        .init(bit: 13, group: "dubLanguage", value: "French"),
        .init(bit: 14, group: "dubLanguage", value: "Hebrew"),
        .init(bit: 15, group: "screeningTech", value: "IMAX"),
        .init(bit: 16, group: "dubLanguage", value: "Original"),
        .init(bit: 17, group: "screenFormat", value: "2D"),
        .init(bit: 18, group: "screeningTech", value: "Standard"),
        .init(bit: 19, group: "showType", value: "Regular"),
        .init(bit: 20, group: "screeningTech", value: "Infinity Vision"),
    ]
}

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
