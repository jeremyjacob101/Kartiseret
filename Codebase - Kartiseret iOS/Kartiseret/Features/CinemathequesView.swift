import SwiftUI

struct CinemathequesView: View {
    let isActive: Bool

    @Environment(AppStore.self) private var app
    @Environment(AccountStore.self) private var account
    @State private var snapshot: CinemathequeSnapshot?
    @State private var error: String?
    @State private var isLoading = false
    @State private var selectedDate: String?

    private var dateRange: (start: String, end: String) {
        (app.today.isoDate, app.today.addingDays(13).isoDate)
    }

    private var visibleShowtimes: [Showtime] {
        guard let selectedDate else { return snapshot?.data.showtimes ?? [] }
        return (snapshot?.data.showtimes ?? []).filter { $0.dateOfShowing == selectedDate }
    }

    private var schedule: [CinemaScheduleSection] {
        guard let snapshot else { return [] }
        let movies = Dictionary(snapshot.data.movies.compactMap { movie -> (String, Movie)? in
            guard let displayed = account.displayedMovie(movie) else { return nil }
            return (displayed.tmdbId, displayed)
        }, uniquingKeysWith: { _, new in new })
        let byCinema = Dictionary(grouping: visibleShowtimes.compactMap { showtime -> (String, Movie, Showtime)? in
            guard let movie = movies[showtime.tmdbId] else { return nil }
            return (showtime.cinema, movie, showtime)
        }, by: { $0.0 })
        return byCinema.keys.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }.compactMap { cinema -> CinemaScheduleSection? in
            guard let entries = byCinema[cinema] else { return nil }
            let byMovie = Dictionary(grouping: entries, by: { $0.1.tmdbId })
            let movieRows = byMovie.values.compactMap { rows -> CinemaFilmSchedule? in
                guard let movie = rows.first?.1 else { return nil }
                let showtimes = rows.map { $0.2 }.sorted { $0.showtime < $1.showtime }
                return CinemaFilmSchedule(movie: movie, showtimes: showtimes)
            }.sorted { $0.showtimes.first?.showtime == $1.showtimes.first?.showtime ? $0.movie.title < $1.movie.title : ($0.showtimes.first?.showtime ?? "") < ($1.showtimes.first?.showtime ?? "") }
            return CinemaScheduleSection(cinema: cinema, movies: movieRows)
        }
    }

    private var dates: [String] {
        (0..<14).map { app.today.addingDays($0).isoDate }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                cityPicker
                datePicker
                if isLoading && snapshot == nil {
                    LoadingState(message: "Loading cinematheque screenings…")
                } else if let error, snapshot == nil {
                    ErrorState(message: error) { Task { await load(force: true) } }
                } else if schedule.isEmpty {
                    EmptyState(title: "No screenings listed", message: "Try another day or city, or check back for the next programme.")
                } else {
                    ForEach(schedule) { section in
                        VStack(alignment: .leading, spacing: 12) {
                            cinemaHeader(section.cinema)
                            ForEach(section.movies) { entry in
                                CinemathequeMovieRow(movie: entry.movie, showtimes: entry.showtimes)
                                .accessibilityIdentifier("cinematheques.movie.\(entry.movie.tmdbId)")
                            }
                        }
                        .padding(14)
                        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 18))
                    }
                }
                if let error, snapshot != nil { InlineError(message: error) { Task { await load(force: true) } } }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle("Cinematheques")
        .navigationBarTitleDisplayMode(.large)
        .task(id: "\(isActive)-\(app.selectedCity)-\(dateRange.start)") {
            guard isActive else { return }
            snapshot = nil
            error = nil
            selectedDate = dates.first
            await load(force: true)
        }
        .refreshable { await load(force: true) }
    }

    private var cityPicker: some View {
        HStack {
            Label("City", systemImage: "mappin.and.ellipse").foregroundStyle(BrandStyle.secondary)
            Spacer()
            Menu {
                ForEach(app.cities) { city in
                    Button {
                        app.selectCity(city.name)
                        Task { await account.saveLocation(city.name) }
                    } label: {
                        if city.name == app.selectedCity { Label(city.name, systemImage: "checkmark") }
                        else { Text(city.name) }
                    }
                }
            } label: {
                HStack(spacing: 6) { Text(app.selectedCity).fontWeight(.semibold); Image(systemName: "chevron.down").font(.caption.bold()) }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 13).padding(.vertical, 9)
                    .background(BrandStyle.raised, in: Capsule())
            }
            .accessibilityIdentifier("cinematheques.city")
        }
    }

    private var datePicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(dates, id: \.self) { date in
                    Button {
                        selectedDate = date
                    } label: {
                        VStack(spacing: 4) {
                            Text(dayLabel(date)).font(.caption.weight(.semibold))
                            Text(String(date.suffix(5)).replacingOccurrences(of: "-", with: "/"))
                                .font(.caption2.monospacedDigit())
                        }
                        .foregroundStyle(selectedDate == date ? .white : BrandStyle.secondary)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(selectedDate == date ? BrandStyle.accent : BrandStyle.surface, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("cinematheques.date.\(date)")
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .accessibilityLabel("Choose screening date")
    }

    @ViewBuilder
    private func cinemaHeader(_ cinema: String) -> some View {
        if let identity = CinemaIdentity.forScreening(city: app.selectedCity, cinema: cinema) {
            NavigationLink(value: CinemaRoute(cinemaID: identity.id)) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(identity.displayName).font(.headline).foregroundStyle(.white)
                        Text("Cinematheque · \(identity.city)").font(.caption).foregroundStyle(BrandStyle.secondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.caption.bold()).foregroundStyle(BrandStyle.accent)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("cinematheques.cinema.\(identity.id)")
        } else {
            Text(cinema).font(.headline).foregroundStyle(.white)
        }
    }

    private func load(force: Bool) async {
        guard force || snapshot == nil else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            snapshot = try await app.api.loadCinematheques(city: app.selectedCity, startDate: dateRange.start, endDate: dateRange.end, publicationRevision: nil)
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func dayLabel(_ value: String) -> String {
        if value == app.today.isoDate { return "Today" }
        if value == app.today.addingDays(1).isoDate { return "Tomorrow" }
        guard let day = CinemaDay(isoDate: value) else { return value }
        let weekday = DateFormatter()
        weekday.locale = .autoupdatingCurrent
        weekday.timeZone = CinemaDay.timeZone
        weekday.dateFormat = "EEE"
        return weekday.string(from: day.date)
    }
}

private struct CinemathequeMovieRow: View {
    let movie: Movie
    let showtimes: [Showtime]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink(value: MovieRoute(mode: .nowPlaying, movieID: movie.tmdbId, movie: movie)) {
                HStack(spacing: 12) {
                    MovieArtwork(movie: movie, width: 58, height: 86)
                    VStack(alignment: .leading, spacing: 7) {
                        Text(movie.title).font(.headline).foregroundStyle(.white).lineLimit(2)
                        Text([String(movie.year), movie.runtime > 0 ? "\(movie.runtime) min" : nil, movie.genres.first].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(BrandStyle.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(BrandStyle.secondary)
                }
            }
            .buttonStyle(.plain)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 74, maximum: 74), spacing: 7, alignment: .bottom)], alignment: .leading, spacing: 7) {
                ForEach(showtimes) { showtime in
                    if let url = showtime.bookingURL {
                        Link(destination: url) {
                            ShowtimeTicketCell(showtime: showtime, theme: .cinematheque)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                            for: showtime,
                            cinemaName: showtime.cinema,
                            movieTitle: movie.title,
                            isBookable: true
                        ))
                    } else {
                        ShowtimeTicketCell(showtime: showtime, theme: .cinematheque)
                            .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                                for: showtime,
                                cinemaName: showtime.cinema,
                                isBookable: false
                            ))
                    }
                }
            }
        }
        .padding(11)
        .background(BrandStyle.raised.opacity(0.75), in: RoundedRectangle(cornerRadius: 14))
    }
}

struct CinemaPageView: View {
    let cinemaID: String

    @Environment(AppStore.self) private var app
    @Environment(AccountStore.self) private var account
    @Environment(\.openURL) private var openURL
    @State private var snapshot: CinemaPageSnapshot?
    @State private var error: String?
    @State private var showingFilters = false

    private var identity: CinemaIdentity? { CinemaIdentity.byID(cinemaID) }
    private var screenings: [CinemaScreening] {
        (snapshot?.data.screenings ?? []).filter { entry in
            let prefs = account.preferences.showtimePreferences
            guard ShowtimeLogic.matchesSavedFilters(entry.screening, state: prefs.screeningFilters) else { return false }
            guard let movie = account.displayedMovie(entry.movie) else { return false }
            return !account.preferences.hideReReleases || ShowtimeLogic.releaseCategory(for: movie) == .newReleases
        }
    }

    var body: some View {
        List {
            if let data = snapshot?.data {
                Section {
                    Text(data.address.isEmpty ? data.city : data.address).foregroundStyle(.secondary)
                    Link(destination: data.mapUrl) { Label("View on map", systemImage: "map") }
                }
                Section {
                    if screenings.isEmpty { ContentUnavailableView("No matching screenings", systemImage: "line.3.horizontal.decrease.circle", description: Text("Try showing more formats, languages, or release types.")) }
                    ForEach(screenings, id: \.screening.id) { entry in
                        CinemaScreeningRow(entry: entry, displayedMovie: account.displayedMovie(entry.movie))
                    }
                } header: {
                    HStack {
                        Text("Upcoming showtimes")
                        Spacer()
                        Button { showingFilters = true } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                            .accessibilityLabel("Showtime filters")
                    }
                }
            } else if let error {
                Section { Text(error).foregroundStyle(.red); Button("Try again") { Task { await load() } } }
            } else {
                Section { ProgressView("Loading cinema…") }
            }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle(snapshot?.data.displayName ?? identity?.displayName ?? "Cinema")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingFilters) {
            NavigationStack { ShowtimePreferencesView() }
        }
        .task(id: cinemaID) { await load() }
    }

    private func load() async {
        do { snapshot = try await app.api.loadCinemaPage(id: cinemaID, publicationRevision: nil) }
        catch { self.error = error.localizedDescription }
    }
}

private struct CinemaFilmSchedule: Identifiable {
    let movie: Movie
    let showtimes: [Showtime]
    var id: String { movie.tmdbId }
}

private struct CinemaScheduleSection: Identifiable {
    let cinema: String
    let movies: [CinemaFilmSchedule]
    var id: String { cinema }
}

private struct CinemaScreeningRow: View {
    let entry: CinemaScreening
    let displayedMovie: Movie?

    var body: some View {
        HStack(spacing: 12) {
            MovieArtwork(movie: displayedMovie, width: 48, height: 70)
            VStack(alignment: .leading, spacing: 5) {
                Text(displayedMovie?.title ?? entry.movie.title).font(.headline).lineLimit(2)
                Text(entry.screening.dateOfShowing)
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Spacer()
            if let url = entry.screening.bookingURL {
                Link(destination: url) {
                    ShowtimeTicketCell(showtime: entry.screening, theme: ShowtimeTheme.forCinema(entry.screening.cinema))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                    for: entry.screening,
                    cinemaName: entry.screening.cinema,
                    movieTitle: entry.movie.title,
                    isBookable: true
                ))
            } else {
                ShowtimeTicketCell(showtime: entry.screening, theme: ShowtimeTheme.forCinema(entry.screening.cinema))
                    .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                        for: entry.screening,
                        cinemaName: entry.screening.cinema,
                        movieTitle: entry.movie.title,
                        isBookable: false
                    ))
            }
        }
        .padding(.vertical, 4)
    }
}
