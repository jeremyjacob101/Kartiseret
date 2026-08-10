import SwiftUI

struct AppRootView: View {
    @Bindable var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var router = model.router
        TabView(selection: $router.selectedTab) {
            HomeView()
                .tabItem { Label(AppTab.home.title, systemImage: AppTab.home.systemImage) }
                .tag(AppTab.home)
                .accessibilityIdentifier("tab.home")

            CatalogTabView(mode: .nowPlaying)
                .tabItem { Label(AppTab.nowPlaying.title, systemImage: AppTab.nowPlaying.systemImage) }
                .tag(AppTab.nowPlaying)
                .accessibilityIdentifier("tab.nowPlaying")

            ShowtimesView()
                .tabItem { Label(AppTab.showtimes.title, systemImage: AppTab.showtimes.systemImage) }
                .tag(AppTab.showtimes)
                .accessibilityIdentifier("tab.showtimes")

            CatalogTabView(mode: .comingSoon)
                .tabItem { Label(AppTab.comingSoon.title, systemImage: AppTab.comingSoon.systemImage) }
                .tag(AppTab.comingSoon)
                .accessibilityIdentifier("tab.comingSoon")

            SettingsView()
                .tabItem { Label(AppTab.settings.title, systemImage: AppTab.settings.systemImage) }
                .tag(AppTab.settings)
                .accessibilityIdentifier("tab.settings")
        }
        .tint(model.theme.tint)
        .toolbarBackground(Theme.raisedBackground, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .environment(model.theme)
        .environment(model.catalogStore)
        .environment(model.sessionStore)
        .environment(model.preferencesStore)
        .environment(model.router)
        .brandBackground()
        .sheet(item: $router.sheet) { destination in
            sheet(for: destination)
                .environment(model.theme)
                .environment(model.catalogStore)
                .environment(model.sessionStore)
                .environment(model.preferencesStore)
                .environment(model.router)
                .preferredColorScheme(.dark)
        }
        .task {
            model.sessionStore.start()
            async let catalogs: Void = model.catalogStore.loadInitialCatalogs()
            async let places: Void = model.catalogStore.loadPlaces()
            _ = await (catalogs, places)
            await model.catalogStore.prefetchCurrentDay(city: model.preferencesStore.city)
        }
        .task(id: model.sessionStore.session) {
            await model.preferencesStore.attach(to: model.sessionStore.session)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await model.catalogStore.handleForeground(city: model.preferencesStore.city) }
            }
        }
        .onOpenURL { url in
            model.router.handle(url: url, catalogStore: model.catalogStore, preferencesStore: model.preferencesStore)
        }
    }

    @ViewBuilder
    private func sheet(for destination: SheetDestination) -> some View {
        switch destination {
        case .cityPicker:
            CityPickerView()
        case .showtimeFilters:
            ShowtimeFilterSheet()
        case .authentication(let mode):
            AuthenticationView(initialMode: mode)
        case .trailer(let url, _), .browser(let url, _):
            if AppConfiguration.isFixtureMode {
                FixtureBrowserView(url: url)
            } else {
                SafariView(url: url).ignoresSafeArea()
            }
        }
    }
}

private struct FixtureBrowserView: View {
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                Image(systemName: "safari.fill").font(.system(size: 46)).foregroundStyle(Color.accentColor)
                Text("In-App Browser").font(.title2.bold())
                Text(url.absoluteString)
                    .font(.footnote.monospaced())
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                Text("Fixture mode blocks live networking while preserving this presentation flow.")
                    .font(.caption).foregroundStyle(Theme.tertiaryText).multilineTextAlignment(.center)
            }
            .padding(24)
            .navigationTitle("Preview")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .brandBackground()
        }
        .accessibilityIdentifier("fixture.browser")
    }
}
