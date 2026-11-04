import Foundation

enum AppConfiguration {
    static var fixtureMode: Bool {
        ProcessInfo.processInfo.arguments.contains("-FixtureMode")
    }

    static var resetPreferences: Bool {
        ProcessInfo.processInfo.arguments.contains("-ResetPreferences")
    }

    static var apiBaseURL: URL {
        let environmentValue = ProcessInfo.processInfo.environment["KARTISERET_API_BASE_URL"]
        let bundleValue = Bundle.main.object(forInfoDictionaryKey: "KARTISERET_API_BASE_URL") as? String
        let configured = environmentValue ?? bundleValue ?? "https://seret.site"
        return URL(string: configured) ?? URL(string: "https://seret.site")!
    }
}
