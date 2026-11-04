import Foundation
import Observation

@MainActor
@Observable
final class AppStore {
    static let defaultCity = "Jerusalem"
    static let cityDefaultsKey = "kartiseret.selectedCity"

    let api: any KartiseretAPI
    let fixtureMode: Bool

    private let defaults: UserDefaults
    private(set) var selectedCity: String
    private(set) var selectedDay: CinemaDay
    private(set) var cities: [City] = []
    private(set) var citiesLoaded = false
    private(set) var isLoadingCities = false
    private(set) var cityError: String?
    private(set) var catalogs: [CatalogMode: CatalogSnapshot] = [:]
    private(set) var catalogLoading: Set<CatalogMode> = []
    private(set) var catalogErrors: [CatalogMode: String] = [:]
    private(set) var showtimes: [ShowtimeRequest: [Showtime]] = [:]
    private(set) var showtimeLoading: Set<ShowtimeRequest> = []
    private(set) var showtimeErrors: [ShowtimeRequest: String] = [:]
    private(set) var lastOpenedBookingURL: URL?

    private var catalogGenerations: [CatalogMode: Int] = [:]
    private var showtimeGenerations: [ShowtimeRequest: Int] = [:]

    init(
        api: any KartiseretAPI,
        defaults: UserDefaults = .standard,
        now: Date = .now,
        fixtureMode: Bool = false,
        resetPreferences: Bool = false
    ) {
        self.api = api
        self.defaults = defaults
        self.fixtureMode = fixtureMode
        if resetPreferences {
            defaults.removeObject(forKey: Self.cityDefaultsKey)
        }
        self.selectedCity = defaults.string(forKey: Self.cityDefaultsKey) ?? Self.defaultCity
        self.selectedDay = CinemaDay.current(at: now)
    }

    var currentInstant: Date { fixtureMode ? FixtureAPIClient.referenceInstant : .now }
    var today: CinemaDay { CinemaDay.current(at: currentInstant) }
    var lastSelectableDay: CinemaDay { today.addingDays(ShowtimeLogic.maximumDayOffset) }

    func selectCity(_ city: String) {
        guard !city.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        selectedCity = city
        defaults.set(city, forKey: Self.cityDefaultsKey)
    }

    func selectDay(_ day: CinemaDay) {
        guard ShowtimeLogic.isWithinSelectableRange(day, today: today) else { return }
        selectedDay = day
    }

    func moveDay(by offset: Int) {
        selectDay(selectedDay.addingDays(offset))
    }

    func reconcileDay(at instant: Date? = nil) {
        let current = CinemaDay.current(at: instant ?? currentInstant)
        if selectedDay < current { selectedDay = current }
    }

    func loadCities(forceRefresh: Bool = false) async {
        guard forceRefresh || !citiesLoaded else { return }
        isLoadingCities = true
        cityError = nil
        do {
            let loaded = try await api.loadCities()
            guard !Task.isCancelled else { isLoadingCities = false; return }
            cities = loaded.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            citiesLoaded = true
            isLoadingCities = false
            if !cities.contains(where: { $0.name == selectedCity }) {
                selectCity(Self.defaultCity)
            }
        } catch is CancellationError {
            isLoadingCities = false
        } catch {
            isLoadingCities = false
            cityError = error.localizedDescription
        }
    }

    func loadCatalog(_ mode: CatalogMode, forceRefresh: Bool = false) async {
        guard forceRefresh || catalogs[mode] == nil else { return }
        let generation = (catalogGenerations[mode] ?? 0) + 1
        catalogGenerations[mode] = generation
        catalogLoading.insert(mode)
        catalogErrors[mode] = nil
        defer {
            if catalogGenerations[mode] == generation { catalogLoading.remove(mode) }
        }
        do {
            let loaded = try await api.loadCatalog(mode)
            guard !Task.isCancelled, catalogGenerations[mode] == generation else { return }
            catalogs[mode] = loaded
            catalogErrors[mode] = nil
        } catch is CancellationError {
            return
        } catch {
            guard catalogGenerations[mode] == generation else { return }
            catalogErrors[mode] = error.localizedDescription
        }
    }

    func makeShowtimeRequest(mode: CatalogMode, movieID: String?) -> ShowtimeRequest {
        ShowtimeRequest(
            mode: mode,
            city: selectedCity,
            day: selectedDay,
            movieID: movieID,
            publicationRevision: catalogs[mode]?.publicationRevision
        )
    }

    func loadShowtimes(_ request: ShowtimeRequest, forceRefresh: Bool = false) async {
        guard forceRefresh || showtimes[request] == nil else { return }
        let generation = (showtimeGenerations[request] ?? 0) + 1
        showtimeGenerations[request] = generation
        showtimeLoading.insert(request)
        showtimeErrors[request] = nil
        var destination = request
        defer {
            showtimeLoading.remove(request)
            showtimeLoading.remove(destination)
        }

        do {
            let result: ShowtimesSnapshot
            do {
                result = try await fetchShowtimes(request)
            } catch let error as APIClientError where error.code == "publication_changed" {
                await loadCatalog(request.mode, forceRefresh: true)
                guard !Task.isCancelled, showtimeGenerations[request] == generation,
                      let refreshedCatalog = catalogs[request.mode] else { return }
                let refreshedRequest = request.with(revision: refreshedCatalog.publicationRevision)
                destination = refreshedRequest
                showtimeLoading.insert(refreshedRequest)
                let retryResult = try await fetchShowtimes(refreshedRequest)
                guard !Task.isCancelled, showtimeGenerations[request] == generation else { return }
                showtimes[refreshedRequest] = retryResult.showtimes
                showtimeErrors[refreshedRequest] = nil
                return
            }
            guard !Task.isCancelled, showtimeGenerations[request] == generation else { return }
            showtimes[destination] = result.showtimes
            showtimeErrors[destination] = nil
        } catch is CancellationError {
            // Selection changes cancel the old request; cancellation is expected.
        } catch {
            guard showtimeGenerations[request] == generation else { return }
            showtimeErrors[request] = error.localizedDescription
            if destination != request { showtimeErrors[destination] = error.localizedDescription }
        }
    }

    func captureFixtureBookingURL(_ url: URL) {
        if fixtureMode { lastOpenedBookingURL = url }
    }

    private func fetchShowtimes(_ request: ShowtimeRequest) async throws -> ShowtimesSnapshot {
        try await api.loadShowtimes(
            city: request.city,
            day: request.day,
            movieID: request.movieID,
            publicationRevision: request.publicationRevision
        )
    }
}
