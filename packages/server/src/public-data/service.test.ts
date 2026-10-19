import { describe, expect, it, vi } from "vitest";
import { CatalogDataIntegrityError } from "../catalog/errors.js";
import type { PublicDataRepository } from "./repository.js";
import {
  getMovieByPermanentCode,
  getMovieCatalog,
  getPublicTheaterData,
  getShowtimeRange,
  getTicketAvailabilityShowtimes,
} from "./service.js";
import { PublicDataIntegrityError } from "./errors.js";

const nowPlaying = {
  tmdbId: 9100001,
  englishTitle: "Now Playing",
  releaseYear: 2026,
  genres: ["Drama"],
  enPoster: null,
  backdrop: "/now.jpg",
  enTrailer: null,
  imdbId: null,
  rtId: null,
  imdbRating: null,
  imdbVotes: null,
  rtAudienceRating: null,
  rtAudienceVotes: null,
  rtCriticRating: null,
  rtCriticVotes: null,
  lbId: null,
  lbRating: null,
  lbVotes: null,
  tmdbRating: null,
  tmdbVotes: null,
  runtime: null,
  popularity: 10,
  altOptions: [],
  soloUpdate: false,
};

const comingSoon = {
  tmdbId: 9100002,
  englishTitle: "Coming Soon",
  releaseYear: 2027,
  releaseDate: "2027-04-12",
  genres: null,
  enPoster: "/soon.jpg",
  backdrop: null,
  enTrailer: null,
  runtime: 100,
  popularity: 2,
  altOptions: [],
  soloUpdate: false,
};

const databaseShowtime = {
  tmdbId: 9100001,
  screeningCity: " Jerusalem ",
  dateOfShowing: "2026-10-20",
  cinema: " Cinema City ",
  showtime: "9:05:00",
  englishHref: "https://tickets.example/en",
  hebrewHref: "https://tickets.example/he",
  screeningTech: null,
  screeningType: null,
  dubLanguage: null,
};

function createRepository(
  overrides: Partial<PublicDataRepository> = {},
): PublicDataRepository {
  return {
    findNowPlayingRows: vi.fn(async () => [nowPlaying]),
    findMovieCodes: vi.fn(async () => new Map([["9100001", "Ab1"]])),
    findComingSoonRows: vi.fn(async () => [comingSoon]),
    findShowtimeRows: vi.fn(async () => [databaseShowtime]),
    findTicketAvailabilityRows: vi.fn(async () => [databaseShowtime]),
    findTheaterCityRows: vi.fn(async () => []),
    findMovieCodeByCode: vi.fn(async () => "9100001"),
    findNowPlayingMovieById: vi.fn(async () => nowPlaying),
    findComingSoonMovieById: vi.fn(async () => comingSoon),
    ...overrides,
  };
}

describe("public movie catalog service", () => {
  it("returns normalized, ordered movie data with one batched code lookup", async () => {
    const repository = createRepository({
      findNowPlayingRows: vi.fn(async () => [
        { ...nowPlaying, tmdbId: 9100002, popularity: null },
        { ...nowPlaying, tmdbId: 9100003, popularity: 0 },
        { ...nowPlaying, tmdbId: 9100001, soloUpdate: true },
      ]),
      findMovieCodes: vi.fn(async (ids) => {
        expect(ids).toEqual(["9100003", "9100002"]);
        return new Map([
          ["9100003", "Ab3"],
          ["9100002", "Ab2"],
        ]);
      }),
    });

    const result = await getMovieCatalog(repository, "nowPlaying");

    expect(result).toMatchObject({
      mode: "nowPlaying",
      movieCodesStatus: "ready",
      movies: [
        { tmdbId: "9100003", movieCode: "Ab3", popularity: 0 },
        { tmdbId: "9100002", movieCode: "Ab2", popularity: 0 },
      ],
    });
    expect(repository.findMovieCodes).toHaveBeenCalledTimes(1);
  });

  it("keeps a usable catalog and reports code lookup failure as a settled status", async () => {
    const lookupError = new Error("private database details");
    const onFailure = vi.fn();
    const repository = createRepository({
      findMovieCodes: vi.fn(async () => {
        throw lookupError;
      }),
    });

    const result = await getMovieCatalog(repository, "nowPlaying", onFailure);

    expect(result.movieCodesStatus).toBe("failed");
    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]?.movieCode).toBeUndefined();
    expect(onFailure).toHaveBeenCalledWith(lookupError);
  });

  it("orders coming-soon movies by date and popularity and excludes pending work", async () => {
    const repository = createRepository({
      findComingSoonRows: vi.fn(async () => [
        { ...comingSoon, tmdbId: 9100003, releaseDate: "2027-05-01" },
        {
          ...comingSoon,
          tmdbId: 9100002,
          releaseDate: "2027-04-12",
          popularity: 1,
        },
        {
          ...comingSoon,
          tmdbId: 9100001,
          releaseDate: "2027-04-12",
          popularity: 5,
        },
        { ...comingSoon, tmdbId: 9100004, soloUpdate: true },
      ]),
      findMovieCodes: vi.fn(async () => new Map()),
    });

    const result = await getMovieCatalog(repository, "comingSoon");

    expect(result.movies.map((movie) => movie.tmdbId)).toEqual([
      "9100001",
      "9100002",
      "9100003",
    ]);
    expect(result.movies[0]?.genres).toEqual([]);
    expect(result.movies[0]?.releaseDate).toBe("2027-04-12");
  });

  it("prefers a now-playing row when a permanent code exists in both catalogs", async () => {
    const repository = createRepository();
    await expect(
      getMovieByPermanentCode(repository, "Ab1"),
    ).resolves.toMatchObject({
      isComingSoon: false,
      movie: { tmdbId: "9100001", movieCode: "Ab1", title: "Now Playing" },
    });
    expect(repository.findNowPlayingMovieById).toHaveBeenCalledWith("9100001");
    expect(repository.findComingSoonMovieById).toHaveBeenCalledWith("9100001");
  });

  it("does not round a bigint code target beyond the movie-table integer range", async () => {
    const repository = createRepository({
      findMovieCodeByCode: vi.fn(async () => "9007199254740993"),
    });

    await expect(
      getMovieByPermanentCode(repository, "Ab1"),
    ).resolves.toBeNull();
    expect(repository.findNowPlayingMovieById).not.toHaveBeenCalled();
    expect(repository.findComingSoonMovieById).not.toHaveBeenCalled();
  });
});

describe("public showtime service", () => {
  it("preserves local wall time and filters invalid availability rows without limiting cities", async () => {
    const repository = createRepository({
      findTicketAvailabilityRows: vi.fn(async () => [
        databaseShowtime,
        { ...databaseShowtime, screeningCity: "Haifa" },
        { ...databaseShowtime, screeningCity: null },
        { ...databaseShowtime, englishHref: "not a URL", hebrewHref: null },
        { ...databaseShowtime, englishHref: "not a URL" },
      ]),
    });

    const result = await getTicketAvailabilityShowtimes(
      repository,
      "9100001",
      "2026-10-20",
    );

    expect(result).toEqual([
      {
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-20",
        cinema: "Cinema City",
        showtime: "09:05",
        englishHref: "https://tickets.example/en",
        hebrewHref: "https://tickets.example/he",
      },
      {
        screeningCity: "Haifa",
        dateOfShowing: "2026-10-20",
        cinema: "Cinema City",
        showtime: "09:05",
        englishHref: "https://tickets.example/en",
        hebrewHref: "https://tickets.example/he",
      },
      {
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-20",
        cinema: "Cinema City",
        showtime: "09:05",
        englishHref: null,
        hebrewHref: "https://tickets.example/he",
      },
    ]);
  });

  it("fails the showtime range for malformed stored local data", async () => {
    const repository = createRepository({
      findShowtimeRows: vi.fn(async () => [
        { ...databaseShowtime, showtime: "25:90" },
      ]),
    });
    await expect(
      getShowtimeRange(repository, {
        city: "Jerusalem",
        startDate: "2026-10-20",
        endDate: "2026-10-20",
      }),
    ).rejects.toBeInstanceOf(CatalogDataIntegrityError);
  });
});

describe("public theater service", () => {
  it("preserves cities without theaters and distinguishes orphaned joins", async () => {
    const repository = createRepository({
      findTheaterCityRows: vi.fn(async () => [
        {
          chain: null,
          address: null,
          location: null,
          theaterName: null,
          theaterLatitude: null,
          theaterLongitude: null,
          cityName: "Haifa",
          altSpellings: [],
          cityLatitude: 32.794,
          cityLongitude: 34.9896,
          zoomLayer: 11,
          neighboringCities: [],
        },
        {
          chain: "Cinema City",
          address: "1 Road",
          location: "https://tickets.example/theater",
          theaterName: "Cinema City Jerusalem",
          theaterLatitude: 31.77,
          theaterLongitude: 35.21,
          cityName: "Jerusalem",
          altSpellings: ["Yerushalayim"],
          cityLatitude: 31.7683,
          cityLongitude: 35.2137,
          zoomLayer: 10,
          neighboringCities: ["Mevaseret Zion"],
        },
      ]),
    });

    const result = await getPublicTheaterData(repository);
    expect(result.cities.map((item) => item.name)).toEqual([
      "Haifa",
      "Jerusalem",
    ]);
    expect(result.theaters).toHaveLength(1);

    const orphanedRepository = createRepository({
      findTheaterCityRows: vi.fn(async () => [
        {
          chain: "Cinema City",
          address: "1 Road",
          location: "https://tickets.example/theater",
          theaterName: "Cinema City",
          theaterLatitude: 31,
          theaterLongitude: 35,
          cityName: null,
          altSpellings: null,
          cityLatitude: null,
          cityLongitude: null,
          zoomLayer: null,
          neighboringCities: null,
        },
      ]),
    });
    await expect(
      getPublicTheaterData(orphanedRepository),
    ).rejects.toMatchObject({
      kind: "orphaned_theater",
    } satisfies Partial<PublicDataIntegrityError>);
  });
});
