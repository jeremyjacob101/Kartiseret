import SwiftUI

struct ShowtimeSections: View {
    let cinemas: [CinemaShowtimes]
    let city: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(cinemas) { cinema in
                let theme = ShowtimeTheme.forCinema(cinema.name)
                VStack(alignment: .leading, spacing: 8) {
                    if let identity = CinemaIdentity.forScreening(city: city, cinema: cinema.name) {
                        NavigationLink(value: CinemaRoute(cinemaID: identity.id)) {
                            HStack {
                                Text(identity.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Color(hex: theme.accentHex))
                                Spacer()
                                Image(systemName: "arrow.up.right").font(.caption.bold()).foregroundStyle(Color(hex: theme.accentHex))
                            }
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(cinema.name).font(.subheadline.weight(.semibold)).foregroundStyle(Color(hex: theme.accentHex))
                    }
                    ShowtimeRow(showtimes: cinema.showtimes, cinemaName: cinema.name, theme: theme)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: theme.accentHex).opacity(0.12), in: RoundedRectangle(cornerRadius: 13))
                .overlay {
                    RoundedRectangle(cornerRadius: 13)
                        .stroke(Color(hex: theme.accentHex).opacity(0.24), lineWidth: 1)
                }
            }
        }
    }
}

private struct ShowtimeRow: View {
    let showtimes: [Showtime]
    let cinemaName: String
    let theme: ShowtimeTheme
    @Environment(AppStore.self) private var store
    @Environment(\.openURL) private var openURL

    private let columns = [GridItem(.adaptive(minimum: 74, maximum: 74), spacing: 7, alignment: .bottom)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 7) {
            ForEach(showtimes) { showtime in
                if let url = showtime.bookingURL {
                    Button {
                        openURL(url)
                        store.captureFixtureBookingURL(url)
                    } label: {
                        ShowtimeTicketCell(showtime: showtime, theme: theme)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                        for: showtime,
                        cinemaName: cinemaName,
                        isBookable: true
                    ))
                    .accessibilityIdentifier("booking.\(showtime.tmdbId).\(showtime.displayTime.replacingOccurrences(of: ":", with: ""))")
                } else {
                    ShowtimeTicketCell(showtime: showtime, theme: theme)
                        .accessibilityLabel(ShowtimeLogic.ticketAccessibilityLabel(
                            for: showtime,
                            cinemaName: cinemaName,
                            isBookable: false
                        ))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}

struct MovieShowtimeCard: View {
    let group: MovieShowtimes
    let city: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: MovieRoute(mode: .nowPlaying, movieID: group.movie.tmdbId)) {
                HStack(spacing: 12) {
                    MovieArtwork(movie: group.movie, width: 54, height: 78)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(group.movie.title)
                            .font(.headline)
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.leading)
                        Text(String(group.movie.year))
                            .font(.caption)
                            .foregroundStyle(BrandStyle.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandStyle.secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("showtimes.movie.link.\(group.movie.tmdbId)")
            ShowtimeSections(cinemas: group.cinemas, city: city)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct ShowtimesView: View {
    let isActive: Bool
    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var selectedCategory: ShowtimeLogic.ReleaseCategory = .newReleases
    @State private var showingFilters = false

    private var request: ShowtimeRequest {
        store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
    }

    private var movieData: MovieCatalogData? { store.catalogs[.nowPlaying]?.data }
    private var visibleMovies: [Movie] {
        let movies = account.displayedMovies(movieData?.movies ?? [], mode: .nowPlaying)
        return ShowtimeLogic.movies(movies, category: selectedCategory)
    }
    private var rows: [Showtime]? { store.showtimes[request] }
    private var groups: [MovieShowtimes] {
        guard let rows else { return [] }
        return ShowtimeLogic.group(rows, movies: visibleMovies, city: request.city, day: request.day, at: store.currentInstant, preferences: account.preferences.showtimePreferences)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                SelectionControls()
                releaseCategoryPicker
                content
                if store.fixtureMode, store.lastOpenedBookingURL != nil {
                    Text("Booking link opened")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(BrandStyle.accent)
                        .accessibilityIdentifier("booking.opened")
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle("All Showtimes")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingFilters = true } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                }
                .accessibilityLabel("Showtime filters")
                .accessibilityIdentifier("showtimes.filters")
            }
        }
        .sheet(isPresented: $showingFilters) {
            NavigationStack { ShowtimePreferencesView() }
        }
        .onChange(of: account.preferences.hideReReleases) { _, hidden in
            if hidden { selectedCategory = .newReleases }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await store.loadCatalog(.nowPlaying)
            await store.loadCities()
        }
        .task(id: request) {
            guard isActive else { return }
            if movieData == nil { await store.loadCatalog(.nowPlaying) }
            guard !Task.isCancelled else { return }
            await store.loadShowtimes(request)
        }
        .refreshable {
            await store.loadCatalog(.nowPlaying, forceRefresh: true)
            let updatedRequest = store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
            await store.loadShowtimes(updatedRequest, forceRefresh: true)
        }
    }

    @ViewBuilder
    private var content: some View {
        if movieData == nil, store.catalogLoading.contains(.nowPlaying) {
            LoadingState(message: "Loading movies…")
        } else if let error = store.catalogErrors[.nowPlaying], movieData == nil {
            ErrorState(message: error) {
                Task { await store.loadCatalog(.nowPlaying, forceRefresh: true) }
            }
        } else if let error = store.showtimeErrors[request], rows == nil {
            ErrorState(message: error) {
                Task { await store.loadShowtimes(request, forceRefresh: true) }
            }
        } else if store.showtimeLoading.contains(request), rows == nil {
            LoadingState(message: "Loading showtimes…")
        } else if let rows {
            let groups = ShowtimeLogic.group(rows, movies: visibleMovies, city: request.city, day: request.day, at: store.currentInstant, preferences: account.preferences.showtimePreferences)
            if groups.isEmpty {
                EmptyState(title: "No showtimes found", message: "Try another city, day, or screening filter.")
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(groups) { group in MovieShowtimeCard(group: group, city: request.city) }
                }
            }
        } else {
            LoadingState(message: "Loading showtimes…")
        }
    }

    @ViewBuilder
    private var releaseCategoryPicker: some View {
        if !account.preferences.hideReReleases {
            Picker("Release category", selection: $selectedCategory) {
                ForEach(ShowtimeLogic.ReleaseCategory.allCases) { category in
                    Text(category.title).tag(category)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("showtimes.releaseCategory")
        }
    }
}
