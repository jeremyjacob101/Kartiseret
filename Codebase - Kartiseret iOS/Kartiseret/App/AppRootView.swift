import SwiftUI

private enum AppTab: Hashable {
    case nowPlaying
    case comingSoon
    case showtimes
}

struct AppRootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var selectedTab: AppTab = .nowPlaying

    var body: some View {
        ZStack {
            BrandStyle.background.ignoresSafeArea()

            TabView(selection: $selectedTab) {
                NavigationStack {
                    CatalogView(mode: .nowPlaying, isActive: selectedTab == .nowPlaying)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                }
                .tabItem { Label("Now Playing", systemImage: "film") }
                .tag(AppTab.nowPlaying)
                .accessibilityIdentifier("tab.nowPlaying")

                NavigationStack {
                    CatalogView(mode: .comingSoon, isActive: selectedTab == .comingSoon)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                }
                .tabItem { Label("Coming Soon", systemImage: "calendar") }
                .tag(AppTab.comingSoon)
                .accessibilityIdentifier("tab.comingSoon")

                NavigationStack {
                    ShowtimesView(isActive: selectedTab == .showtimes)
                        .navigationDestination(for: MovieRoute.self) { MovieDetailView(route: $0) }
                }
                .tabItem { Label("Showtimes", systemImage: "ticket") }
                .tag(AppTab.showtimes)
                .accessibilityIdentifier("tab.showtimes")
            }
            .tint(BrandStyle.accent)
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.reconcileDay() }
        }
    }
}

enum BrandStyle {
    static let background = Color(hex: 0x212121)
    static let surface = Color(hex: 0x303030)
    static let raised = Color(hex: 0x393939)
    static let accent = Color(hex: 0xA66AE3)
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
