import { describe, expect, it } from "vitest";
import { orderNowPlayingRows } from "./now-playing-ranking.js";
import { productionNowPlayingSnapshot } from "./now-playing-ranking.snapshot.js";

const instant = new Date("2026-10-26T12:00:00Z");

function movie(
  tmdbId: number,
  popularity: number | null,
  upcomingShowtimeCount: number,
  localReleaseDate: string | null,
  imdbRating: unknown = null,
  rtCriticRating: unknown = null,
) {
  return {
    tmdbId,
    popularity,
    upcomingShowtimeCount,
    localReleaseDate,
    imdbRating,
    rtCriticRating,
  };
}

function orderedIds(rows: ReturnType<typeof movie>[], at = instant) {
  return orderNowPlayingRows(rows, at).map((row) => row.tmdbId);
}

describe("now-playing ranking", () => {
  it("gives popularity, combined showtimes, and released-date recency equal weight", () => {
    // Popularity and showtime ranks offset each other; all release dates tie.
    // All three signals contribute equally, so numeric IDs decide.
    expect(
      orderedIds([
        movie(3, 20, 10, "2026-10-26"),
        movie(2, 10, 20, "2026-10-26"),
        movie(1, 30, 0, "2026-10-26"),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("uses each signal when the others tie", () => {
    expect(
      orderedIds([
        movie(1, 10, 4, "2026-10-26"),
        movie(2, 20, 4, "2026-10-26"),
      ]),
    ).toEqual([2, 1]);
    expect(
      orderedIds([
        movie(1, 10, 1, "2026-10-26"),
        movie(2, 10, 2, "2026-10-26"),
      ]),
    ).toEqual([2, 1]);
    expect(
      orderedIds([
        movie(1, 10, 2, "2026-10-27"),
        movie(2, 10, 2, "2026-10-26"),
      ]),
    ).toEqual([2, 1]);
  });

  it.each([
    ["two ratings below their cutoffs", 5.9, 59, 2],
    ["numeric string ratings", "5.9", "59", 2],
    ["a zero RT critics score", 5.9, 0, 2],
    ["IMDb exactly at its cutoff", 6.2, 59, 1],
    ["IMDb above its cutoff", 6.3, 59, 1],
    ["RT critics exactly at its cutoff", 5.9, 60, 1],
    ["RT critics above its cutoff", 5.9, 61, 1],
    ["missing IMDb rating", null, 59, 1],
    ["missing RT critics score", 5.9, null, 1],
    ["blank IMDb rating", " ", 59, 1],
    ["blank RT critics score", 5.9, "", 1],
    ["invalid IMDb rating", Number.NaN, 59, 1],
    ["invalid RT critics score", 5.9, Number.POSITIVE_INFINITY, 1],
    ["IMDb rating outside its scale", 11, 59, 1],
    ["RT critics score outside its scale", 5.9, 101, 1],
    ["non-numeric IMDb rating", true, 59, 1],
  ])(
    "applies the rating rule to %s",
    (_case, imdbRating, rtRating, position) => {
      const rows = Array.from({ length: 10 }, (_, index) => {
        const tmdbId = index + 1;
        const isTopMovie = tmdbId === 10;
        return movie(
          tmdbId,
          tmdbId,
          tmdbId,
          "2026-10-26",
          isTopMovie ? imdbRating : 7,
          isTopMovie ? rtRating : 80,
        );
      });

      expect(orderedIds(rows).indexOf(10) + 1).toBe(position);
    },
  );

  it("keeps existing order when no movie qualifies and resolves adjusted ties by ID", () => {
    expect(
      orderedIds([
        movie(3, 3, 3, "2026-10-26", 7, 90),
        movie(2, 2, 2, "2026-10-26", 6.2, 59),
        movie(1, 1, 1, "2026-10-26", 5.9, 60),
      ]),
    ).toEqual([3, 2, 1]);

    expect(
      orderedIds([
        movie(10, 5, 2, "2026-10-01", 5, 40),
        movie(2, 5, 2, "2026-10-01", 5, 40),
      ]),
    ).toEqual([2, 10]);
  });

  it("reproduces 12% rating-penalty positions from the 2026-11-11 production snapshot", () => {
    const rows = productionNowPlayingSnapshot.map(
      ([
        tmdbId,
        popularity,
        upcomingShowtimeCount,
        localReleaseDate,
        imdbRating,
        rtCriticRating,
      ]) => ({
        tmdbId,
        popularity,
        upcomingShowtimeCount,
        localReleaseDate,
        rankingDate: "2026-11-11",
        imdbRating,
        rtCriticRating,
      }),
    );
    const rankedIds = orderedIds(rows, new Date("2026-11-11T12:00:00Z"));
    const positionOf = (tmdbId: number) => rankedIds.indexOf(tmdbId) + 1;

    expect(rows).toHaveLength(161);
    expect(positionOf(1294189)).toBe(5); // The Mongoose
    expect(positionOf(1244523)).toBe(10); // Beware Boiúna
    expect(positionOf(1228834)).toBe(14); // The Fix
  });

  it("ranks one total count of upcoming showtimes", () => {
    expect(
      orderedIds([
        movie(1, 10, 1, "2026-10-26"),
        movie(2, 10, 1_000_000_000, "2026-10-26"),
      ]),
    ).toEqual([2, 1]);
  });

  it("scores dates closer to today higher, including upcoming and recent releases", () => {
    expect(
      orderedIds([
        movie(1, 10, 1, "2026-12-17"),
        movie(2, 10, 1, "2026-11-09"),
        movie(3, 10, 1, "2026-10-12"),
        movie(4, 10, 1, "2026-10-26"),
        movie(5, 10, 1, "2026-11-10"),
        movie(6, 10, 1, "2026-10-11"),
        movie(7, 10, 1, null),
      ]),
    ).toEqual([4, 2, 3, 5, 6, 1, 7]);
  });

  it("gives a slightly higher release-proximity score to each closer upcoming day", () => {
    expect(
      orderedIds([
        movie(3, 10, 1, "2026-10-29"),
        movie(2, 10, 1, "2026-10-28"),
        movie(1, 10, 1, "2026-10-27"),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it("keeps release proximity on the same normalized scale as percentile signals", () => {
    expect(
      orderedIds([
        movie(1, 20, 1, "2026-10-26"),
        movie(2, 30, 1, "2026-11-18"),
        movie(3, 10, 1, "2026-10-26"),
      ]),
    ).toEqual([1, 2, 3]);
  });

  it.each([
    [
      "2026-10-26T21:59:59Z",
      "2026-10-26T22:00:00Z",
      "2026-10-26",
      "2026-10-27",
    ],
    [
      "2026-08-01T20:59:59Z",
      "2026-08-01T21:00:00Z",
      "2026-08-01",
      "2026-08-02",
    ],
  ])(
    "uses Israel calendar days when measuring release proximity (%s)",
    (before, after, today, tomorrow) => {
      const rows = [movie(1, 10, 1, tomorrow), movie(2, 10, 1, today)];
      expect(orderedIds(rows, new Date(before))).toEqual([2, 1]);
      expect(orderedIds(rows, new Date(after))).toEqual([1, 2]);
    },
  );

  it("uses the database statement date to measure release proximity", () => {
    const rows = [
      { ...movie(1, 10, 1, "2026-10-26"), rankingDate: "2026-10-26" },
      { ...movie(2, 10, 1, "2026-10-27"), rankingDate: "2026-10-26" },
    ];
    expect(orderedIds(rows, new Date("2026-10-27T01:00:00Z"))).toEqual([1, 2]);
  });

  it("scores invalid and missing dates together and keeps NULL popularity below numeric zero", () => {
    expect(
      orderedIds([
        movie(3, 0, 0, "2026-02-30"),
        movie(2, 0, 0, null),
        movie(1, null, 0, null),
      ]),
    ).toEqual([2, 3, 1]);
  });

  it("normalizes missing, negative, and nonfinite counts to zero", () => {
    expect(
      orderNowPlayingRows(
        [
          { tmdbId: 10 },
          { tmdbId: 3, upcomingShowtimeCount: -1 },
          { tmdbId: 2, upcomingShowtimeCount: NaN },
        ],
        instant,
      ).map((row) => row.tmdbId),
    ).toEqual([2, 3, 10]);
  });

  it("shares tied ranks, resolves final ties numerically, and leaves input order untouched", () => {
    const rows = [movie(10, 5, 2, "2026-10-01"), movie(2, 5, 2, "2026-10-01")];
    expect(orderedIds(rows)).toEqual([2, 10]);
    expect(rows.map((row) => row.tmdbId)).toEqual([10, 2]);
    expect(orderedIds([])).toEqual([]);
    expect(orderedIds([rows[0]!])).toEqual([10]);
  });
});
