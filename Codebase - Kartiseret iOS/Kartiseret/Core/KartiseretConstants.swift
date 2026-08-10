import Foundation

enum KartiseretConstants {
    static let siteOrigin = URL(string: "https://seret.site")!
    static let timeZoneIdentifier = "Asia/Jerusalem"
    static let cinemaDayCutoffMinutes = 65
    static let showtimeGraceMinutes = 15
    static let pageSize = 1_000
    static let showtimeWindowDays = 180
    static let showtimeChunkDays = 15
    static let showtimePrefetchTriggerDays = 5
    static let defaultCity = "Jerusalem"

    static let theaterOrder = [
        "MovieLand", "Yes Planet", "Cinema City", "Lev Cinema", "Rav Hen"
    ]

    static let supportedCityNames = [
        "Afula", "Ashdod", "Ashkelon", "Ayalon", "Beer Sheva", "Carmiel", "Chadera",
        "Even Yehuda", "Givatayim", "Glilot", "Haifa", "Herziliya", "Jerusalem",
        "Kfar Saba", "Kiryat Bialik", "Kiryat Ono", "Modiin", "Nahariya", "Netanya",
        "Omer", "Petach Tikvah", "Raanana", "Ramat Hasharon", "Rehovot",
        "Rishon Letzion", "Tel Aviv", "Zichron Yaakov", "Holon"
    ]
}

enum AppConfiguration {
    static var supabaseURL: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String else { return nil }
        return URL(string: value)
    }

    static var supabasePublishableKey: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "SupabasePublishableKey") as? String,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    static var isFixtureMode: Bool {
        ProcessInfo.processInfo.arguments.contains("-FixtureMode") ||
        ProcessInfo.processInfo.environment["KARTISERET_FIXTURE_MODE"] == "1"
    }

    static var forcedLocationDenied: Bool {
        ProcessInfo.processInfo.arguments.contains("-LocationDenied")
    }
}
