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
                guard let rating = movie.imdbRating, rating.isFinite else { return nil }
                let value = String(format: "%.1f", rating)
                return MovieRatingBadge(
                    source: source,
                    value: value,
                    logoName: "RatingIMDb",
                    accessibilityLabel: "IMDb rating \(value)",
                    destination: ratingURL(movie.imdbId, baseURL: "https://www.imdb.com/title", trailingSlash: true)
                )
            case "rtAudienceRating":
                guard let rating = movie.rtAudienceRating, rating.isFinite else { return nil }
                let percentage = String(format: "%.0f%%", rating.rounded())
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
                    destination: ratingURL(movie.rtId, baseURL: "https://www.rottentomatoes.com")
                )
            case "rtCriticRating":
                guard let rating = movie.rtCriticRating, rating.isFinite else { return nil }
                let percentage = String(format: "%.0f%%", rating.rounded())
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
                    destination: ratingURL(movie.rtId, baseURL: "https://www.rottentomatoes.com")
                )
            case "lbRating":
                guard let rating = movie.lbRating, rating.isFinite else { return nil }
                let value = String(format: "%.1f", rating)
                return MovieRatingBadge(
                    source: source,
                    value: value,
                    logoName: "RatingLetterboxd",
                    accessibilityLabel: "Letterboxd rating \(value)",
                    destination: ratingURL(movie.lbId, baseURL: "https://letterboxd.com", trailingSlash: true)
                )
            case "tmdbRating":
                guard let rating = movie.tmdbRating, rating.isFinite else { return nil }
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

    private static func ratingURL(_ identifier: String?, baseURL: String, trailingSlash: Bool = false) -> URL? {
        guard let value = identifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else { return nil }
        if let absoluteURL = URL(string: value), let scheme = absoluteURL.scheme {
            guard ["http", "https"].contains(scheme.lowercased()), absoluteURL.host != nil else { return nil }
            return absoluteURL
        }
        let path = value.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !path.isEmpty else { return nil }
        return URL(string: "\(baseURL)/\(path)\(trailingSlash ? "/" : "")")
    }
}
