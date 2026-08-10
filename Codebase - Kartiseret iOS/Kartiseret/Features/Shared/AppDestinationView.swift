import SwiftUI

struct AppDestinationView: View {
    let route: AppRoute
    @Environment(CatalogStore.self) private var catalogStore

    var body: some View {
        switch route {
        case .movieDetail(let mode, let tmdbID):
            if let movie = catalogStore.movie(mode: mode, tmdbID: tmdbID) {
                MovieDetailView(movie: movie)
            } else {
                ContentUnavailableView("Movie unavailable", systemImage: "film", description: Text("This movie is no longer in the current catalog."))
            }
        case .catalog(let mode):
            CatalogGridScreen(mode: mode)
        case .attribution:
            AttributionView()
        case .account:
            AccountDetailView()
        }
    }
}

extension View {
    func appDestinations() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            AppDestinationView(route: route)
        }
    }
}
