import Foundation
@preconcurrency import Supabase

protocol CatalogRepository: Sendable {
    func loadCatalog(_ mode: MovieMode, forceRefresh: Bool) async throws -> [Movie]
    func loadShowtimes(city: String, startDate: String, endDate: String, tmdbID: String?, forceRefresh: Bool) async throws -> [ShowtimeRecord]
    func loadCities() async throws -> [City]
    func loadTheaters() async throws -> [Theater]
    func invalidateShowtimeCache() async
    func invalidateAll() async
}

actor SupabaseCatalogRepository: CatalogRepository {
    private let client: SupabaseClient
    private var catalogCache: [MovieMode: [Movie]] = [:]
    private var catalogTasks: [MovieMode: Task<[Movie], Error>] = [:]
    private var codesCache: [String: String]?
    private var codesTask: Task<[String: String], Error>?
    private var showtimeCache: [ShowtimeRequestKey: [ShowtimeRecord]] = [:]
    private var showtimeTasks: [ShowtimeRequestKey: Task<[ShowtimeRecord], Error>] = [:]
    private var citiesCache: [City]?
    private var citiesTask: Task<[City], Error>?
    private var theatersCache: [Theater]?
    private var theatersTask: Task<[Theater], Error>?

    init(client: SupabaseClient) {
        self.client = client
    }

    func loadCatalog(_ mode: MovieMode, forceRefresh: Bool = false) async throws -> [Movie] {
        if !forceRefresh, let cached = catalogCache[mode] { return cached }
        if let task = catalogTasks[mode] { return try await task.value }
        let task = Task { [client, self] in
            let table = mode == .nowPlaying ? "finalMovies" : "finalSoons"
            let baseColumns = mode == .nowPlaying ? Self.movieColumns : Self.comingSoonColumns
            let optionalColumns = mode == .nowPlaying ? Self.optionalMovieColumns : Self.optionalComingSoonColumns
            async let codes = loadMovieCodes(forceRefresh: forceRefresh)
            let rows = try await Self.fetchRowsWithOptionalColumnFallback(
                client: client,
                table: table,
                baseColumns: baseColumns,
                optionalColumns: optionalColumns
            )
            return SupabaseRowNormalizer.movies(rows: rows, codes: try await codes, mode: mode)
        }
        catalogTasks[mode] = task
        do {
            let movies = try await task.value
            catalogCache[mode] = movies
            catalogTasks[mode] = nil
            return movies
        } catch {
            catalogTasks[mode] = nil
            throw error
        }
    }

    func loadShowtimes(
        city: String,
        startDate: String,
        endDate: String,
        tmdbID: String? = nil,
        forceRefresh: Bool = false
    ) async throws -> [ShowtimeRecord] {
        let key = ShowtimeRequestKey(city: city, startDate: startDate, endDate: endDate, tmdbID: tmdbID)
        if !forceRefresh, let cached = showtimeCache[key] { return cached }
        if let task = showtimeTasks[key] { return try await task.value }
        let task = Task { [client] in
            let columns = Self.showtimeColumns + Self.optionalShowtimeColumns
            do {
                return try await Self.fetchShowtimes(
                    client: client, columns: columns, city: city,
                    startDate: startDate, endDate: endDate, tmdbID: tmdbID
                )
            } catch {
                guard Self.looksLikeMissingColumn(error, optionalColumns: Self.optionalShowtimeColumns) else { throw error }
                return try await Self.fetchShowtimes(
                    client: client, columns: Self.showtimeColumns, city: city,
                    startDate: startDate, endDate: endDate, tmdbID: tmdbID
                )
            }
        }
        showtimeTasks[key] = task
        do {
            let rows = try await task.value
            showtimeCache[key] = rows
            showtimeTasks[key] = nil
            return rows
        } catch {
            showtimeTasks[key] = nil
            throw error
        }
    }

    func loadCities() async throws -> [City] {
        if let citiesCache { return citiesCache }
        if let citiesTask { return try await citiesTask.value }
        let task = Task { [client] in
            let rows = try await Self.fetchAll(
                client: client,
                table: "cities",
                columns: ["name", "alt_spellings", "latitude", "longitude", "zoom_layer", "neighboring_cities"]
            )
            return SupabaseRowNormalizer.cities(rows: rows)
        }
        citiesTask = task
        do {
            let cities = try await task.value
            citiesCache = cities
            citiesTask = nil
            return cities
        } catch {
            citiesTask = nil
            throw error
        }
    }

    func loadTheaters() async throws -> [Theater] {
        if let theatersCache { return theatersCache }
        if let theatersTask { return try await theatersTask.value }
        let task = Task { [client] in
            let rows = try await Self.fetchAll(
                client: client,
                table: "theaters",
                columns: [
                    "chain", "address", "location", "theater_name", "latitude", "longitude",
                    "city_details:cities!theaters_city_name_fkey(name,alt_spellings,latitude,longitude,zoom_layer,neighboring_cities)"
                ]
            )
            return SupabaseRowNormalizer.theaters(rows: rows)
        }
        theatersTask = task
        do {
            let theaters = try await task.value
            theatersCache = theaters
            theatersTask = nil
            return theaters
        } catch {
            theatersTask = nil
            throw error
        }
    }

    func invalidateShowtimeCache() {
        showtimeTasks.values.forEach { $0.cancel() }
        showtimeTasks.removeAll()
        showtimeCache.removeAll()
    }

    func invalidateAll() {
        catalogTasks.values.forEach { $0.cancel() }
        codesTask?.cancel()
        showtimeTasks.values.forEach { $0.cancel() }
        citiesTask?.cancel()
        theatersTask?.cancel()
        catalogTasks.removeAll()
        showtimeTasks.removeAll()
        catalogCache.removeAll()
        showtimeCache.removeAll()
        codesCache = nil
        codesTask = nil
        citiesCache = nil
        citiesTask = nil
        theatersCache = nil
        theatersTask = nil
    }

    private func loadMovieCodes(forceRefresh: Bool) async throws -> [String: String] {
        if !forceRefresh, let codesCache { return codesCache }
        if let codesTask { return try await codesTask.value }
        let task = Task { [client] in
            let rows = try await Self.fetchAll(
                client: client,
                table: "movieCodes",
                columns: ["tmdb_id", "movie_code"]
            )
            return SupabaseRowNormalizer.movieCodes(rows: rows)
        }
        codesTask = task
        do {
            let codes = try await task.value
            codesCache = codes
            codesTask = nil
            return codes
        } catch {
            codesTask = nil
            throw error
        }
    }

    private struct ShowtimeRequestKey: Hashable, Sendable {
        var city: String
        var startDate: String
        var endDate: String
        var tmdbID: String?
    }

    private static let movieColumns = [
        "tmdb_id", "english_title", "release_year", "solo_update", "genres", "en_poster",
        "alt_options", "en_trailer", "backdrop", "imdbRating", "rtCriticRating",
        "rtAudienceRating", "runtime", "popularity"
    ]
    private static let optionalMovieColumns = [
        "imdb_id", "rt_id", "rtCriticVotes", "rtAudienceVotes", "lb_id", "lbRating",
        "lbVotes", "tmdbRating", "tmdbVotes"
    ]
    private static let comingSoonColumns = [
        "tmdb_id", "english_title", "release_year", "solo_update", "release_date", "genres",
        "en_poster", "alt_options", "backdrop", "en_trailer"
    ]
    private static let optionalComingSoonColumns = ["runtime", "popularity"]
    private static let showtimeColumns = [
        "tmdb_id", "screening_city", "date_of_showing", "cinema", "showtime", "english_href"
    ]
    private static let optionalShowtimeColumns = ["screening_tech", "screening_type", "dub_language"]

    private nonisolated static func fetchAll(
        client: SupabaseClient,
        table: String,
        columns: [String]
    ) async throws -> [JSONRow] {
        var allRows: [JSONRow] = []
        var offset = 0
        while true {
            let rows: [JSONRow] = try await client
                .from(table)
                .select(columns.joined(separator: ","))
                .range(from: offset, to: offset + KartiseretConstants.pageSize - 1)
                .execute()
                .value
            allRows.append(contentsOf: rows)
            if rows.count < KartiseretConstants.pageSize { return allRows }
            offset += KartiseretConstants.pageSize
            try Task.checkCancellation()
        }
    }

    private nonisolated static func fetchRowsWithOptionalColumnFallback(
        client: SupabaseClient,
        table: String,
        baseColumns: [String],
        optionalColumns: [String]
    ) async throws -> [JSONRow] {
        do {
            return try await fetchAll(client: client, table: table, columns: baseColumns + optionalColumns)
        } catch {
            guard looksLikeMissingColumn(error, optionalColumns: optionalColumns) else { throw error }
            return try await fetchAll(client: client, table: table, columns: baseColumns)
        }
    }

    private nonisolated static func fetchShowtimes(
        client: SupabaseClient,
        columns: [String],
        city: String,
        startDate: String,
        endDate: String,
        tmdbID: String?
    ) async throws -> [ShowtimeRecord] {
        var allRows: [JSONRow] = []
        var offset = 0
        while true {
            var query = client.from("finalShowtimes")
                .select(columns.joined(separator: ","))
                .eq("screening_city", value: city)
                .gte("date_of_showing", value: startDate)
                .lte("date_of_showing", value: endDate)
            if let tmdbID { query = query.eq("tmdb_id", value: tmdbID) }
            let rows: [JSONRow] = try await query
                .range(from: offset, to: offset + KartiseretConstants.pageSize - 1)
                .execute()
                .value
            allRows.append(contentsOf: rows)
            if rows.count < KartiseretConstants.pageSize { return SupabaseRowNormalizer.showtimes(rows: allRows) }
            offset += KartiseretConstants.pageSize
            try Task.checkCancellation()
        }
    }

    private nonisolated static func looksLikeMissingColumn(_ error: Error, optionalColumns: [String]) -> Bool {
        let message = error.localizedDescription.lowercased()
        return optionalColumns.contains { column in
            message.contains(column.lowercased()) && (message.contains("column") || message.contains("schema cache"))
        }
    }
}
