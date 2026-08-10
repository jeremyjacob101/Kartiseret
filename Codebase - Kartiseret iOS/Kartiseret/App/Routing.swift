import Foundation
import SwiftUI
import Observation

enum AppTab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case home
    case nowPlaying
    case showtimes
    case comingSoon
    case settings

    var id: Self { self }
    var title: String {
        switch self {
        case .home: "Home"
        case .nowPlaying: "Now Playing"
        case .showtimes: "Showtimes"
        case .comingSoon: "Coming Soon"
        case .settings: "Settings"
        }
    }
    var systemImage: String {
        switch self {
        case .home: "house.fill"
        case .nowPlaying: "film.stack.fill"
        case .showtimes: "clock.fill"
        case .comingSoon: "calendar.badge.clock"
        case .settings: "gearshape.fill"
        }
    }
}

enum AppRoute: Hashable, Sendable {
    case movieDetail(mode: MovieMode, tmdbID: String)
    case catalog(MovieMode)
    case attribution
    case account
}

enum SheetDestination: Identifiable, Hashable, Sendable {
    case cityPicker
    case showtimeFilters
    case authentication(AuthMode)
    case trailer(url: URL, title: String)
    case browser(url: URL, title: String)

    var id: String {
        switch self {
        case .cityPicker: "city-picker"
        case .showtimeFilters: "showtime-filters"
        case .authentication(let mode): "auth-\(mode.rawValue)"
        case .trailer(let url, _): "trailer-\(url.absoluteString)"
        case .browser(let url, _): "browser-\(url.absoluteString)"
        }
    }
}

@MainActor
@Observable
final class AppRouter {
    var selectedTab: AppTab = .home
    var sheet: SheetDestination?
    var pendingRoute: AppRoute?

    func open(_ route: AppRoute, in tab: AppTab? = nil) {
        if let tab { selectedTab = tab }
        pendingRoute = route
    }

    func handle(url: URL, catalogStore: CatalogStore, preferencesStore: PreferencesStore) {
        guard url.scheme?.lowercased() == "kartiseret" else { return }
        let pieces = ([url.host].compactMap { $0 } + url.pathComponents.filter { $0 != "/" })
        guard let routeCode = pieces.last, let parsed = ShowtimeLinkCodec.parseRoute(routeCode) else { return }
        switch parsed {
        case .plain(let movieCode):
            if let movie = catalogStore.movie(withCode: movieCode) {
                open(.movieDetail(mode: movie.mode, tmdbID: movie.tmdbID), in: .home)
            }
        case .encoded(let movieCode, let cityCode, let dateCode, let mask, _, _):
            if let city = ShowtimeLinkCodec.resolvedCity(code: cityCode, currentCity: preferencesStore.city) {
                preferencesStore.selectCity(city)
            }
            if let date = ShowtimeLinkCodec.decodeDate(dateCode, today: catalogStore.cinemaDay) {
                catalogStore.pendingShowtimeSelection = .init(date: date, filters: ShowtimeLinkCodec.filters(from: mask) ?? .all)
            }
            if let movie = catalogStore.movie(withCode: movieCode) {
                open(.movieDetail(mode: movie.mode, tmdbID: movie.tmdbID), in: .showtimes)
            }
        }
    }
}
