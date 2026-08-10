import SwiftUI
import Observation

enum AccentChoice: String, CaseIterable, Codable, Identifiable, Sendable {
    case pink = "#e269ba"
    case red = "#ed4c57"
    case orange = "#d97f3a"
    case yellow = "#bebe2d"
    case green = "#63ae3d"
    case teal = "#3caa8e"
    case blue = "#69b0e2"
    case indigo = "#4375d9"
    case purple = "#a66ae3"

    var id: Self { self }

    var title: String {
        switch self {
        case .pink: "Pink"
        case .red: "Red"
        case .orange: "Orange"
        case .yellow: "Yellow"
        case .green: "Green"
        case .teal: "Teal"
        case .blue: "Blue"
        case .indigo: "Indigo"
        case .purple: "Purple"
        }
    }

    var color: Color { Color(hex: rawValue) }

    static func fromStoredValue(_ value: String) -> AccentChoice {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return Self(rawValue: normalized) ?? .purple
    }
}

@MainActor
@Observable
final class Theme {
    var accent: AccentChoice

    init(accent: AccentChoice = .purple) {
        self.accent = accent
    }

    var tint: Color { accent.color }

    static let background = Color(hex: "#212121")
    static let raisedBackground = Color(hex: "#292929")
    static let surface = Color(hex: "#303030")
    static let elevatedSurface = Color(hex: "#393939")
    static let primaryText = Color.white
    static let secondaryText = Color.white.opacity(0.70)
    static let tertiaryText = Color.white.opacity(0.48)
    static let border = Color.white.opacity(0.11)
    static let theaterAccent = Color(hex: "#8ec5ff")
    static let skeleton = Color.white.opacity(0.075)
    static let destructive = Color(hex: "#ff6b72")
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let red: Double
        let green: Double
        let blue: Double
        let alpha: Double
        switch cleaned.count {
        case 3:
            red = Double((value >> 8) * 17) / 255
            green = Double((value >> 4 & 0xF) * 17) / 255
            blue = Double((value & 0xF) * 17) / 255
            alpha = 1
        case 8:
            red = Double(value >> 24) / 255
            green = Double(value >> 16 & 0xFF) / 255
            blue = Double(value >> 8 & 0xFF) / 255
            alpha = Double(value & 0xFF) / 255
        default:
            red = Double(value >> 16) / 255
            green = Double(value >> 8 & 0xFF) / 255
            blue = Double(value & 0xFF) / 255
            alpha = 1
        }
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

struct BrandBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Theme.background.ignoresSafeArea())
            .preferredColorScheme(.dark)
    }
}

extension View {
    func brandBackground() -> some View { modifier(BrandBackground()) }
}
