import Foundation

enum ShowtimeLogic {
    static let maximumDayOffset = 179
    static let filterOptions: [String: [String]] = [
        "showType": ["Regular", "VIP", "VIP Light", "Upgrade", "Prime", "Lounge", "Premium", "Not Just Cinema"],
        "screenFormat": ["2D", "3D"],
        "screeningTech": ["Standard", "HFR", "IMAX", "Atmos", "ONYX", "ScreenX", "4DX", "Infinity Vision"],
        "dubLanguage": ["Original", "Hebrew", "French"],
    ]

    enum ReleaseCategory: String, CaseIterable, Identifiable {
        case newReleases
        case reReleases

        var id: Self { self }
        var title: String { self == .newReleases ? "New Releases" : "Re-Releases" }
    }

    static func releaseCategory(for movie: Movie, currentYear: Int = Calendar.current.component(.year, from: .now)) -> ReleaseCategory {
        movie.year > 0 && movie.year <= currentYear - 3 ? .reReleases : .newReleases
    }

    static func movies(_ movies: [Movie], category: ReleaseCategory, currentYear: Int = Calendar.current.component(.year, from: .now)) -> [Movie] {
        movies.filter { releaseCategory(for: $0, currentYear: currentYear) == category }
    }

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

    static func matchesSavedFilters(_ showtime: Showtime, state: AccountPreferences.Showtime.FilterState) -> Bool {
        let metadata = canonicalMetadata(showtime)
        let unchecked = state.unchecked
        let showTypes = Set(filterOptions["showType"] ?? []).subtracting(unchecked.showType)
        let formats = Set(filterOptions["screenFormat"] ?? []).subtracting(unchecked.screenFormat)
        let technologies = Set(filterOptions["screeningTech"] ?? []).subtracting(unchecked.screeningTech)
        let languages = Set(filterOptions["dubLanguage"] ?? []).subtracting(unchecked.dubLanguage)
        return !metadata.showTypes.isEmpty && metadata.showTypes.contains(where: showTypes.contains) &&
            formats.contains(metadata.format) && !metadata.technologies.isEmpty &&
            metadata.technologies.contains(where: technologies.contains) && languages.contains(metadata.language)
    }

    static func group(
        _ rows: [Showtime],
        movies: [Movie],
        city: String,
        day: CinemaDay,
        at instant: Date,
        preferences: AccountPreferences.Showtime = AccountPreferences.Showtime()
    ) -> [MovieShowtimes] {
        let allowedMovies = Dictionary(uniqueKeysWithValues: movies.map { ($0.tmdbId, $0) })
        var unique = Set<String>()
        let selected = rows.filter { row in
            row.screeningCity == city &&
            row.dateOfShowing == day.isoDate &&
            allowedMovies[row.tmdbId] != nil &&
            matchesSavedFilters(row, state: preferences.screeningFilters) &&
            !isExcluded(row, city: city, excludedCinemaIDs: preferences.excludedCinemaIds) &&
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

    private static func isExcluded(_ showtime: Showtime, city: String, excludedCinemaIDs: [String]) -> Bool {
        guard !excludedCinemaIDs.isEmpty,
              let identity = CinemaIdentity.forScreening(city: city, cinema: showtime.cinema) else { return false }
        return excludedCinemaIDs.contains(identity.id)
    }

    private struct CanonicalMetadata {
        let showTypes: [String]
        let format: String
        let technologies: [String]
        let language: String
    }

    private static func canonicalMetadata(_ showtime: Showtime) -> CanonicalMetadata {
        let type = normalized(showtime.screeningType).isEmpty ? "Regular" : normalized(showtime.screeningType)
        let comparableType = type.lowercased()
        var types = Set<String>()
        if comparableType == "premium" { types.insert("Premium") }
        else if comparableType == "not just cinema" { types.insert("Not Just Cinema") }
        else {
            let words = Set(type.uppercased().split { !$0.isLetter && !$0.isNumber }.map(String.init))
            for token in ["REGULAR", "UPGRADE", "PRIME", "LOUNGE", "VIP"] where words.contains(token) {
                types.insert(token == "REGULAR" ? "Regular" : token == "UPGRADE" ? "Upgrade" : token == "PRIME" ? "Prime" : token == "LOUNGE" ? "Lounge" : "VIP")
            }
            if words.contains("LIGHT") { types.insert("VIP Light"); types.insert("VIP") }
            if words.contains("BUSINESS") { types.insert("VIP") }
        }

        let rawTech = normalized(showtime.screeningTech).isEmpty ? "2D" : normalized(showtime.screeningTech)
        let techTokens = rawTech.uppercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
        let format = techTokens.contains("3D") ? "3D" : "2D"
        let knownTech = Set(["IMAX", "HFR", "SCREENX", "4DX", "ONYX", "ATMOS"])
        var technologies = techTokens.filter { knownTech.contains($0) }.map { token -> String in
            switch token {
            case "SCREENX": "ScreenX"
            case "ATMOS": "Atmos"
            default: token
            }
        }
        if rawTech.range(of: #"\bINFINITY\s+VISION\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            technologies.append("Infinity Vision")
        }
        if technologies.isEmpty { technologies = ["Standard"] }

        let rawLanguage = normalized(showtime.dubLanguage ?? "")
        let language: String
        switch rawLanguage.lowercased() {
        case "", "original": language = "Original"
        case "hebrew": language = "Hebrew"
        case "french": language = "French"
        default: language = rawLanguage
        }
        return CanonicalMetadata(showTypes: Array(types), format: format, technologies: Array(Set(technologies)), language: language)
    }

    private static func normalized(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
