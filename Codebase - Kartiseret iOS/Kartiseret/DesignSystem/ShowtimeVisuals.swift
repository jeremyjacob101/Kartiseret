import SwiftUI

struct TheaterPalette {
    let accent: Color
    let gradientColors: [Color]
    let gradientStart: UnitPoint
    let gradientEnd: UnitPoint
    let surface: Color
    let glow: Color

    static func resolve(_ theater: String) -> TheaterPalette {
        switch theater.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "yes planet":
            TheaterPalette(
                accent: Color(hex: "#d9710f"),
                gradientColors: [Color(hex: "#d9710f"), Color(hex: "#b05806")],
                gradientStart: .trailing,
                gradientEnd: .leading,
                surface: Color(hex: "#ff9a3d").opacity(0.12),
                glow: Color(hex: "#d9710f").opacity(0.28)
            )
        case "cinema city":
            TheaterPalette(
                accent: Color(hex: "#5ea8ff"),
                gradientColors: [Color(hex: "#186bdf"), Color(hex: "#084cab")],
                gradientStart: .leading,
                gradientEnd: .trailing,
                surface: Color(hex: "#5ea8ff").opacity(0.12),
                glow: Color(hex: "#186bdf").opacity(0.30)
            )
        case "lev cinema":
            TheaterPalette(
                accent: Color(hex: "#ff6b6b"),
                gradientColors: [Color(hex: "#b50519"), Color(hex: "#5e030d")],
                gradientStart: .leading,
                gradientEnd: .trailing,
                surface: Color(hex: "#ff6b6b").opacity(0.12),
                glow: Color(hex: "#b50519").opacity(0.28)
            )
        case "rav hen":
            TheaterPalette(
                accent: Color(hex: "#ffb14a"),
                gradientColors: [Color(hex: "#0d06da"), Color(hex: "#ab5306")],
                gradientStart: .leading,
                gradientEnd: .trailing,
                surface: Color(hex: "#ffb14a").opacity(0.14),
                glow: Color(hex: "#0d06da").opacity(0.32)
            )
        case "hot cinema":
            TheaterPalette(
                accent: Color(hex: "#f06a87"),
                gradientColors: [Color(hex: "#f06a87"), Color(hex: "#c13043")],
                gradientStart: .trailing,
                gradientEnd: .leading,
                surface: Color(hex: "#ff4fa0").opacity(0.14),
                glow: Color(hex: "#f06a87").opacity(0.32)
            )
        case "movieland":
            TheaterPalette(
                accent: Color(hex: "#e05aad"),
                gradientColors: [Color(hex: "#58003a"), Color(hex: "#a80371")],
                gradientStart: .leading,
                gradientEnd: .trailing,
                surface: Color(hex: "#a80371").opacity(0.12),
                glow: Color(hex: "#a80371").opacity(0.30)
            )
        default:
            fallback(for: theater)
        }
    }

    private static func fallback(for theater: String) -> TheaterPalette {
        let variants: [(String, String)] = [
            ("#d29bff", "#8952bd"),
            ("#ffd166", "#bd7b17"),
            ("#7bdff2", "#287f9a")
        ]
        let hash = theater.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        let colors = variants[hash % variants.count]
        let accent = Color(hex: colors.0)
        return TheaterPalette(
            accent: accent,
            gradientColors: [accent, Color(hex: colors.1)],
            gradientStart: .topLeading,
            gradientEnd: .bottomTrailing,
            surface: accent.opacity(0.12),
            glow: accent.opacity(0.28)
        )
    }
}

struct ShowtimeTicketVisual: View {
    let entry: ShowtimeEntry
    let theater: String
    var compact = false

    @Environment(Theme.self) private var theme

    private var palette: TheaterPalette { .resolve(theater) }
    private var pillWidth: CGFloat { compact ? 56 : 64 }
    private var pillHeight: CGFloat { compact ? 32 : 35 }

    var body: some View {
        VStack(spacing: -5) {
            if let technologyLabel {
                Text(technologyLabel)
                    .font(.system(size: compact ? 7 : 8, weight: .medium))
                    .italic()
                    .foregroundStyle(Color(hex: "#ece7ea"))
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
                    .frame(width: pillWidth - 4, height: compact ? 14 : 16)
                    .background(
                        LinearGradient(
                            colors: [Color(hex: "#787277"), Color(hex: "#625d61")],
                            startPoint: .top,
                            endPoint: .bottom
                        ),
                        in: UnevenRoundedRectangle(
                            topLeadingRadius: compact ? 7 : 8,
                            bottomLeadingRadius: 1,
                            bottomTrailingRadius: 1,
                            topTrailingRadius: compact ? 7 : 8,
                            style: .continuous
                        )
                    )
                    .zIndex(0)
            }

            Text(entry.time)
                .font(.system(size: compact ? 11 : 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .padding(.horizontal, 5)
                .foregroundStyle(Color(hex: "#f4efec"))
                .frame(width: pillWidth, height: pillHeight)
                .background(
                    LinearGradient(
                        colors: palette.gradientColors,
                        startPoint: palette.gradientStart,
                        endPoint: palette.gradientEnd
                    ),
                    in: RoundedRectangle(cornerRadius: compact ? 8 : 9, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: compact ? 8 : 9, style: .continuous)
                        .stroke(Color(hex: "#040408").opacity(0.9), lineWidth: 1.25)
                }
                .overlay(alignment: .topLeading) { dubFlag }
                .overlay(alignment: .topTrailing) { screeningTypeMarker }
                .shadow(color: .black.opacity(0.22), radius: 2.5, y: 1.5)
                .zIndex(1)
        }
        .frame(minWidth: pillWidth, minHeight: technologyLabel == nil ? 44 : (compact ? 43 : 46))
        .dynamicTypeSize(.xSmall ... .accessibility1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    @ViewBuilder
    private var dubFlag: some View {
        if let assetName = dubFlagAssetName {
            Image(assetName)
                .resizable()
                .renderingMode(.original)
                .scaledToFill()
                .frame(width: compact ? 12 : 14, height: compact ? 9 : 10)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .overlay(RoundedRectangle(cornerRadius: 2).stroke(Color(hex: "#040408"), lineWidth: 1))
                .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
                .offset(x: compact ? -2 : -3, y: compact ? -2 : -3)
        }
    }

    @ViewBuilder
    private var screeningTypeMarker: some View {
        if screeningTypeLabel != nil {
            Image(systemName: "star")
                .font(.system(size: compact ? 6 : 7, weight: .bold))
                .foregroundStyle(theme.tint)
                .frame(width: compact ? 12 : 14, height: compact ? 12 : 14)
                .background(Theme.background.opacity(0.94), in: Circle())
                .overlay(Circle().stroke(Color(hex: "#040408").opacity(0.92), lineWidth: 1))
                .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
                .offset(x: compact ? 2 : 3, y: compact ? -2 : -3)
        }
    }

    private var technologyLabel: String? {
        let normalized = entry.screeningTechnology
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        guard !normalized.isEmpty else { return nil }
        let stripped = normalized.replacingOccurrences(
            of: #"^2D\b[\s/-]*"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !stripped.isEmpty, stripped.caseInsensitiveCompare("Regular") != .orderedSame else { return nil }
        return stripped
    }

    private var screeningTypeLabel: String? {
        let normalized = entry.screeningType
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        guard !normalized.isEmpty, normalized.caseInsensitiveCompare("Regular") != .orderedSame else { return nil }
        return normalized
    }

    private var dubFlagAssetName: String? {
        switch entry.dubLanguage?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "hebrew": "DubIsrael"
        case "french": "DubFrance"
        default: nil
        }
    }

    private var accessibilityLabel: String {
        let details = [
            technologyLabel,
            screeningTypeLabel,
            entry.dubLanguage.map { "\($0) Dub" }
        ].compactMap { $0 }
        return ([entry.time] + details).joined(separator: ", ")
    }
}
