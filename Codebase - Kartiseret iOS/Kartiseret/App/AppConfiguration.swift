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

    static var apiOrigin: String {
        guard let scheme = apiBaseURL.scheme, let host = apiBaseURL.host else { return "https://seret.site" }
        return "\(scheme)://\(host)"
    }

    static var googleIOSClientID: String? {
        configuredValue(forInfoKey: "GIDClientID")
    }

    static var googleServerClientID: String? {
        configuredValue(forInfoKey: "GIDServerClientID")
    }

    static func imageURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        return URL(string: value, relativeTo: apiBaseURL)?.absoluteURL
    }

    private static func configuredValue(forInfoKey key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
