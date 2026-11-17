import SwiftUI

struct MovieDetailView: View {
    let route: MovieRoute

    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var account
    @Environment(\.openURL) private var openURL
    @State private var showingFilters = false
    @State private var actionMessage: String?
    @State private var actionError: String?
    @State private var ticketAlertSaved = false
    @State private var releaseWatchSaved = false
    @State private var isSavingAction = false

    private var movie: Movie? {
        let source = route.movie ?? store.catalogs[route.mode]?.data.movies.first { $0.tmdbId == route.movieID }
        return source.flatMap(account.displayedMovie)
    }

    private var request: ShowtimeRequest {
        store.makeShowtimeRequest(mode: route.mode, movieID: route.movieID)
    }

    private var rows: [Showtime]? { store.showtimes[request] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let movie {
                    header(movie)
                    SelectionControls()
                    showtimeContent(movie)
                } else if store.catalogLoading.contains(route.mode) {
                    LoadingState(message: "Loading movie…")
                } else if let error = store.catalogErrors[route.mode] {
                    ErrorState(message: error) { Task { await store.loadCatalog(route.mode, forceRefresh: true) } }
                } else {
                    EmptyState(title: "Movie unavailable", message: "This title may have been removed from your personalized movie views.")
                }
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(BrandStyle.background)
        .navigationTitle(movie?.title ?? "Movie")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if let movie, let shareURL = shareURL(for: movie) {
                    ShareLink(item: shareURL, subject: Text(movie.title)) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share \(movie.title)")
                }
                Button { showingFilters = true } label: { Image(systemName: "line.3.horizontal.decrease.circle") }
                    .accessibilityLabel("Showtime filters")
            }
        }
        .sheet(isPresented: $showingFilters) {
            NavigationStack { ShowtimePreferencesView() }
        }
        .task(id: request) {
            if route.movie == nil { await store.loadCatalog(route.mode) }
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
        .alert("Kartiseret", isPresented: Binding(
            get: { actionMessage != nil || actionError != nil },
            set: { if !$0 { actionMessage = nil; actionError = nil } }
        )) {
            Button("OK", role: .cancel) { actionMessage = nil; actionError = nil }
        } message: {
            Text(actionError ?? actionMessage ?? "")
        }
    }

    private func header(_ movie: Movie) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ZStack(alignment: .bottomLeading) {
                backdrop(movie)
                LinearGradient(colors: [.clear, BrandStyle.background.opacity(0.95)], startPoint: .center, endPoint: .bottom)
                HStack(alignment: .bottom, spacing: 14) {
                    MovieArtwork(movie: movie, width: 104, height: 152)
                        .shadow(color: .black.opacity(0.35), radius: 12, y: 6)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(route.mode == .nowPlaying ? "NOW PLAYING" : "COMING SOON")
                            .font(.caption.weight(.bold)).tracking(1.3).foregroundStyle(BrandStyle.accent)
                        Text(movie.title).font(.title2.weight(.bold)).foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("movie.details.title")
                        Text(metadata(for: movie).joined(separator: " · ")).font(.subheadline).foregroundStyle(BrandStyle.secondary)
                        if route.mode == .comingSoon, let releaseDate = movie.releaseDate {
                            Label(releaseDate, systemImage: "calendar").font(.caption.weight(.medium)).foregroundStyle(.white)
                        }
                    }
                    .padding(.bottom, 4)
                }
                .padding(14)
            }
            .frame(height: 248)
            .clipShape(RoundedRectangle(cornerRadius: 20))

            if !movie.genres.isEmpty {
                FlowChips(items: movie.genres)
            }
            MovieRatingsView(movie: movie, sources: account.preferences.ratingSources)
            actions(for: movie)
        }
    }

    @ViewBuilder
    private func backdrop(_ movie: Movie) -> some View {
        if let url = AppConfiguration.imageURL(movie.backdropSrc) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() }
                else { BrandStyle.raised }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 248)
            .clipped()
        } else {
            LinearGradient(colors: [BrandStyle.raised, BrandStyle.background], startPoint: .topLeading, endPoint: .bottomTrailing)
                .frame(height: 248)
                .overlay(alignment: .topTrailing) { Image(systemName: "film.stack").font(.system(size: 50, weight: .light)).foregroundStyle(.white.opacity(0.14)).padding(24) }
        }
    }

    @ViewBuilder
    private func actions(for movie: Movie) -> some View {
        HStack(spacing: 10) {
            if let trailerKey = movie.trailerKey, let url = URL(string: "https://www.youtube.com/watch?v=\(trailerKey)") {
                Button { openURL(url) } label: { Label("Trailer", systemImage: "play.fill") }
                    .buttonStyle(.bordered).tint(BrandStyle.accent)
            }
            if account.state == .signedIn {
                Button { Task { await saveTicketAlert(for: movie) } } label: {
                    Label(ticketAlertSaved ? "Watching tickets" : "Ticket alert", systemImage: ticketAlertSaved ? "bell.badge.fill" : "bell.badge")
                }
                .buttonStyle(.borderedProminent).tint(BrandStyle.accent)
                .disabled(isSavingAction || ticketAlertSaved)
                if route.mode == .comingSoon {
                    Button { Task { await saveReleaseWatch(for: movie) } } label: {
                        Label(releaseWatchSaved ? "Watching date" : "Watch release", systemImage: "calendar.badge.clock")
                    }
                    .buttonStyle(.bordered).tint(BrandStyle.accent)
                    .disabled(isSavingAction || releaseWatchSaved)
                }
            } else {
                NavigationLink { SignInView() } label: { Label("Sign in for alerts", systemImage: "bell.badge") }
                    .buttonStyle(.borderedProminent).tint(BrandStyle.accent)
            }
        }
        .controlSize(.regular)
        if isSavingAction { ProgressView("Saving your alert…").font(.caption).tint(BrandStyle.accent) }
    }

    @ViewBuilder
    private func showtimeContent(_ movie: Movie) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Showtimes").font(.title3.weight(.bold)).foregroundStyle(.white)
                Spacer()
                Button { showingFilters = true } label: { Label("Filters", systemImage: "line.3.horizontal.decrease") }
                    .font(.caption.weight(.semibold)).buttonStyle(.bordered).tint(BrandStyle.accent)
            }
            if let error = store.showtimeErrors[request], rows == nil {
                ErrorState(message: error) { Task { await store.loadShowtimes(request, forceRefresh: true) } }
            } else if store.showtimeLoading.contains(request), rows == nil {
                LoadingState(message: "Loading showtimes…")
            } else if let rows {
                let groups = ShowtimeLogic.group(rows, movies: [movie], city: request.city, day: request.day, at: store.currentInstant, preferences: account.preferences.showtimePreferences)
                if let group = groups.first { ShowtimeSections(cinemas: group.cinemas, city: request.city) }
                else { EmptyState(title: "No showtimes found", message: "Try another day or adjust your saved screening filters.") }
            } else {
                LoadingState(message: "Loading showtimes…")
            }
        }
    }

    private func metadata(for movie: Movie) -> [String] {
        var items = [String(movie.year)]
        if movie.runtime > 0 { items.append("\(movie.runtime) min") }
        return items
    }

    private func shareURL(for movie: Movie) -> URL? {
        guard let code = movie.movieCode, !code.isEmpty else {
            return URL(string: "https://www.themoviedb.org/movie/\(movie.tmdbId)")
        }
        return URL(string: "https://seret.site/\(code)")
    }

    private func saveTicketAlert(for movie: Movie) async {
        isSavingAction = true
        defer { isSavingAction = false }
        do {
            let data = try JSONEncoder().encode(TicketAlertCreate(tmdbId: movie.tmdbId))
            let result: TicketAlertChange = try await account.requestPrivate(path: "/api/v1/ticket-alerts", method: "POST", body: data, as: TicketAlertChange.self)
            if result.kind == "available" {
                actionMessage = "Tickets are already available. Check the showtimes for \(movie.title)."
            } else {
                ticketAlertSaved = true
                actionMessage = "We’ll let you know when \(movie.title) has ticketable screenings."
            }
        } catch { actionError = error.localizedDescription }
    }

    private func saveReleaseWatch(for movie: Movie) async {
        isSavingAction = true
        defer { isSavingAction = false }
        do {
            let path = movie.imageSrc.flatMap { $0.hasPrefix("/") ? $0 : nil }
            let body = try JSONEncoder().encode(ComingSoonWatchCreate(tmdbId: movie.tmdbId, title: movie.title, releaseYear: movie.year > 0 ? movie.year : nil, posterPath: path))
            let result: ComingSoonWatchChange = try await account.requestPrivate(path: "/api/v1/coming-soon-watches", method: "POST", body: body, as: ComingSoonWatchChange.self)
            if result.kind == "known" {
                actionMessage = "A release date is already available for \(movie.title)."
            } else {
                releaseWatchSaved = true
                actionMessage = "We’ll let you know when \(movie.title) receives a release date."
            }
        } catch { actionError = error.localizedDescription }
    }
}

private struct FlowChips: View {
    let items: [String]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(items, id: \.self) { item in
                    Text(item).font(.caption).foregroundStyle(BrandStyle.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(BrandStyle.surface, in: Capsule())
                }
            }
        }
        .scrollIndicators(.hidden)
    }
}

private struct TicketAlertCreate: Encodable { let tmdbId: String }
private struct TicketAlertChange: Decodable { let kind: String }
private struct ComingSoonWatchCreate: Encodable {
    let tmdbId: String
    let title: String
    let releaseYear: Int?
    let posterPath: String?
}
private struct ComingSoonWatchChange: Decodable { let kind: String }
