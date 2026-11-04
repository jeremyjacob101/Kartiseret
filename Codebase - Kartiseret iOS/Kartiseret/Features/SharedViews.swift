import SwiftUI

struct MovieArtwork: View {
    let urlString: String
    var width: CGFloat = 94
    var height: CGFloat = 138

    var body: some View {
        Group {
            if let url = URL(string: urlString), !urlString.isEmpty {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: height)
        .background(BrandStyle.raised)
        .clipShape(RoundedRectangle(cornerRadius: 11))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            LinearGradient(colors: [BrandStyle.raised, BrandStyle.surface], startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: "film")
                .font(.title2)
                .foregroundStyle(BrandStyle.secondary)
        }
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
