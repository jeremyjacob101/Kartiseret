package com.jj.kartiseret

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FixtureDataTest {
    @Test fun offlineFixturesHaveBrowseAndCinemaCoverage() {
        assertEquals(4, FixtureData.movies.size)
        assertTrue(FixtureData.movies.all { it.tmdbId.startsWith("910000") })
        assertTrue(FixtureData.movies.all { it.imageSrc.isBlank() })
        assertEquals(ALL_CITIES.toSet(), FixtureData.cities.map(City::name).toSet())
        assertTrue(FixtureData.showtimes("Jerusalem", KartiseretApi.cinemaDay().toString()).showtimes.isNotEmpty())
        assertNotNull(FixtureData.cinema("smBcm2HtRvQA"))
        assertFalse(FixtureData.cinematheques("Jerusalem", KartiseretApi.cinemaDay(), 13).movies.isEmpty())
    }

    @Test fun generatedCinemaLookupUsesExactSharedNamesAndCityAliases() {
        assertEquals("Lv7nojZOm284", CinemaIdentities.forScreening("Jaffa", "Jaffa Cinema")?.id)
        assertEquals("vDDsjAP8cIuf", CinemaIdentities.forScreening("Zichron Yaakov", "Yes Planet Zichron Yaakov")?.id)
        assertEquals(null, CinemaIdentities.forScreening("Tel Aviv", "Cinematheque"))
        assertEquals(null, CinemaIdentities.forScreening("Jerusalem", "Some other cinema"))
    }
}
