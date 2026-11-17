import SwiftUI
import GoogleSignIn

private enum AppTab: Hashable {
    case discover
    case showtimes
    case cinematheques
    case you
}

struct AppRootView: View {
    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var accountStore
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .discover
    @State private var discoverPath = NavigationPath()
    @State private var cinemathequesPath = NavigationPath()
    @State private var movieLinkTask: Task<Void, Never>?
    @State private var linkError: String?
    @State private var failedLinkURL: URL?
    @State private var isReadyForUniversalLinks = false
    @State private var pendingUniversalLinkURL: URL?

    var body: some View {
        ZStack {
            BrandStyle.background.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                NavigationStack(path: $discoverPath) {
                    DiscoverView(isActive: selectedTab == .discover)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                        .navigationDestination(for: CinemaRoute.self) { CinemaPageView(cinemaID: $0.cinemaID) }
                        .navigationDestination(for: CatalogMode.self) { mode in
                            CatalogView(mode: mode, isActive: true)
                                .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                        }
                }
                .tabItem { Label("Discover", systemImage: "sparkles.tv") }
                .tag(AppTab.discover)
                .accessibilityIdentifier("tab.discover")

                NavigationStack {
                    ShowtimesView(isActive: selectedTab == .showtimes)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                        .navigationDestination(for: CinemaRoute.self) { CinemaPageView(cinemaID: $0.cinemaID) }
                }
                .tabItem { Label("Showtimes", systemImage: "ticket") }
                .tag(AppTab.showtimes)
                .accessibilityIdentifier("tab.showtimes")

                NavigationStack(path: $cinemathequesPath) {
                    CinemathequesView(isActive: selectedTab == .cinematheques)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                        .navigationDestination(for: CinemaRoute.self) { CinemaPageView(cinemaID: $0.cinemaID) }
                }
                .tabItem { Label("Cinematheques", systemImage: "building.columns") }
                .tag(AppTab.cinematheques)
                .accessibilityIdentifier("tab.cinematheques")

                NavigationStack {
                    YouView()
                }
                .tabItem { Label("You", systemImage: "person.crop.circle") }
                .tag(AppTab.you)
                .accessibilityIdentifier("tab.you")
            }
        .tint(Color(hexString: accountStore.preferences.siteColor) ?? BrandStyle.accent)
        }
        .preferredColorScheme(.dark)
        .onOpenURL(perform: handleIncomingURL)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { handleIncomingURL(url) }
        }
        .task {
            if !store.fixtureMode {
                await accountStore.loadSignInProviders()
                await accountStore.restore(fallbackLocation: store.selectedCity)
            } else {
                accountStore.useGuestMode()
            }
            await store.loadCities()
            isReadyForUniversalLinks = true
            if let pendingURL = pendingUniversalLinkURL {
                pendingUniversalLinkURL = nil
                handleIncomingURL(pendingURL)
            }
        }
        .onChange(of: accountStore.identity) { _, identity in
            guard identity != nil else { return }
            store.selectCity(accountStore.preferences.location)
        }
        .onChange(of: accountStore.preferences.location) { _, location in
            guard accountStore.state == .signedIn else { return }
            store.selectCity(location)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.reconcileDay() }
        }
        .alert("Couldn’t open this link", isPresented: Binding(
            get: { linkError != nil },
            set: { if !$0 { linkError = nil; failedLinkURL = nil } }
        )) {
            Button("Try again") {
                if let failedLinkURL { handleIncomingURL(failedLinkURL) }
            }
            Button("Open Website") {
                if let failedLinkURL { openWebsiteFallback(failedLinkURL) }
                linkError = nil
                failedLinkURL = nil
            }
            Button("OK", role: .cancel) { linkError = nil; failedLinkURL = nil }
        } message: {
            Text(linkError ?? "")
        }
    }

    private func handleIncomingURL(_ url: URL) {
        if GIDSignIn.sharedInstance.handle(url) { return }
        guard url.host?.lowercased() == "seret.site",
              url.scheme?.lowercased() == "https",
              url.fragment != "no_universal_links" else { return }
        guard let destination = UniversalLinkDestination.parse(url) else {
            openWebsiteFallback(url)
            return
        }
        guard isReadyForUniversalLinks else {
            pendingUniversalLinkURL = url
            return
        }

        movieLinkTask?.cancel()
        linkError = nil
        failedLinkURL = nil
        switch destination {
        case .discover:
            selectedTab = .discover
            discoverPath = NavigationPath()
        case .catalog(let mode):
            selectedTab = .discover
            discoverPath = NavigationPath()
            discoverPath.append(mode)
        case .showtimes:
            selectedTab = .showtimes
        case .cinematheques:
            selectedTab = .cinematheques
            cinemathequesPath = NavigationPath()
        case .account:
            selectedTab = .you
        case .cinema(let id):
            selectedTab = .cinematheques
            cinemathequesPath = NavigationPath()
            cinemathequesPath.append(CinemaRoute(cinemaID: id))
        case .movie(let link):
            selectedTab = .discover
            discoverPath = NavigationPath()
            movieLinkTask = Task { @MainActor in
                let fallbackCity = accountStore.state == .signedIn
                    ? accountStore.preferences.location
                    : store.selectedCity
                let resolution = await store.resolveMovieLink(link, fallbackCity: fallbackCity)
                guard !Task.isCancelled else { return }
                switch resolution {
                case .route(let route):
                    discoverPath.append(route)
                case .unavailable:
                    failedLinkURL = url
                    linkError = "This film isn’t in the current catalog. You can try again or open the website."
                case .networkFailure:
                    failedLinkURL = url
                    linkError = "Kartiseret couldn’t load the film catalog. Check your connection and try again, or open the website."
                    }
            }
        }
    }

    private func openWebsiteFallback(_ url: URL) {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        components.fragment = "no_universal_links"
        if let fallbackURL = components.url { openURL(fallbackURL) }
    }
}

enum BrandStyle {
    static let background = Color(hex: 0x212121)
    static let surface = Color(hex: 0x303030)
    static let raised = Color(hex: 0x393939)
    static var accent: Color {
        Color(hexString: UserDefaults.standard.string(forKey: "kartiseret.account.siteColor") ?? "#a66ae3") ?? Color(hex: 0xA66AE3)
    }
    static let secondary = Color.white.opacity(0.68)
}

extension Color {
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
