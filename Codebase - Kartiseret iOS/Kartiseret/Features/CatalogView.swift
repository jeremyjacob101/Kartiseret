import SwiftUI

struct CatalogView: View {
    let mode: CatalogMode
    let isActive: Bool

    @Environment(AppStore.self) private var store

    private var snapshot: CatalogSnapshot? { store.catalogs[mode] }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                if let snapshot {
                    if let message = store.catalogErrors[mode] {
                        InlineError(message: message) {
                            Task { await store.loadCatalog(mode, forceRefresh: true) }
                        }
                    }
                    if snapshot.data.movies.isEmpty {
                        EmptyState(title: "No movies right now", message: "Check back later for updates.")
                    } else {
                        ForEach(snapshot.data.movies) { movie in
                            NavigationLink(value: MovieRoute(mode: mode, movieID: movie.tmdbId)) {
                                MovieRow(movie: movie, mode: mode)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("movie.\(movie.tmdbId)")
                        }
                    }
                } else if store.catalogLoading.contains(mode) {
                    LoadingState(message: "Loading movies…")
                } else if let error = store.catalogErrors[mode] {
                    ErrorState(message: error) {
                        Task { await store.loadCatalog(mode, forceRefresh: true) }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle(mode.title)
        .navigationBarTitleDisplayMode(.large)
        .task(id: isActive) {
            guard isActive else { return }
            await store.loadCatalog(mode)
        }
        .refreshable {
            await store.loadCatalog(mode, forceRefresh: true)
        }
    }
}

struct MovieRow: View {
    let movie: Movie
    let mode: CatalogMode

    var body: some View {
        HStack(spacing: 14) {
            MovieArtwork(urlString: movie.imageSrc, width: 76, height: 110)
            VStack(alignment: .leading, spacing: 7) {
                Text(movie.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text(movie.yearLabel)
                    .font(.subheadline)
                    .foregroundStyle(BrandStyle.secondary)
                if mode == .comingSoon, let releaseDate = movie.releaseDate {
                    Text("Releases \(releaseDate)")
                        .font(.caption)
                        .foregroundStyle(BrandStyle.accent)
                } else if !movie.genres.isEmpty {
                    Text(movie.genres.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(BrandStyle.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandStyle.secondary)
        }
        .padding(10)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}

private extension Movie {
    var yearLabel: String { String(year) }
}
