package com.jj.kartiseret

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.LocalDate

class CinemaDayTest {
    @Test fun cutoffUsesJerusalemCalendarDay() {
        val zone = ZoneId.of("Asia/Jerusalem")
        assertEquals("2026-11-21", KartiseretApi.cinemaDay(ZonedDateTime.of(2026,11,22,1,4,0,0,zone)).toString())
        assertEquals("2026-11-22", KartiseretApi.cinemaDay(ZonedDateTime.of(2026,11,22,1,5,0,0,zone)).toString())
    }

    @Test fun postMidnightCarryoverAndGraceMatchSharedScheduleRules() {
        val zone = ZoneId.of("Asia/Jerusalem")
        val cinemaDay = LocalDate.parse("2026-11-22")
        assertEquals(cinemaDay.plusDays(1), KartiseretApi.effectiveShowtimeDay(cinemaDay, "01:04"))
        assertEquals(cinemaDay, KartiseretApi.effectiveShowtimeDay(cinemaDay, "01:05"))
        assertEquals(1_470, KartiseretApi.sortShowtime("00:30"))
        assertEquals(null, KartiseretApi.effectiveShowtimeDay(cinemaDay, "25:00"))

        assertTrue(KartiseretApi.shouldIncludeShowtime(cinemaDay, "01:04", ZonedDateTime.of(2026, 11, 23, 1, 19, 0, 0, zone)))
        assertFalse(KartiseretApi.shouldIncludeShowtime(cinemaDay, "01:04", ZonedDateTime.of(2026, 11, 23, 1, 20, 0, 0, zone)))
        assertTrue(KartiseretApi.shouldIncludeShowtime(cinemaDay, "18:00", ZonedDateTime.of(2026, 11, 22, 18, 15, 0, 0, zone)))
        assertFalse(KartiseretApi.shouldIncludeShowtime(cinemaDay, "18:00", ZonedDateTime.of(2026, 11, 22, 18, 16, 0, 0, zone)))
    }
}
