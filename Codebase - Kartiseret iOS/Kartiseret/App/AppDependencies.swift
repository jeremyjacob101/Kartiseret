import Foundation
import Observation
import Supabase

struct AppDependencies: Sendable {
    let catalogRepository: any CatalogRepository
    let authClient: any AuthClient
    let preferencesClient: any PreferencesClient

    static func make() -> AppDependencies {
        if AppConfiguration.isFixtureMode { return .fixtures() }
        guard let url = AppConfiguration.supabaseURL,
              let key = AppConfiguration.supabasePublishableKey else {
            return .fixtures()
        }
        let client = SupabaseClient(supabaseURL: url, supabaseKey: key)
        return AppDependencies(
            catalogRepository: SupabaseCatalogRepository(client: client),
            authClient: SupabaseAuthService(client: client),
            preferencesClient: SupabasePreferencesService(client: client)
        )
    }
}

@MainActor
@Observable
final class AppModel {
    let theme: Theme
    let catalogStore: CatalogStore
    let sessionStore: SessionStore
    let preferencesStore: PreferencesStore
    let router: AppRouter

    init(dependencies: AppDependencies = .make()) {
        let theme = Theme()
        self.theme = theme
        catalogStore = CatalogStore(repository: dependencies.catalogRepository)
        sessionStore = SessionStore(client: dependencies.authClient)
        preferencesStore = PreferencesStore(client: dependencies.preferencesClient, theme: theme)
        router = AppRouter()
    }
}
