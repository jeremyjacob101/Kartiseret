package com.jj.kartiseret

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable data class Envelope<T>(val data: T? = null, val error: ApiError? = null)
@Serializable data class ApiError(val code: String = "", val message: String = "")
@Serializable data class Catalog(val mode: String = "", val movies: List<Movie> = emptyList(), val movieCodesStatus: String = "")
@Serializable data class Movie(
    val tmdbId: String, val title: String, val year: Int, val releaseDate: String? = null,
    val genres: List<String> = emptyList(), val runtime: Int = 0, val movieCode: String? = null,
    val imageSrc: String = "", val imageSrcSet: String? = null, val backdropSrc: String? = null,
    val backdropSrcSet: String? = null, val trailerKey: String? = null, val imdbId: String? = null,
    val imdbRating: Double? = null, val rtAudienceRating: Double? = null, val rtAudienceVotes: Double? = null,
    val rtCriticRating: Double? = null, val rtCriticVotes: Double? = null, val lbId: String? = null,
    val lbRating: Double? = null, val lbVotes: Double? = null, val tmdbRating: Double? = null,
    val tmdbVotes: Double? = null, val runtimeMinutes: Int? = null
)
@Serializable data class City(val name: String, val altSpellings: List<String> = emptyList(), val latitude: Double? = null, val longitude: Double? = null, val neighboringCities: List<String> = emptyList())
@Serializable data class Theater(val city: City? = null, val chain: String = "", val address: String = "", val theaterName: String = "", val location: String = "", val lat: Double? = null, val lng: Double? = null)
@Serializable data class Theaters(val cities: List<City> = emptyList(), val theaters: List<Theater> = emptyList())
@Serializable data class Screening(val tmdbId: String, val screeningCity: String, val dateOfShowing: String, val cinema: String, val showtime: String, val englishHref: String? = null, val hebrewHref: String? = null, val screeningTech: String = "", val screeningType: String = "", val dubLanguage: String? = null)
@Serializable data class Showtimes(val showtimes: List<Screening> = emptyList())
@Serializable data class CinemathequeData(val movies: List<Movie> = emptyList(), val movieCodesStatus: String = "", val showtimes: List<Screening> = emptyList())
@Serializable data class CinemaPage(val id: String, val displayName: String, val city: String, val address: String, val mapUrl: String, val latitude: Double, val longitude: Double, val screenings: List<CinemaScreening> = emptyList())
@Serializable data class CinemaScreening(val movie: Movie, val screening: Screening)
@Serializable data class AccountData(val user: User, val isAdmin: Boolean = false)
@Serializable data class User(val id: String, val email: String? = null, val name: String? = null)
@Serializable data class Preferences(
    val location: String = "Jerusalem", val siteColor: String = "#a66ae3",
    val ratingSources: List<String> = listOf("imdbRating", "rtAudienceRating", "rtCriticRating"),
    val hideReReleases: Boolean = false, val showtimePreferences: ShowtimePreferences = ShowtimePreferences()
)
@Serializable data class ShowtimePreferences(val screeningFilters: FilterState = FilterState(), val excludedCinemaIds: List<String> = emptyList())
@Serializable data class FilterState(val version: Int = 3, val unchecked: FilterGroups = FilterGroups())
@Serializable data class FilterGroups(val showType: List<String> = emptyList(), val screenFormat: List<String> = emptyList(), val screeningTech: List<String> = emptyList(), val dubLanguage: List<String> = emptyList())

@Serializable data class DisplayRule(val tmdbId: String, val title: String, val releaseYear: Int? = null, val treatment: String = "standard", val hideBackdrop: Boolean = false)
@Serializable data class DisplayRulePage(val preferences: List<DisplayRule> = emptyList(), val nextCursor: String? = null)
@Serializable data class TicketAlert(val tmdbId: String, val createdAt: String = "", val notifiedAt: String? = null, val deliveryTitle: String? = null, val deliveryDate: String? = null, val completedCities: List<String> = emptyList(), val criteriaOverrides: AlertCriteriaOverride = AlertCriteriaOverride())
@Serializable data class AlertCriteriaOverride(val cities: List<String>? = null, val notificationMode: String? = null, val filters: AlertFilters? = null)
@Serializable data class AlertCriteria(val cities: List<String>? = null, val notificationMode: String = "first_any_city", val filters: AlertFilters = AlertFilters())
@Serializable data class AlertFilters(val showType: List<String> = emptyList(), val screenFormat: List<String> = emptyList(), val screeningTech: List<String> = emptyList(), val dubLanguage: List<String> = emptyList())
@Serializable data class TicketAlertPage(val subscriptions: List<TicketAlert> = emptyList(), val nextOffset: Int? = null)
@Serializable data class TicketAlertPreferencesData(val preferences: AlertCriteria)
@Serializable data class ComingSoonWatch(val tmdbId: String, val title: String, val releaseYear: Int? = null, val posterPath: String? = null, val notifiedAt: String? = null, val comingSoonDate: String? = null)
@Serializable data class ComingSoonWatchPage(val watches: List<ComingSoonWatch> = emptyList())
@Serializable data class LetterboxdSource(val id: String, val sourceUrl: String, val sourceType: String, val lastSyncAttemptAt: String? = null, val lastSuccessfulSyncAt: String? = null, val lastSyncError: String? = null, val filmCount: Int = 0, val matchedFilmCount: Int = 0)
@Serializable data class LetterboxdSourcePage(val sources: List<LetterboxdSource> = emptyList())
@Serializable data class ProviderData(val providers: List<String> = emptyList())
@Serializable data class HomepageFeatured(val lineup: WeeklyLineup? = null, val highlights: List<HomepageHighlight> = emptyList(), val promotions: List<HomepagePromotion> = emptyList(), val metadata: FeaturedMetadata = FeaturedMetadata())
@Serializable data class WeeklyLineup(val nowPlayingIds: List<String> = emptyList(), val comingSoonIds: List<String> = emptyList())
@Serializable data class HomepageHighlight(val tmdbId: String, val label: String? = null, val title: String? = null, val subtitle: String? = null, val posterUrl: String? = null, val backdropUrl: String? = null, val ctaHref: String? = null)
@Serializable data class HomepagePromotion(val id: String, val title: String, val body: String? = null, val imageUrl: String? = null, val ctaLabel: String? = null, val ctaHref: String? = null)
@Serializable data class FeaturedMetadata(val localReleaseDates: Map<String, String> = emptyMap(), val ticketedUpcomingIds: List<String> = emptyList())
@Serializable data class TmdbSearchResult(val tmdbId: String, val title: String, val releaseYear: Int? = null, val posterPath: String? = null, val comingSoonDate: String? = null)
@Serializable data class TmdbSearchData(val titles: List<TmdbSearchResult> = emptyList())

const val DEFAULT_LOCATION = "Jerusalem"
val ALL_CITIES = listOf("Afula", "Ashdod", "Ashkelon", "Ayalon", "Bat Yam", "Beer Sheva", "Carmiel", "Chadera", "Even Yehuda", "Givatayim", "Glilot", "Haifa", "Herziliya", "Jerusalem", "Kfar Saba", "Kiryat Bialik", "Kiryat Ono", "Modiin", "Nahariya", "Netanya", "Omer", "Petach Tikvah", "Raanana", "Ramat Hasharon", "Rehovot", "Rishon Letzion", "Tel Aviv", "Zichron Yaakov", "Holon")
val FILTER_OPTIONS = mapOf("showType" to listOf("Regular", "VIP", "VIP Light", "Upgrade", "Prime", "Lounge", "Premium", "Not Just Cinema"), "screenFormat" to listOf("2D", "3D"), "screeningTech" to listOf("Standard", "HFR", "IMAX", "Atmos", "ONYX", "ScreenX", "4DX", "Infinity Vision"), "dubLanguage" to listOf("Original", "Hebrew", "French"))
