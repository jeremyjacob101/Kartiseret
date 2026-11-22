package com.jj.kartiseret

import kotlinx.serialization.Serializable

@Serializable data class Envelope<T>(val data: T? = null, val error: ApiError? = null)
@Serializable data class ApiError(val code: String = "", val message: String = "")
@Serializable data class Catalog(val mode: String = "", val movies: List<Movie> = emptyList(), val movieCodesStatus: String = "")
@Serializable data class Movie(val tmdbId: String, val title: String, val year: Int, val releaseDate: String? = null, val genres: List<String> = emptyList(), val runtime: Int = 0, val movieCode: String? = null, val imageSrc: String? = null, val backdropSrc: String? = null, val trailerKey: String? = null, val imdbRating: Double? = null, val rtAudienceRating: Double? = null, val rtCriticRating: Double? = null, val lbRating: Double? = null, val tmdbRating: Double? = null, val overview: String? = null)
@Serializable data class City(val name: String, val altSpellings: List<String>? = null, val neighboringCities: List<String>? = null)
@Serializable data class Theaters(val cities: List<City> = emptyList())
@Serializable data class Screening(val tmdbId: String, val screeningCity: String, val dateOfShowing: String, val cinema: String, val showtime: String, val englishHref: String? = null, val hebrewHref: String? = null, val screeningTech: String = "", val screeningType: String = "", val dubLanguage: String? = null)
@Serializable data class Showtimes(val showtimes: List<Screening> = emptyList())
@Serializable data class CinemaSchedule(val movies: List<Movie> = emptyList(), val showtimes: List<Screening> = emptyList())
@Serializable data class Account(val user: User)
@Serializable data class User(val id: String, val name: String = "", val email: String = "")
@Serializable data class Preferences(val location: String = "Jerusalem", val siteColor: String = "#a66ae3", val ratingSources: List<String> = emptyList(), val hideReReleases: Boolean = false)
