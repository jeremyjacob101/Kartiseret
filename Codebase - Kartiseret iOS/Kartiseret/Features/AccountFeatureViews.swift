import SwiftUI

enum UserPreferenceCategory: String, CaseIterable, Identifiable, Sendable {
    case showtimes
    case discovery
    case appearance
    case notifications
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .showtimes: "Showtimes"
        case .discovery: "Discovery"
        case .appearance: "Appearance"
        case .notifications: "Notifications"
        case .account: "Account"
        }
    }

    var systemImage: String {
        switch self {
        case .showtimes: "ticket"
        case .discovery: "sparkles.magnifyingglass"
        case .appearance: "paintpalette"
        case .notifications: "bell.badge"
        case .account: "person.crop.circle"
        }
    }

    var summary: String {
        switch self {
        case .showtimes: "Set the city, cinemas and formats you see first."
        case .discovery: "Choose how ratings and titles appear while you browse."
        case .appearance: "Make Kartiseret feel a little more like yours."
        case .notifications: "Manage the films you want to hear about."
        case .account: "Manage your account and connected services."
        }
    }
}

struct PreferencesView: View {
    @Environment(AccountStore.self) private var account
    @Environment(AppStore.self) private var app
    @State private var activeCategory: UserPreferenceCategory = .showtimes
    @State private var ratingSourcesExpanded = false

    private var accent: Color {
        Color(hexString: account.preferences.siteColor) ?? BrandStyle.accent
    }

    private var visibleColorOptions: [(String, String)] {
        let selected = account.preferences.siteColor.lowercased()
        guard AccountPreferences.colorOptions.contains(where: { $0.1.lowercased() == selected }) else {
            return [("Current", account.preferences.siteColor)] + AccountPreferences.colorOptions
        }
        return AccountPreferences.colorOptions
    }

    private var ratingSummary: String {
        let labels = AccountPreferences.ratingSourceOptions
            .filter { account.preferences.ratingSources.contains($0) }
            .map(ratingSourceLabel)
        guard !labels.isEmpty else { return "No sources selected" }
        guard labels.count > 2 else { return labels.joined(separator: ", ") }
        return "\(labels[0]), \(labels[1]) +\(labels.count - 2) more"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                pageHeader
                categoryPicker

                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        Image(systemName: activeCategory.systemImage)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(accent)
                            .frame(width: 42, height: 42)
                            .background(accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 14))

                        VStack(alignment: .leading, spacing: 4) {
                            Text(activeCategory.title)
                                .font(.title3.weight(.bold))
                                .foregroundStyle(.white)
                            Text(activeCategory.summary)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    Rectangle()
                        .fill(.white.opacity(0.08))
                        .frame(height: 1)

                    categoryContent
                    saveStatus
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 24))
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(.white.opacity(0.075), lineWidth: 1)
                }
                .accessibilityIdentifier("preferences.categoryContent")
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 28)
        }
        .scrollIndicators(.hidden)
        .background(BrandStyle.background.ignoresSafeArea())
        .navigationTitle("Preferences")
        .navigationBarTitleDisplayMode(.inline)
        .tint(accent)
        .onAppear { app.selectCity(account.preferences.location) }
    }

    private var pageHeader: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("YOUR KARTISERET")
                .font(.caption.weight(.bold))
                .tracking(1.5)
                .foregroundStyle(accent)

            Text("Make it yours")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("Fine-tune showtimes, discovery and the details that shape your app.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityIdentifier("preferences.header")
    }

    private var categoryPicker: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 9) {
                ForEach(UserPreferenceCategory.allCases) { category in
                    let isSelected = activeCategory == category
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            activeCategory = category
                        }
                    } label: {
                        Label(category.title, systemImage: category.systemImage)
                            .font(.subheadline.weight(.semibold))
                            .labelStyle(.titleAndIcon)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 11)
                            .foregroundStyle(isSelected ? accent : Color.white.opacity(0.78))
                            .background(
                                isSelected ? accent.opacity(0.17) : Color.white.opacity(0.055),
                                in: Capsule()
                            )
                            .overlay {
                                Capsule().stroke(
                                    isSelected ? accent.opacity(0.42) : Color.white.opacity(0.08),
                                    lineWidth: 1
                                )
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                    .accessibilityIdentifier("preferences.category.\(category.rawValue)")
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private var categoryContent: some View {
        switch activeCategory {
        case .showtimes:
            showtimeSettings
        case .discovery:
            discoverySettings
        case .appearance:
            appearanceSettings
        case .notifications:
            notificationSettings
        case .account:
            accountSettings
        }
    }

    private var showtimeSettings: some View {
        VStack(spacing: 12) {
            preferencePanel {
                HStack(spacing: 12) {
                    settingIcon("mappin.and.ellipse")

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Default city").font(.headline)
                        Text("Used when you open showtimes and cinema pages.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Spacer(minLength: 4)

                    if app.cities.isEmpty {
                        Text(account.preferences.location)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                    } else {
                        Picker("Default city", selection: Binding(
                            get: { account.preferences.location },
                            set: { city in
                                Task {
                                    await account.saveLocation(city)
                                    app.selectCity(city)
                                }
                            }
                        )) {
                            ForEach(app.cities) { city in
                                Text(city.name).tag(city.name)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                        .accessibilityLabel("Default city")
                        .accessibilityValue(account.preferences.location)
                        .accessibilityIdentifier("preferences.city")
                    }
                }
            }

            preferenceLink(
                "Showtime filters",
                detail: "Choose cinemas, screening types and formats.",
                systemImage: "slider.horizontal.3",
                identifier: "preferences.showtimeFilters"
            ) {
                ShowtimePreferencesView()
            }
        }
    }

    private var discoverySettings: some View {
        VStack(spacing: 12) {
            preferencePanel {
                DisclosureGroup(isExpanded: $ratingSourcesExpanded) {
                    VStack(spacing: 0) {
                        ForEach(AccountPreferences.ratingSourceOptions, id: \.self) { source in
                            Toggle(ratingSourceLabel(source), isOn: ratingSelection(source))
                                .padding(.vertical, 4)
                                .accessibilityIdentifier("preferences.rating.\(source)")
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Rating sources").font(.headline)
                        Text(ratingSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(accent)
                .accessibilityIdentifier("preferences.ratingSources")
            }

            preferencePanel {
                Toggle(isOn: Binding(
                    get: { account.preferences.hideReReleases },
                    set: { value in Task { await account.saveHideReReleases(value) } }
                )) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Hide Re-Releases").font(.headline)
                        Text("Remove re-releases from Now Playing, Coming Soon and All Showtimes.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityIdentifier("preferences.hideReReleases")
            }

            preferenceLink(
                "Movie display",
                detail: "Choose title artwork or hide a movie from your views.",
                systemImage: "rectangle.on.rectangle",
                identifier: "preferences.movieDisplay"
            ) {
                MovieDisplayPreferencesView()
            }
        }
    }

    private var appearanceSettings: some View {
        preferencePanel {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Site color").font(.headline)
                    Text("Choose the accent used throughout Kartiseret.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 3), spacing: 10) {
                    ForEach(visibleColorOptions, id: \.1) { option in
                        let isSelected = account.preferences.siteColor.lowercased() == option.1.lowercased()
                        Button {
                            Task { await account.saveSiteColor(option.1) }
                        } label: {
                            VStack(spacing: 8) {
                                Circle()
                                    .fill(Color(hexString: option.1) ?? accent)
                                    .frame(width: 36, height: 36)
                                    .overlay {
                                        if isSelected {
                                            Image(systemName: "checkmark")
                                                .font(.system(size: 14, weight: .bold))
                                                .foregroundStyle(.white)
                                        }
                                    }
                                    .shadow(color: Color(hexString: option.1)?.opacity(0.26) ?? .clear, radius: 7)

                                Text(option.0)
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.white.opacity(0.86))
                                    .lineLimit(1)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(
                                isSelected ? accent.opacity(0.13) : Color.white.opacity(0.035),
                                in: RoundedRectangle(cornerRadius: 16)
                            )
                            .overlay {
                                RoundedRectangle(cornerRadius: 16)
                                    .stroke(isSelected ? accent.opacity(0.5) : Color.white.opacity(0.07), lineWidth: 1)
                            }
                            .overlay(alignment: .topTrailing) {
                                if isSelected {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(accent)
                                        .offset(x: -5, y: 5)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Use \(option.0) accent")
                        .accessibilityValue(isSelected ? "Selected" : "")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                        .accessibilityIdentifier("preferences.color.\(option.0.lowercased())")
                    }
                }

                Button("Reset to default") {
                    Task { await account.saveSiteColor(AccountPreferences().siteColor) }
                }
                .buttonStyle(.bordered)
                .disabled(account.preferences.siteColor.lowercased() == AccountPreferences().siteColor.lowercased())
                .accessibilityIdentifier("preferences.resetColor")
            }
        }
    }

    private var notificationSettings: some View {
        VStack(spacing: 12) {
            preferenceLink(
                "Ticket alerts",
                detail: "Follow films and choose how screening alerts work.",
                systemImage: "bell.badge",
                identifier: "preferences.ticketAlerts"
            ) {
                TicketAlertsView()
            }

            preferenceLink(
                "Coming Soon watches",
                detail: "Keep track of films awaiting a local release date.",
                systemImage: "calendar.badge.clock",
                identifier: "preferences.comingSoonWatches"
            ) {
                ComingSoonWatchesView()
            }
        }
    }

    private var accountSettings: some View {
        VStack(spacing: 12) {
            preferencePanel {
                HStack(spacing: 12) {
                    settingIcon("person.crop.circle.fill")
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Signed in").font(.headline)
                        Text(account.identity?.email ?? "Kartiseret account")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Spacer(minLength: 0)
                }
            }

            preferenceLink(
                "Letterboxd lists",
                detail: "Manage the film lists connected to your account.",
                systemImage: "film.stack",
                identifier: "preferences.letterboxd"
            ) {
                LetterboxdSourcesView()
            }

            preferenceLink(
                "Help and privacy",
                detail: "Support, privacy policy and app information.",
                systemImage: "questionmark.circle",
                identifier: "preferences.help"
            ) {
                HelpView()
            }

            preferenceLink(
                "Delete account",
                detail: "Permanently remove your Kartiseret account.",
                systemImage: "person.crop.circle.badge.minus",
                tint: .red,
                identifier: "preferences.deleteAccount"
            ) {
                DeleteAccountView()
            }
        }
    }

    private var saveStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if account.isSaving {
                    ProgressView().controlSize(.small)
                }
                Text(account.isSaving ? "Saving your changes…" : "Changes save automatically")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            if let feedback = account.feedback {
                Label(feedback, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("preferences.saveFeedback")
            }
        }
        .padding(.top, 2)
    }

    private func preferencePanel<Content: View>(
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 19))
            .overlay {
                RoundedRectangle(cornerRadius: 19)
                    .stroke(.white.opacity(0.07), lineWidth: 1)
            }
    }

    private func settingIcon(_ systemImage: String, tint: Color? = nil) -> some View {
        let iconTint = tint ?? accent
        return Image(systemName: systemImage)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(iconTint)
            .frame(width: 40, height: 40)
            .background(iconTint.opacity(0.14), in: RoundedRectangle(cornerRadius: 13))
    }

    private func preferenceLink<Destination: View>(
        _ title: String,
        detail: String,
        systemImage: String,
        tint: Color? = nil,
        identifier: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        let rowTint = tint ?? accent
        return NavigationLink(destination: destination()) {
            HStack(spacing: 12) {
                settingIcon(systemImage, tint: rowTint)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(tint == nil ? Color.white : rowTint)
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 2)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 19))
            .overlay {
                RoundedRectangle(cornerRadius: 19)
                    .stroke(.white.opacity(0.07), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    private func ratingSelection(_ source: String) -> Binding<Bool> {
        Binding(
            get: { account.preferences.ratingSources.contains(source) },
            set: { selected in
                var values = account.preferences.ratingSources
                if selected {
                    if !values.contains(source) { values.append(source) }
                } else {
                    values.removeAll { $0 == source }
                }
                Task { await account.saveRatingSources(values) }
            }
        )
    }

    private func ratingSourceLabel(_ source: String) -> String {
        switch source {
        case "imdbRating": "IMDb"
        case "rtAudienceRating": "Rotten Tomatoes Audience"
        case "rtCriticRating": "Rotten Tomatoes Critics"
        case "lbRating": "Letterboxd"
        default: "TMDB"
        }
    }
}

struct MovieDisplayPreferencesView: View {
    @Environment(AccountStore.self) private var account
    @State private var query = ""
    @State private var results: [TitleSearchResult] = []
    @State private var rules: [MovieDisplayRule] = []
    @State private var error: String?
    @State private var busyID: String?

    var body: some View {
        List {
            Section("Search movies") {
                TextField("Search TMDb", text: $query)
                    .textInputAutocapitalization(.never)
                    .accessibilityIdentifier("movieDisplay.search")
                if query.trimmingCharacters(in: .whitespaces).count < 2 {
                    Text("Enter at least two characters.").foregroundStyle(.secondary)
                } else if results.isEmpty {
                    Text("No matching movies.").foregroundStyle(.secondary)
                }
                ForEach(results) { title in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(titleWithYear(title.title, title.releaseYear)).font(.headline)
                        HStack {
                            Button("Kartiseret poster") { Task { await add(title, treatment: "standard") } }
                                .buttonStyle(.borderedProminent)
                            Button("Hide movie") { Task { await add(title, treatment: "remove") } }
                                .buttonStyle(.bordered)
                        }
                    }
                    .disabled(busyID == title.id)
                }
            }
            Section("Your choices") {
                if rules.isEmpty { ContentUnavailableView("No movie choices", systemImage: "rectangle.on.rectangle", description: Text("Search for a title to choose its artwork or hide it from your browsing.")) }
                ForEach(rules) { rule in
                    VStack(alignment: .leading, spacing: 9) {
                        Text(titleWithYear(rule.title, rule.releaseYear)).font(.headline)
                        Text(rule.treatment == "remove" ? "Hidden from your site views" : "Kartiseret title poster")
                            .font(.caption).foregroundStyle(.secondary)
                        if rule.treatment == "standard" {
                            Toggle("Hide backdrop", isOn: Binding(
                                get: { rule.hideBackdrop },
                                set: { value in Task { await update(rule, hideBackdrop: value) } }
                            ))
                        }
                        Button("Restore original") { Task { await remove(rule) } }
                            .font(.subheadline).foregroundStyle(.red)
                    }
                    .disabled(busyID == rule.id)
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Movie display")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadRules() }
        .task(id: query) { await search() }
    }

    private func search() async {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 2 else { results = []; return }
        do {
            try await Task.sleep(for: .milliseconds(300))
            results = try await account.searchTitles(value)
        } catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }

    private func loadRules() async {
        do {
            var cursor: String?
            var cursors = Set<String>()
            var all: [MovieDisplayRule] = []
            repeat {
                let suffix = cursor.map { "?after=\(urlEncode($0))" } ?? ""
                let page: MovieDisplayRulePage = try await account.requestPrivate(path: "/api/v1/preferences/movie-display\(suffix)", method: "GET", as: MovieDisplayRulePage.self)
                all.append(contentsOf: page.preferences)
                guard let next = page.nextCursor else { break }
                guard cursors.insert(next).inserted else { throw APIClientError.invalidResponse }
                cursor = next
            } while cursor != nil
            rules = all
            await account.refreshMovieDisplayRules()
        } catch { self.error = error.localizedDescription }
    }

    private func add(_ title: TitleSearchResult, treatment: String) async {
        busyID = title.id
        defer { busyID = nil }
        do {
            let payload = try jsonBody(["tmdbId": title.tmdbId, "title": title.title, "releaseYear": title.releaseYear as Any? ?? NSNull(), "treatment": treatment, "hideBackdrop": true])
            _ = try await account.requestPrivate(path: "/api/v1/preferences/movie-display", method: "POST", body: payload)
            await loadRules()
        } catch { self.error = error.localizedDescription }
    }

    private func update(_ rule: MovieDisplayRule, hideBackdrop: Bool) async {
        busyID = rule.id
        defer { busyID = nil }
        do {
            _ = try await account.requestPrivate(path: "/api/v1/preferences/movie-display/\(rule.id)", method: "PATCH", body: jsonBody(["hideBackdrop": hideBackdrop]))
            await loadRules()
        } catch { self.error = error.localizedDescription }
    }

    private func remove(_ rule: MovieDisplayRule) async {
        busyID = rule.id
        defer { busyID = nil }
        do {
            _ = try await account.requestPrivate(path: "/api/v1/preferences/movie-display/\(rule.id)", method: "DELETE")
            rules.removeAll { $0.id == rule.id }
            await account.refreshMovieDisplayRules()
        } catch { self.error = error.localizedDescription }
    }
}

struct TicketAlertsView: View {
    @Environment(AccountStore.self) private var account
    @State private var query = ""
    @State private var results: [TitleSearchResult] = []
    @State private var subscriptions: [TicketAlertSubscription] = []
    @State private var nextOffset: Int?
    @State private var error: String?

    var body: some View {
        List {
            Section("Find a movie") {
                TextField("Search movies", text: $query).textInputAutocapitalization(.never)
                ForEach(results) { title in
                    Button {
                        Task { await subscribe(title) }
                    } label: {
                        Label(titleWithYear(title.title, title.releaseYear), systemImage: "bell.badge")
                    }
                    .disabled(subscriptions.contains { $0.id == title.id })
                }
            }
            Section("Ticket alerts") {
                if subscriptions.isEmpty { Text("You have no active ticket alerts.").foregroundStyle(.secondary) }
                ForEach(subscriptions) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.deliveryTitle ?? "Movie \(item.tmdbId)").font(.headline)
                            Text(item.notifiedAt == nil ? "Watching for screenings" : "Alert sent")
                                .font(.caption).foregroundStyle(.secondary)
                            if let date = item.deliveryDate { Text("Available \(date)").font(.caption) }
                        }
                        Spacer()
                        Button("Remove", role: .destructive) { Task { await remove(item) } }
                            .labelStyle(.iconOnly)
                            .accessibilityLabel("Remove alert for \(item.deliveryTitle ?? item.tmdbId)")
                    }
                    NavigationLink {
                        TicketAlertCriteriaView(subscription: item) { updateCriteria($0, for: item.id) }
                    } label: {
                        Label("Alert settings", systemImage: "slider.horizontal.3")
                            .font(.caption.weight(.medium))
                    }
                    .accessibilityIdentifier("ticketAlert.criteria.\(item.id)")
                }
                if let nextOffset { Button("Load more") { Task { await load(offset: nextOffset) } } }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Ticket alerts")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { TicketAlertPreferencesView() } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("Ticket alert settings")
            }
        }
        .task { await load(offset: 0) }
        .task(id: query) { await search() }
    }

    private func load(offset: Int) async {
        do {
            let page: TicketAlertPage = try await account.requestPrivate(path: "/api/v1/ticket-alerts?offset=\(offset)", method: "GET", as: TicketAlertPage.self)
            if offset == 0 { subscriptions = page.subscriptions }
            else { subscriptions += page.subscriptions }
            nextOffset = page.nextOffset
        } catch { self.error = error.localizedDescription }
    }

    private func search() async {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 2 else { results = []; return }
        do { try await Task.sleep(for: .milliseconds(300)); results = try await account.searchTitles(value) }
        catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }

    private func subscribe(_ title: TitleSearchResult) async {
        do {
            let result = try await account.requestPrivate(path: "/api/v1/ticket-alerts", method: "POST", body: jsonBody(["tmdbId": title.tmdbId]))
            if let change = try? JSONDecoder().decode(TicketAlertChange.self, from: result), change.kind == "available" {
                error = "Tickets are already available for \(title.title). Open the movie to see current screenings."
            } else { await load(offset: 0) }
        } catch { self.error = error.localizedDescription }
    }

    private func remove(_ subscription: TicketAlertSubscription) async {
        do {
            _ = try await account.requestPrivate(path: "/api/v1/ticket-alerts/\(subscription.id)", method: "DELETE")
            subscriptions.removeAll { $0.id == subscription.id }
        } catch { self.error = error.localizedDescription }
    }

    private func updateCriteria(_ value: TicketAlertCriteriaOverride, for id: String) {
        guard let index = subscriptions.firstIndex(where: { $0.id == id }) else { return }
        subscriptions[index].criteriaOverrides = value
    }
}

private struct TicketAlertChange: Decodable { let kind: String }

struct ComingSoonWatchesView: View {
    @Environment(AccountStore.self) private var account
    @State private var query = ""
    @State private var results: [TitleSearchResult] = []
    @State private var watches: [ComingSoonWatch] = []
    @State private var error: String?

    var body: some View {
        List {
            Section("Watch for a release date") {
                TextField("Search movies", text: $query).textInputAutocapitalization(.never)
                ForEach(results) { title in
                    Button {
                        Task { await add(title) }
                    } label: { Label(titleWithYear(title.title, title.releaseYear), systemImage: "calendar.badge.clock") }
                    .disabled(watches.contains { $0.id == title.id })
                }
            }
            Section("Watching") {
                if watches.isEmpty { Text("No release dates being watched.").foregroundStyle(.secondary) }
                ForEach(watches) { watch in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(titleWithYear(watch.title, watch.releaseYear))
                            Text(watch.comingSoonDate.map { "Release date: \($0)" } ?? (watch.notifiedAt == nil ? "Watching for a date" : "Date found"))
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Remove", role: .destructive) { Task { await remove(watch) } }
                            .labelStyle(.iconOnly).accessibilityLabel("Stop watching \(watch.title)")
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Coming Soon watches")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .task(id: query) { await search() }
    }

    private func load() async {
        do { let data: ComingSoonWatchPage = try await account.requestPrivate(path: "/api/v1/coming-soon-watches", method: "GET", as: ComingSoonWatchPage.self); watches = data.watches }
        catch { self.error = error.localizedDescription }
    }
    private func search() async {
        let value = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count >= 2 else { results = []; return }
        do { try await Task.sleep(for: .milliseconds(300)); results = try await account.searchTitles(value) }
        catch is CancellationError { }
        catch { self.error = error.localizedDescription }
    }
    private func add(_ title: TitleSearchResult) async {
        do {
            let body = try jsonBody(["tmdbId": title.tmdbId, "title": title.title, "releaseYear": title.releaseYear as Any? ?? NSNull(), "posterPath": title.posterPath as Any? ?? NSNull()])
            let data = try await account.requestPrivate(path: "/api/v1/coming-soon-watches", method: "POST", body: body)
            if let change = try? JSONDecoder().decode(ComingSoonWatchChange.self, from: data), change.kind == "known" {
                error = "\(title.title) already has a release date: \(change.comingSoonDate ?? "")"
            }
            await load()
        } catch { self.error = error.localizedDescription }
    }
    private func remove(_ watch: ComingSoonWatch) async {
        do { _ = try await account.requestPrivate(path: "/api/v1/coming-soon-watches/\(watch.id)", method: "DELETE"); watches.removeAll { $0.id == watch.id } }
        catch { self.error = error.localizedDescription }
    }
}

private struct ComingSoonWatchChange: Decodable { let kind: String; let comingSoonDate: String? }

struct LetterboxdSourcesView: View {
    @Environment(AccountStore.self) private var account
    @State private var url = ""
    @State private var sources: [LetterboxdSource] = []
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        List {
            Section("Add a public list") {
                TextField("https://letterboxd.com/…", text: $url)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Add Letterboxd list") { Task { await add() } }.disabled(busy || url.isEmpty)
                Text("Kartiseret checks public watchlists and lists for films you follow.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Connected lists") {
                if sources.isEmpty { Text("No Letterboxd lists connected.").foregroundStyle(.secondary) }
                ForEach(sources) { source in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(source.sourceUrl).font(.subheadline).textSelection(.enabled)
                        Text("\(source.matchedFilmCount) matched of \(source.filmCount) films")
                            .font(.caption).foregroundStyle(.secondary)
                        if let error = source.lastSyncError { Text(error).font(.caption).foregroundStyle(.orange) }
                        Button("Remove list", role: .destructive) { Task { await remove(source) } }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .scrollContentBackground(.hidden)
        .background(BrandStyle.background)
        .navigationTitle("Letterboxd")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do { let data: LetterboxdSourcePage = try await account.requestPrivate(path: "/api/v1/letterboxd-sources", method: "GET", as: LetterboxdSourcePage.self); sources = data.sources }
        catch { self.error = error.localizedDescription }
    }
    private func add() async {
        busy = true; defer { busy = false }
        do { _ = try await account.requestPrivate(path: "/api/v1/letterboxd-sources", method: "POST", body: jsonBody(["sourceUrl": url])); url = ""; await load() }
        catch { self.error = error.localizedDescription }
    }
    private func remove(_ source: LetterboxdSource) async {
        do { _ = try await account.requestPrivate(path: "/api/v1/letterboxd-sources/\(source.id)", method: "DELETE"); sources.removeAll { $0.id == source.id } }
        catch { self.error = error.localizedDescription }
    }
}

private func titleWithYear(_ title: String, _ year: Int?) -> String {
    year.map { "\(title) (\($0))" } ?? title
}

private func jsonBody(_ value: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: value)
}

private func urlEncode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
}
