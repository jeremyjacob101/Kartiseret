import Foundation

struct ShowtimeTheme: Equatable, Sendable {
    let startHex: UInt
    let endHex: UInt
    let accentHex: UInt

    static let fallback = ShowtimeTheme(startHex: 0xA66AE3, endHex: 0x68439C, accentHex: 0xA66AE3)
    static let cinematheque = ShowtimeTheme(startHex: 0x31A26D, endHex: 0x207047, accentHex: 0x31A26D)

    static func forCinema(_ name: String) -> ShowtimeTheme {
        let normalized = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
        if normalized.contains("planet cinema") { return ShowtimeTheme(startHex: 0xD9710F, endHex: 0xB05806, accentHex: 0xD9710F) }
        if normalized.contains("cinema city") { return ShowtimeTheme(startHex: 0x186BDF, endHex: 0x084CAB, accentHex: 0x186BDF) }
        if normalized.contains("lev cinema") { return ShowtimeTheme(startHex: 0xB50519, endHex: 0x5E030D, accentHex: 0xB50519) }
        if normalized.contains("rav hen") || normalized.contains("rav-hen") { return ShowtimeTheme(startHex: 0x0D06DA, endHex: 0xAB5306, accentHex: 0x0D06DA) }
        if normalized.contains("hot cinema") { return ShowtimeTheme(startHex: 0xF06A87, endHex: 0xC13043, accentHex: 0xF06A87) }
        if normalized.contains("movieland") || normalized.contains("movie land") { return ShowtimeTheme(startHex: 0x58003A, endHex: 0xA80371, accentHex: 0xA80371) }
        if normalized.contains("cinematheque") || normalized.contains("cinemateque") || normalized.contains("cinemathek") { return .cinematheque }
        return .fallback
    }
}
