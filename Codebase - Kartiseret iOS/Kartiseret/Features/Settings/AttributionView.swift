import SwiftUI

struct AttributionView: View {
    @Environment(AppRouter.self) private var router

    private let movieSources = [
        AttributionSource("TMDb", "https://www.themoviedb.org/", "film.stack")
    ]
    private let ratingSources = [
        AttributionSource("IMDb", "https://www.imdb.com/", "star.fill"),
        AttributionSource("Rotten Tomatoes", "https://www.rottentomatoes.com/", "leaf.fill"),
        AttributionSource("Letterboxd", "https://letterboxd.com/", "square.grid.3x3.fill"),
        AttributionSource("TMDb", "https://www.themoviedb.org/", "chart.bar.fill")
    ]
    private let theaterSources = [
        AttributionSource("Yes Planet", "https://www.planetcinema.co.il/", "building.2"),
        AttributionSource("Cinema City", "https://www.cinema-city.co.il/", "building.2"),
        AttributionSource("Lev Cinema", "https://www.lev.co.il/", "building.2"),
        AttributionSource("Rav Hen", "https://www.rav-hen.co.il/", "building.2"),
        AttributionSource("Hot Cinema", "https://www.hotcinema.co.il/", "building.2"),
        AttributionSource("MovieLand", "https://www.movieland.co.il/", "building.2")
    ]
    private let cinemathequeSources = [
        AttributionSource("Holon Cinematheque", "https://www.cinemaholon.org.il/", "theatermasks"),
        AttributionSource("Haifa Cinematheque", "https://www.haifacin.co.il/", "theatermasks"),
        AttributionSource("Jaffa Cinema", "https://www.jaffacinema.com/", "theatermasks"),
        AttributionSource("Jerusalem Cinematheque", "https://jer-cin.org.il/he", "theatermasks"),
        AttributionSource("Herziliya Cinematheque", "https://www.hcinema.org.il/", "theatermasks"),
        AttributionSource("Tel Aviv Cinematheque", "https://www.cinema.co.il/", "theatermasks"),
        AttributionSource("Sam Spiegel Cinema", "https://www.jsfs.co.il/", "theatermasks")
    ]

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    BrandTitle()
                    Text("Kartiseret brings Israeli cinema listings, movie details, ratings, maps, and ticket links into one native experience.")
                        .foregroundStyle(Theme.secondaryText)
                }
                .padding(.vertical, 8)
            }
            sourceSection(
                title: "Movie Data",
                description: "This product uses the TMDB API, made available through granted access to its publicly available data.",
                sources: movieSources
            )
            sourceSection(
                title: "Ratings",
                description: "Rating information is compiled from publicly available information on official rating and review websites.",
                sources: ratingSources
            )
            sourceSection(
                title: "Theater Chains",
                description: "Showtimes and venue information are compiled from the official websites of these Israeli theater chains.",
                sources: theaterSources
            )
            sourceSection(
                title: "Independent Cinemas",
                description: "Additional listings come from official cinematheque and cinema websites.",
                sources: cinemathequeSources
            )
            sourceSection(
                title: "Maps & Location",
                description: "The iOS app uses Apple MapKit. The Kartiseret web app also acknowledges CARTO basemaps and OpenStreetMap contributors.",
                sources: [
                    AttributionSource("Apple Maps", "https://www.apple.com/maps/", "map.fill"),
                    AttributionSource("CARTO", "https://carto.com/", "map"),
                    AttributionSource("OpenStreetMap", "https://www.openstreetmap.org/", "globe")
                ]
            )
            Section("Creator") {
                sourceRow(AttributionSource("Jeremy Jacob on GitHub", "https://github.com/jeremyjacob101/", "chevron.left.forwardslash.chevron.right"))
                sourceRow(AttributionSource("Jeremy Jacob on LinkedIn", "https://www.linkedin.com/in/jeremyjacob101/", "person.crop.square"))
            }
            Section("Disclaimer") {
                Text("Information shown throughout the app may be incomplete, outdated, or incorrect and can change without notice. Confirm final times and ticket details with the cinema.")
                    .font(.footnote)
                    .foregroundStyle(Theme.secondaryText)
            }
            Section {
                Text("© 2026 Kartiseret").frame(maxWidth: .infinity).foregroundStyle(Theme.tertiaryText)
            }
        }
        .navigationTitle("About & Attribution")
        .scrollContentBackground(.hidden)
        .brandBackground()
    }

    private func sourceSection(title: String, description: String, sources: [AttributionSource]) -> some View {
        Section {
            Text(description).font(.footnote).foregroundStyle(Theme.secondaryText)
            ForEach(sources) { source in sourceRow(source) }
        } header: { Text(title) }
    }

    private func sourceRow(_ source: AttributionSource) -> some View {
        Button {
            if let url = URL(string: source.url) { router.sheet = .browser(url: url, title: source.name) }
        } label: {
            HStack {
                Label(source.name, systemImage: source.systemImage)
                Spacer()
                Image(systemName: "arrow.up.right").font(.caption).foregroundStyle(Theme.tertiaryText)
            }
            .frame(minHeight: 44)
        }
        .foregroundStyle(Theme.primaryText)
    }
}

private struct AttributionSource: Identifiable {
    let name: String
    let url: String
    let systemImage: String
    var id: String { name + url }

    init(_ name: String, _ url: String, _ systemImage: String) {
        self.name = name
        self.url = url
        self.systemImage = systemImage
    }
}
