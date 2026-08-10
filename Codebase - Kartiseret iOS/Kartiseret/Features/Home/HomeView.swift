import SwiftUI

struct HomeView: View {
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @Environment(Theme.self) private var theme

    @State private var path: [AppRoute] = []
    @State private var searchText = ""
    @State private var searchScope: SearchScope = .all

    private var searchResults: [MovieSearchResult] {
        MovieSearchEngine.search(
            query: searchText,
            nowPlaying: catalogStore.nowPlaying,
            comingSoon: catalogStore.comingSoon,
            scope: searchScope
        )
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    homeContent
                } else {
                    searchContent
                }
            }
            .navigationTitle("Kartiseret")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        router.sheet = .cityPicker
                    } label: {
                        Label(preferencesStore.city, systemImage: "mappin.and.ellipse")
                            .labelStyle(.titleAndIcon)
                    }
                    .accessibilityIdentifier("home.cityPicker")
                }
            }
            .searchable(text: $searchText, prompt: "Search movies or years")
            .searchScopes($searchScope) {
                ForEach(SearchScope.allCases) { scope in Text(scope.rawValue).tag(scope) }
            }
            .appDestinations()
            .onChange(of: router.pendingRoute) { _, route in
                guard router.selectedTab == .home, let route else { return }
                path.append(route)
                router.pendingRoute = nil
            }
        }
    }

    private var homeContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 30) {
                welcomePanel
                catalogSection(
                    title: "Now Playing",
                    subtitle: "In cinemas around \(preferencesStore.city)",
                    movies: catalogStore.nowPlaying,
                    state: catalogStore.nowPlayingState,
                    mode: .nowPlaying
                )
                catalogSection(
                    title: "Coming Soon",
                    subtitle: "Worth putting on your radar",
                    movies: catalogStore.comingSoon,
                    state: catalogStore.comingSoonState,
                    mode: .comingSoon
                )
                cityShowtimePrompt
            }
            .padding(.vertical, 12)
        }
        .refreshable {
            async let now: Void = catalogStore.refresh(.nowPlaying)
            async let soon: Void = catalogStore.refresh(.comingSoon)
            _ = await (now, soon)
        }
        .scrollIndicators(.hidden)
        .brandBackground()
    }

    private var welcomePanel: some View {
        ZStack(alignment: .bottomLeading) {
            LinearGradient(
                colors: [theme.tint.opacity(0.42), Color(hex: "#303345"), Theme.raisedBackground],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle().fill(theme.tint.opacity(0.18)).frame(width: 180).offset(x: 115, y: -65)
            VStack(alignment: .leading, spacing: 11) {
                BrandTitle()
                Text("Find the right movie, the right cinema, and the right time.")
                    .font(.title3.weight(.medium))
                    .foregroundStyle(Theme.primaryText)
                    .frame(maxWidth: 320, alignment: .leading)
                Button {
                    router.selectedTab = .showtimes
                } label: {
                    Label("Browse \(preferencesStore.city) Showtimes", systemImage: "ticket.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding(22)
        }
        .frame(minHeight: 210)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.08)))
        .padding(.horizontal)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func catalogSection(
        title: String,
        subtitle: String,
        movies: [Movie],
        state: LoadState<[Movie]>,
        mode: MovieMode
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeading(title: title, subtitle: subtitle, actionTitle: "View All") {
                path.append(.catalog(mode))
            }
            .padding(.horizontal)

            if !movies.isEmpty {
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 14) {
                        ForEach(movies.prefix(12)) { movie in
                            NavigationLink(value: AppRoute.movieDetail(mode: movie.mode, tmdbID: movie.tmdbID)) {
                                PosterCard(movie: movie, width: 132)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("home.movie.\(movie.tmdbID)")
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
                .scrollIndicators(.hidden)
            } else {
                switch state {
                case .loading, .idle:
                    ScrollView(.horizontal) {
                        HStack(spacing: 14) {
                            ForEach(0..<4, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: 12).fill(Theme.skeleton).frame(width: 132, height: 198)
                            }
                        }.padding(.horizontal)
                    }.scrollDisabled(true)
                case .failed(let message, _):
                    ContentUnavailableCard(
                        title: "Couldn’t load \(title.lowercased())",
                        message: message,
                        systemImage: "wifi.exclamationmark",
                        actionTitle: "Try Again"
                    ) {
                        Task { await catalogStore.refresh(mode) }
                    }
                    .padding(.horizontal)
                case .empty, .loaded:
                    ContentUnavailableCard(title: "Nothing here yet", message: "Check back soon for an updated catalog.")
                        .padding(.horizontal)
                }
            }
        }
    }

    private var cityShowtimePrompt: some View {
        Button {
            router.sheet = .cityPicker
        } label: {
            HStack(spacing: 15) {
                Image(systemName: "map.fill").font(.title2).foregroundStyle(theme.tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Showing \(preferencesStore.city)").font(.headline)
                    Text("Tap to choose another supported city").font(.subheadline).foregroundStyle(Theme.secondaryText)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Theme.tertiaryText)
            }
            .padding(18)
            .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .padding(.horizontal)
        .padding(.bottom, 24)
    }

    private var searchContent: some View {
        List {
            if searchResults.isEmpty {
                ContentUnavailableView.search(text: searchText)
                    .listRowBackground(Color.clear)
            } else {
                Section("Top matches") {
                    ForEach(searchResults) { result in
                        NavigationLink(value: AppRoute.movieDetail(mode: result.movie.mode, tmdbID: result.movie.tmdbID)) {
                            SearchResultRow(movie: result.movie)
                        }
                        .accessibilityIdentifier("search.result.\(result.movie.tmdbID)")
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .brandBackground()
    }
}

private struct SearchResultRow: View {
    let movie: Movie

    var body: some View {
        HStack(spacing: 13) {
            RemoteArtwork(url: movie.posterURL, title: movie.title, cornerRadius: 7)
                .frame(width: 52, height: 78)
            VStack(alignment: .leading, spacing: 5) {
                Text(movie.title).font(.headline).lineLimit(2)
                Text(movie.metadataLine).font(.subheadline).foregroundStyle(Theme.secondaryText).lineLimit(1)
                Text(movie.mode.title).font(.caption.weight(.semibold)).foregroundStyle(Color.accentColor)
            }
        }
        .padding(.vertical, 4)
    }
}
