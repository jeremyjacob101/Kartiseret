import { buildCinemathequeShowtimesByDate, isCinemathequeTheaterName } from "../src/data/cinematheques";
import type { ShowtimeCityData } from "../src/data/movieCatalog";
import { describe, expect, it } from "vitest";
import { sampleMovie } from "./fixtures";

describe("cinematheque showtimes", () => {
  it("recognizes the supported cinematheques without matching regular cinemas", () => {
    expect(isCinemathequeTheaterName("Jerusalem Cinematheque")).toBe(true);
    expect(isCinemathequeTheaterName("Jaffa Cinema")).toBe(true);
    expect(isCinemathequeTheaterName("Sam Spiegel Cinema - Jerusalem")).toBe(
      true,
    );
    expect(isCinemathequeTheaterName("Cinema City Jerusalem")).toBe(false);
    expect(isCinemathequeTheaterName("Lev Cinema")).toBe(false);
  });

  it("keeps only cinematheque screenings while preserving empty days", () => {
    const cityData = {
      broadVisibleDayCount: 2,
      movieShowtimesByTmdbId: {
        [sampleMovie.tmdbId]: [
          {
            date: "2026-10-25",
            theaters: [
              {
                theater: "Cinema City Jerusalem",
                showtimes: [
                  {
                    time: "18:00",
                    href: null,
                    screeningTech: "2D",
                    screeningType: "Regular",
                    dubLanguage: null,
                  },
                ],
              },
              {
                theater: "Jerusalem Cinematheque",
                showtimes: [
                  {
                    time: "20:00",
                    href: null,
                    screeningTech: "35mm",
                    screeningType: "Film",
                    dubLanguage: null,
                  },
                ],
              },
            ],
          },
          { date: "2026-10-26", theaters: [] },
        ],
      },
    } as ShowtimeCityData;

    expect(buildCinemathequeShowtimesByDate([sampleMovie], cityData)).toEqual([
      {
        date: "2026-10-25",
        movies: [
          {
            movie: sampleMovie,
            theaters: [
              {
                theater: "Jerusalem Cinematheque",
                showtimes: [
                  {
                    time: "20:00",
                    href: null,
                    screeningTech: "35mm",
                    screeningType: "Film",
                    dubLanguage: null,
                  },
                ],
              },
            ],
          },
        ],
      },
      { date: "2026-10-26", movies: [] },
    ]);
  });
});
