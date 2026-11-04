import SwiftUI

private enum HelpLinks {
    static let support = URL(string: "https://seret.site")!
    static let privacyPolicy = URL(string: "https://gist.github.com/jeremyjacob101/2093d9bd74c8a1fe908f6d2a78a837d6")!
}

struct HelpView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("For help using Kartiseret or information about privacy, use these links.")
                    .font(.subheadline)
                    .foregroundStyle(BrandStyle.secondary)
                    .padding(.bottom, 4)

                Link(destination: HelpLinks.support) {
                    HelpLinkRow(
                        title: "Support",
                        detail: "Visit seret.site",
                        symbol: "questionmark.circle"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("help.support")
                .accessibilityHint("Opens Kartiseret support in your browser.")

                Link(destination: HelpLinks.privacyPolicy) {
                    HelpLinkRow(
                        title: "Privacy Policy",
                        detail: "How Kartiseret handles information",
                        symbol: "hand.raised"
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("help.privacyPolicy")
                .accessibilityHint("Opens the Kartiseret privacy policy in your browser.")
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(BrandStyle.background)
        .navigationTitle("Help")
        .navigationBarTitleDisplayMode(.large)
    }
}

private struct HelpLinkRow: View {
    let title: String
    let detail: String
    let symbol: String

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(BrandStyle.accent)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(BrandStyle.secondary)
            }

            Spacer(minLength: 8)

            Image(systemName: "arrow.up.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrandStyle.secondary)
        }
        .padding(16)
        .background(BrandStyle.surface, in: RoundedRectangle(cornerRadius: 16))
        .contentShape(RoundedRectangle(cornerRadius: 16))
    }
}
