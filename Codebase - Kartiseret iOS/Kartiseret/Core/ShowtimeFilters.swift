import Foundation

enum ShowtimeFilterGroup: String, CaseIterable, Identifiable, Sendable {
    case showType
    case screenFormat
    case screeningTechnology
    case dubLanguage

    var id: Self { self }
    var title: String {
        switch self {
        case .showType: "Show Type"
        case .screenFormat: "Format"
        case .screeningTechnology: "Technology"
        case .dubLanguage: "Dub Language"
        }
    }
}

struct ShowtimeFilterState: Equatable, Codable, Sendable {
    var showTypes: Set<String>
    var screenFormats: Set<String>
    var screeningTechnologies: Set<String>
    var dubLanguages: Set<String>

    static let showTypeOptions = [
        "Regular", "VIP", "VIP Light", "Upgrade", "Prime", "Lounge", "Premium", "Not Just Cinema"
    ]
    static let screenFormatOptions = ["2D", "3D"]
    static let screeningTechnologyOptions = ["Standard", "HFR", "IMAX", "Atmos", "ONYX", "ScreenX", "4DX"]
    static let dubLanguageOptions = ["Original", "Hebrew", "French"]

    static let all = ShowtimeFilterState(
        showTypes: Set(showTypeOptions),
        screenFormats: Set(screenFormatOptions),
        screeningTechnologies: Set(screeningTechnologyOptions),
        dubLanguages: Set(dubLanguageOptions)
    )

    var isDefault: Bool { self == .all }

    var disabledCount: Int {
        Self.showTypeOptions.count - showTypes.count +
        Self.screenFormatOptions.count - screenFormats.count +
        Self.screeningTechnologyOptions.count - screeningTechnologies.count +
        Self.dubLanguageOptions.count - dubLanguages.count
    }

    func options(for group: ShowtimeFilterGroup) -> [String] {
        switch group {
        case .showType: Self.showTypeOptions
        case .screenFormat: Self.screenFormatOptions
        case .screeningTechnology: Self.screeningTechnologyOptions
        case .dubLanguage: Self.dubLanguageOptions
        }
    }

    func contains(_ value: String, in group: ShowtimeFilterGroup) -> Bool {
        switch group {
        case .showType: showTypes.contains(value)
        case .screenFormat: screenFormats.contains(value)
        case .screeningTechnology: screeningTechnologies.contains(value)
        case .dubLanguage: dubLanguages.contains(value)
        }
    }

    mutating func set(_ value: String, in group: ShowtimeFilterGroup, enabled: Bool) {
        switch group {
        case .showType: update(&showTypes, value: value, enabled: enabled)
        case .screenFormat: update(&screenFormats, value: value, enabled: enabled)
        case .screeningTechnology: update(&screeningTechnologies, value: value, enabled: enabled)
        case .dubLanguage: update(&dubLanguages, value: value, enabled: enabled)
        }
    }

    func normalized() -> ShowtimeFilterState {
        ShowtimeFilterState(
            showTypes: showTypes.intersection(Self.showTypeOptions),
            screenFormats: screenFormats.intersection(Self.screenFormatOptions),
            screeningTechnologies: screeningTechnologies.intersection(Self.screeningTechnologyOptions),
            dubLanguages: dubLanguages.intersection(Self.dubLanguageOptions)
        )
    }

    private func update(_ set: inout Set<String>, value: String, enabled: Bool) {
        if enabled { set.insert(value) } else { set.remove(value) }
    }
}

struct CanonicalShowtimeMetadata: Equatable, Sendable {
    let showTypes: Set<String>
    let screenFormat: String
    let screeningTechnologies: Set<String>
    let dubLanguage: String
}

enum ShowtimeFilterEngine {
    static func canonicalMetadata(for entry: ShowtimeEntry) -> CanonicalShowtimeMetadata {
        let showTypes = showTypeTokens(from: entry.screeningType)
        let technology = technologyParts(from: entry.screeningTechnology)
        return CanonicalShowtimeMetadata(
            showTypes: showTypes,
            screenFormat: technology.format,
            screeningTechnologies: technology.technologies,
            dubLanguage: normalizedDubLanguage(entry.dubLanguage)
        )
    }

    static func matches(_ entry: ShowtimeEntry, filters: ShowtimeFilterState) -> Bool {
        let metadata = canonicalMetadata(for: entry)
        return !metadata.showTypes.isDisjoint(with: filters.showTypes) &&
            filters.screenFormats.contains(metadata.screenFormat) &&
            !metadata.screeningTechnologies.isDisjoint(with: filters.screeningTechnologies) &&
            filters.dubLanguages.contains(metadata.dubLanguage)
    }

    static func filter(_ theaters: [TheaterShowtimes], using filters: ShowtimeFilterState) -> [TheaterShowtimes] {
        theaters.compactMap { theater in
            let entries = theater.showtimes.filter { matches($0, filters: filters) }
            return entries.isEmpty ? nil : TheaterShowtimes(theater: theater.theater, showtimes: entries)
        }
    }

    static func showTypeTokens(from rawValue: String) -> Set<String> {
        let value = normalizedText(rawValue).isEmpty ? "Regular" : normalizedText(rawValue)
        let comparable = value.lowercased()
        if comparable == "premium" { return ["Premium"] }
        if comparable == "not just cinema" { return ["Not Just Cinema"] }

        let words = Set(value.uppercased().split(whereSeparator: { "+ /,-".contains($0) || $0.isWhitespace }).map(String.init))
        var tokens = Set<String>()
        if words.contains("REGULAR") { tokens.insert("Regular") }
        if words.contains("UPGRADE") { tokens.insert("Upgrade") }
        if words.contains("PRIME") { tokens.insert("Prime") }
        if words.contains("LOUNGE") { tokens.insert("Lounge") }
        if words.contains("VIP") { tokens.insert("VIP") }
        if words.contains("LIGHT") {
            tokens.insert("VIP Light")
            tokens.insert("VIP")
        }
        if words.contains("BUSINESS") { tokens.insert("VIP") }
        return tokens
    }

    static func technologyParts(from rawValue: String) -> (format: String, technologies: Set<String>) {
        let value = normalizedText(rawValue).isEmpty ? "2D" : normalizedText(rawValue)
        let rawTokens = value.split(whereSeparator: { "+ /,-".contains($0) || $0.isWhitespace })
        let tokens = rawTokens.compactMap { normalizeTechnologyToken(String($0)) }
        let format = tokens.contains("3D") ? "3D" : "2D"
        let premium = Set(tokens.filter { $0 != "2D" && $0 != "3D" && $0 != "Standard" })
        return (format, premium.isEmpty ? ["Standard"] : premium)
    }

    static func normalizedDubLanguage(_ rawValue: String?) -> String {
        let value = normalizedText(rawValue ?? "")
        guard !value.isEmpty else { return "Original" }
        return switch value.lowercased() {
        case "hebrew": "Hebrew"
        case "french": "French"
        case "original": "Original"
        default: value
        }
    }

    private static func normalizeTechnologyToken(_ rawValue: String) -> String? {
        switch normalizedText(rawValue).uppercased() {
        case "IMAX": "IMAX"
        case "HFR": "HFR"
        case "SCREENX": "ScreenX"
        case "4DX": "4DX"
        case "ONYX": "ONYX"
        case "ATMOS": "Atmos"
        case "2D": "2D"
        case "3D": "3D"
        case "STANDARD": "Standard"
        default: nil
        }
    }

    private static func normalizedText(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}

enum ShowtimeGrouper {
    static func group(records: [ShowtimeRecord], now: Date = .now) -> [String: [MovieShowtimeDay]] {
        var result: [String: [String: [String: [String: ShowtimeEntry]]]] = [:]
        for record in records where CinemaClock.shouldInclude(cinemaDay: record.date, showtime: record.entry.time, at: now) {
            var entry = record.entry
            entry.time = String(entry.time.trimmingCharacters(in: .whitespacesAndNewlines).prefix(5))
            let existing = result[record.tmdbID]?[record.date]?[record.theater]?[entry.id]
            if entry.ticketURL == nil { entry.ticketURL = existing?.ticketURL }
            result[record.tmdbID, default: [:]][record.date, default: [:]][record.theater, default: [:]][entry.id] = entry
        }

        return result.mapValues { dateMap in
            dateMap.keys.sorted().map { date in
                let theaterMap = dateMap[date, default: [:]]
                let theaters = theaterMap.keys.sorted(by: theaterComparator).map { theater in
                    let showtimes = theaterMap[theater, default: [:]].values.sorted(by: showtimeComparator)
                    return TheaterShowtimes(theater: theater, showtimes: showtimes)
                }
                return MovieShowtimeDay(date: date, theaters: theaters)
            }
        }
    }

    static func theaterComparator(_ lhs: String, _ rhs: String) -> Bool {
        let leftIndex = KartiseretConstants.theaterOrder.firstIndex(of: lhs) ?? .max
        let rightIndex = KartiseretConstants.theaterOrder.firstIndex(of: rhs) ?? .max
        if leftIndex != rightIndex { return leftIndex < rightIndex }
        return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
    }

    static func showtimeComparator(_ lhs: ShowtimeEntry, _ rhs: ShowtimeEntry) -> Bool {
        let left = CinemaClock.sortValue(for: lhs.time)
        let right = CinemaClock.sortValue(for: rhs.time)
        if left != right { return left < right }
        if lhs.time != rhs.time { return lhs.time < rhs.time }
        if lhs.screeningTechnology != rhs.screeningTechnology { return lhs.screeningTechnology < rhs.screeningTechnology }
        if lhs.screeningType != rhs.screeningType { return lhs.screeningType < rhs.screeningType }
        return (lhs.dubLanguage ?? "") < (rhs.dubLanguage ?? "")
    }
}
