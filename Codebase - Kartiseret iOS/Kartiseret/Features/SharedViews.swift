import SwiftUI

struct MovieArtwork: View {
    var movie: Movie? = nil
    var width: CGFloat = 94
    var height: CGFloat = 138

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 11).fill(BrandStyle.raised)
            if let url = AppConfiguration.imageURL(movie?.imageSrc) {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        fallback
                    }
                }
                .frame(width: width, height: height)
                .clipped()
            } else {
                fallback
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 11))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(movie?.title ?? "Kartiseret movie card")
    }

    private var fallback: some View {
        ZStack {
            LinearGradient(colors: [BrandStyle.accent, BrandStyle.raised], startPoint: .topLeading, endPoint: .bottomTrailing)
            VStack(spacing: 8) {
                Image(systemName: "film").font(.system(size: min(width, height) * 0.20, weight: .semibold))
                Text(movie?.title ?? "KARTISERET")
                    .font(.system(size: min(width * 0.14, 12), weight: .bold, design: .rounded))
                    .multilineTextAlignment(.center).lineLimit(4).minimumScaleFactor(0.65)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, max(4, width * 0.06))
        }
    }
}

struct MovieRatingsView: View {
    let movie: Movie
    let sources: [String]

    private var ratings: [MovieRatingBadge] {
        sources.compactMap { source in
            switch source {
            case "imdbRating":
                guard let rating = movie.imdbRating else { return nil }
                let id = movie.imdbId.map { $0.hasPrefix("http") ? $0 : "https://www.imdb.com/title/\($0)/" }
                return MovieRatingBadge(key: source, label: "IMDb", value: String(format: "%.1f", rating), url: id.flatMap { URL(string: $0) })
            case "rtAudienceRating":
                guard let rating = movie.rtAudienceRating else { return nil }
                let url = movie.rtId.flatMap { URL(string: $0.hasPrefix("http") ? $0 : "https://www.rottentomatoes.com\($0.hasPrefix("/") ? "" : "/")\($0)") }
                return MovieRatingBadge(key: source, label: "RT audience", value: "\(Int(rating.rounded()))%", url: url)
            case "rtCriticRating":
                guard let rating = movie.rtCriticRating else { return nil }
                let url = movie.rtId.flatMap { URL(string: $0.hasPrefix("http") ? $0 : "https://www.rottentomatoes.com\($0.hasPrefix("/") ? "" : "/")\($0)") }
                return MovieRatingBadge(key: source, label: "RT critics", value: "\(Int(rating.rounded()))%", url: url)
            case "lbRating":
                guard let rating = movie.lbRating else { return nil }
                let url = movie.lbId.flatMap { URL(string: $0.hasPrefix("http") ? $0 : "https://letterboxd.com/\($0.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/") }
                return MovieRatingBadge(key: source, label: "Letterboxd", value: String(format: "%.1f", rating), url: url)
            case "tmdbRating":
                guard let rating = movie.tmdbRating else { return nil }
                return MovieRatingBadge(key: source, label: "TMDb", value: String(format: "%.1f", rating), url: URL(string: "https://www.themoviedb.org/movie/\(movie.tmdbId)"))
            default:
                return nil
            }
        }
    }

    var body: some View {
        if !ratings.isEmpty {
            ScrollView(.horizontal) {
                HStack(spacing: 7) {
                    ForEach(ratings) { rating in
                        if let url = rating.url {
                            Link(destination: url) { badge(rating) }
                                .buttonStyle(.plain)
                        } else {
                            badge(rating)
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
            .accessibilityLabel("Movie ratings")
        }
    }

    private func badge(_ rating: MovieRatingBadge) -> some View {
        HStack(spacing: 5) {
            Text(rating.label).foregroundStyle(BrandStyle.secondary)
            Text(rating.value).foregroundStyle(.white).fontWeight(.semibold)
        }
        .font(.caption2)
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(BrandStyle.raised, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rating.label): \(rating.value)")
    }
}

private struct MovieRatingBadge: Identifiable {
    let key: String
    let label: String
    let value: String
    let url: URL?
    var id: String { key }
}

struct LoadingState: View {
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            ProgressView().tint(BrandStyle.accent)
            Text(message).font(.subheadline).foregroundStyle(BrandStyle.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 170)
        .accessibilityElement(children: .combine)
    }
}

struct EmptyState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "film.stack")
                .font(.title2)
                .foregroundStyle(BrandStyle.accent)
            Text(title).font(.headline).foregroundStyle(.white)
            Text(message).font(.subheadline).foregroundStyle(BrandStyle.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 170)
        .padding(20)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.title2)
                .foregroundStyle(BrandStyle.accent)
            Text("Couldn’t load this right now")
                .font(.headline)
                .foregroundStyle(.white)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(BrandStyle.secondary)
                .multilineTextAlignment(.center)
            Button("Try again", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(BrandStyle.accent)
                .accessibilityIdentifier("retryButton")
        }
        .frame(maxWidth: .infinity, minHeight: 210)
        .padding(20)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }
}

struct InlineError: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(BrandStyle.accent)
            Text(message)
                .font(.caption)
                .foregroundStyle(BrandStyle.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
            Button("Retry", action: retry).font(.caption.weight(.semibold))
        }
        .padding(12)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}
