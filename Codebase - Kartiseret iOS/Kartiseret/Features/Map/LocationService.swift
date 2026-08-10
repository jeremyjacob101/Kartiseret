import Foundation
@preconcurrency import CoreLocation
import Observation

enum LocationRequestState: Equatable, Sendable {
    case idle
    case requesting
    case located
    case denied
    case unavailable(String)
}

@MainActor
@Observable
final class LocationService: NSObject, CLLocationManagerDelegate {
    private(set) var state: LocationRequestState = .idle
    private(set) var location: CLLocation?
    @ObservationIgnored private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func requestLocation() {
        if AppConfiguration.forcedLocationDenied {
            state = .denied
            return
        }
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable("Location Services are turned off on this device.")
            return
        }
        state = .requesting
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            state = .denied
        @unknown default:
            state = .unavailable("Your location authorization state is unavailable.")
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor [weak self] in
            guard let self else { return }
            switch status {
            case .authorizedAlways, .authorizedWhenInUse:
                state = .requesting
                self.manager.requestLocation()
            case .denied, .restricted:
                state = .denied
            case .notDetermined:
                break
            @unknown default:
                state = .unavailable("Your location authorization state is unavailable.")
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.location = location
            state = location == nil ? .unavailable("Your current location could not be determined.") : .located
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            state = .unavailable(error.localizedDescription)
        }
    }
}
