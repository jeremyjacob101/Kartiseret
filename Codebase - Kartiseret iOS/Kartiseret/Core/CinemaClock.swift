import Foundation

enum CinemaClock {
    static var jerusalemTimeZone: TimeZone {
        TimeZone(identifier: KartiseretConstants.timeZoneIdentifier) ?? .current
    }

    static func calendar(timeZone: TimeZone = jerusalemTimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US_POSIX")
        calendar.timeZone = timeZone
        return calendar
    }

    static func cinemaDay(for instant: Date = .now, timeZone: TimeZone = jerusalemTimeZone) -> String {
        let calendar = calendar(timeZone: timeZone)
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: instant)
        guard let year = components.year, let month = components.month, let day = components.day else {
            return isoDate(for: instant, timeZone: timeZone)
        }
        let minuteOfDay = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        var dayComponents = DateComponents(year: year, month: month, day: day, hour: 12)
        if minuteOfDay < KartiseretConstants.cinemaDayCutoffMinutes,
           let date = calendar.date(from: dayComponents),
           let previous = calendar.date(byAdding: .day, value: -1, to: date) {
            return isoDate(for: previous, timeZone: timeZone)
        }
        dayComponents.hour = nil
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func isoDate(for date: Date, timeZone: TimeZone = jerusalemTimeZone) -> String {
        let components = calendar(timeZone: timeZone).dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", components.year ?? 0, components.month ?? 0, components.day ?? 0)
    }

    static func date(fromISO value: String, timeZone: TimeZone = jerusalemTimeZone) -> Date? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2]) else { return nil }
        let calendar = calendar(timeZone: timeZone)
        guard let date = calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 12)) else {
            return nil
        }
        let validated = calendar.dateComponents([.year, .month, .day], from: date)
        guard validated.year == year, validated.month == month, validated.day == day else { return nil }
        return date
    }

    static func addingDays(_ count: Int, to isoDate: String, timeZone: TimeZone = jerusalemTimeZone) -> String? {
        let calendar = calendar(timeZone: timeZone)
        guard let date = date(fromISO: isoDate, timeZone: timeZone),
              let result = calendar.date(byAdding: .day, value: count, to: date) else { return nil }
        return self.isoDate(for: result, timeZone: timeZone)
    }

    static func dateRange(start: String, count: Int) -> [String] {
        guard count > 0 else { return [] }
        return (0..<count).compactMap { addingDays($0, to: start) }
    }

    static func parseShowtimeMinutes(_ showtime: String) -> Int? {
        let prefix = showtime.trimmingCharacters(in: .whitespacesAndNewlines).prefix(5)
        let pieces = prefix.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        guard pieces.count == 2, let hour = Int(pieces[0]), let minute = Int(pieces[1]),
              (0...23).contains(hour), (0...59).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    static func isCarryover(_ showtime: String) -> Bool {
        guard let minutes = parseShowtimeMinutes(showtime) else { return false }
        return minutes < KartiseretConstants.cinemaDayCutoffMinutes
    }

    static func effectiveDate(cinemaDay: String, showtime: String) -> String? {
        guard parseShowtimeMinutes(showtime) != nil, date(fromISO: cinemaDay) != nil else { return nil }
        return isCarryover(showtime) ? addingDays(1, to: cinemaDay) : cinemaDay
    }

    static func shouldInclude(
        cinemaDay: String,
        showtime: String,
        at instant: Date = .now,
        timeZone: TimeZone = jerusalemTimeZone
    ) -> Bool {
        guard let minutes = parseShowtimeMinutes(showtime),
              let effectiveDate = effectiveDate(cinemaDay: cinemaDay, showtime: showtime) else { return false }
        let currentDate = isoDate(for: instant, timeZone: timeZone)
        if effectiveDate > currentDate { return true }
        if effectiveDate < currentDate { return false }
        let components = calendar(timeZone: timeZone).dateComponents([.hour, .minute], from: instant)
        let nowMinutes = (components.hour ?? 0) * 60 + (components.minute ?? 0)
        return minutes + KartiseretConstants.showtimeGraceMinutes >= nowMinutes
    }

    static func sortValue(for showtime: String) -> Int {
        guard let minutes = parseShowtimeMinutes(showtime) else { return .max }
        return isCarryover(showtime) ? minutes + 24 * 60 : minutes
    }

    static func displayDate(_ isoDate: String, style: Date.FormatStyle.DateStyle = .abbreviated) -> String {
        guard let date = date(fromISO: isoDate) else { return isoDate }
        return date.formatted(.dateTime.weekday(.abbreviated).month(style == .long ? .wide : .abbreviated).day())
    }
}
