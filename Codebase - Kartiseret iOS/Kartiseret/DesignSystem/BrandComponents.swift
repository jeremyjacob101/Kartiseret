import SwiftUI
import UIKit

struct BrandMark: View {
    @Environment(Theme.self) private var theme
    var size: CGFloat = 30

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.23, style: .continuous)
                .fill(theme.tint.gradient)
                .rotationEffect(.degrees(-7))
            Text("K")
                .font(.system(size: size * 0.57, weight: .black, design: .rounded))
                .foregroundStyle(Theme.background)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct BrandTitle: View {
    var body: some View {
        HStack(spacing: 10) {
            BrandMark(size: 31)
            Text("Kartiseret")
                .font(.title2.weight(.bold))
                .tracking(-0.4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Kartiseret")
    }
}

struct RemoteArtwork: View {
    enum Kind { case poster, backdrop }

    let url: URL?
    let title: String
    var kind: Kind = .poster
    var cornerRadius: CGFloat = 12

    @State private var image: UIImage?
    @State private var failed = false
    @Environment(Theme.self) private var theme

    var body: some View {
        ZStack {
            placeholder
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            }
            if kind == .backdrop {
                LinearGradient(
                    colors: [.clear, Theme.background.opacity(0.15), Theme.background],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .task(id: url) {
            image = nil
            failed = false
            guard let url else { failed = true; return }
            do {
                let data = try await ImagePipeline.shared.data(for: url)
                guard !Task.isCancelled, let decoded = UIImage(data: data) else {
                    failed = true
                    return
                }
                withAnimation(.easeOut(duration: 0.22)) { image = decoded }
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Poster for \(title)")
    }

    private var placeholder: some View {
        let palette = placeholderPalette
        return LinearGradient(colors: palette, startPoint: .topLeading, endPoint: .bottomTrailing)
            .overlay {
            Circle()
                .fill(.white.opacity(0.06))
                .frame(width: kind == .poster ? 170 : 330)
                .offset(x: kind == .poster ? 55 : 130, y: kind == .poster ? -90 : -70)
            }
            .overlay {
            VStack(spacing: 9) {
                BrandMark(size: kind == .poster ? 36 : 48)
                if kind == .poster {
                    Text(title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.78))
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .padding(.horizontal, 10)
                }
            }
            }
            .overlay {
                if failed, url != nil {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.42))
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                        .padding(8)
                        .accessibilityHidden(true)
                }
            }
    }

    private var placeholderPalette: [Color] {
        let palettes: [[Color]] = [
            [Color(hex: "#49305f"), Color(hex: "#1e2836")],
            [Color(hex: "#274b4d"), Color(hex: "#20252c")],
            [Color(hex: "#623c3d"), Color(hex: "#292229")],
            [Color(hex: "#3f3b6c"), Color(hex: "#1e2932")],
            [Color(hex: "#5a482c"), Color(hex: "#25252d")]
        ]
        let sum = title.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return palettes[sum % palettes.count]
    }
}

struct PosterCard: View {
    let movie: Movie
    var width: CGFloat? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            RemoteArtwork(url: movie.posterURL, title: movie.title)
                .aspectRatio(2 / 3, contentMode: .fit)
                .shadow(color: .black.opacity(0.28), radius: 8, y: 5)
            Text(movie.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.primaryText)
                .lineLimit(2, reservesSpace: true)
            Text(movie.mode == .comingSoon ? releaseText : yearText)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
                .lineLimit(1)
        }
        .frame(width: width, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    private var yearText: String { movie.year > 0 ? String(movie.year) : "Year unavailable" }
    private var releaseText: String {
        guard let date = movie.releaseDateValue else { return yearText }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }
    private var accessibilityLabel: String {
        movie.mode == .comingSoon
            ? "\(movie.title), coming soon \(releaseText)"
            : "\(movie.title), \(yearText)"
    }
}

struct RatingPill: View {
    let source: RatingSource
    let movie: Movie
    var compact = false

    var body: some View {
        if let value = source.formattedValue(in: movie) {
            VStack(spacing: compact ? 4 : 7) {
                RatingBrandLogo(source: source, movie: movie, compact: compact)
                    .frame(width: logoSize.width, height: logoSize.height)
                Text(value)
                    .font(compact ? .caption2.weight(.bold) : .caption.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(Theme.primaryText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .frame(width: compact ? 36 : 44, height: compact ? 40 : 48)
            .dynamicTypeSize(.xSmall ... .accessibility1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(source.scoreDescription(in: movie)), \(value)")
        }
    }

    private var logoSize: CGSize {
        switch source {
        case .imdb, .tmdb:
            CGSize(width: compact ? 26 : 30, height: compact ? 13 : 16)
        case .rottenTomatoesAudience, .rottenTomatoesCritic, .letterboxd:
            CGSize(width: compact ? 20 : 24, height: compact ? 20 : 24)
        }
    }
}

private struct RatingBrandLogo: View {
    let source: RatingSource
    let movie: Movie
    let compact: Bool

    @ViewBuilder
    var body: some View {
        switch source {
        case .imdb:
            Text("IMDb")
                .font(.system(size: compact ? 8 : 10, weight: .black, design: .rounded))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(hex: "#f6c700"), in: RoundedRectangle(cornerRadius: compact ? 2.5 : 3.5))
        case .rottenTomatoesAudience, .rottenTomatoesCritic:
            Image(source.logoAssetName(in: movie))
                .resizable()
                .renderingMode(.original)
                .scaledToFit()
        case .letterboxd:
            HStack(spacing: compact ? -4 : -5) {
                Circle().fill(Color(hex: "#ff8000"))
                Circle().fill(Color(hex: "#00e054")).zIndex(1)
                Circle().fill(Color(hex: "#40bcf4"))
            }
            .padding(.vertical, compact ? 5 : 6)
        case .tmdb:
            Text("TMDB")
                .font(.system(size: compact ? 8 : 10, weight: .black, design: .rounded))
                .tracking(-0.35)
                .foregroundStyle(
                    LinearGradient(
                        colors: [Color(hex: "#90cea1"), Color(hex: "#3cbec9"), Color(hex: "#00b3e5")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

struct LoadingPosterGrid: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 16)], spacing: 22) {
            ForEach(0..<8, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 12).fill(Theme.skeleton).aspectRatio(2 / 3, contentMode: .fit)
                    RoundedRectangle(cornerRadius: 4).fill(Theme.skeleton).frame(height: 14)
                    RoundedRectangle(cornerRadius: 4).fill(Theme.skeleton).frame(width: 55, height: 10)
                }
                .accessibilityHidden(true)
            }
        }
        .redacted(reason: .placeholder)
    }
}

struct ContentUnavailableCard: View {
    let title: String
    let message: String
    var systemImage = "film"
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: systemImage)
                .font(.system(size: 34, weight: .medium))
                .foregroundStyle(Theme.secondaryText)
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(Theme.raisedBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(Theme.border))
    }
}

struct SectionHeading: View {
    let title: String
    var subtitle: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.title2.bold())
                if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(Theme.secondaryText) }
            }
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
            }
        }
    }
}
