import Foundation
import UIKit

protocol ImageDataLoading: Sendable {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

struct URLSessionImageLoader: ImageDataLoading {
    let session: URLSession

    init(cache: URLCache = ImagePipeline.makeURLCache()) {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = cache
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration)
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }
}

actor ImagePipeline {
    static let shared = ImagePipeline()

    private let memoryCache = NSCache<NSURL, NSData>()
    private let loader: any ImageDataLoading
    private var inFlight: [URL: Task<Data, Error>] = [:]

    init(loader: any ImageDataLoading = URLSessionImageLoader()) {
        self.loader = loader
        memoryCache.countLimit = 300
        memoryCache.totalCostLimit = 120 * 1_024 * 1_024
    }

    func data(for url: URL) async throws -> Data {
        if let cached = memoryCache.object(forKey: url as NSURL) { return cached as Data }
        if let task = inFlight[url] { return try await task.value }
        let loader = loader
        let task = Task<Data, Error> {
            var request = URLRequest(url: url)
            request.cachePolicy = .returnCacheDataElseLoad
            request.setValue("image/avif,image/webp,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
            let (data, response) = try await loader.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  !data.isEmpty else {
                throw AppServiceError.network("The image could not be loaded.")
            }
            return data
        }
        inFlight[url] = task
        do {
            let data = try await task.value
            memoryCache.setObject(data as NSData, forKey: url as NSURL, cost: data.count)
            inFlight[url] = nil
            return data
        } catch {
            inFlight[url] = nil
            throw error
        }
    }

    func removeAll() {
        memoryCache.removeAllObjects()
        inFlight.values.forEach { $0.cancel() }
        inFlight.removeAll()
    }

    nonisolated static func makeURLCache() -> URLCache {
        URLCache(
            memoryCapacity: 40 * 1_024 * 1_024,
            diskCapacity: 240 * 1_024 * 1_024,
            diskPath: "kartiseret-images"
        )
    }
}
