import Foundation

enum ShowtimeLogic {
    static let maximumDayOffset = 179

    static func isWithinSelectableRange(_ day: CinemaDay, today: CinemaDay) -> Bool {
        day >= today && day <= today.addingDays(maximumDayOffset)
    }

    static func minutes(_ time: String) -> Int? {
        let parts = time.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: ":")
        guard parts.count >= 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1]),
              (0...23).contains(hour),
              (0...59).contains(minute) else { return nil }
        return hour * 60 + minute
    }

    static func shouldInclude(_ showtime: Showtime, for day: CinemaDay, at instant: Date) -> Bool {
        guard let minutes = minutes(showtime.showtime) else { return false }
        let effectiveDay = minutes < 65 ? day.addingDays(1) : day
        let today = CinemaDay.calendarDate(at: instant)
        if effectiveDay > today { return true }
        if effectiveDay < today { return false }
        let now = CinemaDay.calendar.dateComponents([.hour, .minute], from: instant)
        let currentMinute = (now.hour ?? 0) * 60 + (now.minute ?? 0)
        return minutes + 15 >= currentMinute
    }

    static func sortValue(_ time: String) -> Int {
        guard let minutes = minutes(time) else { return Int.max }
        return minutes < 65 ? minutes + 1_440 : minutes
    }

    static func group(
        _ rows: [Showtime],
        movies: [Movie],
        city: String,
        day: CinemaDay,
        at instant: Date
    ) -> [MovieShowtimes] {
        let allowedMovies = Dictionary(uniqueKeysWithValues: movies.map { ($0.tmdbId, $0) })
        var unique = Set<String>()
        let selected = rows.filter { row in
            row.screeningCity == city &&
            row.dateOfShowing == day.isoDate &&
            allowedMovies[row.tmdbId] != nil &&
            shouldInclude(row, for: day, at: instant) &&
            unique.insert(row.id).inserted
        }

        let rowsByMovie = Dictionary(grouping: selected, by: \.tmdbId)
        return movies.compactMap { movie in
            guard let movieRows = rowsByMovie[movie.tmdbId], !movieRows.isEmpty else { return nil }
            let byCinema = Dictionary(grouping: movieRows, by: \.cinema)
            let cinemas = byCinema.keys.sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
                .compactMap { cinema -> CinemaShowtimes? in
                    guard let entries = byCinema[cinema] else { return nil }
                    let ordered = entries.sorted {
                        let left = sortValue($0.showtime)
                        let right = sortValue($1.showtime)
                        return left == right ? $0.id < $1.id : left < right
                    }
                    return CinemaShowtimes(name: cinema, showtimes: ordered)
                }
            return MovieShowtimes(movie: movie, cinemas: cinemas)
        }
    }
}
