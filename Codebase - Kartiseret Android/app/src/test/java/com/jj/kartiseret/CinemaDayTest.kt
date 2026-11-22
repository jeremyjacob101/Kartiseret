package com.jj.kartiseret

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class CinemaDayTest {
    @Test fun cutoffUsesJerusalemCalendarDay() {
        val zone = ZoneId.of("Asia/Jerusalem")
        assertEquals("2026-11-21", KartiseretApi.cinemaDay(ZonedDateTime.of(2026,11,22,1,4,0,0,zone)).toString())
        assertEquals("2026-11-22", KartiseretApi.cinemaDay(ZonedDateTime.of(2026,11,22,1,5,0,0,zone)).toString())
    }
}
