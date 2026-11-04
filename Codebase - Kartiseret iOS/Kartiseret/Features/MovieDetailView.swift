import SwiftUI

struct MovieDetailView: View {
    let route: MovieRoute
    @Environment(AppStore.self) private var store

    private var movie: Movie? {
        store.catalogs[route.mode]?.data.movies.first { $0.tmdbId == route.movieID }
    }

    private var request: ShowtimeRequest {
        store.makeShowtimeRequest(mode: route.mode, movieID: route.movieID)
    }

    private var rows: [Showtime]? { store.showtimes[request] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let movie {
                    header(movie)
                    SelectionControls()
                    showtimeContent(movie)
                } else if store.catalogLoading.contains(route.mode) {
                    LoadingState(message: "Loading movie…")
                } else if let error = store.catalogErrors[route.mode] {
                    ErrorState(message: error) {
                        Task { await store.loadCatalog(route.mode, forceRefresh: true) }
                    }
                } else {
                    EmptyState(title: "Movie unavailable", message: "This title is no longer listed.")
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle(movie?.title ?? "Movie")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: request) {
            await store.loadCatalog(route.mode)
            guard !Task.isCancelled else { return }
            await store.loadCities()
            guard !Task.isCancelled else { return }
            await store.loadShowtimes(request)
        }
        .refreshable {
            await store.loadCatalog(route.mode, forceRefresh: true)
            let updatedRequest = store.makeShowtimeRequest(mode: route.mode, movieID: route.movieID)
            await store.loadShowtimes(updatedRequest, forceRefresh: true)
        }
    }

    private func header(_ movie: Movie) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                MovieArtwork(width: 108, height: 158)
                VStack(alignment: .leading, spacing: 9) {
                    Text(route.mode == .nowPlaying ? "NOW PLAYING" : "COMING SOON")
                        .font(.caption.weight(.bold))
                        .tracking(1.3)
                        .foregroundStyle(BrandStyle.accent)
                    Text(movie.title)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.white)
                        .accessibilityIdentifier("movie.details.title")
                    Text(metadata(for: movie).joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(BrandStyle.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if route.mode == .comingSoon, let releaseDate = movie.releaseDate {
                        Text("Release date: \(releaseDate)")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(.white)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func showtimeContent(_ movie: Movie) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Showtimes")
                .font(.title3.weight(.bold))
                .foregroundStyle(.white)
            if let error = store.showtimeErrors[request], rows == nil {
                ErrorState(message: error) {
                    Task { await store.loadShowtimes(request, forceRefresh: true) }
                }
            } else if store.showtimeLoading.contains(request), rows == nil {
                LoadingState(message: "Loading showtimes…")
            } else if let rows {
                let groups = ShowtimeLogic.group(rows, movies: [movie], city: request.city, day: request.day, at: store.currentInstant)
                if let group = groups.first {
                    ShowtimeSections(cinemas: group.cinemas)
                } else {
                    EmptyState(
                        title: "No showtimes found",
                        message: "There are no screenings for \(request.city) on \(request.day.displayName)."
                    )
                }
            } else {
                LoadingState(message: "Loading showtimes…")
            }
        }
    }

    private func metadata(for movie: Movie) -> [String] {
        var items = [String(movie.year)]
        if movie.runtime > 0 { items.append("\(movie.runtime) min") }
        if !movie.genres.isEmpty { items.append(movie.genres.joined(separator: ", ")) }
        return items
    }
}
