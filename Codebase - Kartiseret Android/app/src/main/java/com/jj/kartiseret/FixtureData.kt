package com.jj.kartiseret

import java.time.LocalDate

/** Deterministic, fictional and fully offline data for the fixture build. */
object FixtureData {
    val cities = ALL_CITIES.map { City(name = it) }
    val movies = listOf(
        Movie("9100001", "A Quiet Harbor", 2026, "2026-10-02", listOf("Drama"), 108, "Qh1", "", trailerKey = null, imdbRating = 7.4, rtAudienceRating = 83.0, rtCriticRating = 78.0, lbRating = 3.7, tmdbRating = 7.2),
        Movie("9100002", "Paper Moons", 2026, "2026-12-11", listOf("Comedy", "Romance"), 97, "Pm2", "", imdbRating = 6.9, rtAudienceRating = 79.0, tmdbRating = 6.8),
        Movie("9100003", "The Blue Orchard", 2027, "2027-03-19", listOf("Mystery"), 116, "Bo3", "", backdropSrc = "", lbRating = 4.0, tmdbRating = 8.0),
        Movie("9100004", "Small Hours", 2025, "2025-04-04", listOf("Documentary"), 88, "Sh4", "", imdbRating = 7.8, lbRating = 3.9)
    )

    private val today get() = KartiseretApi.cinemaDay()
    private val screenings get() = listOf(
        Screening("9100001", "Jerusalem", today.toString(), "Jerusalem Cinematheque", "18:20", "https://example.org/tickets/quiet-harbor", null, "2D", "Regular", "Original"),
        Screening("9100001", "Jerusalem", today.toString(), "Cinema City Jerusalem", "21:10", null, "https://example.org/tickets/quiet-harbor-he", "IMAX", "VIP", "Hebrew"),
        Screening("9100002", "Tel Aviv", today.toString(), "Tel Aviv Cinematheque", "19:30", "https://example.org/tickets/paper-moons", null, "2D", "Regular", "Original"),
        Screening("9100004", "Jerusalem", today.plusDays(1).toString(), "Jerusalem Cinematheque", "20:00", null, null, "3D", "Regular", "Original")
    )

    fun showtimes(city: String, date: String): Showtimes = Showtimes(
        screenings.filter { it.screeningCity == city && it.dateOfShowing == date }
    )

    fun cinematheques(city: String, startDate: LocalDate, days: Long): CinemathequeData {
        val end = startDate.plusDays(days)
        val rows = screenings.filter { it.screeningCity == city && runCatching { LocalDate.parse(it.dateOfShowing) }.getOrNull()?.let { date -> date in startDate..end } == true }
        val ids = rows.map(Screening::tmdbId).toSet()
        return CinemathequeData(movies = movies.filter { it.tmdbId in ids }, showtimes = rows)
    }

    fun cinema(id: String): CinemaPage? {
        val identity = CinemaIdentities.byId(id) ?: return null
        val rows = screenings.filter { row -> row.screeningCity == identity.city && CinemaIdentities.forScreening(row.screeningCity, row.cinema)?.id == id }
        return CinemaPage(
            id = identity.id, displayName = identity.displayName, city = identity.city,
            address = "Fixture address · ${identity.city}",
            mapUrl = "https://maps.google.com/?q=${UriCompat.encode(identity.displayName)}",
            latitude = 31.7683, longitude = 35.2137,
            screenings = rows.mapNotNull { row -> movies.firstOrNull { it.tmdbId == row.tmdbId }?.let { CinemaScreening(it, row) } }
        )
    }

    fun featured(): HomepageFeatured = HomepageFeatured(highlights = listOf(HomepageHighlight("9100001", label = "kids")))
}

private object UriCompat {
    fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}
