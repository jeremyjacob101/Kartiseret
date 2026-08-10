import Foundation

enum SearchScope: String, CaseIterable, Identifiable, Sendable {
    case all = "All"
    case nowPlaying = "Now Playing"
    case comingSoon = "Coming Soon"
    var id: Self { self }
}

struct MovieSearchResult: Identifiable, Hashable, Sendable {
    let movie: Movie
    let score: Int
    var id: String { movie.id }
}

enum MovieSearchEngine {
    static func search(
        query: String,
        nowPlaying: [Movie],
        comingSoon: [Movie],
        scope: SearchScope = .all,
        limit: Int = 10
    ) -> [MovieSearchResult] {
        let normalizedQuery = normalize(query)
        guard !normalizedQuery.isEmpty else { return [] }
        let candidates: [Movie] = switch scope {
        case .all: nowPlaying + comingSoon
        case .nowPlaying: nowPlaying
        case .comingSoon: comingSoon
        }

        return candidates
            .compactMap { movie -> MovieSearchResult? in
                let score = score(movie: movie, query: normalizedQuery)
                return score > 0 ? MovieSearchResult(movie: movie, score: score) : nil
            }
            .sorted {
                if $0.score != $1.score { return $0.score > $1.score }
                if $0.movie.popularity != $1.movie.popularity { return $0.movie.popularity > $1.movie.popularity }
                return $0.movie.title.localizedCaseInsensitiveCompare($1.movie.title) == .orderedAscending
            }
            .uniqued(by: \MovieSearchResult.movie.tmdbID)
            .prefix(max(0, limit))
            .map { $0 }
    }

    static func score(movie: Movie, query: String) -> Int {
        let normalizedQuery = normalize(query)
        guard !normalizedQuery.isEmpty else { return 0 }
        let title = normalize(movie.title)
        let year = movie.year > 0 ? String(movie.year) : ""
        let titleWithYear = year.isEmpty ? title : "\(title) \(year)"
        if title == normalizedQuery { return 500 }
        if title.hasPrefix(normalizedQuery) { return 400 }
        if title.split(separator: " ").contains(where: { $0.hasPrefix(normalizedQuery) }) { return 320 }
        if title.contains(normalizedQuery) { return 240 }
        if !year.isEmpty, year == normalizedQuery { return 180 }
        if titleWithYear.contains(normalizedQuery) { return 120 }
        return 0
    }

    private static func normalize(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private extension Array {
    func uniqued<Key: Hashable>(by keyPath: KeyPath<Element, Key>) -> [Element] {
        var seen = Set<Key>()
        return filter { seen.insert($0[keyPath: keyPath]).inserted }
    }
}
