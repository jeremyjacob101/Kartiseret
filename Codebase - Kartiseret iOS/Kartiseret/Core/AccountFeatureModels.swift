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

struct WalletTicket: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let tmdbId: String?
    let title: String
    let city: String
    let cinema: String
    let screeningDate: String
    let screeningTime: String
    let reminderEnabled: Bool
    let createdAt: String
    let updatedAt: String
}

struct WalletTicketDetail: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let tmdbId: String?
    let title: String
    let city: String
    let cinema: String
    let screeningDate: String
    let screeningTime: String
    let reminderEnabled: Bool
    let createdAt: String
    let updatedAt: String
    let qrMessage: String
}

struct WalletTicketDetailsPage: Decodable, Sendable {
    let tickets: [WalletTicketDetail]
}

struct WalletTicketScreening: Codable, Equatable, Sendable {
    var tmdbId: String?
    var title: String
    var city: String
    var cinema: String
    var screeningDate: String
    var screeningTime: String
}

struct WalletTicketList: Decodable, Sendable { let tickets: [WalletTicket] }
struct WalletTicketDetailPage: Decodable, Sendable { let ticket: WalletTicketDetail }
struct WalletTicketChangePage: Decodable, Sendable { let ticket: WalletTicket }
struct WalletTicketRecentScreeningPage: Decodable, Sendable { let screening: WalletTicketScreening? }

struct TicketPassRoute: Hashable, Sendable {
    let ticketID: String
}

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
