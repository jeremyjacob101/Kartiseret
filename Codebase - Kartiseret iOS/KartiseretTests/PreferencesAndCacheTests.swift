import XCTest
@testable import Kartiseret

final class PreferencesAndCacheTests: XCTestCase {
    func testPreferenceNormalization() {
        let invalid = AppPreferences(city: "Atlantis", ratingSources: [.imdb, .imdb], accent: .purple)
        let normalized = invalid.normalized()
        XCTAssertEqual(normalized.city, "Jerusalem")
        XCTAssertEqual(normalized.ratingSources, [.imdb])
    }

    @MainActor
    func testOptimisticSaveCoalescesPerKey() async throws {
        let client = FixturePreferencesClient(initial: .defaults)
        let defaults = isolatedDefaults()
        let theme = Theme()
        let store = PreferencesStore(client: client, theme: theme, defaults: defaults)
        await store.attach(to: FixtureData.signedInUser)
        XCTAssertTrue(store.selectAccent(.red))
        XCTAssertTrue(store.selectAccent(.blue))
        XCTAssertTrue(store.selectAccent(.green))
        XCTAssertEqual(store.accent, .green)
        try await Task.sleep(for: .milliseconds(500))
        let updateCount = await client.updateCount
        let snapshot = await client.snapshot()
        XCTAssertEqual(updateCount, 1)
        XCTAssertEqual(snapshot?.accent, .green)
        XCTAssertEqual(store.syncState, .synced)
    }

    @MainActor
    func testOptimisticSaveRollsBackOnFailure() async throws {
        let client = FixturePreferencesClient(initial: .defaults, failSaves: true)
        let store = PreferencesStore(client: client, theme: Theme(), defaults: isolatedDefaults())
        await store.attach(to: FixtureData.signedInUser)
        XCTAssertTrue(store.selectAccent(.orange))
        XCTAssertEqual(store.accent, .orange)
        try await Task.sleep(for: .milliseconds(500))
        XCTAssertEqual(store.accent, .purple)
        guard case .failed = store.syncState else { return XCTFail("Expected failed sync state") }
    }

    func testImageRequestsCoalesceAndInvalidate() async throws {
        let loader = CountingImageLoader()
        let pipeline = ImagePipeline(loader: loader)
        let url = URL(string: "https://images.example/poster.jpg")!
        async let first = pipeline.data(for: url)
        async let second = pipeline.data(for: url)
        let values = try await (first, second)
        XCTAssertEqual(values.0, Data([1, 2, 3]))
        XCTAssertEqual(values.1, Data([1, 2, 3]))
        let initialCount = await loader.count
        XCTAssertEqual(initialCount, 1)
        await pipeline.removeAll()
        _ = try await pipeline.data(for: url)
        let invalidatedCount = await loader.count
        XCTAssertEqual(invalidatedCount, 2)
    }

    func testImageInvalidationCancelsInFlightRequest() async throws {
        let loader = CountingImageLoader(delay: .seconds(1))
        let pipeline = ImagePipeline(loader: loader)
        let url = URL(string: "https://images.example/slow-poster.jpg")!
        let request = Task { try await pipeline.data(for: url) }

        while await loader.count == 0 { await Task.yield() }
        await pipeline.removeAll()

        do {
            _ = try await request.value
            XCTFail("Expected cache invalidation to cancel the shared request")
        } catch is CancellationError {
            // Expected.
        }
    }

    @MainActor
    private func isolatedDefaults() -> UserDefaults {
        let name = "KartiseretTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}

private actor CountingImageLoader: ImageDataLoading {
    private(set) var count = 0
    private let delay: Duration

    init(delay: Duration = .milliseconds(80)) {
        self.delay = delay
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        count += 1
        try await Task.sleep(for: delay)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        return (Data([1, 2, 3]), response)
    }
}
