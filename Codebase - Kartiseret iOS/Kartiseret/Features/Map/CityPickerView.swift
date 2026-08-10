import SwiftUI
import MapKit
import CoreLocation

struct CityPickerView: View {
    @Environment(CatalogStore.self) private var catalogStore
    @Environment(PreferencesStore.self) private var preferencesStore
    @Environment(Theme.self) private var theme
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @State private var query = ""
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var locationService = LocationService()
    @State private var locationMessage: String?

    private var filteredCities: [City] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return catalogStore.cities }
        let needle = query.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        return catalogStore.cities.filter { city in
            ([city.name] + city.alternateSpellings).contains {
                $0.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current).contains(needle)
            }
        }
    }

    private var selectedTheaters: [Theater] {
        catalogStore.theaters.filter { $0.cityName == preferencesStore.city }
    }

    var body: some View {
        NavigationStack {
            Group {
                if horizontalSizeClass == .regular {
                    HStack(spacing: 0) {
                        map.frame(maxWidth: .infinity, maxHeight: .infinity)
                        Divider()
                        cityList.frame(width: 360)
                    }
                } else {
                    VStack(spacing: 0) {
                        map.frame(height: 310)
                        Divider()
                        cityList
                    }
                }
            }
            .navigationTitle("Choose a City")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search supported cities")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        locationService.requestLocation()
                    } label: {
                        if locationService.state == .requesting {
                            ProgressView().controlSize(.small).frame(width: 44, height: 44)
                        } else {
                            Image(systemName: "location.fill").frame(width: 44, height: 44)
                        }
                    }
                    .disabled(locationService.state == .requesting)
                    .accessibilityLabel("Use My Location")
                    .accessibilityIdentifier("city.useLocation")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .safeAreaInset(edge: .bottom) {
                if let message = locationMessage ?? locationStateMessage {
                    HStack(spacing: 10) {
                        Image(systemName: locationService.state == .denied ? "location.slash" : "info.circle")
                        Text(message).font(.footnote)
                        Spacer()
                        Button { locationMessage = nil } label: { Image(systemName: "xmark") }
                            .accessibilityLabel("Dismiss message")
                    }
                    .padding(12)
                    .background(.ultraThinMaterial)
                }
            }
            .brandBackground()
            .task {
                await catalogStore.loadPlaces()
                center(on: preferencesStore.city, animated: false)
            }
            .onChange(of: locationService.location) { _, location in
                guard let location, let city = nearestCity(to: location) else { return }
                select(city)
                locationMessage = "Selected \(city.name), the nearest supported city."
            }
        }
        .presentationDetents(horizontalSizeClass == .regular ? [.large] : [.large])
        .presentationDragIndicator(.visible)
    }

    private var map: some View {
        Map(position: $mapPosition) {
            ForEach(catalogStore.cities) { city in
                if let coordinate = coordinate(for: city) {
                    Annotation(city.name, coordinate: coordinate, anchor: .bottom) {
                        Button { select(city) } label: {
                            VStack(spacing: 3) {
                                Image(systemName: city.name == preferencesStore.city ? "mappin.circle.fill" : "mappin.circle")
                                    .font(.title2)
                                    .foregroundStyle(city.name == preferencesStore.city ? theme.tint : .white)
                                    .shadow(color: .black.opacity(0.5), radius: 3)
                                Text(city.name)
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(.black.opacity(0.65), in: Capsule())
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Select \(city.name)")
                    }
                }
            }
            ForEach(selectedTheaters) { theater in
                if let latitude = theater.latitude, let longitude = theater.longitude {
                    Marker(theater.name, systemImage: "popcorn.fill", coordinate: .init(latitude: latitude, longitude: longitude))
                        .tint(.orange)
                }
            }
            if let location = locationService.location {
                Marker("My Location", systemImage: "location.fill", coordinate: location.coordinate).tint(.blue)
            }
        }
        .mapStyle(.standard(elevation: .realistic, emphasis: .muted))
        .mapControls {
            MapCompass()
            MapScaleView()
        }
        .accessibilityIdentifier("city.map")
    }

    private var cityList: some View {
        List {
            Section {
                ForEach(filteredCities) { city in
                    Button { select(city) } label: {
                        HStack(spacing: 12) {
                            Image(systemName: city.name == preferencesStore.city ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(city.name == preferencesStore.city ? theme.tint : Theme.tertiaryText)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(city.name).foregroundStyle(Theme.primaryText)
                                let count = catalogStore.theaters.filter { $0.cityName == city.name }.count
                                if count > 0 {
                                    Text("\(count) mapped \(count == 1 ? "cinema" : "cinemas")")
                                        .font(.caption).foregroundStyle(Theme.secondaryText)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.tertiaryText)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("city.option.\(city.name)")
                }
            } header: {
                Text("Supported Cities")
            }

            if !selectedTheaters.isEmpty {
                Section("Cinemas in \(preferencesStore.city)") {
                    ForEach(selectedTheaters) { theater in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(theater.name).font(.subheadline.weight(.semibold))
                            if !theater.chain.isEmpty, theater.chain != theater.name {
                                Text(theater.chain).font(.caption).foregroundStyle(Theme.theaterAccent)
                            }
                            if !theater.address.isEmpty {
                                Text(theater.address).font(.caption).foregroundStyle(Theme.secondaryText)
                            }
                        }
                        .padding(.vertical, 5)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }

    private var locationStateMessage: String? {
        switch locationService.state {
        case .denied: "Location access is denied. Choose a city manually or enable access in Settings."
        case .unavailable(let message): message
        case .idle, .requesting, .located: nil
        }
    }

    private func select(_ city: City) {
        preferencesStore.selectCity(city.name)
        catalogStore.selectedShowtimeDate = catalogStore.cinemaDay
        center(on: city.name, animated: true)
        Task { await catalogStore.prefetchCurrentDay(city: city.name) }
    }

    private func center(on cityName: String, animated: Bool) {
        guard let city = catalogStore.cities.first(where: { $0.name == cityName }),
              let coordinate = coordinate(for: city) else { return }
        let span = MKCoordinateSpan(latitudeDelta: 0.16, longitudeDelta: 0.16)
        let position = MapCameraPosition.region(MKCoordinateRegion(center: coordinate, span: span))
        if animated { withAnimation(.easeInOut(duration: 0.35)) { mapPosition = position } }
        else { mapPosition = position }
    }

    private func coordinate(for city: City) -> CLLocationCoordinate2D? {
        guard let latitude = city.latitude, let longitude = city.longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    private func nearestCity(to location: CLLocation) -> City? {
        catalogStore.cities.compactMap { city -> (City, CLLocationDistance)? in
            guard let coordinate = coordinate(for: city) else { return nil }
            let candidate = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            return (city, location.distance(from: candidate))
        }.min { $0.1 < $1.1 }?.0
    }
}
