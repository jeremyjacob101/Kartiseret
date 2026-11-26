package com.jj.kartiseret

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate

data class KartiseretState(
    val nowPlaying: List<Movie> = emptyList(),
    val comingSoon: List<Movie> = emptyList(),
    val cities: List<City> = emptyList(),
    val theaters: List<Theater> = emptyList(),
    val featured: HomepageFeatured? = null,
    val movieId: String? = null,
    val pendingMovieCode: String? = null,
    val pendingMovieLinkError: String? = null,
    val catalogLoaded: Boolean = false,
    val selectedTab: AppTab = AppTab.DISCOVER,
    val query: String = "",
    val searchResults: List<TmdbSearchResult> = emptyList(),
    val searchLoading: Boolean = false,
    val searchError: String? = null,
    val selectedCity: String = DEFAULT_LOCATION,
    val selectedDate: String = KartiseretApi.cinemaDay().toString(),
    val showtimes: List<Screening> = emptyList(),
    val cinematheques: List<Screening> = emptyList(),
    val scheduleMovies: List<Movie> = emptyList(),
    val catalogLoading: Boolean = false,
    val scheduleLoading: Boolean = false,
    val error: String? = null,
    val accountError: String? = null,
    val accountLoading: Boolean = true,
    val user: User? = null,
    val preferences: Preferences = Preferences(),
    val providers: Set<String> = emptySet(),
    val displayRules: List<DisplayRule> = emptyList(),
    val ticketAlerts: List<TicketAlert> = emptyList(),
    val ticketAlertPreferences: AlertCriteria = AlertCriteria(),
    val watches: List<ComingSoonWatch> = emptyList(),
    val letterboxdSources: List<LetterboxdSource> = emptyList(),
    val cinemaPage: CinemaPage? = null,
    val pendingDeletionToken: String? = null
) {
    val isSignedIn get() = user != null
    val allMovies get() = (nowPlaying + comingSoon + searchResults.map(TmdbSearchResult::asMovie)).distinctBy(Movie::tmdbId)
    val selectedMovie get() = movieId?.let { id -> allMovies.firstOrNull { it.tmdbId == id } ?: scheduleMovies.firstOrNull { it.tmdbId == id } }
}

enum class AppTab { DISCOVER, SHOWTIMES, CINEMATHEQUES, YOU }

class KartiseretViewModel(application: Application) : AndroidViewModel(application) {
    val api = KartiseretApi()
    private val sessions = SessionStore(application)
    private val guest = application.getSharedPreferences("kartiseret_guest", 0)
    private fun guestPreferences(): Preferences = guest.getString("preferences", null)?.let { runCatching { api.json.decodeFromString<Preferences>(it) }.getOrNull() }
        ?: Preferences(location = guest.getString("city", DEFAULT_LOCATION) ?: DEFAULT_LOCATION)
    private val mutableState = MutableStateFlow(KartiseretState(
        selectedCity = guest.getString("city", DEFAULT_LOCATION) ?: DEFAULT_LOCATION,
        selectedDate = KartiseretApi.cinemaDay().toString(),
        preferences = guestPreferences()
    ))
    val state = mutableState.asStateFlow()
    private var nowRevision: String? = null
    private var soonRevision: String? = null
    private var accountGeneration = 0
    private var searchJob: Job? = null
    private val alertPreferencesMutex = Mutex()

    init {
        viewModelScope.launch {
            if (BuildConfig.FLAVOR == "fixture") mutableState.update { it.copy(accountLoading = false) }
            else { launch { loadProviders() }; restoreAccount() }
        }
        refreshPublic()
    }

    fun selectTab(tab: AppTab) { mutableState.update { it.copy(selectedTab = tab) }; if (tab == AppTab.SHOWTIMES) loadShowtimes() else if (tab == AppTab.CINEMATHEQUES) loadCinematheques() }
    fun selectMovie(id: String?) { mutableState.update { it.copy(movieId = id, cinemaPage = null) }; if (id != null) loadMovieShowtimes(id) }
    fun selectCity(city: String) {
        if (city !in ALL_CITIES) return
        mutableState.update { it.copy(selectedCity = city, preferences = it.preferences.copy(location = city)) }
        saveGuestPreferences(mutableState.value.preferences)
        if (mutableState.value.isSignedIn) savePreference("location", api.json.encodeToString(city))
        loadShowtimes(); loadCinematheques()
    }
    fun setDate(date: LocalDate) { val today = KartiseretApi.cinemaDay(); if (date < today || date > today.plusDays(179)) return; mutableState.update { it.copy(selectedDate = date.toString()) }; loadShowtimes() }
    fun setQuery(value: String) {
        mutableState.update { it.copy(query = value, searchError = null) }
        searchJob?.cancel()
        if (value.trim().length < 2 || BuildConfig.FLAVOR == "fixture") {
            mutableState.update { it.copy(searchResults = emptyList(), searchLoading = false) }
            return
        }
        val query = value.trim()
        searchJob = viewModelScope.launch {
            mutableState.update { it.copy(searchLoading = true) }
            delay(350)
            runCatching { api.search(query) }
                .onSuccess { results -> mutableState.update { current -> if (current.query.trim() == query) current.copy(searchResults = results, searchLoading = false) else current } }
                .onFailure { error -> mutableState.update { current -> if (current.query.trim() == query) current.copy(searchLoading = false, searchError = error.message) else current } }
        }
    }
    fun clearError() { mutableState.update { it.copy(error = null, accountError = null) } }
    private fun saveGuestPreferences(preferences: Preferences) { guest.edit().putString("preferences", api.json.encodeToString(preferences)).putString("city", preferences.location).apply() }

    fun refreshPublic() = viewModelScope.launch {
        mutableState.update { it.copy(catalogLoading = true, catalogLoaded = false, error = null) }
        if (BuildConfig.FLAVOR == "fixture") {
            mutableState.update { it.copy(nowPlaying = FixtureData.movies.filter { movie -> movie.tmdbId != "9100003" }, comingSoon = FixtureData.movies.filter { movie -> movie.tmdbId == "9100003" }, cities = FixtureData.cities, theaters = emptyList(), featured = FixtureData.featured(), catalogLoading = false, catalogLoaded = true) }
            loadShowtimes()
            loadCinematheques()
            return@launch
        }
        val now = async { runCatching { api.catalog(false) } }
        val soon = async { runCatching { api.catalog(true) } }
        val theaters = async { runCatching { api.theaters() } }
        val featured = async { runCatching { api.featured() } }
        val nowResult = now.await(); val soonResult = soon.await(); val cities = theaters.await(); val hero = featured.await()
        nowResult.getOrNull()?.let { nowRevision = it.publicationRevision }
        soonResult.getOrNull()?.let { soonRevision = it.publicationRevision }
        mutableState.update { current -> current.copy(
            nowPlaying = nowResult.getOrNull()?.data?.movies ?: current.nowPlaying,
            comingSoon = soonResult.getOrNull()?.data?.movies ?: current.comingSoon,
            cities = cities.getOrNull()?.cities ?: current.cities,
            theaters = cities.getOrNull()?.theaters ?: current.theaters,
            featured = hero.getOrNull(), catalogLoading = false,
            error = listOfNotNull(nowResult.exceptionOrNull(), soonResult.exceptionOrNull(), cities.exceptionOrNull()).firstOrNull()?.message,
            catalogLoaded = true
        ) }
        loadShowtimes()
    }

    private fun loadShowtimes(movieId: String? = null) = viewModelScope.launch {
        val snapshot = mutableState.value
        if (BuildConfig.FLAVOR == "fixture") {
            val rows = FixtureData.showtimes(snapshot.selectedCity, snapshot.selectedDate).showtimes
            mutableState.update { it.copy(showtimes = if (movieId == null) rows else it.showtimes.filterNot { row -> row.tmdbId == movieId } + rows.filter { it.tmdbId == movieId }, scheduleLoading = false) }
            return@launch
        }
        mutableState.update { it.copy(scheduleLoading = true) }
        suspend fun fetch(revision: String?) = api.showtimes(snapshot.selectedCity, snapshot.selectedDate, snapshot.selectedDate, movieId, revision)
        val primaryRevision = nowRevision
        val result = runCatching { fetch(primaryRevision) }.recoverCatching { error ->
            if ((error as? ApiException)?.code == "publication_changed") {
                refreshCatalogForRevision()
                fetch(nowRevision)
            } else throw error
        }
        mutableState.update { current -> if (current.selectedCity != snapshot.selectedCity || current.selectedDate != snapshot.selectedDate) current else current.copy(
            showtimes = result.getOrNull()?.first?.showtimes ?: current.showtimes,
            scheduleLoading = false,
            error = result.exceptionOrNull()?.message
        ) }
    }

    private suspend fun refreshCatalogForRevision() {
        val state = mutableState.value
        nowRevision = api.catalog(false).publicationRevision
        if (state.comingSoon.isNotEmpty()) soonRevision = api.catalog(true).publicationRevision
    }

    fun loadMovieShowtimes(id: String) = viewModelScope.launch {
        val snapshot = mutableState.value
        if (BuildConfig.FLAVOR == "fixture") {
            val rows = FixtureData.showtimes(snapshot.selectedCity, snapshot.selectedDate).showtimes.filter { it.tmdbId == id }
            mutableState.update { it.copy(showtimes = it.showtimes.filterNot { row -> row.tmdbId == id } + rows) }
            return@launch
        }
        val result = runCatching { api.showtimes(snapshot.selectedCity, snapshot.selectedDate, snapshot.selectedDate, id, nowRevision).first.showtimes }
        result.onSuccess { rows -> mutableState.update { it.copy(showtimes = (it.showtimes.filterNot { row -> row.tmdbId == id } + rows)) } }
            .onFailure { failure -> mutableState.update { it.copy(error = failure.message) } }
    }

    fun loadCinematheques() = viewModelScope.launch {
        val today = KartiseretApi.cinemaDay()
        val snapshot = mutableState.value
        if (BuildConfig.FLAVOR == "fixture") {
            val data = FixtureData.cinematheques(snapshot.selectedCity, today, 13)
            mutableState.update { it.copy(cinematheques = data.showtimes, scheduleMovies = data.movies) }
            return@launch
        }
        val result = runCatching { api.cinematheques(snapshot.selectedCity, today.toString(), today.plusDays(13).toString(), nowRevision) }
        result.onSuccess { data -> mutableState.update { it.copy(cinematheques = data.showtimes, scheduleMovies = data.movies) } }
            .onFailure { failure -> mutableState.update { it.copy(error = failure.message) } }
    }

    fun loadCinema(id: String) = viewModelScope.launch {
        mutableState.update { it.copy(cinemaPage = null) }
        if (BuildConfig.FLAVOR == "fixture") {
            mutableState.update { it.copy(cinemaPage = FixtureData.cinema(id), selectedTab = AppTab.CINEMATHEQUES) }
            return@launch
        }
        runCatching { api.cinema(id, nowRevision) }.onSuccess { page -> mutableState.update { it.copy(cinemaPage = page, selectedTab = AppTab.CINEMATHEQUES) } }
            .onFailure { failure -> mutableState.update { it.copy(error = failure.message) } }
    }

    private suspend fun restoreAccount() {
        mutableState.update { it.copy(accountLoading = true) }
        val token = sessions.read()
        if (BuildConfig.FLAVOR == "fixture") { mutableState.update { it.copy(accountLoading = false) }; return }
        if (token == null) { mutableState.update { it.copy(accountLoading = false) }; return }
        val generation = ++accountGeneration
        runCatching {
            val account = api.account(token)
            val prefs = api.initializePreferences(token, mutableState.value.selectedCity, account.user.id)
            account to prefs
        }.onSuccess { (account, prefs) ->
            if (generation == accountGeneration) mutableState.update { it.copy(user = account.user, preferences = prefs, selectedCity = prefs.location, accountLoading = false) }
            if (generation == accountGeneration) loadAccountFeatures(token, account.user.id)
        }.onFailure { error ->
            if ((error as? ApiException)?.status == 401) sessions.clear()
            mutableState.update { it.copy(accountLoading = false, accountError = error.message) }
        }
    }

    suspend fun signIn(email: String, password: String) {
        val token = api.signIn(email, password); activate(token)
    }
    suspend fun signUp(name: String, email: String, password: String): Boolean {
        val token = api.signUp(name, email, password, mutableState.value.selectedCity) ?: return false
        activate(token); return true
    }
    suspend fun signInGoogle(idToken: String) { activate(api.googleSignIn(idToken)) }
    private suspend fun activate(token: String) {
        sessions.save(token)
        ++accountGeneration
        val account = api.account(token)
        val prefs = api.initializePreferences(token, mutableState.value.selectedCity, account.user.id)
        mutableState.update { it.copy(user = account.user, preferences = prefs, selectedCity = prefs.location, accountError = null, accountLoading = false) }
        loadProviders(); loadAccountFeatures(token, account.user.id)
    }
    private suspend fun loadProviders() {
        if (BuildConfig.FLAVOR == "fixture") return
        runCatching { api.providers() }.onSuccess { providers -> mutableState.update { it.copy(providers = providers.toSet()) } }
    }
    private suspend fun loadAccountFeatures(token: String, userId: String) {
        runCatching { api.privateData("/api/v1/preferences/movie-display", token, userId, DisplayRulePage.serializer()) }.onSuccess { page -> mutableState.update { it.copy(displayRules = page.preferences) } }
        runCatching { api.privateData("/api/v1/ticket-alerts?offset=0", token, userId, TicketAlertPage.serializer()) }.onSuccess { page -> mutableState.update { it.copy(ticketAlerts = page.subscriptions) } }
        runCatching { api.privateData("/api/v1/ticket-alerts/preferences", token, userId, TicketAlertPreferencesData.serializer()) }.onSuccess { data -> mutableState.update { it.copy(ticketAlertPreferences = data.preferences) } }
        runCatching { api.privateData("/api/v1/coming-soon-watches", token, userId, ComingSoonWatchPage.serializer()) }.onSuccess { page -> mutableState.update { it.copy(watches = page.watches) } }
        runCatching { api.privateData("/api/v1/letterboxd-sources", token, userId, LetterboxdSourcePage.serializer()) }.onSuccess { page -> mutableState.update { it.copy(letterboxdSources = page.sources) } }
    }

    fun savePreference(key: String, value: String) = viewModelScope.launch {
        val token = sessions.read(); val user = mutableState.value.user
        val parsed = runCatching { api.json.parseToJsonElement(value) }.getOrNull() ?: return@launch
        mutableState.update { old -> val prefs = when(key) {
            "location" -> old.preferences.copy(location = parsed.toString().trim('"'))
            "siteColor" -> old.preferences.copy(siteColor = parsed.toString().trim('"'))
            "hideReReleases" -> old.preferences.copy(hideReReleases = parsed.toString().toBoolean())
            "ratingSources" -> old.preferences.copy(ratingSources = api.json.decodeFromJsonElement(ListSerializerString, parsed))
            "showtimePreferences" -> old.preferences.copy(showtimePreferences = api.json.decodeFromJsonElement(ShowtimePreferences.serializer(), parsed))
            else -> old.preferences
        }; old.copy(preferences = prefs) }
        saveGuestPreferences(mutableState.value.preferences)
        if (token == null || user == null) return@launch
        val patch = JsonObject(mapOf(key to parsed)).toString()
        runCatching { api.savePreferences(token, user.id, patch) }.onSuccess { confirmed -> mutableState.update { it.copy(preferences = confirmed) } }
            .onFailure { error -> mutableState.update { it.copy(accountError = "Could not save that preference. ${error.message}") }; restoreAccount() }
    }

    fun saveShowtimeFilters(filters: FilterGroups) {
        val saved = mutableState.value.preferences.showtimePreferences.copy(screeningFilters = FilterState(3, filters))
        val json = api.json.encodeToString(saved)
        savePreference("showtimePreferences", json)
    }

    fun toggleCinemaExcluded(cinemaId: String, excluded: Boolean) {
        if (CinemaIdentities.byId(cinemaId) == null) return
        val current = mutableState.value.preferences.showtimePreferences
        val ids = current.excludedCinemaIds.toMutableSet().also { if (excluded) it.add(cinemaId) else it.remove(cinemaId) }.sorted()
        savePreference("showtimePreferences", api.json.encodeToString(current.copy(excludedCinemaIds = ids)))
    }

    fun saveAlertPreferences(criteria: AlertCriteria) = viewModelScope.launch {
        val token = sessions.read() ?: return@launch
        val userId = mutableState.value.user?.id ?: return@launch
        val previous = mutableState.value.ticketAlertPreferences
        mutableState.update { it.copy(ticketAlertPreferences = criteria, accountError = null) }
        alertPreferencesMutex.withLock {
            val latest = mutableState.value.ticketAlertPreferences
            runCatching { api.privateData("/api/v1/ticket-alerts/preferences", token, userId, TicketAlertPreferencesData.serializer(), "PATCH", "{\"cities\":${latest.cities?.let { api.json.encodeToString(it) } ?: "null"},\"notificationMode\":${api.json.encodeToString(latest.notificationMode)},\"filters\":${api.json.encodeToString(latest.filters)}}") }
                .onSuccess { updated -> mutableState.update { current -> if (current.ticketAlertPreferences == latest) current.copy(ticketAlertPreferences = updated.preferences) else current } }
                .onFailure { error -> mutableState.update { current -> current.copy(ticketAlertPreferences = if (current.ticketAlertPreferences == latest) previous else current.ticketAlertPreferences, accountError = error.message) } }
        }
    }

    fun createTicketAlert(movie: Movie) = privateMutation { token, user -> api.privateData("/api/v1/ticket-alerts", token, user, kotlinx.serialization.json.JsonElement.serializer(), "POST", "{\"tmdbId\":${api.json.encodeToString(movie.tmdbId)}}"); Unit }
    fun removeTicketAlert(movieId: String) = privateMutation { token, user -> api.privateData("/api/v1/ticket-alerts/$movieId", token, user, Removed.serializer(), "DELETE"); Unit }
    fun saveTicketAlertCriteria(movieId: String, overrides: AlertCriteriaOverride) = privateMutation { token, user -> api.privateData("/api/v1/ticket-alerts/$movieId/criteria", token, user, kotlinx.serialization.json.JsonElement.serializer(), "PATCH", "{\"criteriaOverrides\":${api.json.encodeToString(overrides)}}"); Unit }
    fun createWatch(movie: Movie) = privateMutation { token, user -> api.privateData("/api/v1/coming-soon-watches", token, user, kotlinx.serialization.json.JsonElement.serializer(), "POST", "{\"tmdbId\":${api.json.encodeToString(movie.tmdbId)},\"title\":${api.json.encodeToString(movie.title)},\"releaseYear\":${if (movie.year >= 1870) movie.year else "null"},\"posterPath\":null}"); Unit }
    fun deleteWatch(id: String) = privateMutation { token, user -> api.privateData("/api/v1/coming-soon-watches/$id", token, user, Removed.serializer(), "DELETE"); Unit }
    fun createLetterboxdSource(url: String) = privateMutation { token, user -> api.privateData("/api/v1/letterboxd-sources", token, user, SourceChange.serializer(), "POST", "{\"sourceUrl\":${api.json.encodeToString(url)}}"); Unit }
    fun deleteLetterboxdSource(id: String) = privateMutation { token, user -> api.privateData("/api/v1/letterboxd-sources/$id", token, user, Removed.serializer(), "DELETE"); Unit }
    fun updateDisplayRule(rule: DisplayRule) = privateMutation { token, user -> api.privateData("/api/v1/preferences/movie-display", token, user, DisplayRuleChange.serializer(), "POST", api.json.encodeToString(rule)); Unit }
    fun setDisplayRuleBackdrop(movieId: String, hidden: Boolean) = privateMutation { token, user -> api.privateData("/api/v1/preferences/movie-display/$movieId", token, user, DisplayRuleChange.serializer(), "PATCH", "{\"hideBackdrop\":$hidden}"); Unit }
    fun removeDisplayRule(movieId: String) = privateMutation { token, user -> api.privateData("/api/v1/preferences/movie-display/$movieId", token, user, Removed.serializer(), "DELETE"); Unit }

    private fun privateMutation(action: suspend (String, String) -> Unit) = viewModelScope.launch {
        val token = sessions.read(); val userId = mutableState.value.user?.id
        if (token == null || userId == null) { mutableState.update { it.copy(accountError = "Sign in to make this change.") }; return@launch }
        runCatching { action(token, userId) }.onSuccess { loadAccountFeatures(token, userId) }.onFailure { e -> mutableState.update { it.copy(accountError = e.message) } }
    }

    fun requestAccountDeletion() = viewModelScope.launch {
        val token = sessions.read() ?: return@launch
        runCatching { api.requestDeletion(token) }.onSuccess { mutableState.update { it.copy(accountError = "Check your email to confirm account deletion.") } }
            .onFailure { e -> mutableState.update { it.copy(accountError = e.message) } }
    }
    fun acceptDeletionLink(token: String) { mutableState.update { it.copy(pendingDeletionToken = token, selectedTab = AppTab.YOU) } }
    fun confirmAccountDeletion() = viewModelScope.launch {
        val session = sessions.read(); val confirmation = mutableState.value.pendingDeletionToken
        if (session == null || confirmation == null) { mutableState.update { it.copy(accountError = "Sign in again before confirming deletion.") }; return@launch }
        runCatching { api.confirmDeletion(session, confirmation) }.onSuccess {
            sessions.clear(); accountGeneration++
            mutableState.update { it.copy(user = null, pendingDeletionToken = null, preferences = Preferences(location = it.selectedCity), ticketAlerts = emptyList(), watches = emptyList(), letterboxdSources = emptyList(), displayRules = emptyList(), accountError = "Account deleted.") }
        }.onFailure { e -> mutableState.update { it.copy(accountError = e.message) } }
    }
    fun signOut() = viewModelScope.launch {
        val token = sessions.read(); accountGeneration++
        runCatching { token?.let { api.signOut(it) } }
        sessions.clear()
        val prefs = guestPreferences()
        mutableState.update { it.copy(user = null, preferences = prefs, selectedCity = prefs.location, displayRules = emptyList(), ticketAlerts = emptyList(), watches = emptyList(), letterboxdSources = emptyList(), accountError = null) }
    }

    fun visibleMovies(soon: Boolean): List<Movie> {
        val current = mutableState.value
        val collection = if (soon) current.comingSoon else current.nowPlaying
        val rules = current.displayRules.associateBy(DisplayRule::tmdbId)
        val now = java.time.Year.now().value
        return collection.filter { movie -> rules[movie.tmdbId]?.treatment != "remove" && !(current.preferences.hideReReleases && !soon && movie.year in 1..(now - 3)) }
    }

    fun isMovieVisible(movie: Movie): Boolean = mutableState.value.displayRules.firstOrNull { it.tmdbId == movie.tmdbId }?.treatment != "remove"

    fun setLink(uri: java.net.URI) {
        val route = parseIncomingLink(uri, mutableState.value.selectedCity) ?: return
        when (route) {
            is IncomingRoute.Tab -> selectTab(route.tab)
            is IncomingRoute.Catalog -> selectTab(AppTab.DISCOVER)
            is IncomingRoute.Movie -> {
                val current = mutableState.value
                val nextCity = route.city?.takeIf { it in ALL_CITIES } ?: current.selectedCity
                val nextDate = route.date?.takeIf { it >= KartiseretApi.cinemaDay() && it <= KartiseretApi.cinemaDay().plusDays(179) } ?: current.selectedDate.let(LocalDate::parse)
                val nextFilters = route.filterMask?.let(MovieShareCodec::uncheckedFromFilterMask) ?: current.preferences.showtimePreferences.screeningFilters.unchecked
                val nextPrefs = current.preferences.showtimePreferences.copy(
                    screeningFilters = FilterState(3, nextFilters),
                    excludedCinemaIds = route.excludedCinemaIds.filter { CinemaIdentities.byId(it) != null }
                )
                guest.edit().putString("city", nextCity).apply()
                mutableState.update { it.copy(selectedCity = nextCity, selectedDate = nextDate.toString(), pendingMovieCode = route.movieCode, pendingMovieLinkError = null, preferences = it.preferences.copy(location = nextCity, showtimePreferences = nextPrefs)) }
                saveGuestPreferences(mutableState.value.preferences)
                loadShowtimes()
                loadCinematheques()
            }
            is IncomingRoute.Cinema -> loadCinema(route.id)
            is IncomingRoute.Delete -> acceptDeletionLink(route.token)
        }
    }

    fun retryPendingMovieLink() {
        mutableState.update { it.copy(pendingMovieLinkError = null) }
        refreshPublic()
    }
    fun markPendingMovieLinkUnavailable() { mutableState.update { it.copy(pendingMovieLinkError = "This film could not be found in the current catalogs. Check your connection and try again.") } }
    fun consumePendingMovieLink() { mutableState.update { it.copy(pendingMovieCode = null, pendingMovieLinkError = null) } }

    fun setCinemaPage(page: CinemaPage?) { mutableState.update { it.copy(cinemaPage = page) } }
}

private fun TmdbSearchResult.asMovie() = Movie(
    tmdbId = tmdbId,
    title = title,
    year = releaseYear ?: 0,
    releaseDate = comingSoonDate,
    imageSrc = posterImageSource(posterPath)
)

private fun posterImageSource(path: String?): String = path?.takeIf(String::isNotBlank)?.let {
    if (it.startsWith("https://")) it else if (it.startsWith('/')) "https://image.tmdb.org/t/p/w500$it" else ""
} ?: ""

@Serializable private data class Removed(val removed: Boolean = false)
@Serializable private data class SourceChange(val source: LetterboxdSource)
@Serializable private data class TicketAlertChange(val kind: String, val subscription: TicketAlert? = null)
@Serializable private data class DisplayRuleChange(val preference: DisplayRule)
private val ListSerializerString = kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.serializer<String>())
