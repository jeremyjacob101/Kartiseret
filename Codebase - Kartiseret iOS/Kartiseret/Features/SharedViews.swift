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
    var maxWidth: CGFloat? = nil
    var linksEnabled = true

    private var ratings: [MovieRatingBadge] { MovieRatingLogic.badges(for: movie, sources: sources) }

    var body: some View {
        if !ratings.isEmpty {
            Group {
                if let maxWidth {
                    ratingRow.frame(width: maxWidth, alignment: .leading)
                } else {
                    ratingRow.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .accessibilityLabel("Movie ratings")
        }
    }

    private var ratingRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 7) {
                ForEach(ratings) { rating in
                    if linksEnabled, let url = rating.destination {
                        Link(destination: url) { badge(rating) }
                            .buttonStyle(.plain)
                    } else {
                        badge(rating)
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func badge(_ rating: MovieRatingBadge) -> some View {
        HStack(spacing: 5) {
            Image(rating.logoName)
                .resizable()
                .scaledToFit()
                .frame(width: logoSize(for: rating.logoName).width, height: logoSize(for: rating.logoName).height)
            Text(rating.value)
                .foregroundStyle(.white)
                .font(.caption2.weight(.bold))
                .monospacedDigit()
        }
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(BrandStyle.raised, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(rating.accessibilityLabel)
    }

    private func logoSize(for name: String) -> CGSize {
        switch name {
        case "RatingIMDb", "RatingTMDb": CGSize(width: 25, height: 14)
        case "RatingLetterboxd": CGSize(width: 17, height: 17)
        default: CGSize(width: 17, height: 19)
        }
    }
}

struct ShowtimeTicket: View {
    let time: String
    let theme: ShowtimeTheme
    var screeningType: String? = nil
    var dubLanguage: String? = nil

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(hex: theme.startHex), Color(hex: theme.endHex)],
                startPoint: .leading,
                endPoint: .trailing
            )
            .mask { Image("ShowtimeTicketMask").resizable() }

            Image("ShowtimeTicketOutline")
                .resizable()
                .renderingMode(.template)
                .foregroundStyle(.black.opacity(0.55))

            Text(time)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundStyle(.white)

            if let flagName = ShowtimeLogic.dubFlagAssetName(dubLanguage),
               ShowtimeLogic.dubbingBadge(dubLanguage) != nil {
                Image(flagName)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 17, height: 13)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                    .background(.white, in: RoundedRectangle(cornerRadius: 2))
                    .overlay(RoundedRectangle(cornerRadius: 2).stroke(.black.opacity(0.85), lineWidth: 1))
                    .shadow(color: .black.opacity(0.22), radius: 3, y: 2)
                    .offset(x: -26, y: -17)
                    .accessibilityHidden(true)
            }

            if ShowtimeLogic.screeningTypeBadge(screeningType ?? "") != nil {
                Image(systemName: "star")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(BrandStyle.accent)
                    .frame(width: 17, height: 13)
                    .background(Color(hex: 0x0C0B14).opacity(0.9), in: Capsule())
                    .overlay(Capsule().stroke(.black.opacity(0.85), lineWidth: 1))
                    .shadow(color: .black.opacity(0.22), radius: 3, y: 2)
                    .offset(x: 26, y: -17)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: 74, height: 39)
        .shadow(color: Color(hex: theme.accentHex).opacity(0.28), radius: 4, y: 2)
        .accessibilityHidden(true)
    }
}

struct ShowtimeTicketCell: View {
    let showtime: Showtime
    let theme: ShowtimeTheme

    private var technology: String? { ShowtimeLogic.technologyBadge(showtime.screeningTech) }

    var body: some View {
        VStack(spacing: -4) {
            if let technology {
                Text(technology)
                    .font(.system(size: 9, weight: .medium).italic())
                    .tracking(-0.15)
                    .foregroundStyle(Color(hex: 0xECE7EA))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 5)
                    .padding(.top, 3)
                    .frame(width: 70, height: 22, alignment: .top)
                    .background(
                        LinearGradient(colors: [Color(hex: 0x756F73), Color(hex: 0x6B6468)], startPoint: .top, endPoint: .bottom),
                        in: UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12)
                    )
                    .accessibilityHidden(true)
            }
            ShowtimeTicket(
                time: showtime.displayTime,
                theme: theme,
                screeningType: showtime.screeningType,
                dubLanguage: showtime.dubLanguage
            )
        }
        .frame(width: 74, height: technology == nil ? 39 : 52, alignment: .bottom)
        .accessibilityHidden(true)
    }
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
