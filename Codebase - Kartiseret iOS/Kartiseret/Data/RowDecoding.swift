import Foundation

enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String {
        switch self {
        case .string(let value): value
        case .number(let value):
            value.rounded() == value ? String(Int(value)) : String(value)
        case .bool(let value): String(value)
        case .array, .object, .null: ""
        }
    }

    var doubleValue: Double? {
        switch self {
        case .number(let value): value.isFinite ? value : nil
        case .string(let value): Double(value.trimmingCharacters(in: .whitespacesAndNewlines))
        case .bool(let value): value ? 1 : 0
        case .array, .object, .null: nil
        }
    }

    var boolValue: Bool? {
        switch self {
        case .bool(let value): value
        case .number(let value): value != 0
        case .string(let value):
            switch value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
            case "true", "t", "1": true
            case "false", "f", "0": false
            default: nil
            }
        case .array, .object, .null: nil
        }
    }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { value } else { nil }
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { value } else { nil }
    }
}

typealias JSONRow = [String: JSONValue]

enum SupabaseRowNormalizer {
    static func movies(rows: [JSONRow], codes: [String: String], mode: MovieMode) -> [Movie] {
        rows
            .filter { !($0["solo_update"]?.boolValue ?? false) }
            .map { row in movie(row: row, code: codes[text(row["tmdb_id"])], mode: mode) }
            .filter { !$0.tmdbID.isEmpty && !$0.title.isEmpty }
            .sorted { left, right in
                if mode == .comingSoon {
                    let leftDate = left.releaseDate ?? "9999-12-31"
                    let rightDate = right.releaseDate ?? "9999-12-31"
                    if leftDate != rightDate { return leftDate < rightDate }
                    if left.popularity != right.popularity { return left.popularity > right.popularity }
                } else if left.popularity != right.popularity {
                    return left.popularity > right.popularity
                }
                return left.title.localizedCaseInsensitiveCompare(right.title) == .orderedAscending
            }
    }

    static func movieCodes(rows: [JSONRow]) -> [String: String] {
        var result: [String: String] = [:]
        for row in rows {
            let tmdbID = text(row["tmdb_id"])
            let code = text(row["movie_code"])
            if !tmdbID.isEmpty,
               code.range(of: "^[0-9A-Za-z]{3}$", options: .regularExpression) != nil {
                result[tmdbID] = code
            }
        }
        return result
    }

    static func showtimes(rows: [JSONRow]) -> [ShowtimeRecord] {
        rows.compactMap { row in
            let tmdbID = text(row["tmdb_id"])
            let city = text(row["screening_city"])
            let date = text(row["date_of_showing"])
            let theater = text(row["cinema"])
            let fullTime = text(row["showtime"])
            let time = String(fullTime.prefix(5))
            guard !tmdbID.isEmpty, !city.isEmpty, CinemaClock.date(fromISO: date) != nil,
                  !theater.isEmpty, CinemaClock.parseShowtimeMinutes(time) != nil else { return nil }
            return ShowtimeRecord(
                tmdbID: tmdbID,
                city: city,
                date: date,
                theater: theater,
                entry: ShowtimeEntry(
                    time: time,
                    ticketURL: safeURL(row["english_href"]),
                    screeningTechnology: text(row["screening_tech"]),
                    screeningType: text(row["screening_type"]),
                    dubLanguage: optionalText(row["dub_language"])
                )
            )
        }
    }

    static func cities(rows: [JSONRow]) -> [City] {
        var mapped: [String: City] = [:]
        for row in rows {
            let name = text(row["name"])
            guard !name.isEmpty else { continue }
            mapped[name] = City(
                name: name,
                alternateSpellings: stringArray(row["alt_spellings"]),
                latitude: row["latitude"]?.doubleValue,
                longitude: row["longitude"]?.doubleValue,
                zoomLevel: row["zoom_layer"]?.doubleValue,
                neighboringCities: stringArray(row["neighboring_cities"])
            )
        }
        for name in KartiseretConstants.supportedCityNames where mapped[name] == nil {
            mapped[name] = City(name: name, alternateSpellings: [], latitude: nil, longitude: nil, zoomLevel: nil, neighboringCities: [])
        }
        return mapped.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    static func theaters(rows: [JSONRow]) -> [Theater] {
        rows.compactMap { row in
            let details: JSONRow
            if let object = row["city_details"]?.objectValue { details = object }
            else if let first = row["city_details"]?.arrayValue?.first?.objectValue { details = first }
            else { details = [:] }
            let cityName = firstText(in: [details, row], keys: ["name", "city_name", "screening_city"])
            let name = firstText(in: [row], keys: ["theater_name", "name", "cinema"])
            let chain = text(row["chain"])
            guard !cityName.isEmpty, !(name.isEmpty && chain.isEmpty) else { return nil }
            return Theater(
                name: name.isEmpty ? chain : name,
                chain: chain,
                address: text(row["address"]),
                location: text(row["location"]),
                latitude: row["latitude"]?.doubleValue,
                longitude: row["longitude"]?.doubleValue,
                cityName: cityName
            )
        }
        .uniqued()
        .sorted {
            if $0.cityName != $1.cityName { return $0.cityName < $1.cityName }
            if $0.chain != $1.chain { return ShowtimeGrouper.theaterComparator($0.chain, $1.chain) }
            return $0.name < $1.name
        }
    }

    static func preferences(row: JSONRow?) -> AppPreferences? {
        guard let row else { return nil }
        let city = optionalText(row["location"]) ?? AppPreferences.defaults.city
        let sources = stringArray(row["rating_sources"]).compactMap(RatingSource.init(rawValue:))
        let accentRaw = optionalText(row["site_color"]) ?? AccentChoice.purple.rawValue
        return AppPreferences(
            city: city,
            ratingSources: sources.isEmpty ? AppPreferences.defaults.ratingSources : sources,
            accent: AccentChoice.fromStoredValue(accentRaw)
        ).normalized()
    }

    private static func movie(row: JSONRow, code: String?, mode: MovieMode) -> Movie {
        let releaseDate = optionalText(row["release_date"])
        let explicitYear = row["release_year"]?.doubleValue.map { Int($0) } ?? 0
        let inferredYear = releaseDate.flatMap { Int($0.prefix(4)) } ?? 0
        let poster = firstURL(row, keys: ["en_poster", "poster", "backdrop"])
        return Movie(
            tmdbID: text(row["tmdb_id"]),
            movieCode: code,
            imdbID: optionalText(row["imdb_id"]),
            rottenTomatoesID: optionalText(row["rt_id"]),
            letterboxdID: optionalText(row["lb_id"]),
            title: text(row["english_title"]).trimmingCharacters(in: CharacterSet(charactersIn: "\"")),
            year: explicitYear > 0 ? explicitYear : inferredYear,
            releaseDate: releaseDate,
            genres: genres(row["genres"]),
            posterURL: poster,
            backdropURL: firstURL(row, keys: ["backdrop", "en_poster", "poster"]) ?? poster,
            trailerKey: optionalText(row["en_trailer"]),
            imdbRating: row["imdbRating"]?.doubleValue,
            letterboxdRating: row["lbRating"]?.doubleValue,
            letterboxdVotes: row["lbVotes"]?.doubleValue,
            tmdbRating: row["tmdbRating"]?.doubleValue,
            tmdbVotes: row["tmdbVotes"]?.doubleValue,
            rottenTomatoesCriticRating: row["rtCriticRating"]?.doubleValue,
            rottenTomatoesCriticVotes: row["rtCriticVotes"]?.doubleValue,
            rottenTomatoesAudienceRating: row["rtAudienceRating"]?.doubleValue,
            rottenTomatoesAudienceVotes: row["rtAudienceVotes"]?.doubleValue,
            runtimeMinutes: row["runtime"]?.doubleValue.map { Int($0) } ?? 0,
            popularity: row["popularity"]?.doubleValue ?? 0,
            alternatives: alternatives(row["alt_options"]),
            mode: mode
        )
    }

    private static func alternatives(_ value: JSONValue?) -> [MovieAlternative] {
        let array = decodedArray(value)
        return array.compactMap { value in
            guard let row = value.objectValue else { return nil }
            let tmdbID = firstText(in: [row], keys: ["tmdb", "tmdb_id"])
            let title = text(row["title"]).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            guard !tmdbID.isEmpty, !title.isEmpty else { return nil }
            return MovieAlternative(
                tmdbID: tmdbID,
                title: title,
                year: row["year"]?.doubleValue.map(Int.init),
                posterURL: safeURL(row["poster_url"])
            )
        }.prefix(10).map { $0 }
    }

    private static func genres(_ value: JSONValue?) -> [String] {
        var values = stringArray(value)
        if values.isEmpty, let string = value?.stringValue, !string.isEmpty {
            values = string.trimmingCharacters(in: CharacterSet(charactersIn: "{}[]"))
                .split(separator: ",")
                .map(String.init)
        }
        return values.map {
            normalizedText($0.trimmingCharacters(in: CharacterSet(charactersIn: "\"")))
        }.filter { !$0.isEmpty }.uniqued()
    }

    private static func stringArray(_ value: JSONValue?) -> [String] {
        let direct = decodedArray(value).map(\.stringValue).filter { !$0.isEmpty }
        if !direct.isEmpty { return direct }
        guard let string = value?.stringValue, !string.isEmpty else { return [] }
        if let data = string.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([JSONValue].self, from: data) {
            return decoded.map(\.stringValue).filter { !$0.isEmpty }
        }
        return []
    }

    private static func decodedArray(_ value: JSONValue?) -> [JSONValue] {
        if let direct = value?.arrayValue { return direct }
        guard let string = value?.stringValue, let data = string.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([JSONValue].self, from: data)) ?? []
    }

    private static func firstURL(_ row: JSONRow, keys: [String]) -> URL? {
        keys.lazy.compactMap { safeURL(row[$0]) }.first
    }

    private static func safeURL(_ value: JSONValue?) -> URL? {
        guard let string = optionalText(value), let url = URL(string: string), url.isSafeExternalURL else { return nil }
        return url
    }

    private static func firstText(in rows: [JSONRow], keys: [String]) -> String {
        for row in rows {
            for key in keys {
                let value = text(row[key])
                if !value.isEmpty { return value }
            }
        }
        return ""
    }

    private static func optionalText(_ value: JSONValue?) -> String? {
        let value = text(value)
        return value.isEmpty ? nil : value
    }

    private static func text(_ value: JSONValue?) -> String {
        normalizedText(value?.stringValue ?? "")
    }

    private static func normalizedText(_ value: String) -> String {
        value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}
