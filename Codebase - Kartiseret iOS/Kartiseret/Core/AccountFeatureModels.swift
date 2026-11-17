import Foundation

struct TicketAlertSubscription: Decodable, Identifiable, Sendable {
    let tmdbId: String
    let createdAt: String
    let notifiedAt: String?
    let deliveryTitle: String?
    let deliveryDate: String?
    let completedCities: [String]
    var criteriaOverrides: TicketAlertCriteriaOverride?
    var id: String { tmdbId }
}

struct TicketAlertCriteriaOverride: Codable, Equatable, Sendable {
    struct FilterOverrides: Codable, Equatable, Sendable {
        var showType: [String]?
        var screenFormat: [String]?
        var screeningTech: [String]?
        var dubLanguage: [String]?
    }

    var cities: [String]?
    var notificationMode: String?
    var filters: FilterOverrides?
}

struct TicketAlertPage: Decodable, Sendable {
    let subscriptions: [TicketAlertSubscription]
    let nextOffset: Int?
}

struct ComingSoonWatch: Decodable, Identifiable, Sendable {
    let tmdbId: String
    let title: String
    let releaseYear: Int?
    let notifiedAt: String?
    let comingSoonDate: String?
    var id: String { tmdbId }
}

struct ComingSoonWatchPage: Decodable, Sendable { let watches: [ComingSoonWatch] }

struct LetterboxdSource: Decodable, Identifiable, Sendable {
    let id: String
    let sourceUrl: String
    let sourceType: String
    let lastSyncAttemptAt: String?
    let lastSuccessfulSyncAt: String?
    let lastSyncError: String?
    let filmCount: Int
    let matchedFilmCount: Int
}

struct LetterboxdSourcePage: Decodable, Sendable { let sources: [LetterboxdSource] }

struct MovieDisplayRule: Codable, Identifiable, Sendable {
    let tmdbId: String
    let title: String
    let releaseYear: Int?
    var treatment: String
    var hideBackdrop: Bool
    var id: String { tmdbId }
}

struct MovieDisplayRulePage: Decodable, Sendable {
    let preferences: [MovieDisplayRule]
    let nextCursor: String?
}

struct TicketAlertPreferences: Codable, Equatable, Sendable {
    var cities: [String]?
    var notificationMode = "first_any_city"
    var filters = AccountPreferences.FilterExclusions()
}

struct TicketAlertPreferencesData: Decodable, Sendable { let preferences: TicketAlertPreferences }
