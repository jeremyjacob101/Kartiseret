import { describe, expect, it } from "vitest";
import { orderNowPlayingRows } from "./now-playing-ranking.js";

const instant = new Date("2026-10-26T12:00:00Z");

function movie(
  tmdbId: number,
  popularity: number | null,
  nearShowtimeCount: number,
  distantShowtimeCount: number,
  localReleaseDate: string | null,
) {
  return {
    tmdbId,
    popularity,
    nearShowtimeCount,
    distantShowtimeCount,
    localReleaseDate,
  };
}

function orderedIds(rows: ReturnType<typeof movie>[], at = instant) {
  return orderNowPlayingRows(rows, at).map((row) => row.tmdbId);
}

describe("now-playing ranking", () => {
  it("gives popularity, combined showtimes, and released-date recency equal weight", () => {
    // Each movie wins one signal, is second in another, and last in the third.
    // Matching window orders make the 90/10 split sum to one showtime signal.
    // All totals tie, so numeric IDs decide.
    expect(
      orderedIds([
        movie(3, 20, 0, 0, "2026-10-26"),
        movie(2, 10, 20, 20, "2025-01-01"),
        movie(1, 30, 10, 10, "2024-01-01"),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("uses each signal when the others tie", () => {
    expect(
      orderedIds([
        movie(1, 10, 4, 2, "2025-03-01"),
        movie(2, 20, 4, 2, "2025-03-01"),
      ]),
    ).toEqual([2, 1]);
    expect(
      orderedIds([
        movie(1, 10, 1, 2, "2025-03-01"),
        movie(2, 10, 2, 2, "2025-03-01"),
      ]),
    ).toEqual([2, 1]);
    expect(
      orderedIds([
        movie(1, 10, 2, 1, "2025-03-01"),
        movie(2, 10, 2, 2, "2025-03-01"),
      ]),
    ).toEqual([2, 1]);
    expect(
      orderedIds([
        movie(1, 10, 1, 2, "2025-03-01"),
        movie(2, 10, 1, 2, "2026-03-01"),
      ]),
    ).toEqual([2, 1]);
  });

  it("caps distant screenings at 10% of the showtime signal regardless of volume", () => {
    expect(
      orderedIds([
        movie(1, 10, 0, 1_000_000_000, "2026-10-01"),
        movie(2, 10, 1, 0, "2026-10-01"),
      ]),
    ).toEqual([2, 1]);
  });

  it("uses the 90/10 split even when near-term percentile differences are small", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      movie(index + 1, 10, index, index === 11 ? 0 : 1, null),
    );
    // Near-term ranks differ by 1/11; distant ranks differ by 6/11.
    // 0.9/11 beats 0.1 * 6/11. An 85/15 split would reverse them.
    expect(orderedIds(rows).slice(0, 2)).toEqual([12, 11]);
  });

  it("puts future dates at the same lowest recency rank as missing dates", () => {
    expect(
      orderedIds([
        movie(1, 10, 1, 1, "2026-12-17"),
        movie(2, 10, 1, 1, "2026-10-08"),
        movie(3, 10, 1, 1, null),
        movie(4, 10, 1, 1, "2026-10-26"),
      ]),
    ).toEqual([4, 2, 1, 3]);
  });

  it.each([
    ["2026-10-26T21:59:59Z", "2026-10-26T22:00:00Z", "2026-10-27"],
    ["2026-08-01T20:59:59Z", "2026-08-01T21:00:00Z", "2026-08-02"],
  ])(
    "starts recency credit at Israel midnight in winter and summer (%s)",
    (before, after, releaseDate) => {
      const rows = [
        movie(1, 10, 1, 1, releaseDate),
        movie(2, 10, 1, 1, "2026-01-01"),
      ];
      expect(orderedIds(rows, new Date(before))).toEqual([2, 1]);
      expect(orderedIds(rows, new Date(after))).toEqual([1, 2]);
    },
  );

  it("uses the database statement date to align recency and screening windows", () => {
    const rows = [
      { ...movie(1, 10, 1, 1, "2026-10-27"), rankingDate: "2026-10-26" },
      { ...movie(2, 10, 1, 1, "2026-10-25"), rankingDate: "2026-10-26" },
    ];
    expect(orderedIds(rows, new Date("2026-10-27T01:00:00Z"))).toEqual([2, 1]);
  });

  it("scores invalid and missing dates together and keeps NULL popularity below numeric zero", () => {
    expect(
      orderedIds([
        movie(3, 0, 0, 0, "2026-02-30"),
        movie(2, 0, 0, 0, null),
        movie(1, null, 0, 0, null),
      ]),
    ).toEqual([2, 3, 1]);
  });

  it("normalizes missing, negative, and nonfinite counts to zero", () => {
    expect(
      orderNowPlayingRows(
        [
          { tmdbId: 10 },
          { tmdbId: 3, nearShowtimeCount: -1, distantShowtimeCount: -10 },
          { tmdbId: 2, nearShowtimeCount: NaN, distantShowtimeCount: Infinity },
        ],
        instant,
      ).map((row) => row.tmdbId),
    ).toEqual([2, 3, 10]);
  });

  it("shares tied ranks, resolves final ties numerically, and leaves input order untouched", () => {
    const rows = [
      movie(10, 5, 2, 3, "2025-03-01"),
      movie(2, 5, 2, 3, "2025-03-01"),
    ];
    expect(orderedIds(rows)).toEqual([2, 10]);
    expect(rows.map((row) => row.tmdbId)).toEqual([10, 2]);
    expect(orderedIds([])).toEqual([]);
    expect(orderedIds([rows[0]!])).toEqual([10]);
  });
});
