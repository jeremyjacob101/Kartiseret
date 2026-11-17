import SwiftUI

struct DiscoverView: View {
    let isActive: Bool
    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var account
    @State private var showingSearch = false

    private var nowPlaying: [Movie] { account.displayedMovies(store.catalogs[.nowPlaying]?.data.movies ?? [], mode: .nowPlaying) }
    private var comingSoon: [Movie] { account.displayedMovies(store.catalogs[.comingSoon]?.data.movies ?? [], mode: .comingSoon) }
    private var newReleases: [Movie] { ShowtimeLogic.movies(nowPlaying, category: .newReleases) }
    private var reReleases: [Movie] { ShowtimeLogic.movies(nowPlaying, category: .reReleases) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                introduction
                catalogError
                if !newReleases.isEmpty {
                    MovieShelf(title: "New Releases", subtitle: "Now Playing", movies: newReleases, mode: .nowPlaying)
                } else if store.catalogLoading.contains(.nowPlaying) {
                    LoadingState(message: "Finding what’s playing…")
                }
                if !comingSoon.isEmpty {
                    MovieShelf(title: "Coming Soon", subtitle: "On the horizon", movies: comingSoon, mode: .comingSoon)
                } else if store.catalogLoading.contains(.comingSoon) {
                    LoadingState(message: "Loading upcoming films…")
                }
                if !account.preferences.hideReReleases, !reReleases.isEmpty {
                    MovieShelf(title: "Re-Releases", subtitle: "Back on the big screen", movies: reReleases, mode: .nowPlaying)
                }
                if nowPlaying.isEmpty && comingSoon.isEmpty && !store.catalogLoading.contains(.nowPlaying) && !store.catalogLoading.contains(.comingSoon) {
                    EmptyState(title: "No movies available", message: "Pull down to refresh the catalogs.")
                }
            }
            .padding(.top, 12)
            .padding(.bottom, 28)
        }
        .background(BrandStyle.background)
        .navigationTitle("Kartiseret")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingSearch = true } label: {
                    Image(systemName: "magnifyingglass").font(.headline)
                }
                .accessibilityLabel("Search movies")
                .accessibilityIdentifier("discover.search")
            }
        }
        .sheet(isPresented: $showingSearch) {
            NavigationStack {
                CatalogSearchView()
                    .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
            }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await store.loadCatalog(.nowPlaying)
            guard !Task.isCancelled else { return }
            await store.loadCatalog(.comingSoon)
        }
        .refreshable {
            await store.loadCatalog(.nowPlaying, forceRefresh: true)
            await store.loadCatalog(.comingSoon, forceRefresh: true)
        }
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("ISRAELI CINEMA, ALL IN ONE PLACE")
                .font(.caption.weight(.bold)).tracking(1.2).foregroundStyle(BrandStyle.accent)
            Text("Find your next\nnight at the movies.")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Label(store.selectedCity, systemImage: "mappin.and.ellipse")
                Text("·").foregroundStyle(BrandStyle.secondary)
                Text("Showtimes, films, and local cinemas")
            }
            .font(.subheadline).foregroundStyle(BrandStyle.secondary)
            HStack(spacing: 10) {
                NavigationLink(value: CatalogMode.nowPlaying) {
                    Label("Now Playing", systemImage: "film")
                }
                .accessibilityIdentifier("discover.nowPlaying")
                NavigationLink(value: CatalogMode.comingSoon) {
                    Label("Coming Soon", systemImage: "calendar")
                }
                .accessibilityIdentifier("discover.comingSoon")
            }
            .buttonStyle(.bordered)
            .tint(BrandStyle.accent)
            .padding(.top, 3)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            LinearGradient(colors: [BrandStyle.raised, BrandStyle.background], startPoint: .topLeading, endPoint: .bottomTrailing)
        }
    }

    @ViewBuilder
    private var catalogError: some View {
        if let error = store.catalogErrors[.nowPlaying] ?? store.catalogErrors[.comingSoon] {
            InlineError(message: error) {
                Task {
                    await store.loadCatalog(.nowPlaying, forceRefresh: true)
                    await store.loadCatalog(.comingSoon, forceRefresh: true)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct MovieShelf: View {
    let title: String
    let subtitle: String
    let movies: [Movie]
    let mode: CatalogMode
    @Environment(AccountStore.self) private var account

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(subtitle.uppercased()).font(.caption.weight(.bold)).tracking(1).foregroundStyle(BrandStyle.accent)
                    Text(title).font(.title2.weight(.bold)).foregroundStyle(.white)
                }
                Spacer()
                NavigationLink(value: mode) {
                    HStack(spacing: 4) { Text("See all"); Image(systemName: "chevron.right") }
                        .font(.subheadline.weight(.semibold))
                }
            }
            .padding(.horizontal, 18)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(movies.prefix(12)) { movie in
                        NavigationLink(value: MovieRoute(mode: mode, movieID: movie.tmdbId)) {
                            VStack(alignment: .leading, spacing: 8) {
                                MovieArtwork(movie: movie, width: 132, height: 198)
                                    .overlay(alignment: .bottomLeading) {
                                        if movie.year > 0 {
                                            Text(String(movie.year))
                                                .font(.caption2.weight(.bold)).padding(.horizontal, 7).padding(.vertical, 4)
                                                .background(.black.opacity(0.7), in: Capsule()).padding(7)
                                        }
                                    }
                                Text(movie.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                    .lineLimit(2).frame(width: 132, alignment: .leading)
                                MovieRatingsView(movie: movie, sources: account.preferences.ratingSources)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("movie.\(movie.tmdbId)")
                    }
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }
}

private struct CatalogSearchView: View {
    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var results: [CatalogSearchResult] {
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.count >= 2 else { return [] }
        let candidates = [
            (account.displayedMovies(store.catalogs[.nowPlaying]?.data.movies ?? [], mode: .nowPlaying), CatalogMode.nowPlaying),
            (account.displayedMovies(store.catalogs[.comingSoon]?.data.movies ?? [], mode: .comingSoon), CatalogMode.comingSoon),
        ].flatMap { movies, mode in movies.map { ($0, mode) } }
        var seen = Set<String>()
        return candidates.compactMap { movie, mode -> (movie: Movie, mode: CatalogMode, score: Int)? in
            guard seen.insert(movie.tmdbId).inserted else { return nil }
            let title = movie.title.lowercased()
            let year = String(movie.year)
            let score: Int
            if title == normalized { score = 500 }
            else if title.hasPrefix(normalized) { score = 400 }
            else if title.contains(" \(normalized)") { score = 320 }
            else if title.contains(normalized) { score = 240 }
            else if year == normalized { score = 180 }
            else if "\(title) \(year)".contains(normalized) { score = 120 }
            else { score = 0 }
            return score > 0 ? (movie, mode, score) : nil
        }
        .sorted { $0.score == $1.score ? $0.movie.title < $1.movie.title : $0.score > $1.score }
        .prefix(20)
        .map { CatalogSearchResult(movie: $0.movie, mode: $0.mode) }
    }

    var body: some View {
        List {
            if query.trimmingCharacters(in: .whitespaces).count < 2 {
                ContentUnavailableView("Search movies", systemImage: "magnifyingglass", description: Text("Search Now Playing and Coming Soon by title or year."))
            } else if results.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                ForEach(results) { result in
                    NavigationLink(value: MovieRoute(mode: result.mode, movieID: result.movie.tmdbId)) {
                        HStack(spacing: 12) {
                            MovieArtwork(movie: result.movie, width: 48, height: 72)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.movie.title).font(.headline)
                                Text("\(result.mode.title) · \(result.movie.year)").font(.caption).foregroundStyle(.secondary)
                                MovieRatingsView(movie: result.movie, sources: account.preferences.ratingSources)
                            }
                        }
                    }
                    .accessibilityIdentifier("search.result.\(result.movie.tmdbId)")
                }
            }
        }
        .searchable(text: $query, prompt: "Movie title or year")
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .task {
            await store.loadCatalog(.nowPlaying)
            await store.loadCatalog(.comingSoon)
        }
    }
}

private struct CatalogSearchResult: Identifiable {
    let movie: Movie
    let mode: CatalogMode
    var id: String { movie.tmdbId }
}
