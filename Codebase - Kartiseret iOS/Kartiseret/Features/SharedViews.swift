import SwiftUI

struct MovieArtwork: View {
    var width: CGFloat = 94
    var height: CGFloat = 138

    var body: some View {
        ZStack {
            BrandStyle.accent
            VStack(spacing: max(5, height * 0.08)) {
                Image(systemName: "film")
                    .font(.system(size: min(width, height) * 0.22, weight: .semibold))
                Text("KARTISERET")
                    .font(.system(size: min(width * 0.14, 12), weight: .bold, design: .rounded))
                    .tracking(0.45)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, max(4, width * 0.06))
        }
        .frame(width: width, height: height)
        .background(BrandStyle.accent)
        .clipShape(RoundedRectangle(cornerRadius: 11))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Kartiseret movie card")
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
