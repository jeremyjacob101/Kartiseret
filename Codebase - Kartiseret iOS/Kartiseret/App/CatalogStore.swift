import Foundation
import Observation

struct PendingShowtimeSelection: Equatable, Sendable {
    var date: String
    var filters: ShowtimeFilterState
}

@MainActor
@Observable
final class CatalogStore {
    private(set) var nowPlayingState: LoadState<[Movie]> = .idle
    private(set) var comingSoonState: LoadState<[Movie]> = .idle
    private(set) var citiesState: LoadState<[City]> = .idle
    private(set) var theatersState: LoadState<[Theater]> = .idle
    private(set) var showtimeStates: [CityDateKey: LoadState<[ShowtimeRecord]>] = [:]
    private(set) var cinemaDay = CinemaClock.cinemaDay()
    private(set) var loadedDayCountByCity: [String: Int] = [:]
    private(set) var isPrefetching = false
    var pendingShowtimeSelection: PendingShowtimeSelection?
    var selectedShowtimeDate: String
    var showtimeFilters: ShowtimeFilterState = .all

    @ObservationIgnored private let repository: any CatalogRepository
    @ObservationIgnored private var catalogLoadTask: Task<Void, Never>?
    @ObservationIgnored private var dayAtLastForeground = CinemaClock.cinemaDay()

    init(repository: any CatalogRepository) {
        self.repository = repository
        selectedShowtimeDate = CinemaClock.cinemaDay()
    }

    var nowPlaying: [Movie] { nowPlayingState.value ?? [] }
    var comingSoon: [Movie] { comingSoonState.value ?? [] }
    var allMovies: [Movie] { nowPlaying + comingSoon }
    var cities: [City] { citiesState.value ?? [] }
    var theaters: [Theater] { theatersState.value ?? [] }
    var isCatalogLoading: Bool { nowPlayingState.isLoading || comingSoonState.isLoading }

    func movie(mode: MovieMode, tmdbID: String) -> Movie? {
        (mode == .nowPlaying ? nowPlaying : comingSoon).first { $0.tmdbID == tmdbID }
    }

    func movie(withCode code: String) -> Movie? {
        allMovies.first { $0.movieCode == code }
    }

    func loadInitialCatalogs() async {
        guard catalogLoadTask == nil else { return await catalogLoadTask?.value ?? () }
        let task = Task { [weak self] in
            guard let self else { return }
            let oldNow = nowPlayingState.value
            let oldSoon = comingSoonState.value
            nowPlayingState = .loading(previous: oldNow)
            comingSoonState = .loading(previous: oldSoon)

            let nowTask = Task { try await repository.loadCatalog(.nowPlaying, forceRefresh: false) }
            let soonTask = Task { try await repository.loadCatalog(.comingSoon, forceRefresh: false) }

            do {
                let movies = try await nowTask.value
                nowPlayingState = movies.isEmpty ? .empty : .loaded(movies)
            } catch {
                nowPlayingState = .failed(message: Self.message(for: error), previous: oldNow)
            }
            do {
                let movies = try await soonTask.value
                comingSoonState = movies.isEmpty ? .empty : .loaded(movies)
            } catch {
                comingSoonState = .failed(message: Self.message(for: error), previous: oldSoon)
            }
        }
        catalogLoadTask = task
        await task.value
        catalogLoadTask = nil
    }

    func refresh(_ mode: MovieMode) async {
        let previous = mode == .nowPlaying ? nowPlayingState.value : comingSoonState.value
        setCatalogState(.loading(previous: previous), mode: mode)
        do {
            let movies = try await repository.loadCatalog(mode, forceRefresh: true)
            setCatalogState(movies.isEmpty ? .empty : .loaded(movies), mode: mode)
        } catch {
            setCatalogState(.failed(message: Self.message(for: error), previous: previous), mode: mode)
        }
    }

    func loadPlaces() async {
        let shouldLoadCities: Bool
        switch citiesState { case .idle, .failed: shouldLoadCities = true; default: shouldLoadCities = false }
        let shouldLoadTheaters: Bool
        switch theatersState { case .idle, .failed: shouldLoadTheaters = true; default: shouldLoadTheaters = false }
        guard shouldLoadCities || shouldLoadTheaters else { return }
        if shouldLoadCities { citiesState = .loading(previous: citiesState.value) }
        if shouldLoadTheaters { theatersState = .loading(previous: theatersState.value) }
        let cityTask = shouldLoadCities ? Task { try await repository.loadCities() } : nil
        let theaterTask = shouldLoadTheaters ? Task { try await repository.loadTheaters() } : nil
        if let cityTask {
            do {
                let values = try await cityTask.value
                citiesState = values.isEmpty ? .empty : .loaded(values)
            } catch {
                citiesState = .failed(message: Self.message(for: error), previous: citiesState.value)
            }
        }
        if let theaterTask {
            do {
                let values = try await theaterTask.value
                theatersState = values.isEmpty ? .empty : .loaded(values)
            } catch {
                theatersState = .failed(message: Self.message(for: error), previous: theatersState.value)
            }
        }
    }

    func ensureShowtimes(city: String, date: String, tmdbID: String? = nil, forceRefresh: Bool = false) async {
        let key = CityDateKey(city: city, date: date, tmdbID: tmdbID)
        if !forceRefresh {
            switch showtimeStates[key] {
            case .loaded, .empty, .loading: return
            case .idle, .failed, nil: break
            }
        }
        let previous = showtimeStates[key]?.value
        showtimeStates[key] = .loading(previous: previous)
        do {
            let records = try await repository.loadShowtimes(
                city: city, startDate: date, endDate: date, tmdbID: tmdbID, forceRefresh: forceRefresh
            )
            showtimeStates[key] = records.isEmpty ? .empty : .loaded(records)
            if tmdbID == nil {
                let index = CinemaClock.dateRange(start: cinemaDay, count: KartiseretConstants.showtimeWindowDays).firstIndex(of: date) ?? 0
                loadedDayCountByCity[city] = max(loadedDayCountByCity[city] ?? 0, index + 1)
            }
        } catch {
            showtimeStates[key] = .failed(message: Self.message(for: error), previous: previous)
        }
    }

    func prefetchCurrentDay(city: String) async {
        await ensureShowtimes(city: city, date: cinemaDay)
    }

    func prefetchIfNeeded(city: String, previewDayIndex: Int) async {
        guard !isPrefetching else { return }
        let loaded = max(loadedDayCountByCity[city] ?? 1, 1)
        guard loaded < KartiseretConstants.showtimeWindowDays,
              previewDayIndex >= max(0, loaded - KartiseretConstants.showtimePrefetchTriggerDays) else { return }
        let startIndex = loaded
        let count = min(KartiseretConstants.showtimeChunkDays, KartiseretConstants.showtimeWindowDays - startIndex)
        guard let start = CinemaClock.addingDays(startIndex, to: cinemaDay),
              let end = CinemaClock.addingDays(startIndex + count - 1, to: cinemaDay) else { return }
        isPrefetching = true
        defer { isPrefetching = false }
        do {
            let records = try await repository.loadShowtimes(
                city: city, startDate: start, endDate: end, tmdbID: nil, forceRefresh: false
            )
            for date in CinemaClock.dateRange(start: start, count: count) {
                let values = records.filter { $0.date == date }
                let key = CityDateKey(city: city, date: date, tmdbID: nil)
                showtimeStates[key] = values.isEmpty ? .empty : .loaded(values)
            }
            loadedDayCountByCity[city] = startIndex + count
        } catch {
            let key = CityDateKey(city: city, date: start, tmdbID: nil)
            showtimeStates[key] = .failed(message: Self.message(for: error), previous: nil)
        }
    }

    func showtimeState(city: String, date: String, tmdbID: String? = nil) -> LoadState<[ShowtimeRecord]> {
        showtimeStates[CityDateKey(city: city, date: date, tmdbID: tmdbID)] ?? .idle
    }

    func records(city: String, date: String, tmdbID: String? = nil) -> [ShowtimeRecord] {
        if let targeted = showtimeStates[CityDateKey(city: city, date: date, tmdbID: tmdbID)]?.value {
            return targeted
        }
        let broad = showtimeStates[CityDateKey(city: city, date: date, tmdbID: nil)]?.value ?? []
        return tmdbID.map { id in broad.filter { $0.tmdbID == id } } ?? broad
    }

    func showtimeDay(movieID: String, city: String, date: String, filters: ShowtimeFilterState = .all) -> MovieShowtimeDay {
        let grouped = ShowtimeGrouper.group(records: records(city: city, date: date, tmdbID: movieID))
        let day = grouped[movieID]?.first(where: { $0.date == date }) ?? MovieShowtimeDay(date: date, theaters: [])
        return MovieShowtimeDay(date: date, theaters: ShowtimeFilterEngine.filter(day.theaters, using: filters))
    }

    func moviesWithShowtimes(city: String, date: String, filters: ShowtimeFilterState) -> [(Movie, MovieShowtimeDay)] {
        let grouped = ShowtimeGrouper.group(records: records(city: city, date: date))
        return allMovies.compactMap { movie in
            guard let rawDay = grouped[movie.tmdbID]?.first(where: { $0.date == date }) else { return nil }
            let day = MovieShowtimeDay(date: date, theaters: ShowtimeFilterEngine.filter(rawDay.theaters, using: filters))
            return day.theaters.isEmpty ? nil : (movie, day)
        }.sorted {
            let left = $0.1.theaters.flatMap(\.showtimes).map { CinemaClock.sortValue(for: $0.time) }.min() ?? .max
            let right = $1.1.theaters.flatMap(\.showtimes).map { CinemaClock.sortValue(for: $0.time) }.min() ?? .max
            if left != right { return left < right }
            return $0.0.title < $1.0.title
        }
    }

    func nearbyCities(to city: String) -> [City] {
        guard let selected = cities.first(where: { $0.name == city }) else { return [] }
        return selected.neighboringCities.compactMap { name in cities.first { $0.name == name } }
    }

    func handleForeground(city: String) async {
        let newDay = CinemaClock.cinemaDay()
        guard newDay != dayAtLastForeground else { return }
        dayAtLastForeground = newDay
        cinemaDay = newDay
        selectedShowtimeDate = newDay
        showtimeStates.removeAll()
        loadedDayCountByCity.removeAll()
        await repository.invalidateShowtimeCache()
        await prefetchCurrentDay(city: city)
    }

    private func setCatalogState(_ state: LoadState<[Movie]>, mode: MovieMode) {
        if mode == .nowPlaying { nowPlayingState = state } else { comingSoonState = state }
    }

    private static func message(for error: Error) -> String {
        let message = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        return message.isEmpty ? "Kartiseret could not load this content." : message
    }

    struct CityDateKey: Hashable, Sendable {
        var city: String
        var date: String
        var tmdbID: String?
    }
}
