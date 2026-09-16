import { describe, expect, it } from "vitest";
import { addShowtimeCalendarDays, getCinemaDayDate, getEffectiveShowtimeDate, getShowtimeSortValue, getZonedDateTimeParts, isPostMidnightCarryoverShowtime, parseShowtimeMinutes, shouldIncludeShowtime } from "../src/domain/showtimeDay";

describe("showtime day and cutoff rules", () => {
  it("adds valid calendar days across month and leap-year boundaries", () => {
    expect(addShowtimeCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addShowtimeCalendarDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addShowtimeCalendarDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(addShowtimeCalendarDays("2024-03-01", 0.5)).toBeNull();
    expect(addShowtimeCalendarDays("2024-02-30", 1)).toBeNull();
  });

  it("uses the Jerusalem 01:05 cinema-day cutoff", () => {
    const justBeforeCutoff = new Date("2026-09-15T22:04:00.000Z");
    const atCutoff = new Date("2026-09-15T22:05:00.000Z");

    expect(getZonedDateTimeParts("Asia/Jerusalem", justBeforeCutoff)).toEqual({
      date: "2026-09-16",
      hour: 1,
      minute: 4,
    });
    expect(getCinemaDayDate(justBeforeCutoff)).toBe("2026-09-15");
    expect(getCinemaDayDate(atCutoff)).toBe("2026-09-16");
  });

  it("classifies post-midnight carryover screenings and invalid times", () => {
    expect(parseShowtimeMinutes(" 0:05 (late) ")).toBe(5);
    expect(parseShowtimeMinutes("23:59")).toBe(1439);
    expect(parseShowtimeMinutes("24:00")).toBeNull();
    expect(parseShowtimeMinutes("9:60")).toBeNull();
    expect(parseShowtimeMinutes("unknown")).toBeNull();

    expect(isPostMidnightCarryoverShowtime("01:04")).toBe(true);
    expect(isPostMidnightCarryoverShowtime("01:05")).toBe(false);
    expect(getEffectiveShowtimeDate("2026-09-16", "00:30")).toBe("2026-09-17");
    expect(getEffectiveShowtimeDate("2026-09-16", "01:05")).toBe("2026-09-16");
  });

  it("includes future screenings and the grace period but excludes stale ones", () => {
    const eveningNow = new Date("2026-09-16T17:00:00.000Z");

    expect(shouldIncludeShowtime("2026-09-16", "19:50", eveningNow)).toBe(true);
    expect(shouldIncludeShowtime("2026-09-16", "19:44", eveningNow)).toBe(
      false,
    );
    expect(shouldIncludeShowtime("2026-09-17", "00:30", eveningNow)).toBe(true);
    expect(shouldIncludeShowtime("2026-09-15", "22:00", eveningNow)).toBe(
      false,
    );
    expect(shouldIncludeShowtime("2026-09-16", "invalid", eveningNow)).toBe(
      false,
    );
  });

  it("sorts late-night carryover screenings after same-day evening screenings", () => {
    expect(getShowtimeSortValue("00:30")).toBe(1470);
    expect(getShowtimeSortValue("23:00")).toBe(1380);
    expect(getShowtimeSortValue("not a time")).toBe(Number.POSITIVE_INFINITY);
  });
});
