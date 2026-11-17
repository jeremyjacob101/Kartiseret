import SwiftUI

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
