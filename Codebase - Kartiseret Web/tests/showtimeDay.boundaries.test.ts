import { describe, expect, it } from "vitest";
import { SHOWTIME_DAY_CUTOFF_MINUTES, SHOWTIME_GRACE_PERIOD_MINUTES, addShowtimeCalendarDays, getCinemaDayDate, getEffectiveShowtimeDate, getShowtimeSortValue, isPostMidnightCarryoverShowtime, parseShowtimeMinutes, shouldIncludeShowtime } from "../src/domain/showtimeDay";

describe("showtime calendar boundary invariants", () => {
  it.each([
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["2023-02-28", 1, "2023-03-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-09-16", 0, "2026-09-16"],
    ["2026-09-16", 365, "2027-09-16"],
  ])("adds calendar days without time-zone drift (%s, %s)", (
    date,
    offset,
    expected,
  ) => {
    expect(addShowtimeCalendarDays(date, offset)).toBe(expected);
  });

  it.each([
    ["", null],
    ["20", null],
    ["20:0", null],
    ["24:00", null],
    ["23:60", null],
    ["-1:00", null],
    [" 00:05 extra", 5],
    ["7:09", 429],
    ["23:59", 1439],
  ])("parses only valid showtime prefixes (%s)", (value, expected) => {
    expect(parseShowtimeMinutes(value)).toBe(expected);
  });

  it.each([
    ["00:00", true],
    ["01:04", true],
    ["01:05", false],
    ["01:06", false],
    ["not-a-time", false],
  ])("classifies carryover showtimes at the 01:05 cutoff (%s)", (
    value,
    expected,
  ) => {
    expect(isPostMidnightCarryoverShowtime(value)).toBe(expected);
  });

  it("keeps the cutoff constant and moves carryover showtimes to the next date", () => {
    expect(SHOWTIME_DAY_CUTOFF_MINUTES).toBe(65);
    expect(getEffectiveShowtimeDate("2026-09-16", "01:04")).toBe("2026-09-17");
    expect(getEffectiveShowtimeDate("2026-09-16", "01:05")).toBe("2026-09-16");
    expect(getEffectiveShowtimeDate("2026-02-30", "20:00")).toBeNull();
    expect(getEffectiveShowtimeDate("2026-09-16", "bad")).toBeNull();
  });

  it.each([
    ["2026-09-16T21:04:00Z", "2026-09-16"],
    ["2026-09-16T22:05:00Z", "2026-09-17"],
    ["2026-12-31T22:04:00Z", "2026-12-31"],
    ["2026-12-31T23:05:00Z", "2027-01-01"],
  ])("assigns the cinema day in Asia/Jerusalem around midnight (%s)", (
    instant,
    expected,
  ) => {
    expect(getCinemaDayDate(new Date(instant))).toBe(expected);
  });

  it.each([
    ["2026-09-16", "20:00", "2026-09-16T16:00:00Z", true],
    ["2026-09-16", "19:45", "2026-09-16T17:00:00Z", true],
    ["2026-09-16", "19:44", "2026-09-16T17:00:00Z", false],
    ["2026-09-16", "00:30", "2026-09-16T21:45:00Z", true],
    ["2026-09-16", "00:29", "2026-09-16T21:45:00Z", false],
    ["2026-09-16", "20:00", "2026-09-17T16:00:00Z", false],
    ["2026-09-16", "20:00", "2026-09-15T16:00:00Z", true],
  ])("includes future and grace-period showtimes but excludes expired ones", (
    cinemaDate,
    showtime,
    instant,
    expected,
  ) => {
    expect(shouldIncludeShowtime(cinemaDate, showtime, new Date(instant))).toBe(
      expected,
    );
  });

  it("applies the documented grace period exactly once", () => {
    expect(SHOWTIME_GRACE_PERIOD_MINUTES).toBe(15);
    const atBoundary = new Date("2026-09-16T17:00:00Z");
    const afterBoundary = new Date("2026-09-16T17:01:00Z");
    expect(shouldIncludeShowtime("2026-09-16", "19:45", atBoundary)).toBe(true);
    expect(shouldIncludeShowtime("2026-09-16", "19:45", afterBoundary)).toBe(
      false,
    );
  });

  it.each([
    ["00:00", 1440],
    ["01:04", 1504],
    ["01:05", 65],
    ["19:30", 1170],
    ["23:59", 1439],
    ["unknown", Number.POSITIVE_INFINITY],
  ])("sorts post-midnight times after regular evening times (%s)", (
    showtime,
    expected,
  ) => {
    expect(getShowtimeSortValue(showtime)).toBe(expected);
  });
});
