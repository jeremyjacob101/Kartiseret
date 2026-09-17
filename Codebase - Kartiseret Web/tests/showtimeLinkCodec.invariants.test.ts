import { DATE_CODE_ALPHABET, SHOWTIME_FILTER_BIT_COUNT, SHOWTIME_FILTER_BIT_ASSIGNMENTS, addCalendarDays, decodeBase62, decodeDateCode, decodeFilterMask, encodeBase62Fixed, encodeDateCode, encodeFilterMask, filterMaskFromUnchecked, isCanonicalShowtimeFilterMatch, isDateInShowtimeLinkWindow, isSupportedFilterMask, uncheckedFromFilterMask } from "../src/routing/showtimeLinkCodec";
import { describe, expect, it } from "vitest";

const today = "2026-09-16";
const dateCases = Array.from({ length: 62 }, (_, offset) => {
  const date = addCalendarDays(today, offset);
  if (!date) {
    throw new Error(`Unable to create fixture date for offset ${offset}`);
  }
  return [date, offset] as const;
});

const maskCases = [
  0,
  1,
  2 ** SHOWTIME_FILTER_BIT_COUNT - 1,
  ...Array.from(
    { length: 128 },
    (_, index) => (index * 7919) % 2 ** SHOWTIME_FILTER_BIT_COUNT,
  ),
];

describe("showtime codec property-style invariants", () => {
  it.each(dateCases)("round-trips every date in the supported 62-day window", (
    date,
  ) => {
    const code = encodeDateCode(date);

    expect(code).toHaveLength(1);
    expect(decodeDateCode(code!, today)).toBe(date);
    expect(isDateInShowtimeLinkWindow(date, today)).toBe(true);
  });

  it("uses every character exactly once in the date alphabet over a complete window", () => {
    const codes = dateCases.map(([date]) => encodeDateCode(date));
    expect(new Set(codes)).toHaveProperty("size", DATE_CODE_ALPHABET.length);
    expect(new Set(codes).size).toBe(DATE_CODE_ALPHABET.length);
  });

  it.each(maskCases.map((mask) => [mask] as const))(
    "round-trips supported filter mask %s through base62 and unchecked values",
    (mask) => {
      expect(isSupportedFilterMask(mask)).toBe(true);
      const encoded = encodeFilterMask(mask);
      const unchecked = uncheckedFromFilterMask(mask);

      expect(encoded).toHaveLength(4);
      expect(decodeFilterMask(encoded!)).toBe(mask);
      expect(unchecked).not.toBeNull();
      expect(filterMaskFromUnchecked(unchecked!)).toBe(mask);
    },
  );

  it.each(SHOWTIME_FILTER_BIT_ASSIGNMENTS.map(({ bit }) => [bit] as const))(
    "keeps each individual filter assignment isolated at bit %s",
    (bit) => {
      const mask = 2 ** bit;
      const unchecked = uncheckedFromFilterMask(mask);

      expect(unchecked).not.toBeNull();
      expect(filterMaskFromUnchecked(unchecked!)).toBe(mask);
    },
  );

  it.each([
    ["", null],
    ["0!", null],
    ["-1", null],
    ["1.5", null],
    ["1e?", null],
    ["!", null],
    ["0".repeat(100), null],
  ] as const)("rejects malformed base62 values (%s)", (value, expected) => {
    expect(decodeBase62(value)).toBe(expected);
  });

  it.each([
    [-1, 4],
    [Number.MAX_SAFE_INTEGER, 4],
    [0, 0],
    [0, -1],
    [0, 1.5],
    [62, 1],
  ] as const)("rejects unsafe fixed-width encodings (%s, %s)", (
    value,
    width,
  ) => {
    expect(encodeBase62Fixed(value, width)).toBeNull();
  });

  it.each([
    ["2026-09-15", today, false],
    ["2026-11-18", today, false],
    ["2026-02-30", today, false],
    [today, "2026-02-30", false],
  ] as const)("rejects dates outside a canonical forward window (%s, %s)", (
    date,
    base,
    expected,
  ) => {
    expect(isDateInShowtimeLinkWindow(date, base)).toBe(expected);
  });

  it("requires every canonical filter dimension to match independently", () => {
    const metadata = {
      showTypeTokens: ["VIP"],
      screenFormatToken: "3D",
      screeningTechTokens: ["IMAX"],
      dubLanguage: "Original",
    };
    const selections = {
      showType: new Set(["VIP"]),
      screenFormat: new Set(["3D"]),
      screeningTech: new Set(["IMAX"]),
      dubLanguage: new Set(["Original"]),
    };

    expect(isCanonicalShowtimeFilterMatch(metadata, selections)).toBe(true);
    expect(
      isCanonicalShowtimeFilterMatch(metadata, {
        ...selections,
        showType: new Set(),
      }),
    ).toBe(false);
    expect(
      isCanonicalShowtimeFilterMatch(metadata, {
        ...selections,
        screenFormat: new Set(["2D"]),
      }),
    ).toBe(false);
    expect(
      isCanonicalShowtimeFilterMatch(metadata, {
        ...selections,
        screeningTech: new Set(),
      }),
    ).toBe(false);
    expect(
      isCanonicalShowtimeFilterMatch(metadata, {
        ...selections,
        dubLanguage: new Set(["French"]),
      }),
    ).toBe(false);
    expect(
      isCanonicalShowtimeFilterMatch(
        { ...metadata, showTypeTokens: [] },
        selections,
      ),
    ).toBe(false);
  });
});
