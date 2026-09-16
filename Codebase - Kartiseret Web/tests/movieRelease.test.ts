import { describe, expect, it } from "vitest";
import { filterMoviesByReleaseCategory, getMovieReleaseCategory, isMovieReRelease } from "../src/domain/movieRelease";

describe("movie release categories", () => {
  it("uses the three-calendar-year boundary", () => {
    expect(isMovieReRelease({ year: 2023 }, 2026)).toBe(true);
    expect(isMovieReRelease({ year: 2024 }, 2026)).toBe(false);
    expect(isMovieReRelease({ year: 2026 }, 2026)).toBe(false);
  });

  it("moves the boundary forward with the calendar year", () => {
    expect(getMovieReleaseCategory({ year: 2024 }, 2027)).toBe("reReleases");
    expect(getMovieReleaseCategory({ year: 2025 }, 2027)).toBe("newReleases");
  });

  it("keeps unknown years in the new-release bucket", () => {
    const movies = [{ year: 0 }, { year: 2023 }, { year: 2026 }];

    expect(filterMoviesByReleaseCategory(movies, "newReleases", 2026)).toEqual([
      { year: 0 },
      { year: 2026 },
    ]);
    expect(filterMoviesByReleaseCategory(movies, "reReleases", 2026)).toEqual([
      { year: 2023 },
    ]);
  });
});
