import SwiftUI

struct MovieDetailView: View {
    let movie: Movie

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @Environment(Theme.self) private var theme

    private var shareURL: URL? {
        guard let movieCode = movie.movieCode else { return ShowtimeLinkCodec.movieURL(for: movie) }
        return ShowtimeLinkCodec.shareURL(
            for: .init(
                movieCode: movieCode,
                city: preferencesStore.city,
                date: catalogStore.selectedShowtimeDate,
                filters: catalogStore.showtimeFilters
            )
        ) ?? ShowtimeLinkCodec.movieURL(for: movie)
    }

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                regularLayout
            } else {
                compactLayout
            }
        }
        .navigationTitle(movie.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { shareToolbar }
        .task(id: loadIdentifier) {
            await catalogStore.ensureShowtimes(
                city: preferencesStore.city,
                date: catalogStore.selectedShowtimeDate,
                tmdbID: movie.tmdbID
            )
        }
        .brandBackground()
    }

    private var loadIdentifier: String {
        [preferencesStore.city, catalogStore.selectedShowtimeDate, movie.tmdbID].joined(separator: "::")
    }

    private var compactLayout: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                detailHero
                VStack(alignment: .leading, spacing: 24) {
                    movieSummary
                    actionRow
                    ratingSection
                    Divider().overlay(Theme.border)
                    MovieShowtimeBrowser(movie: movie)
                }
                .padding()
            }
        }
        .scrollIndicators(.hidden)
    }

    private var regularLayout: some View {
        GeometryReader { proxy in
            ScrollView {
                Group {
                    if proxy.size.width < 560 {
                        narrowRegularContent
                    } else if proxy.size.width < 1_080 {
                        mediumRegularContent(availableWidth: proxy.size.width)
                    } else {
                        wideRegularContent(availableWidth: proxy.size.width)
                    }
                }
            }
        }
    }

    private var narrowRegularContent: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            detailHero
            VStack(alignment: .leading, spacing: 24) {
                movieSummary(includesIdentity: false)
                actionRow
                ratingSection
                Divider().overlay(Theme.border)
                MovieShowtimeBrowser(movie: movie)
            }
            .padding()
        }
    }

    private func mediumRegularContent(availableWidth: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            RemoteArtwork(url: movie.backdropURL, title: movie.title, kind: .backdrop, cornerRadius: 20)
                .frame(height: min(310, availableWidth * 0.4))
            HStack(alignment: .top, spacing: 22) {
                RemoteArtwork(url: movie.posterURL, title: movie.title, cornerRadius: 14)
                    .frame(width: 150, height: 225)
                movieSummary(includesIdentity: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            actionRow
            ratingSection
            Divider().overlay(Theme.border)
            MovieShowtimeBrowser(movie: movie)
        }
        .padding(28)
    }

    private func wideRegularContent(availableWidth: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 20) {
                RemoteArtwork(url: movie.backdropURL, title: movie.title, kind: .backdrop, cornerRadius: 20)
                    .frame(height: 245)
                HStack(alignment: .top, spacing: 20) {
                    RemoteArtwork(url: movie.posterURL, title: movie.title, cornerRadius: 14)
                        .frame(width: 150, height: 225)
                    movieSummary(includesIdentity: true)
                }
                actionRow
                ratingSection
            }
            .frame(width: min(500, availableWidth * 0.42), alignment: .leading)

            Divider().overlay(Theme.border)

            MovieShowtimeBrowser(movie: movie)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .padding(28)
    }

    private var detailHero: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteArtwork(url: movie.backdropURL, title: movie.title, kind: .backdrop, cornerRadius: 0)
                .frame(height: 275)
            HStack(alignment: .bottom, spacing: 17) {
                RemoteArtwork(url: movie.posterURL, title: movie.title, cornerRadius: 12)
                    .frame(width: 112, height: 168)
                    .shadow(color: .black.opacity(0.45), radius: 10, y: 5)
                VStack(alignment: .leading, spacing: 7) {
                    modeBadge
                    Text(movie.title)
                        .font(.title2.bold())
                        .fixedSize(horizontal: false, vertical: true)
                    Text(movie.metadataLine)
                        .font(.subheadline)
                        .foregroundStyle(Theme.secondaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 8)
            }
            .padding(.horizontal)
        }
    }

    private var movieSummary: some View {
        movieSummary(includesIdentity: horizontalSizeClass == .regular)
    }

    private func movieSummary(includesIdentity: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if includesIdentity {
                modeBadge
                Text(movie.title)
                    .font(.largeTitle.bold())
                    .tracking(-0.7)
                    .fixedSize(horizontal: false, vertical: true)
                Text(movie.metadataLine)
                    .font(.body)
                    .foregroundStyle(Theme.secondaryText)
            }
            if movie.mode == .comingSoon, let date = movie.releaseDateValue {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("In cinemas").font(.caption).foregroundStyle(Theme.secondaryText)
                        Text(date.formatted(.dateTime.weekday(.wide).month(.wide).day().year()))
                            .font(.headline)
                    }
                } icon: {
                    Image(systemName: "calendar.badge.clock").foregroundStyle(theme.tint)
                }
                .padding(13)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 13))
            }
            if !movie.genres.isEmpty {
                FlowLayout(spacing: 7) {
                    ForEach(movie.genres, id: \.self) { genre in
                        Text(genre)
                            .font(.caption.weight(.medium))
                            .padding(.horizontal, 9)
                            .frame(minHeight: 30)
                            .background(Theme.elevatedSurface, in: Capsule())
                    }
                }
            }
        }
    }

    private var modeBadge: some View {
        Text(movie.mode.title.uppercased())
            .font(.caption2.weight(.bold))
            .tracking(0.9)
            .foregroundStyle(theme.tint)
    }

    private var actionRow: some View {
        HStack(spacing: 12) {
            if let trailerURL = movie.trailerURL {
                Button {
                    router.sheet = .trailer(url: trailerURL, title: "\(movie.title) Trailer")
                } label: {
                    Label("Watch Trailer", systemImage: "play.fill")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("detail.trailer")
            } else {
                Label("Trailer Unavailable", systemImage: "play.slash")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.tertiaryText)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
            }
            Button {
                router.sheet = .browser(
                    url: URL(string: "https://www.themoviedb.org/movie/\(movie.tmdbID)")!,
                    title: "TMDb"
                )
            } label: {
                Image(systemName: "info.circle")
                    .font(.title3)
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Open TMDb details")
        }
    }

    @ViewBuilder
    private var ratingSection: some View {
        let sources = preferencesStore.ratingSources.filter { $0.value(in: movie) != nil }
        if !sources.isEmpty {
            VStack(alignment: .leading, spacing: 11) {
                Text("Ratings").font(.headline)
                FlowLayout(spacing: 8) {
                    ForEach(sources) { source in
                        if let url = source.externalURL(for: movie) {
                            Button {
                                router.sheet = .browser(url: url, title: source.title)
                            } label: {
                                RatingPill(source: source, movie: movie)
                            }
                            .buttonStyle(.plain)
                        } else {
                            RatingPill(source: source, movie: movie)
                        }
                    }
                }
            }
        }
    }

    @ToolbarContentBuilder
    private var shareToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if let shareURL {
                ShareLink(
                    item: shareURL,
                    subject: Text(movie.title),
                    message: Text("See \(movie.title) showtimes on Kartiseret")
                ) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share \(movie.title)")
                .accessibilityIdentifier("detail.share")
            }
        }
    }
}

struct MovieShowtimeBrowser: View {
    let movie: Movie
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @Environment(Theme.self) private var theme

    private var day: MovieShowtimeDay {
        catalogStore.showtimeDay(
            movieID: movie.tmdbID,
            city: preferencesStore.city,
            date: catalogStore.selectedShowtimeDate,
            filters: catalogStore.showtimeFilters
        )
    }

    private var rawDay: MovieShowtimeDay {
        catalogStore.showtimeDay(
            movieID: movie.tmdbID,
            city: preferencesStore.city,
            date: catalogStore.selectedShowtimeDate,
            filters: .all
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Showtimes").font(.title2.bold())
                    Text(preferencesStore.city).font(.subheadline).foregroundStyle(Theme.secondaryText)
                }
                Spacer()
                Button {
                    router.sheet = .showtimeFilters
                } label: {
                    Label("Filters", systemImage: catalogStore.showtimeFilters.isDefault ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                        .font(.subheadline.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .frame(minHeight: 44)
            }

            ShowtimeDateStrip(selectedDate: selectedDateBinding, dayCount: ShowtimeLinkCodec.dateWindowCount)

            let state = catalogStore.showtimeState(
                city: preferencesStore.city,
                date: catalogStore.selectedShowtimeDate,
                tmdbID: movie.tmdbID
            )
            if !day.theaters.isEmpty {
                VStack(spacing: 0) {
                    ForEach(day.theaters) { theater in
                        TheaterShowtimeSection(theater: theater)
                    }
                }
                .padding(.horizontal, 14)
                .background(
                    LinearGradient(
                        colors: [Color(hex: "#0c0b2d").opacity(0.72), Color(hex: "#070618").opacity(0.58)],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    in: RoundedRectangle(cornerRadius: 17, style: .continuous)
                )
                .overlay(RoundedRectangle(cornerRadius: 17).stroke(Color(hex: "#6c7acd").opacity(0.18)))
            } else if state.isLoading && rawDay.theaters.isEmpty {
                ShowtimeLoadingRows()
            } else if !rawDay.theaters.isEmpty {
                ContentUnavailableCard(
                    title: "No matching screenings",
                    message: "The selected filters removed every screening for this date.",
                    systemImage: "line.3.horizontal.decrease.circle",
                    actionTitle: "Clear Filters"
                ) { catalogStore.showtimeFilters = .all }
            } else {
                ContentUnavailableCard(
                    title: movie.mode == .comingSoon ? "No advance showtimes yet" : "No screenings on this date",
                    message: movie.mode == .comingSoon
                        ? "Release plans can change. Check again closer to the release date."
                        : "Try another date or choose a nearby city.",
                    systemImage: "calendar.badge.exclamationmark"
                )
            }
        }
    }

    private var selectedDateBinding: Binding<String> {
        Binding(
            get: { catalogStore.selectedShowtimeDate },
            set: { date in
                catalogStore.selectedShowtimeDate = date
                Task {
                    await catalogStore.ensureShowtimes(city: preferencesStore.city, date: date, tmdbID: movie.tmdbID)
                }
            }
        )
    }
}

struct TheaterShowtimeSection: View {
    let theater: TheaterShowtimes
    @Environment(AppRouter.self) private var router

    private var palette: TheaterPalette { .resolve(theater.theater) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Circle()
                    .fill(palette.accent)
                    .frame(width: 8, height: 8)
                Text(theater.theater)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
            FlowLayout(spacing: 7) {
                ForEach(theater.showtimes) { entry in
                    ShowtimeCapsule(entry: entry, theater: theater.theater) {
                        if let url = entry.ticketURL {
                            router.sheet = .browser(url: url, title: "Tickets at \(theater.theater)")
                        }
                    }
                }
            }
        }
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.border)
                .frame(height: 1)
        }
    }
}

struct ShowtimeCapsule: View {
    let entry: ShowtimeEntry
    let theater: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ShowtimeTicketVisual(entry: entry, theater: theater)
        }
        .buttonStyle(.plain)
        .disabled(entry.ticketURL == nil)
        .opacity(entry.ticketURL == nil ? 0.60 : 1)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(entry.ticketURL == nil ? "Ticket link unavailable" : "Opens the cinema ticket page")
        .accessibilityIdentifier("showtime.\(entry.time)")
    }

    private var capsuleMetadata: String {
        let metadata = ShowtimeFilterEngine.canonicalMetadata(for: entry)
        return ([metadata.screenFormat] + metadata.screeningTechnologies.filter { $0 != "Standard" } + metadata.showTypes.filter { $0 != "Regular" }).sorted().joined(separator: " · ")
    }

    private var accessibilityLabel: String {
        let detail = capsuleMetadata
        return detail.isEmpty ? entry.time : "\(entry.time), \(detail)"
    }
}

struct ShowtimeLoadingRows: View {
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 14) {
                    RoundedRectangle(cornerRadius: 5).fill(Theme.skeleton).frame(width: 130, height: 18)
                    HStack {
                        ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 10).fill(Theme.skeleton).frame(width: 72, height: 48) }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 17))
            }
        }
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading showtimes")
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = layout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = layout(proposal: ProposedViewSize(width: bounds.width, height: proposal.height), subviews: subviews)
        for (index, point) in result.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), anchor: .topLeading, proposal: .unspecified)
        }
    }

    private func layout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, points: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var points: [CGPoint] = []
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += lineHeight + spacing
                lineHeight = 0
            }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
        return (CGSize(width: proposal.width ?? max(0, x - spacing), height: y + lineHeight), points)
    }
}
