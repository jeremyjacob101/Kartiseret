import SwiftUI

private enum AppTab: Hashable {
    case discover
    case showtimes
    case cinematheques
    case you
}

struct AppRootView: View {
    @Environment(AppStore.self) private var store
    @Environment(AccountStore.self) private var accountStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .discover

    var body: some View {
        ZStack {
            BrandStyle.background.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                NavigationStack {
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

                NavigationStack {
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
        .task {
            if !store.fixtureMode {
                await accountStore.loadSignInProviders()
                await accountStore.restore(fallbackLocation: store.selectedCity)
            } else {
                accountStore.useGuestMode()
            }
            await store.loadCities()
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
