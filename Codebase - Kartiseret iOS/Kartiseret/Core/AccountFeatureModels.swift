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

struct WalletTicketQRCode: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let qrMessage: String
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
    let qrCodes: [WalletTicketQRCode]

    private enum CodingKeys: String, CodingKey {
        case id, tmdbId, title, city, cinema, screeningDate, screeningTime
        case reminderEnabled, createdAt, updatedAt, qrMessage, qrCodes
    }

    init(
        id: String,
        tmdbId: String?,
        title: String,
        city: String,
        cinema: String,
        screeningDate: String,
        screeningTime: String,
        reminderEnabled: Bool,
        createdAt: String,
        updatedAt: String,
        qrMessage: String,
        qrCodes: [WalletTicketQRCode]? = nil
    ) {
        self.id = id
        self.tmdbId = tmdbId
        self.title = title
        self.city = city
        self.cinema = cinema
        self.screeningDate = screeningDate
        self.screeningTime = screeningTime
        self.reminderEnabled = reminderEnabled
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.qrMessage = qrMessage
        self.qrCodes = qrCodes ?? [WalletTicketQRCode(id: id, qrMessage: qrMessage)]
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        tmdbId = try values.decodeIfPresent(String.self, forKey: .tmdbId)
        title = try values.decode(String.self, forKey: .title)
        city = try values.decode(String.self, forKey: .city)
        cinema = try values.decode(String.self, forKey: .cinema)
        screeningDate = try values.decode(String.self, forKey: .screeningDate)
        screeningTime = try values.decode(String.self, forKey: .screeningTime)
        reminderEnabled = try values.decode(Bool.self, forKey: .reminderEnabled)
        createdAt = try values.decode(String.self, forKey: .createdAt)
        updatedAt = try values.decode(String.self, forKey: .updatedAt)
        qrMessage = try values.decode(String.self, forKey: .qrMessage)
        qrCodes = try values.decodeIfPresent([WalletTicketQRCode].self, forKey: .qrCodes)
            ?? [WalletTicketQRCode(id: id, qrMessage: qrMessage)]
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encodeIfPresent(tmdbId, forKey: .tmdbId)
        try values.encode(title, forKey: .title)
        try values.encode(city, forKey: .city)
        try values.encode(cinema, forKey: .cinema)
        try values.encode(screeningDate, forKey: .screeningDate)
        try values.encode(screeningTime, forKey: .screeningTime)
        try values.encode(reminderEnabled, forKey: .reminderEnabled)
        try values.encode(createdAt, forKey: .createdAt)
        try values.encode(updatedAt, forKey: .updatedAt)
        try values.encode(qrMessage, forKey: .qrMessage)
        try values.encode(qrCodes, forKey: .qrCodes)
    }
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
