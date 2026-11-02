import { buildCinemathequeSchedule, buildCinemathequeShowtimesByDate, isCinemathequeTheaterName } from "../src/data/cinematheques";
import type { PublicShowtime } from "@kartiseret/contracts/public-data";
import { describe, expect, it } from "vitest";
import { sampleMovie } from "./fixtures";

describe("cinematheque showtimes", () => {
  it("groups future screenings by date and separate cinema", () => {
    const row: PublicShowtime = {
      tmdbId: sampleMovie.tmdbId,
      screeningCity: "Tel Aviv",
      dateOfShowing: "2028-01-01",
      cinema: "Tel Aviv Cinematheque",
      showtime: "20:00",
      englishHref: null,
      hebrewHref: null,
      screeningTech: "2D",
      screeningType: "Regular",
      dubLanguage: null,
    };
    const result = buildCinemathequeSchedule(
      [sampleMovie],
      [
        row,
        { ...row, cinema: "Jaffa Cinema" },
        { ...row, dateOfShowing: "2027-01-01" },
      ],
    );
    expect(result.map((day) => day.date)).toEqual(["2027-01-01", "2028-01-01"]);
    expect(result[1]?.cinemas.map((cinema) => cinema.cinema)).toEqual([
      "Jaffa Cinema",
      "Tel Aviv Cinematheque",
    ]);
    expect(
      result[1]?.cinemas.every((cinema) => cinema.movies.length === 1),
    ).toBe(true);
  });

  it("recognizes the supported cinematheques without matching regular cinemas", () => {
    expect(isCinemathequeTheaterName("Jerusalem Cinematheque")).toBe(true);
    expect(isCinemathequeTheaterName("Jaffa Cinema")).toBe(true);
    expect(isCinemathequeTheaterName("Sam Spiegel Cinema - Jerusalem")).toBe(
      true,
    );
    expect(isCinemathequeTheaterName("Cinema City Jerusalem")).toBe(false);
    expect(isCinemathequeTheaterName("Lev Cinema")).toBe(false);
  });

  it("groups dedicated API screenings and retains dates without screenings", () => {
    const secondMovie = { ...sampleMovie, tmdbId: "9100002", title: "Second" };
    const rows: PublicShowtime[] = [
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-25",
        cinema: "Cinema City Jerusalem",
        showtime: "18:00",
        englishHref: null,
        hebrewHref: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-25",
        cinema: "Jerusalem Cinematheque",
        showtime: "20:00",
        englishHref: "https://tickets.example.test/en",
        hebrewHref: null,
        screeningTech: "35mm",
        screeningType: "Film",
        dubLanguage: null,
      },
      {
        tmdbId: secondMovie.tmdbId,
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-27",
        cinema: "Jaffa Cinema",
        showtime: "19:30",
        englishHref: null,
        hebrewHref: "https://tickets.example.test/he",
        screeningTech: "DCP",
        screeningType: "Special",
        dubLanguage: "Hebrew",
      },
    ];

    expect(
      buildCinemathequeShowtimesByDate([sampleMovie, secondMovie], rows, [
        "2026-10-25",
        "2026-10-26",
        "2026-10-27",
      ]),
    ).toEqual([
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
                    href: "https://tickets.example.test/en",
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
      {
        date: "2026-10-27",
        movies: [
          {
            movie: secondMovie,
            theaters: [
              {
                theater: "Jaffa Cinema",
                showtimes: [
                  {
                    time: "19:30",
                    href: "https://tickets.example.test/he",
                    screeningTech: "DCP",
                    screeningType: "Special",
                    dubLanguage: "Hebrew",
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });
});
