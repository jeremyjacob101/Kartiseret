import SwiftUI

struct SettingsView: View {
    @Environment(SessionStore.self) private var sessionStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @Environment(Theme.self) private var theme
    @State private var path: [AppRoute] = []
    @State private var showingSignOutConfirmation = false

    var body: some View {
        NavigationStack(path: $path) {
            Form {
                accountSection
                locationSection
                ratingSection
                appearanceSection
                aboutSection
            }
            .navigationTitle("Settings")
            .scrollContentBackground(.hidden)
            .brandBackground()
            .appDestinations()
            .alert("Kartiseret", isPresented: messageBinding) {
                Button("OK") { preferencesStore.clearMessage() }
            } message: {
                Text(preferencesStore.message ?? "")
            }
            .confirmationDialog("Log out of Kartiseret?", isPresented: $showingSignOutConfirmation, titleVisibility: .visible) {
                Button("Log Out", role: .destructive) { Task { _ = await sessionStore.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
            .onChange(of: router.pendingRoute) { _, route in
                guard router.selectedTab == .settings, let route else { return }
                path.append(route)
                router.pendingRoute = nil
            }
        }
    }

    @ViewBuilder
    private var accountSection: some View {
        Section("Account") {
            if sessionStore.isRestoring {
                HStack { ProgressView(); Text("Restoring session…").foregroundStyle(Theme.secondaryText) }
            } else if let session = sessionStore.session {
                NavigationLink(value: AppRoute.account) {
                    HStack(spacing: 13) {
                        Image(systemName: "person.crop.circle.fill")
                            .font(.title2).foregroundStyle(theme.tint)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(session.email).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text(preferencesStore.syncState.label).font(.caption).foregroundStyle(syncColor)
                        }
                    }
                    .frame(minHeight: 44)
                }
                Button(role: .destructive) { showingSignOutConfirmation = true } label: {
                    Label("Log Out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .disabled(sessionStore.isWorking)
                .accessibilityIdentifier("settings.signOut")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Browsing as a guest").font(.headline)
                    Text("Your city stays on this device. Log in to sync ratings and accent color.")
                        .font(.footnote).foregroundStyle(Theme.secondaryText)
                }
                .padding(.vertical, 4)
                Button { router.sheet = .authentication(.logIn) } label: {
                    Label("Log In", systemImage: "person.crop.circle")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("settings.login")
                Button { router.sheet = .authentication(.createAccount) } label: {
                    Text("Create Account").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("settings.createAccount")
            }
        }
    }

    private var locationSection: some View {
        Section {
            Button { router.sheet = .cityPicker } label: {
                HStack {
                    Label("City", systemImage: "map.fill")
                    Spacer()
                    Text(preferencesStore.city).foregroundStyle(Theme.secondaryText)
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.tertiaryText)
                }
                .frame(minHeight: 44)
            }
            .foregroundStyle(Theme.primaryText)
            .accessibilityIdentifier("settings.city")
        } header: {
            Text("Showtime Location")
        } footer: {
            Text(preferencesStore.isAuthenticated ? "Your city syncs with your Kartiseret account." : "Guest city is saved on this device.")
        }
    }

    private var ratingSection: some View {
        Section {
            ForEach(RatingSource.allCases) { source in
                Toggle(source.title, isOn: ratingBinding(source))
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("settings.rating.\(source.rawValue)")
            }
        } header: {
            HStack { Text("Rating Sources"); if !preferencesStore.isAuthenticated { Image(systemName: "lock.fill") } }
        } footer: {
            Text(preferencesStore.isAuthenticated ? "Choose the ratings shown throughout the app." : "Log in to change rating sources.")
        }
    }

    private var appearanceSection: some View {
        Section {
            ScrollView(.horizontal) {
                HStack(spacing: 13) {
                    ForEach(AccentChoice.allCases) { accent in
                        Button { chooseAccent(accent) } label: {
                            VStack(spacing: 7) {
                                ZStack {
                                    Circle().fill(accent.color).frame(width: 42, height: 42)
                                    if preferencesStore.accent == accent {
                                        Image(systemName: "checkmark").font(.headline.bold()).foregroundStyle(Theme.background)
                                    }
                                }
                                Text(accent.title).font(.caption2).foregroundStyle(Theme.secondaryText)
                            }
                            .frame(minWidth: 52, minHeight: 66)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("\(accent.title) accent")
                        .accessibilityAddTraits(preferencesStore.accent == accent ? .isSelected : [])
                        .accessibilityIdentifier("settings.accent.\(accent.title)")
                    }
                }
                .padding(.vertical, 3)
            }
            .scrollIndicators(.hidden)
        } header: {
            HStack { Text("Accent Color"); if !preferencesStore.isAuthenticated { Image(systemName: "lock.fill") } }
        } footer: {
            Text(preferencesStore.isAuthenticated ? "The selected accent follows your account." : "Log in to choose an accent color.")
        }
    }

    private var aboutSection: some View {
        Section("About") {
            NavigationLink(value: AppRoute.attribution) {
                Label("About & Attribution", systemImage: "info.circle")
            }
            Button { open(URL(string: "https://github.com/jeremyjacob101/")!, title: "GitHub") } label: {
                Label("Jeremy Jacob on GitHub", systemImage: "chevron.left.forwardslash.chevron.right")
            }
            .foregroundStyle(Theme.primaryText)
            Button { open(URL(string: "https://www.linkedin.com/in/jeremyjacob101/")!, title: "LinkedIn") } label: {
                Label("Jeremy Jacob on LinkedIn", systemImage: "person.crop.square")
            }
            .foregroundStyle(Theme.primaryText)
            LabeledContent("Version", value: "1.0 (1)")
        }
    }

    private var messageBinding: Binding<Bool> {
        Binding(get: { preferencesStore.message != nil }, set: { if !$0 { preferencesStore.clearMessage() } })
    }

    private var syncColor: Color {
        if case .failed = preferencesStore.syncState { return Theme.destructive }
        return Theme.secondaryText
    }

    private func ratingBinding(_ source: RatingSource) -> Binding<Bool> {
        Binding(
            get: { preferencesStore.ratingSources.contains(source) },
            set: { enabled in
                if !preferencesStore.toggleRatingSource(source, enabled: enabled) {
                    router.sheet = .authentication(.logIn)
                }
            }
        )
    }

    private func chooseAccent(_ accent: AccentChoice) {
        if !preferencesStore.selectAccent(accent) { router.sheet = .authentication(.logIn) }
    }

    private func open(_ url: URL, title: String) {
        router.sheet = .browser(url: url, title: title)
    }
}

struct AccountDetailView: View {
    @Environment(SessionStore.self) private var sessionStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(AppRouter.self) private var router
    @State private var showingSignOut = false

    var body: some View {
        Form {
            Section("Signed In") {
                LabeledContent("Email", value: sessionStore.session?.email ?? "—")
                LabeledContent("Preference Sync", value: preferencesStore.syncState.label)
            }
            Section("Location") {
                Button { router.sheet = .cityPicker } label: {
                    LabeledContent("Showtime City", value: preferencesStore.city)
                }
            }
            Section {
                Button("Log Out", role: .destructive) { showingSignOut = true }
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .navigationTitle("Account")
        .scrollContentBackground(.hidden)
        .brandBackground()
        .confirmationDialog("Log out of Kartiseret?", isPresented: $showingSignOut) {
            Button("Log Out", role: .destructive) { Task { _ = await sessionStore.signOut() } }
            Button("Cancel", role: .cancel) {}
        }
    }
}
