#if DEBUG
import SwiftUI

#Preview("Loaded · iPhone") {
    AppRootView(model: AppModel(dependencies: .fixtures()))
}

#Preview("Signed In · iPad", traits: .fixedLayout(width: 1_024, height: 768)) {
    AppRootView(
        model: AppModel(
            dependencies: .fixtures(
                auth: FixtureAuthClient(signedIn: true),
                preferences: FixturePreferencesClient(initial: .init(city: "Tel Aviv", ratingSources: RatingSource.allCases, accent: .teal))
            )
        )
    )
}

#Preview("Loading") {
    ScrollView { LoadingPosterGrid().padding() }
        .environment(Theme())
        .brandBackground()
}

#Preview("Empty") {
    ContentUnavailableCard(title: "No screenings found", message: "Try another date or nearby city.", systemImage: "calendar.badge.exclamationmark")
        .padding()
        .environment(Theme())
        .brandBackground()
}

#Preview("Network Error") {
    ContentUnavailableCard(title: "Couldn’t load movies", message: "The network connection appears to be offline.", systemImage: "wifi.exclamationmark", actionTitle: "Try Again") {}
        .padding()
        .environment(Theme())
        .brandBackground()
}

#Preview("Malformed Image Fallback") {
    RemoteArtwork(url: nil, title: "Missing Poster").frame(width: 190, height: 285)
        .padding()
        .environment(Theme())
        .brandBackground()
}

#Preview("No Showtime") {
    ContentUnavailableCard(title: "No advance showtimes yet", message: "Check again closer to release day.", systemImage: "calendar.badge.clock")
        .padding()
        .environment(Theme())
        .brandBackground()
}
#endif
