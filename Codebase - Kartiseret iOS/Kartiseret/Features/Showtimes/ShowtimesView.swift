import SwiftUI

struct ShowtimesView: View {
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @Environment(Theme.self) private var theme
    @State private var path: [AppRoute] = []

    private var filteredMovies: [(Movie, MovieShowtimeDay)] {
        catalogStore.moviesWithShowtimes(
            city: preferencesStore.city,
            date: catalogStore.selectedShowtimeDate,
            filters: catalogStore.showtimeFilters
        )
    }
    private var unfilteredMovies: [(Movie, MovieShowtimeDay)] {
        catalogStore.moviesWithShowtimes(
            city: preferencesStore.city,
            date: catalogStore.selectedShowtimeDate,
            filters: .all
        )
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    dateHeader
                    content
                }
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .navigationTitle("Showtimes")
            .toolbar { showtimeToolbar }
            .appDestinations()
            .refreshable {
                await catalogStore.ensureShowtimes(
                    city: preferencesStore.city,
                    date: catalogStore.selectedShowtimeDate,
                    forceRefresh: true
                )
            }
            .brandBackground()
            .task(id: loadIdentifier) {
                await catalogStore.ensureShowtimes(city: preferencesStore.city, date: catalogStore.selectedShowtimeDate)
                if let index = dateIndex {
                    await catalogStore.prefetchIfNeeded(city: preferencesStore.city, previewDayIndex: index)
                }
            }
            .onChange(of: catalogStore.pendingShowtimeSelection) { _, pending in
                guard let pending else { return }
                catalogStore.selectedShowtimeDate = pending.date
                catalogStore.showtimeFilters = pending.filters
                catalogStore.pendingShowtimeSelection = nil
            }
            .onChange(of: router.pendingRoute) { _, route in
                guard router.selectedTab == .showtimes, let route else { return }
                path.append(route)
                router.pendingRoute = nil
            }
        }
    }

    private var loadIdentifier: String { "\(preferencesStore.city)::\(catalogStore.selectedShowtimeDate)" }
    private var dateIndex: Int? {
        CinemaClock.dateRange(start: catalogStore.cinemaDay, count: KartiseretConstants.showtimeWindowDays)
            .firstIndex(of: catalogStore.selectedShowtimeDate)
    }

    private var dateHeader: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(preferencesStore.city).font(.title2.bold())
                    Text(CinemaClock.displayDate(catalogStore.selectedShowtimeDate)).font(.subheadline).foregroundStyle(Theme.secondaryText)
                }
                Spacer()
                if catalogStore.isPrefetching {
                    ProgressView().controlSize(.small).accessibilityLabel("Loading more dates")
                }
            }
            .padding(.horizontal)
            ShowtimeDateStrip(
                selectedDate: Binding(
                    get: { catalogStore.selectedShowtimeDate },
                    set: { catalogStore.selectedShowtimeDate = $0 }
                ),
                dayCount: KartiseretConstants.showtimeWindowDays
            )
        }
    }

    @ViewBuilder
    private var content: some View {
        let state = catalogStore.showtimeState(city: preferencesStore.city, date: catalogStore.selectedShowtimeDate)
        if !filteredMovies.isEmpty {
            ForEach(filteredMovies, id: \.0.id) { movie, day in
                NavigationLink(value: AppRoute.movieDetail(mode: movie.mode, tmdbID: movie.tmdbID)) {
                    ShowtimeMovieCard(movie: movie, day: day)
                }
                .buttonStyle(.plain)
                .padding(.horizontal)
                .accessibilityIdentifier("showtimes.movie.\(movie.tmdbID)")
            }
        } else if state.isLoading {
            ForEach(0..<3, id: \.self) { _ in ShowtimeMovieCardSkeleton().padding(.horizontal) }
        } else if !unfilteredMovies.isEmpty {
            ContentUnavailableCard(
                title: "No showtimes match",
                message: "Your filters removed all \(unfilteredMovies.count) movies screening on this date.",
                systemImage: "line.3.horizontal.decrease.circle",
                actionTitle: "Clear Filters"
            ) { catalogStore.showtimeFilters = .all }
            .padding(.horizontal)
        } else {
            emptyShowtimes
        }
    }

    private var emptyShowtimes: some View {
        VStack(spacing: 16) {
            ContentUnavailableCard(
                title: "No screenings found",
                message: "There are no published screenings in \(preferencesStore.city) for this cinema day.",
                systemImage: "calendar.badge.exclamationmark"
            )
            let nearby = catalogStore.nearbyCities(to: preferencesStore.city)
            if !nearby.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Try a nearby city").font(.headline)
                    ForEach(nearby.prefix(4)) { city in
                        Button {
                            preferencesStore.selectCity(city.name)
                        } label: {
                            HStack {
                                Label(city.name, systemImage: "mappin")
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Theme.tertiaryText)
                            }
                            .frame(minHeight: 44)
                        }
                    }
                }
                .padding(16)
                .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 17))
            }
        }
        .padding(.horizontal)
    }

    @ToolbarContentBuilder
    private var showtimeToolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button { router.sheet = .cityPicker } label: {
                Image(systemName: "mappin.and.ellipse")
            }
            .accessibilityLabel("Choose city, currently \(preferencesStore.city)")
            .accessibilityIdentifier("showtimes.cityPicker")

            Button { router.sheet = .showtimeFilters } label: {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: catalogStore.showtimeFilters.isDefault ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                    if catalogStore.showtimeFilters.disabledCount > 0 {
                        Text("\(catalogStore.showtimeFilters.disabledCount)")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(Theme.background)
                            .frame(minWidth: 13, minHeight: 13)
                            .background(theme.tint, in: Circle())
                            .offset(x: 7, y: -7)
                    }
                }
            }
            .accessibilityLabel("Showtime filters")
            .accessibilityIdentifier("showtimes.filters")
        }
    }
}

struct ShowtimeDateStrip: View {
    @Binding var selectedDate: String
    let dayCount: Int
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(Theme.self) private var theme

    private var dates: [String] { CinemaClock.dateRange(start: catalogStore.cinemaDay, count: dayCount) }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 9) {
                    ForEach(dates, id: \.self) { date in
                        Button {
                            selectedDate = date
                        } label: {
                            VStack(spacing: 3) {
                                Text(dayName(date)).font(.caption2.weight(.semibold)).textCase(.uppercase)
                                Text(dayNumber(date)).font(.title3.monospacedDigit().weight(.bold))
                                if date == catalogStore.cinemaDay { Circle().fill(theme.tint).frame(width: 4, height: 4) }
                                else { Color.clear.frame(width: 4, height: 4) }
                            }
                            .foregroundStyle(selectedDate == date ? theme.tint : Theme.primaryText.opacity(0.82))
                            .frame(width: 52, height: 58)
                            .background(selectedDate == date ? theme.tint.opacity(0.13) : .clear, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(selectedDate == date ? theme.tint.opacity(0.30) : .clear)
                            )
                        }
                        .buttonStyle(.plain)
                        .id(date)
                        .accessibilityIdentifier("showtime.date.\(date)")
                        .accessibilityLabel(accessibilityDate(date))
                        .accessibilityAddTraits(selectedDate == date ? .isSelected : [])
                    }
                }
                .padding(.horizontal)
            }
            .scrollIndicators(.hidden)
            .onAppear { proxy.scrollTo(selectedDate, anchor: .center) }
            .onChange(of: selectedDate) { _, date in withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(date, anchor: .center) } }
        }
    }

    private func dayName(_ iso: String) -> String {
        CinemaClock.date(fromISO: iso)?.formatted(.dateTime.weekday(.abbreviated)) ?? "—"
    }
    private func dayNumber(_ iso: String) -> String {
        CinemaClock.date(fromISO: iso)?.formatted(.dateTime.day()) ?? "—"
    }
    private func accessibilityDate(_ iso: String) -> String {
        guard let date = CinemaClock.date(fromISO: iso) else { return iso }
        let label = date.formatted(.dateTime.weekday(.wide).month(.wide).day())
        return iso == catalogStore.cinemaDay ? "Today, \(label)" : label
    }
}

private struct ShowtimeMovieCard: View {
    let movie: Movie
    let day: MovieShowtimeDay
    @Environment(PreferencesStore.self) private var preferencesStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                RemoteArtwork(url: movie.posterURL, title: movie.title, cornerRadius: 9)
                    .frame(width: 76, height: 114)
                VStack(alignment: .leading, spacing: 7) {
                    Text(movie.title).font(.headline).lineLimit(2)
                    Text(movie.metadataLine).font(.caption).foregroundStyle(Theme.secondaryText).lineLimit(2)
                    FlowLayout(spacing: 6) {
                        ForEach(preferencesStore.ratingSources.prefix(3)) { source in
                            RatingPill(source: source, movie: movie, compact: true)
                        }
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.tertiaryText)
            }
            ForEach(day.theaters) { theater in
                TheaterShowtimeSummary(theater: theater)
            }
        }
        .padding(16)
        .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 19).stroke(Theme.border))
    }
}

private struct TheaterShowtimeSummary: View {
    let theater: TheaterShowtimes

    private var palette: TheaterPalette { .resolve(theater.theater) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Circle()
                    .fill(palette.accent)
                    .frame(width: 7, height: 7)
                Text(theater.theater)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(palette.accent)
            }
            FlowLayout(spacing: 6) {
                ForEach(theater.showtimes.prefix(8)) { entry in
                    ShowtimeTicketVisual(entry: entry, theater: theater.theater, compact: true)
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Theme.border.opacity(0.72))
                .frame(height: 1)
        }
    }
}

private struct ShowtimeMovieCardSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 9).fill(Theme.skeleton).frame(width: 76, height: 114)
            VStack(alignment: .leading, spacing: 12) {
                RoundedRectangle(cornerRadius: 4).fill(Theme.skeleton).frame(height: 18)
                RoundedRectangle(cornerRadius: 4).fill(Theme.skeleton).frame(width: 150, height: 12)
                HStack { ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 8).fill(Theme.skeleton).frame(width: 58, height: 42) } }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 19))
        .redacted(reason: .placeholder)
        .accessibilityLabel("Loading movie showtimes")
    }
}

struct ShowtimeFilterSheet: View {
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var store = catalogStore
        NavigationStack {
            Form {
                Section {
                    ForEach(ShowtimeFilterGroup.allCases) { group in
                        DisclosureGroup(group.title) {
                            ForEach(store.showtimeFilters.options(for: group), id: \.self) { option in
                                Toggle(option, isOn: filterBinding(option, group: group))
                                    .frame(minHeight: 44)
                            }
                        }
                    }
                } header: {
                    Text("Screenings must match one selected option in every group.")
                }
                Section {
                    Button("Select All") { store.showtimeFilters = .all }
                        .disabled(store.showtimeFilters.isDefault)
                }
            }
            .navigationTitle("Showtime Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.fontWeight(.semibold) }
            }
            .scrollContentBackground(.hidden)
            .brandBackground()
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func filterBinding(_ option: String, group: ShowtimeFilterGroup) -> Binding<Bool> {
        Binding(
            get: { catalogStore.showtimeFilters.contains(option, in: group) },
            set: { enabled in
                var filters = catalogStore.showtimeFilters
                filters.set(option, in: group, enabled: enabled)
                catalogStore.showtimeFilters = filters
            }
        )
    }
}
