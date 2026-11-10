import Foundation

struct CinemaDay: Codable, Hashable, Comparable, Sendable, CustomStringConvertible {
    static let timeZone = TimeZone(identifier: "Asia/Jerusalem")!
    static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }()

    let isoDate: String

    init?(isoDate: String) {
        let parts = isoDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        var components = DateComponents()
        components.calendar = Self.calendar
        components.timeZone = Self.timeZone
        components.year = parts[0]
        components.month = parts[1]
        components.day = parts[2]
        components.hour = 12
        guard let date = Self.calendar.date(from: components) else { return nil }
        let check = Self.calendar.dateComponents([.year, .month, .day], from: date)
        guard check.year == parts[0], check.month == parts[1], check.day == parts[2] else { return nil }
        self.isoDate = isoDate
    }

    init?(date: Date) {
        let components = Self.calendar.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month, let day = components.day else { return nil }
        self.init(isoDate: Self.format(year: year, month: month, day: day))
    }

    static func current(at instant: Date = .now) -> CinemaDay {
        let parts = Self.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: instant)
        let minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        if minutes >= 65, let day = CinemaDay(date: instant) { return day }
        let start = Self.calendar.startOfDay(for: instant)
        let previous = Self.calendar.date(byAdding: .day, value: -1, to: start) ?? instant
        return CinemaDay(date: previous) ?? CinemaDay(isoDate: "1970-01-01")!
    }

    static func calendarDate(at instant: Date) -> CinemaDay {
        CinemaDay(date: instant) ?? CinemaDay(isoDate: "1970-01-01")!
    }

    var date: Date {
        let values = isoDate.split(separator: "-").compactMap { Int($0) }
        var components = DateComponents()
        components.calendar = Self.calendar
        components.timeZone = Self.timeZone
        components.year = values[0]
        components.month = values[1]
        components.day = values[2]
        components.hour = 12
        return Self.calendar.date(from: components) ?? .now
    }

    var description: String { isoDate }

    var displayName: String {
        let formatter = DateFormatter()
        formatter.calendar = Self.calendar
        formatter.timeZone = Self.timeZone
        formatter.locale = .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    func addingDays(_ offset: Int) -> CinemaDay {
        let next = Self.calendar.date(byAdding: .day, value: offset, to: date) ?? date
        return CinemaDay(date: next) ?? self
    }

    static func < (lhs: CinemaDay, rhs: CinemaDay) -> Bool {
        lhs.isoDate < rhs.isoDate
    }

    private static func format(year: Int, month: Int, day: Int) -> String {
        String(format: "%04d-%02d-%02d", year, month, day)
    }
}
