import SwiftUI

struct CatalogView: View {
    let mode: CatalogMode
    let isActive: Bool

    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var category: ShowtimeLogic.ReleaseCategory = .newReleases
    @State private var query = ""

    private var snapshot: CatalogSnapshot? { store.catalogs[mode] }

    private var visibleMovies: [Movie] {
        let movies = account.displayedMovies(snapshot?.data.movies ?? [], mode: mode)
        let categorized = mode == .nowPlaying && !account.preferences.hideReReleases
            ? ShowtimeLogic.movies(movies, category: category)
            : movies
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !search.isEmpty else { return categorized }
        return categorized.filter { "\($0.title) \($0.year)".localizedCaseInsensitiveContains(search) }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if mode == .nowPlaying && !account.preferences.hideReReleases {
                    Picker("Release category", selection: $category) {
                        ForEach(ShowtimeLogic.ReleaseCategory.allCases) { item in Text(item.title).tag(item) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("catalog.releaseCategory")
                }
                if snapshot != nil {
                    if let message = store.catalogErrors[mode] {
                        InlineError(message: message) { Task { await store.loadCatalog(mode, forceRefresh: true) } }
                    }
                    if visibleMovies.isEmpty {
                        EmptyState(title: query.isEmpty ? "No movies right now" : "No matching movies", message: query.isEmpty ? "Check back later for updates." : "Try another title or year.")
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 112, maximum: 190), spacing: 14)], alignment: .leading, spacing: 20) {
                            ForEach(visibleMovies) { movie in
                                NavigationLink(value: MovieRoute(mode: mode, movieID: movie.tmdbId)) {
                                    MoviePosterTile(movie: movie, mode: mode, ratingSources: account.preferences.ratingSources)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("movie.\(movie.tmdbId)")
                            }
                        }
                    }
                } else if store.catalogLoading.contains(mode) {
                    LoadingState(message: "Loading movies…")
                } else if let error = store.catalogErrors[mode] {
                    ErrorState(message: error) { Task { await store.loadCatalog(mode, forceRefresh: true) } }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle(mode.title)
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Search movies or year")
        .task(id: isActive) {
            guard isActive else { return }
            await store.loadCatalog(mode)
        }
        .refreshable { await store.loadCatalog(mode, forceRefresh: true) }
    }
}

private struct MoviePosterTile: View {
    let movie: Movie
    let mode: CatalogMode
    let ratingSources: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            GeometryReader { geometry in
                MovieArtwork(movie: movie, width: geometry.size.width, height: geometry.size.width * 220 / 148)
                    .overlay(alignment: .bottomLeading) {
                        if mode == .comingSoon, let releaseDate = movie.releaseDate {
                            Label(releaseDate, systemImage: "calendar")
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8).padding(.vertical, 5)
                                .background(.black.opacity(0.75), in: Capsule())
                                .padding(7)
                        }
                    }
                }
            .aspectRatio(148 / 220, contentMode: .fit)
            Text(movie.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(movie.year > 0 ? String(movie.year) : "")
                .font(.caption)
                .foregroundStyle(BrandStyle.secondary)
            MovieRatingsView(movie: movie, sources: ratingSources, linksEnabled: false)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .contentShape(Rectangle())
    }

}

struct MovieRow: View {
    let movie: Movie
    let mode: CatalogMode

    var body: some View {
        HStack(spacing: 14) {
            MovieArtwork(movie: movie, width: 76, height: 110)
            VStack(alignment: .leading, spacing: 7) {
                Text(movie.title).font(.headline).foregroundStyle(.white).lineLimit(2)
                Text(movie.year > 0 ? String(movie.year) : "").font(.subheadline).foregroundStyle(BrandStyle.secondary)
                if mode == .comingSoon, let releaseDate = movie.releaseDate {
                    Text("Releases \(releaseDate)").font(.caption).foregroundStyle(BrandStyle.accent)
                } else if !movie.genres.isEmpty {
                    Text(movie.genres.joined(separator: " · ")).font(.caption).foregroundStyle(BrandStyle.secondary).lineLimit(1)
                }
                MovieRatingsView(movie: movie, sources: ["imdbRating", "rtAudienceRating", "rtCriticRating"], linksEnabled: false)
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(BrandStyle.secondary)
        }
        .padding(10)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}
