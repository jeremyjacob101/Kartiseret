import SwiftUI

struct CatalogTabView: View {
    let mode: MovieMode
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(AppRouter.self) private var router
    @State private var selectedMovieID: String?
    @State private var path: [AppRoute] = []

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                NavigationSplitView {
                    NavigationStack {
                        CatalogGridContent(mode: mode, selectedMovieID: $selectedMovieID)
                            .navigationTitle(mode.title)
                    }
                    .navigationSplitViewColumnWidth(min: 340, ideal: 500, max: 660)
                } detail: {
                    NavigationStack {
                        if let id = selectedMovieID, let movie = catalogStore.movie(mode: mode, tmdbID: id) {
                            MovieDetailView(movie: movie)
                        } else {
                            ContentUnavailableView(
                                "Choose a movie",
                                systemImage: mode == .nowPlaying ? "film.stack" : "calendar.badge.clock",
                                description: Text("Select a poster to see details and showtimes.")
                            )
                        }
                    }
                }
                .brandBackground()
            } else {
                NavigationStack(path: $path) {
                    CatalogGridContent(mode: mode, selectedMovieID: nil)
                        .navigationTitle(mode.title)
                        .appDestinations()
                }
            }
        }
        .onChange(of: router.pendingRoute) { _, route in
            let tab: AppTab = mode == .nowPlaying ? .nowPlaying : .comingSoon
            guard router.selectedTab == tab, let route else { return }
            if case .movieDetail(let routeMode, let id) = route, routeMode == mode, horizontalSizeClass == .regular {
                selectedMovieID = id
            } else if horizontalSizeClass != .regular {
                path.append(route)
            }
            router.pendingRoute = nil
        }
    }
}

struct CatalogGridScreen: View {
    let mode: MovieMode
    var body: some View {
        CatalogGridContent(mode: mode, selectedMovieID: nil)
            .navigationTitle(mode.title)
    }
}

private struct CatalogGridContent: View {
    let mode: MovieMode
    var selectedMovieID: Binding<String?>?

    @Environment(CatalogStore.self) private var catalogStore
    @State private var searchText = ""

    private var state: LoadState<[Movie]> {
        mode == .nowPlaying ? catalogStore.nowPlayingState : catalogStore.comingSoonState
    }
    private var movies: [Movie] {
        let values = mode == .nowPlaying ? catalogStore.nowPlaying : catalogStore.comingSoon
        guard !searchText.isEmpty else { return values }
        return MovieSearchEngine.search(
            query: searchText,
            nowPlaying: mode == .nowPlaying ? values : [],
            comingSoon: mode == .comingSoon ? values : [],
            scope: mode == .nowPlaying ? .nowPlaying : .comingSoon,
            limit: values.count
        ).map(\.movie)
    }

    var body: some View {
        ScrollView {
            Group {
                if !movies.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 145, maximum: 205), spacing: 16)], alignment: .leading, spacing: 24) {
                        ForEach(movies) { movie in
                            movieLink(movie)
                        }
                    }
                } else {
                    stateContent
                }
            }
            .padding()
        }
        .scrollIndicators(.hidden)
        .searchable(text: $searchText, prompt: "Search \(mode.title.lowercased())")
        .refreshable { await catalogStore.refresh(mode) }
        .brandBackground()
    }

    @ViewBuilder
    private func movieLink(_ movie: Movie) -> some View {
        if let selectedMovieID {
            Button { selectedMovieID.wrappedValue = movie.tmdbID } label: {
                PosterCard(movie: movie)
                    .padding(5)
                    .background(
                        RoundedRectangle(cornerRadius: 15)
                            .stroke(selectedMovieID.wrappedValue == movie.tmdbID ? Color.accentColor : .clear, lineWidth: 2)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("catalog.movie.\(movie.tmdbID)")
        } else {
            NavigationLink(value: AppRoute.movieDetail(mode: movie.mode, tmdbID: movie.tmdbID)) {
                PosterCard(movie: movie)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("catalog.movie.\(movie.tmdbID)")
        }
    }

    @ViewBuilder
    private var stateContent: some View {
        switch state {
        case .idle, .loading:
            LoadingPosterGrid()
        case .empty, .loaded:
            ContentUnavailableCard(
                title: searchText.isEmpty ? "No movies available" : "No matches",
                message: searchText.isEmpty ? "The catalog is currently empty." : "Try another title or year.",
                systemImage: "film"
            )
        case .failed(let message, _):
            ContentUnavailableCard(title: "Couldn’t load movies", message: message, systemImage: "wifi.exclamationmark", actionTitle: "Try Again") {
                Task { await catalogStore.refresh(mode) }
            }
        }
    }
}
