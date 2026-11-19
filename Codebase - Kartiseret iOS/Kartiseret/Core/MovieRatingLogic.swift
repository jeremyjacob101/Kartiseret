import Foundation

struct MovieRatingBadge: Identifiable, Equatable, Sendable {
    let source: String
    let value: String
    let logoName: String
    let accessibilityLabel: String
    let destination: URL?

    var id: String { source }
}

enum MovieRatingLogic {
    private static let criticFreshScore = 60.0
    private static let criticCertifiedFreshScore = 75.0
    private static let criticCertifiedFreshReviews = 80.0
    private static let audiencePositiveScore = 60.0
    private static let audienceHotScore = 90.0
    private static let audienceHotRatings = 500.0

    static func badges(for movie: Movie, sources: [String]) -> [MovieRatingBadge] {
        sources.compactMap { source in
            switch source {
            case "imdbRating":
                guard let rating = movie.imdbRating else { return nil }
                let imdbID = movie.imdbId.map { $0.hasPrefix("http") ? $0 : "https://www.imdb.com/title/\($0)/" }
                let value = String(format: "%.1f", rating)
                return MovieRatingBadge(
                    source: source,
                    value: value,
                    logoName: "RatingIMDb",
                    accessibilityLabel: "IMDb rating \(value)",
                    destination: imdbID.flatMap { URL(string: $0) }
                )
            case "rtAudienceRating":
                guard let rating = movie.rtAudienceRating else { return nil }
                let percentage = "\(Int(rating.rounded()))%"
                let isHot = rating >= audienceHotScore && (movie.rtAudienceVotes ?? 0) >= audienceHotRatings
                let isPositive = rating >= audiencePositiveScore
                let logoName = isHot
                    ? "RatingRottenTomatoesAudienceHot"
                    : isPositive ? "RatingRottenTomatoesAudienceGood" : "RatingRottenTomatoesAudienceBad"
                let description = isHot ? "Verified Hot" : isPositive ? "Full Popcorn Bucket" : "Spilled Popcorn Bucket"
                return MovieRatingBadge(
                    source: source,
                    value: percentage,
                    logoName: logoName,
                    accessibilityLabel: "Rotten Tomatoes audience rating \(percentage), \(description)",
                    destination: rottenTomatoesURL(for: movie)
                )
            case "rtCriticRating":
                guard let rating = movie.rtCriticRating else { return nil }
                let percentage = "\(Int(rating.rounded()))%"
                let isCertified = rating >= criticCertifiedFreshScore && (movie.rtCriticVotes ?? 0) >= criticCertifiedFreshReviews
                let isFresh = rating >= criticFreshScore
                let logoName = isCertified
                    ? "RatingRottenTomatoesCriticsHot"
                    : isFresh ? "RatingRottenTomatoesCriticsGood" : "RatingRottenTomatoesCriticsBad"
                let description = isCertified ? "Certified Fresh" : isFresh ? "Fresh" : "Rotten"
                return MovieRatingBadge(
                    source: source,
                    value: percentage,
                    logoName: logoName,
                    accessibilityLabel: "Rotten Tomatoes critics rating \(percentage), \(description)",
                    destination: rottenTomatoesURL(for: movie)
                )
            case "lbRating":
                guard let rating = movie.lbRating else { return nil }
                let value = String(format: "%.1f", rating)
                let identifier = movie.lbId?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                return MovieRatingBadge(
                    source: source,
                    value: value,
                    logoName: "RatingLetterboxd",
                    accessibilityLabel: "Letterboxd rating \(value)",
                    destination: identifier.flatMap { URL(string: "https://letterboxd.com/\($0)/") }
                )
            case "tmdbRating":
                guard let rating = movie.tmdbRating else { return nil }
                let value = String(format: "%.1f", rating)
                return MovieRatingBadge(
                    source: source,
                    value: value,
                    logoName: "RatingTMDb",
                    accessibilityLabel: "TMDb rating \(value)",
                    destination: URL(string: "https://www.themoviedb.org/movie/\(movie.tmdbId)")
                )
            default:
                return nil
            }
        }
    }

    private static func rottenTomatoesURL(for movie: Movie) -> URL? {
        guard let identifier = movie.rtId else { return nil }
        if identifier.hasPrefix("http") { return URL(string: identifier) }
        let path = identifier.hasPrefix("/") ? identifier : "/\(identifier)"
        return URL(string: "https://www.rottentomatoes.com\(path)")
    }
}
