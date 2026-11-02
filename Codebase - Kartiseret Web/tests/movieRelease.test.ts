import { filterMoviesByReleaseCategory, getMovieReleaseCategory } from "../src/domain/movieRelease";
import { describe, expect, it } from "vitest";

describe("movie release categories", () => {
  it("uses a three-calendar-year cutoff", () => {
    expect(getMovieReleaseCategory({ year: 2023 }, 2026)).toBe("reReleases");
    expect(getMovieReleaseCategory({ year: 2024 }, 2026)).toBe("newReleases");
    expect(getMovieReleaseCategory({ year: 2026 }, 2026)).toBe("newReleases");
  });

  it("moves the cutoff forward with the current year", () => {
    expect(getMovieReleaseCategory({ year: 2024 }, 2027)).toBe("reReleases");
    expect(getMovieReleaseCategory({ year: 2025 }, 2027)).toBe("newReleases");
  });

  it("keeps unknown years in New Releases", () => {
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
