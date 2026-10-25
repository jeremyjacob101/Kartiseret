import { describe, expect, it } from "vitest";
import { orderNowPlayingRows } from "./now-playing-ranking.js";

function movie(
  tmdbId: number,
  popularity: number | null,
  showtimeCount: number,
  localReleaseDate: string | null,
) {
  return { tmdbId, popularity, showtimeCount, localReleaseDate };
}

describe("now-playing ranking", () => {
  it("gives popularity, showtime count, and release recency equal weight", () => {
    const rows = [
      movie(1, 30, 10, "2024-01-01"),
      movie(2, 10, 20, "2025-01-01"),
      movie(3, 20, 0, "2026-01-01"),
    ];

    expect(orderNowPlayingRows(rows).map((row) => row.tmdbId)).toEqual([
      1, 2, 3,
    ]);
  });

  it("uses each signal when the other two are tied", () => {
    expect(
      orderNowPlayingRows([
        movie(1, 10, 4, "2025-03-01"),
        movie(2, 20, 4, "2025-03-01"),
      ]).map((row) => row.tmdbId),
    ).toEqual([2, 1]);
    expect(
      orderNowPlayingRows([
        movie(1, 10, 1, "2025-03-01"),
        movie(2, 10, 2, "2025-03-01"),
      ]).map((row) => row.tmdbId),
    ).toEqual([2, 1]);
    expect(
      orderNowPlayingRows([
        movie(1, 10, 1, "2025-03-01"),
        movie(2, 10, 1, "2026-03-01"),
      ]).map((row) => row.tmdbId),
    ).toEqual([2, 1]);
  });

  it("scores missing release dates and NULL popularity at the bottom", () => {
    const rows = [movie(2, null, 1, null), movie(1, 0, 1, "2025-03-01")];

    expect(orderNowPlayingRows(rows).map((row) => row.tmdbId)).toEqual([1, 2]);
  });

  it("shares tied percentiles and breaks equal overall scores by numeric TMDb ID", () => {
    const rows = [movie(10, 5, 2, "2025-03-01"), movie(2, 5, 2, "2025-03-01")];

    expect(orderNowPlayingRows(rows).map((row) => row.tmdbId)).toEqual([2, 10]);

    expect(
      orderNowPlayingRows([
        movie(2, 10, 1, "2025-03-01"),
        movie(1, 10, 1, "2025-03-01"),
        movie(3, 20, 1, "2025-03-01"),
      ]).map((row) => row.tmdbId),
    ).toEqual([3, 1, 2]);
  });
});
