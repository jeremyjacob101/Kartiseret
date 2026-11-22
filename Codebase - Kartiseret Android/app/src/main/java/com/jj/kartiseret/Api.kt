package com.jj.kartiseret

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

class KartiseretApi(private val base: String = BuildConfig.API_BASE_URL) {
    private val origin = java.net.URI(base).let { "${it.scheme}://${it.authority}" }
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS)
        .build()
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }

    private data class RawResponse(val body: String, val headers: Map<String, String>, val status: Int)

    private suspend fun request(
        path: String,
        token: String? = null,
        accountId: String? = null,
        method: String = "GET",
        body: String? = null,
        revision: String? = null
    ): RawResponse = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val url = java.net.URI(base.trimEnd('/') + path)
        require(url.scheme == "https" && "${url.scheme}://${url.authority}" == origin) { "Requests must remain on the configured HTTPS origin." }
        val builder = Request.Builder().url(url.toString()).header("Accept", "application/json").header("Origin", origin)
        token?.let { builder.header("Authorization", "Bearer $it") }
        accountId?.let { builder.header("X-Kartiseret-Account-Id", it) }
        revision?.let { builder.header("X-Kartiseret-Publication", it) }
        if (body != null) builder.header("Content-Type", "application/json")
        builder.method(method, body?.toRequestBody("application/json; charset=utf-8".toMediaType()))
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            val headers = response.headers.toMultimap().mapValues { (_, values) -> values.firstOrNull().orEmpty() }
            if (response.code in 300..399) throw ApiException(response.code, "The server redirected this request. Sign in again or check the configured API origin.")
            if (!response.isSuccessful) {
                val remote = runCatching { json.decodeFromString<ApiError>(text) }.getOrNull()
                val envelope = runCatching { json.decodeFromString<Envelope<Unit>>(text).error }.getOrNull()
                throw ApiException(response.code, envelope?.message?.takeIf(String::isNotBlank) ?: remote?.message?.takeIf(String::isNotBlank) ?: "Request failed (${response.code}).", envelope?.code ?: remote?.code.orEmpty())
            }
            RawResponse(text, headers, response.code)
        }
    }

    private suspend inline fun <reified T> data(path: String, token: String? = null, accountId: String? = null, method: String = "GET", body: String? = null, revision: String? = null): Pair<T, RawResponse> {
        val result = request(path, token, accountId, method, body, revision)
        val envelope = json.decodeFromString(Envelope.serializer(serializer<T>()), result.body)
        envelope.error?.let { throw ApiException(result.status, it.message, it.code) }
        return (envelope.data ?: throw ApiException(result.status, "The server returned an empty response.")) to result
    }

    suspend fun catalog(soon: Boolean): CatalogResult {
        val (payload, response) = data<Catalog>(if (soon) "/api/v1/catalog/coming-soon" else "/api/v1/catalog/now-playing")
        return CatalogResult(payload, header(response, "X-Kartiseret-Publication"))
    }
    suspend fun featured() = data<HomepageFeatured>("/api/v1/homepage/featured").first
    suspend fun theaters() = data<Theaters>("/api/v1/theaters").first
    suspend fun showtimes(city: String, start: String, end: String, movieId: String? = null, revision: String? = null): Pair<Showtimes, String?> {
        val query = buildList { add("city" to city); add("startDate" to start); add("endDate" to end); movieId?.let { add("tmdbId" to it) } }.joinToString("&") { (key, value) -> "${enc(key)}=${enc(value)}" }
        val (payload, response) = data<Showtimes>("/api/v1/showtimes?$query", revision = revision)
        return payload to response.headers.entries.firstOrNull { it.key.equals("X-Kartiseret-Publication", true) }?.value
    }
    suspend fun cinematheques(city: String, start: String, end: String, revision: String? = null) = data<CinemathequeData>("/api/v1/cinematheques?city=${enc(city)}&startDate=${enc(start)}&endDate=${enc(end)}", revision = revision).first
    suspend fun cinema(id: String, revision: String? = null) = data<CinemaPage>("/api/v1/cinemas/${encPath(id)}", revision = revision).first
    suspend fun ticketAvailability(movieId: String, from: String) = data<Showtimes>("/api/v1/ticket-availability?tmdbId=${enc(movieId)}&fromDate=${enc(from)}").first.showtimes
    suspend fun search(query: String) = data<TmdbSearchData>("/api/v1/tmdb/search?query=${enc(query)}").first.titles
    suspend fun providers() = data<ProviderData>("/api/v1/auth/providers").first.providers

    suspend fun signIn(email: String, password: String) = authToken("/api/auth/sign-in/email", "{\"email\":${quote(email.trim())},\"password\":${quote(password)}}")
    suspend fun signUp(name: String, email: String, password: String, city: String): String? {
        val raw = request("/api/auth/sign-up/email", method = "POST", body = "{\"name\":${quote(name.trim())},\"email\":${quote(email.trim())},\"password\":${quote(password)},\"signupLocation\":${quote(city)}}")
        return raw.headers.entries.firstOrNull { it.key.equals("set-auth-token", true) }?.value?.takeIf(String::isNotBlank)
    }
    suspend fun googleSignIn(idToken: String) = authToken("/api/auth/sign-in/social", "{\"provider\":\"google\",\"idToken\":{\"token\":${quote(idToken)}}}")
    private suspend fun authToken(path: String, body: String): String {
        val response = request(path, method = "POST", body = body)
        return response.headers.entries.firstOrNull { it.key.equals("set-auth-token", true) }?.value?.takeIf(String::isNotBlank)
            ?: throw ApiException(response.status, "The server did not return a session token.")
    }
    suspend fun account(token: String) = data<AccountData>("/api/v1/account", token).first
    suspend fun initializePreferences(token: String, city: String, userId: String) = data<Preferences>("/api/v1/preferences/initialize", token, userId, "POST", "{\"fallbackLocation\":${quote(city)}}").first
    suspend fun savePreferences(token: String, userId: String, patch: String) = data<Preferences>("/api/v1/preferences", token, userId, "PATCH", patch).first
    suspend fun <T> privateData(path: String, token: String, userId: String, serializer: KSerializer<T>, method: String = "GET", body: String? = null): T {
        val response = request(path, token, userId, method, body)
        val envelope = json.decodeFromString(Envelope.serializer(serializer), response.body)
        envelope.error?.let { throw ApiException(response.status, it.message, it.code) }
        return envelope.data ?: throw ApiException(response.status, "The server returned an empty response.")
    }
    suspend fun signOut(token: String) { request("/api/auth/sign-out", token, method = "POST", body = "{}") }
    suspend fun requestDeletion(token: String) { request("/api/auth/delete-user", token, method = "POST", body = "{}") }
    suspend fun confirmDeletion(token: String, confirmation: String) { request("/api/auth/delete-user", token, method = "POST", body = "{\"token\":${quote(confirmation)}}") }

    private fun enc(value: String) = URLEncoder.encode(value, Charsets.UTF_8.name())
    private fun encPath(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
    private fun quote(value: String) = kotlinx.serialization.json.JsonPrimitive(value).toString()
    private fun header(response: RawResponse, name: String) = response.headers.entries.firstOrNull { it.key.equals(name, true) }?.value

    companion object {
        fun cinemaDay(now: ZonedDateTime = ZonedDateTime.now(ZoneId.of("Asia/Jerusalem"))): LocalDate = if (now.hour * 60 + now.minute >= 65) now.toLocalDate() else now.toLocalDate().minusDays(1)
        fun minuteOf(value: String): Int? = Regex("^(\\d{1,2}):(\\d{2})").find(value.trim())?.let { match -> val hour = match.groupValues[1].toInt(); val minute = match.groupValues[2].toInt(); if (hour in 0..23 && minute in 0..59) hour * 60 + minute else null }
        fun effectiveShowtimeDay(day: LocalDate, value: String): LocalDate? = minuteOf(value)?.let { if (it < 65) day.plusDays(1) else day }
        fun shouldIncludeShowtime(day: LocalDate, value: String, now: ZonedDateTime = ZonedDateTime.now(ZoneId.of("Asia/Jerusalem"))): Boolean {
            val minutes = minuteOf(value) ?: return false
            val effective = if (minutes < 65) day.plusDays(1) else day
            val localNow = now.withZoneSameInstant(ZoneId.of("Asia/Jerusalem"))
            return effective > localNow.toLocalDate() || (effective == localNow.toLocalDate() && minutes + 15 >= localNow.hour * 60 + localNow.minute)
        }
        fun sortShowtime(value: String) = minuteOf(value)?.let { if (it < 65) it + 1440 else it } ?: Int.MAX_VALUE
    }
}
data class CatalogResult(val data: Catalog, val publicationRevision: String?)
class ApiException(val status: Int, override val message: String, val code: String = ""): Exception(message)
