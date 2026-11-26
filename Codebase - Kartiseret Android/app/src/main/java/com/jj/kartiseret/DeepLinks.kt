package com.jj.kartiseret

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.time.LocalDate

sealed interface IncomingRoute {
    data class Tab(val tab: AppTab) : IncomingRoute
    data class Catalog(val soon: Boolean) : IncomingRoute
    data class Movie(val movieCode: String, val city: String? = null, val date: LocalDate? = null, val filterMask: Int? = null, val excludedCinemaIds: List<String> = emptyList()) : IncomingRoute
    data class Cinema(val id: String) : IncomingRoute
    data class Delete(val token: String) : IncomingRoute
}

object MovieShareCodec {
    const val urlAlphabet = "1iljIt23457fkrsvxyzFJLT0689abcdeghnopquABCDEGHKNOPQRSUVXYZmwMW"
    const val dateAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    val cityCodes = mapOf("Jerusalem" to "i", "Tel Aviv" to "l", "Glilot" to "j", "Modiin" to "I", "Herziliya" to "t", "Afula" to "2", "Ashdod" to "3", "Ashkelon" to "4", "Ayalon" to "5", "Bat Yam" to "c", "Beer Sheva" to "7", "Carmiel" to "f", "Chadera" to "k", "Even Yehuda" to "r", "Givatayim" to "s", "Haifa" to "v", "Kfar Saba" to "x", "Kiryat Bialik" to "y", "Kiryat Ono" to "z", "Nahariya" to "F", "Netanya" to "J", "Omer" to "L", "Petach Tikvah" to "T", "Raanana" to "0", "Ramat Hasharon" to "6", "Rehovot" to "8", "Rishon Letzion" to "9", "Zichron Yaakov" to "a", "Holon" to "b")
    private val cityNames = cityCodes.entries.associate { it.value to it.key }
    private data class Bit(val bit: Int, val group: String, val value: String)
    private val bitAssignments = listOf(
        Bit(0,"showType","Not Just Cinema"),Bit(1,"showType","Premium"),Bit(2,"showType","Lounge"),Bit(3,"showType","Prime"),Bit(4,"showType","Upgrade"),Bit(5,"showType","VIP Light"),Bit(6,"showType","VIP"),Bit(7,"screeningTech","4DX"),Bit(8,"screeningTech","ScreenX"),Bit(9,"screeningTech","ONYX"),Bit(10,"screeningTech","Atmos"),Bit(11,"screeningTech","HFR"),Bit(12,"screenFormat","3D"),Bit(13,"dubLanguage","French"),Bit(14,"dubLanguage","Hebrew"),Bit(15,"screeningTech","IMAX"),Bit(16,"dubLanguage","Original"),Bit(17,"screenFormat","2D"),Bit(18,"screeningTech","Standard"),Bit(19,"showType","Regular"),Bit(20,"screeningTech","Infinity Vision")
    )

    fun decode(code: String, currentCity: String, today: LocalDate): IncomingRoute.Movie? {
        if (!code.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' }) return null
        if (code.length == 3) return IncomingRoute.Movie(code)
        if (code.length !in setOf(6, 7, 9, 10)) return null
        val cityCode = code[3].toString()
        val city = if (cityCode == "1") currentCity else cityNames[cityCode] ?: return null
        val dateIndex = dateAlphabet.indexOf(code[4])
        if (dateIndex < 0) return null
        val date = (0 until 62).map { today.plusDays(it.toLong()) }.firstOrNull { Math.floorMod(it.toEpochDay(), 62L).toInt() == dateIndex } ?: return null
        val shortcut = code.length in setOf(6, 7)
        if (shortcut && (code[5] != 'j' || (code.length == 7 && code[6] != 'i'))) return null
        if (!shortcut && code.length == 10 && code[9] != 'i') return null
        val mask = if (shortcut) 0 else decodeBase62(code.substring(5, 9))
        if (mask !in 0 until (1 shl 21)) return null
        return IncomingRoute.Movie(code.take(3), city, date, mask)
    }

    fun encode(movieCode: String, city: String, date: LocalDate, today: LocalDate, filters: FilterGroups, excludedCinemaIds: List<String>): String? {
        if (!movieCode.matches(Regex("[A-Za-z0-9]{3}")) || date < today || date >= today.plusDays(62)) return null
        if (excludedCinemaIds.any { CinemaIdentities.byId(it) == null }) return null
        val cityCode = cityCodes[city] ?: return null
        val dayIndex = Math.floorMod(date.toEpochDay(), 62L).toInt()
        var mask = 0
        bitAssignments.forEach { bit ->
            val values = when(bit.group){"showType"->filters.showType;"screenFormat"->filters.screenFormat;"screeningTech"->filters.screeningTech;else->filters.dubLanguage}
            if (bit.value in values) mask = mask or (1 shl bit.bit)
        }
        val dateCode = dateAlphabet[dayIndex]
        val filterCode = if (mask == 0) "j" else encodeBase62(mask, 4) ?: return null
        val path = "/$movieCode$cityCode$dateCode$filterCode"
        val params = buildList {
            add("date=${date}")
            if (excludedCinemaIds.isNotEmpty()) add("excludeCinemas=${URLEncoder.encode(excludedCinemaIds.distinct().sorted().joinToString(","), Charsets.UTF_8.name()).replace("+", "%20")}")
        }.joinToString("&")
        return "$path?$params"
    }

    fun uncheckedFromFilterMask(mask: Int): FilterGroups? {
        if (mask !in 0 until (1 shl 21)) return null
        val unchecked = mutableMapOf("showType" to mutableListOf<String>(), "screenFormat" to mutableListOf(), "screeningTech" to mutableListOf(), "dubLanguage" to mutableListOf())
        bitAssignments.filter { mask and (1 shl it.bit) != 0 }.forEach { unchecked.getValue(it.group).add(it.value) }
        return FilterGroups(unchecked.getValue("showType"), unchecked.getValue("screenFormat"), unchecked.getValue("screeningTech"), unchecked.getValue("dubLanguage"))
    }

    private fun encodeBase62(raw: Int, width: Int): String? {
        var value = raw
        if (value < 0 || value >= urlAlphabet.length.toDouble().pow(width)) return null
        val output = CharArray(width) { urlAlphabet[0] }
        for (index in width - 1 downTo 0) { output[index] = urlAlphabet[value % urlAlphabet.length]; value /= urlAlphabet.length }
        return output.concatToString()
    }
    private fun decodeBase62(value: String): Int? {
        var result = 0L
        for (char in value) { val digit = urlAlphabet.indexOf(char); if (digit < 0) return null; result = result * urlAlphabet.length + digit; if (result > Int.MAX_VALUE) return null }
        return result.toInt()
    }
    private fun Double.pow(power: Int): Double = (0 until power).fold(1.0) { acc, _ -> acc * this }
}

fun parseIncomingLink(uri: URI, fallbackCity: String): IncomingRoute? {
    if (uri.scheme != "https" || uri.host != BuildConfig.APP_LINK_HOST || uri.userInfo != null || uri.port != -1) return null
    val query = decodeForm(uri.rawQuery)
    if (query.containsKey("no_universal_links")) return null
    val path = uri.path.orEmpty()
    if (path == "/confirm-account-deletion") {
        val fragment = uri.rawFragment ?: return null
        if (fragment.length > 8192) return null
        val parts = fragment.split('&')
        val tokens = parts.mapNotNull { part -> part.split('=', limit = 2).takeIf { decodeFragmentComponent(it.firstOrNull().orEmpty()) == "token" }?.getOrNull(1)?.let(::decodeFragmentComponent) }
        val token = tokens.singleOrNull()?.takeIf { it.isNotBlank() && it.length <= 4096 && it.none(Char::isISOControl) } ?: return null
        return IncomingRoute.Delete(token)
    }
    if (path == "/" || path.isBlank()) return IncomingRoute.Tab(AppTab.DISCOVER)
    when (path) {
        "/movies" -> return IncomingRoute.Catalog(soon = false)
        "/soons" -> return IncomingRoute.Catalog(soon = true)
        "/showtimes" -> return IncomingRoute.Tab(AppTab.SHOWTIMES)
        "/cinematheques" -> return IncomingRoute.Tab(AppTab.CINEMATHEQUES)
        "/user" -> return IncomingRoute.Tab(AppTab.YOU)
    }
    val segments = path.trim('/').split('/')
    if (segments.size == 2 && segments[0] == "c" && CinemaIdentities.byId(segments[1]) != null) return IncomingRoute.Cinema(segments[1])
    if (segments.size != 1) return null
    val explicitDate = query["date"]?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
    val parsed = MovieShareCodec.decode(segments[0], fallbackCity, explicitDate ?: KartiseretApi.cinemaDay()) ?: return null
    if (explicitDate != null && parsed.date != null && parsed.date != explicitDate) return null
    val excluded = query["excludeCinemas"]?.takeIf { it.length <= 2000 }?.split(',')?.filter { CinemaIdentities.byId(it) != null }?.distinct().orEmpty()
    return parsed.copy(date = explicitDate ?: parsed.date, excludedCinemaIds = excluded)
}

private fun decodeForm(value: String?): Map<String, String> {
    val raw = value?.takeIf { it.length <= 8192 } ?: return emptyMap()
    val result = linkedMapOf<String, String>()
    raw.split('&').forEach { part ->
        val split = part.split('=', limit = 2)
        val key = decodeComponent(split[0])
        if (key !in result) result[key] = decodeComponent(split.getOrElse(1) { "" })
    }
    return result
}

private fun decodeComponent(value: String) = runCatching { URLDecoder.decode(value, Charsets.UTF_8.name()) }.getOrDefault("")

private fun decodeFragmentComponent(value: String) = runCatching { URLDecoder.decode(value.replace("+", "%2B"), Charsets.UTF_8.name()) }.getOrDefault("")
