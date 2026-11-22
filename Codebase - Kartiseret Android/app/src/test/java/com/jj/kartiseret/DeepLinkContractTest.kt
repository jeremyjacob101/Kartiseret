package com.jj.kartiseret

import java.io.File
import java.net.URI
import java.time.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepLinkContractTest {
    private val json = Json

    @Test fun sharedShowtimeLinkVectorsDecodeAndReencode() {
        val file = contractVectorFile()
        val vectors = json.parseToJsonElement(file.readText()).jsonArray
        assertEquals("Keep the Android codec aligned with the shared three-vector contract", 3, vectors.size)

        vectors.forEach { element ->
            val vector = element.jsonObject
            val movieCode = vector.getValue("movieCode").jsonPrimitive.content
            val city = vector.getValue("city").jsonPrimitive.content
            val date = LocalDate.parse(vector.getValue("date").jsonPrimitive.content)
            val filterMask = vector.getValue("filterMask").jsonPrimitive.content.toInt()
            val path = vector.getValue("path").jsonPrimitive.content
            val routeCode = path.substringBefore('?').removePrefix("/")
            val filtersObject = vector.getValue("filterExclusions").jsonObject
            val filters = FilterGroups(
                showType = filtersObject.getValue("showType").jsonArray.map { it.jsonPrimitive.content },
                screenFormat = filtersObject.getValue("screenFormat").jsonArray.map { it.jsonPrimitive.content },
                screeningTech = filtersObject.getValue("screeningTech").jsonArray.map { it.jsonPrimitive.content },
                dubLanguage = filtersObject.getValue("dubLanguage").jsonArray.map { it.jsonPrimitive.content }
            )

            val decoded = MovieShareCodec.decode(routeCode, "Jerusalem", date.minusDays(10))
            assertTrue("Expected vector $path to decode", decoded is IncomingRoute.Movie)
            decoded as IncomingRoute.Movie
            assertEquals(movieCode, decoded.movieCode)
            assertEquals(city, decoded.city)
            assertEquals(date, decoded.date)
            assertEquals(filterMask, decoded.filterMask)
            assertEquals(filters, MovieShareCodec.uncheckedFromFilterMask(filterMask))

            assertEquals(path, MovieShareCodec.encode(movieCode, city, date, date.minusDays(10), filters, emptyList()))
            val appLink = URI("https://${BuildConfig.APP_LINK_HOST}$path")
            val parsed = parseIncomingLink(appLink, "Jerusalem") as IncomingRoute.Movie
            assertEquals(city, parsed.city)
            assertEquals(date, parsed.date)
            assertEquals(filters, MovieShareCodec.uncheckedFromFilterMask(parsed.filterMask!!))
        }
    }

    @Test fun acceptsBothShareAndEditRouteCodes() {
        val date = LocalDate.of(2027, 1, 15)
        val filters = FilterGroups(screeningTech = listOf("Infinity Vision"))
        val share = MovieShareCodec.encode("A7z", "Tel Aviv", date, date.minusDays(10), filters, emptyList())!!
        val editCode = share.substringBefore('?').removePrefix("/") + "i"
        val route = MovieShareCodec.decode(editCode, "Jerusalem", date.minusDays(10))
        assertTrue(route is IncomingRoute.Movie)
        assertEquals(1 shl 20, (route as IncomingRoute.Movie).filterMask)
        assertNull(MovieShareCodec.decode(editCode.dropLast(1) + "x", "Jerusalem", date.minusDays(10)))
    }

    @Test fun onlyCanonicalCinemasAndSupportedLinksBecomeNativeRoutes() {
        assertEquals("smBcm2HtRvQA", CinemaIdentities.forScreening("Jerusalem", "Jerusalem Cinematheque")?.id)
        assertNull(CinemaIdentities.forScreening("Tel Aviv", "Cinematheque")) // The provider label is ambiguous.
        assertNull(parseIncomingLink(URI("https://${BuildConfig.APP_LINK_HOST}/c/not-a-cinema"), "Jerusalem"))
        assertNull(parseIncomingLink(URI("https://${BuildConfig.APP_LINK_HOST}/showtimes?no_universal_links=1"), "Jerusalem"))

        val deletion = parseIncomingLink(URI("https://${BuildConfig.APP_LINK_HOST}/confirm-account-deletion#token=example%2Btoken"), "Jerusalem")
        assertEquals(IncomingRoute.Delete("example+token"), deletion)
        assertEquals(IncomingRoute.Catalog(soon = false), parseIncomingLink(URI("https://${BuildConfig.APP_LINK_HOST}/movies"), "Jerusalem"))
        assertEquals(IncomingRoute.Catalog(soon = true), parseIncomingLink(URI("https://${BuildConfig.APP_LINK_HOST}/soons"), "Jerusalem"))
    }

    private fun contractVectorFile(): File {
        var directory: File? = File(requireNotNull(System.getProperty("user.dir"))).canonicalFile
        while (directory != null) {
            val candidate = File(directory, "packages/contracts/test-data/showtime-link-vectors.json")
            if (candidate.isFile) return candidate
            directory = directory.parentFile
        }
        throw AssertionError("Shared showtime-link vectors were not found in an ancestor workspace directory.")
    }
}
