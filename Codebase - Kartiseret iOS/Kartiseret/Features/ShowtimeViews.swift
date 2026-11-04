import SwiftUI

struct ShowtimeSections: View {
    let cinemas: [CinemaShowtimes]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(cinemas) { cinema in
                VStack(alignment: .leading, spacing: 8) {
                    Text(cinema.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                    ForEach(cinema.showtimes) { showtime in
                        ShowtimeRow(showtime: showtime)
                    }
                }
                .padding(12)
                .background(BrandStyle.raised, in: RoundedRectangle(cornerRadius: 13))
            }
        }
    }
}

private struct ShowtimeRow: View {
    let showtime: Showtime
    @Environment(AppStore.self) private var store
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 8) {
            Text(showtime.displayTime)
                .font(.subheadline.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
                .frame(minWidth: 46, alignment: .leading)
            if !showtime.formatLabels.isEmpty {
                Text(showtime.formatLabels.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(BrandStyle.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 2)
            if let url = showtime.bookingURL {
                Button {
                    openURL(url)
                    store.captureFixtureBookingURL(url)
                } label: {
                    Label("Tickets", systemImage: "arrow.up.right")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(BrandStyle.accent)
                .accessibilityIdentifier("booking.\(showtime.tmdbId)")
            }
        }
        .padding(.vertical, 3)
    }
}

struct MovieShowtimeCard: View {
    let group: MovieShowtimes

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: MovieRoute(mode: .nowPlaying, movieID: group.movie.tmdbId)) {
                HStack(spacing: 12) {
                    MovieArtwork(urlString: group.movie.imageSrc, width: 54, height: 78)
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
            ShowtimeSections(cinemas: group.cinemas)
        }
        .padding(14)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct ShowtimesView: View {
    let isActive: Bool
    @Environment(AppStore.self) private var store

    private var request: ShowtimeRequest {
        store.makeShowtimeRequest(mode: .nowPlaying, movieID: nil)
    }

    private var movieData: MovieCatalogData? { store.catalogs[.nowPlaying]?.data }
    private var rows: [Showtime]? { store.showtimes[request] }
    private var groups: [MovieShowtimes] {
        guard let rows, let movies = movieData?.movies else { return [] }
        return ShowtimeLogic.group(rows, movies: movies, city: request.city, day: request.day, at: store.currentInstant)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                SelectionControls()
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
            let groups = ShowtimeLogic.group(rows, movies: movieData?.movies ?? [], city: request.city, day: request.day, at: store.currentInstant)
            if groups.isEmpty {
                EmptyState(title: "No showtimes found", message: "Try another city or day.")
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(groups) { group in MovieShowtimeCard(group: group) }
                }
            }
        } else {
            LoadingState(message: "Loading showtimes…")
        }
    }
}
