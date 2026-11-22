package com.jj.kartiseret

import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

class KartiseretApi(private val base: String = BuildConfig.API_BASE_URL) {
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }
    private fun request(path: String, token: String? = null, method: String = "GET", body: String? = null, revision: String? = null): String {
        val builder = Request.Builder().url(base.trimEnd('/') + path).header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (revision != null) builder.header("X-Kartiseret-Publication", revision)
        if (body != null) builder.header("Content-Type", "application/json")
        builder.method(method, body?.toRequestBody("application/json".toMediaType()))
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw ApiException(response.code, text)
            return text
        }
    }
    fun catalog(soon: Boolean) = request(if (soon) "/api/v1/catalog/coming-soon" else "/api/v1/catalog/now-playing")
    fun theaters() = request("/api/v1/theaters")
    fun showtimes(city: String, day: String, movieId: String? = null, revision: String? = null) = request("/api/v1/showtimes?city=${URLEncoder.encode(city, "UTF-8")}&date=$day" + (movieId?.let { "&tmdbId=$it" } ?: ""), revision = revision)
    fun cinematheques(city: String, from: String, to: String) = request("/api/v1/cinematheques?city=${URLEncoder.encode(city, "UTF-8")}&startDate=$from&endDate=$to")
    fun signIn(email: String, password: String) = request("/api/auth/sign-in/email", method = "POST", body = "{\"email\":\"$email\",\"password\":\"$password\"}")
    fun account(token: String) = request("/api/v1/account", token)
    fun initializePreferences(token: String, city: String) = request("/api/v1/preferences/initialize", token, "POST", "{\"fallbackLocation\":\"$city\"}")
    fun savePreference(token: String, patch: String) = request("/api/v1/preferences", token, "PATCH", patch)
    fun privateCall(token: String, path: String, method: String = "GET", body: String? = null) = request(path, token, method, body)
    fun signOut(token: String) { request("/api/auth/sign-out", token, "POST", "{}") }
    companion object { fun cinemaDay(now: ZonedDateTime = ZonedDateTime.now(ZoneId.of("Asia/Jerusalem"))): LocalDate = if (now.hour * 60 + now.minute >= 65) now.toLocalDate() else now.toLocalDate().minusDays(1) }
}
class ApiException(val status: Int, message: String): Exception(message)
