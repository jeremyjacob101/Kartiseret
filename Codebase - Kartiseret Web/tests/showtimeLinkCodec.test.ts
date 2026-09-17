import { addCalendarDays, buildMovieShowtimeShareUrl, decodeBase62, decodeDateCode, decodeFilterMask, encodeBase62Fixed, encodeDateCode, encodeFilterMask, encodeMovieRouteCode, filterMaskFromUnchecked, getTargetedShowtimePrefetchRange, isCanonicalShowtimeFilterMatch, isDateInShowtimeLinkWindow, migrateShowtimeFilterState, parseMovieRouteCode, resolveCityCode, uncheckedFromFilterMask } from "../src/routing/showtimeLinkCodec";
import { describe, expect, it } from "vitest";

describe("showtime share-link codec", () => {
  it("round-trips fixed-width base62 values and rejects unsafe input", () => {
    for (const value of [0, 1, 61, 62, 12345, 2 ** 20 - 1]) {
      const encoded = encodeBase62Fixed(value, 4);
      expect(encoded).not.toBeNull();
      expect(decodeBase62(encoded!)).toBe(value);
    }

    expect(encodeBase62Fixed(-1, 4)).toBeNull();
    expect(encodeBase62Fixed(1, 0)).toBeNull();
    expect(encodeBase62Fixed(62 ** 4, 4)).toBeNull();
    expect(decodeBase62("!")).toBeNull();
    expect(decodeBase62("X".repeat(20))).toBeNull();
  });

  it("encodes dates into the bounded forward window", () => {
    const today = "2026-09-16";
    const todayCode = encodeDateCode(today);
    const future = addCalendarDays(today, 61)!;

    expect(todayCode).not.toBeNull();
    expect(decodeDateCode(todayCode!, today)).toBe(today);
    expect(decodeDateCode(encodeDateCode(future)!, today)).toBe(future);
    expect(isDateInShowtimeLinkWindow(future, today)).toBe(true);
    expect(isDateInShowtimeLinkWindow(addCalendarDays(today, 62)!, today)).toBe(
      false,
    );
    expect(encodeDateCode("2026-02-30")).toBeNull();
    expect(decodeDateCode("?", today)).toBeNull();
  });

  it("round-trips every supported filter bit and rejects overflow masks", () => {
    const unchecked = {
      showType: ["VIP", "Premium"],
      screeningTech: ["IMAX", "4DX"],
      screenFormat: ["3D"],
      dubLanguage: ["French"],
    } as const;
    const mask = filterMaskFromUnchecked(unchecked);

    expect(encodeFilterMask(mask)).not.toBeNull();
    expect(decodeFilterMask(encodeFilterMask(mask)!)).toBe(mask);
    expect(uncheckedFromFilterMask(mask)).toEqual({
      showType: ["Premium", "VIP"],
      screeningTech: ["4DX", "IMAX"],
      screenFormat: ["3D"],
      dubLanguage: ["French"],
    });
    expect(decodeFilterMask("1")).toBeNull();
    expect(encodeFilterMask(2 ** 20)).toBeNull();
    expect(uncheckedFromFilterMask(2 ** 20)).toBeNull();
  });

  it("supports plain, shared, and edit route forms", () => {
    expect(parseMovieRouteCode("Ab1")).toEqual({
      kind: "plain",
      movieCode: "Ab1",
    });

    const sharedShortcut = encodeMovieRouteCode({
      movieCode: "Ab1",
      cityCode: "1",
      dateCode: "a",
      filterMask: 0,
      mode: "share",
    });
    expect(parseMovieRouteCode(sharedShortcut!)).toMatchObject({
      kind: "encoded",
      movieCode: "Ab1",
      cityCode: "1",
      dateCode: "a",
      filterMask: 0,
      mode: "share",
      usedFilterShortcut: true,
    });

    const editRoute = encodeMovieRouteCode({
      movieCode: "Ab1",
      cityCode: "i",
      dateCode: "b",
      filterMask: 4,
      mode: "edit",
    });
    expect(parseMovieRouteCode(editRoute!)).toMatchObject({
      mode: "edit",
      filterMask: 4,
      usedFilterShortcut: false,
    });
    expect(parseMovieRouteCode("Ab1i?j")).toBeNull();
    expect(
      encodeMovieRouteCode({
        movieCode: "too-long",
        cityCode: "1",
        dateCode: "a",
        filterMask: 0,
        mode: "share",
      }),
    ).toBeNull();
  });

  it("builds canonical URLs and resolves current versus explicit cities", () => {
    const url = buildMovieShowtimeShareUrl(
      {
        movieCode: "Ab1",
        city: "Jerusalem",
        date: "2026-09-16",
        filterMask: 0,
      },
      "https://example.test///",
    );

    expect(url).toMatch(/^https:\/\/example\.test\/Ab1/);
    expect(resolveCityCode("1", "Haifa")).toBe("Haifa");
    expect(resolveCityCode("i", "Haifa")).toBe("Jerusalem");
    expect(resolveCityCode("?", "Haifa")).toBeNull();
  });

  it("migrates legacy filter states and prefetches only near uncovered edges", () => {
    expect(
      migrateShowtimeFilterState({
        version: 1,
        unchecked: { screeningTech: ["3D", "IMAX", "IMAX"] },
      }),
    ).toEqual({
      version: 3,
      unchecked: {
        showType: [],
        screeningTech: ["IMAX"],
        screenFormat: ["3D"],
        dubLanguage: [],
      },
    });
    expect(migrateShowtimeFilterState({ version: 99 })).toBeNull();

    const covered = new Set(["2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(
      getTargetedShowtimePrefetchRange({
        previewDate: "2026-09-17",
        windowStartDate: "2026-09-16",
        windowEndDate: "2026-09-25",
        chunkDayCount: 5,
        triggerDayCount: 3,
        isDateCovered: (date) => covered.has(date),
      }),
    ).toEqual({ startDate: "2026-09-19", endDate: "2026-09-23" });
    expect(
      getTargetedShowtimePrefetchRange({
        previewDate: "2026-09-16",
        windowStartDate: "2026-09-16",
        windowEndDate: "2026-09-25",
        chunkDayCount: 5,
        triggerDayCount: 3,
        isDateCovered: () => false,
      }),
    ).toBeNull();
  });

  it("requires every filter dimension to match a showtime", () => {
    expect(
      isCanonicalShowtimeFilterMatch(
        {
          showTypeTokens: ["VIP"],
          screenFormatToken: "3D",
          screeningTechTokens: ["IMAX"],
          dubLanguage: "Original",
        },
        {
          showType: new Set(["VIP"]),
          screenFormat: new Set(["3D"]),
          screeningTech: new Set(["IMAX"]),
          dubLanguage: new Set(["Original"]),
        },
      ),
    ).toBe(true);
  });
});
