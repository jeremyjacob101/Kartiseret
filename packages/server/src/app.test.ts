import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { CatalogDatabaseError } from "./catalog/errors.js";
import type { CatalogRepository } from "./catalog/service.js";
import type { PublicDataRepository } from "./public-data/repository.js";

const validMovie = {
  tmdbId: 9100001,
  englishTitle: "A Dev Film",
  releaseYear: 2024n,
  genres: ["Drama", "Drama"],
  enPoster: "/poster.jpg",
  backdrop: "/backdrop.jpg",
  enTrailer: "trailer",
  imdbId: "tt1234567",
  rtId: null,
  imdbRating: 7.4,
  imdbVotes: "120",
  rtAudienceRating: "92%",
  rtAudienceVotes: "35",
  rtCriticRating: null,
  rtCriticVotes: null,
  lbId: null,
  lbRating: 4.1,
  lbVotes: 18,
  tmdbRating: 81,
  tmdbVotes: 88,
  runtime: 118.8,
  popularity: 22.1,
  altOptions: [
    { tmdb: 9100002, title: "Alternative", year: "2023", poster_url: null },
  ],
  soloUpdate: false,
};

function createRepository(
  rows: readonly unknown[] = [validMovie],
  movieCodes: ReadonlyMap<string, string> = new Map([["9100001", "Ab1"]]),
): CatalogRepository {
  return {
    findNowPlayingRows: vi.fn(async () => rows),
    findMovieCodes: vi.fn(async () => movieCodes),
  };
}

const comingSoonMovie = {
  tmdbId: 9100002,
  englishTitle: "A Coming Film",
  releaseYear: 2027,
  releaseDate: "2027-04-12",
  genres: null,
  enPoster: null,
  backdrop: "/coming.jpg",
  enTrailer: null,
  runtime: null,
  popularity: 4.2,
  altOptions: [],
  soloUpdate: false,
};

const showtime = {
  tmdbId: 9100001,
  screeningCity: "Jerusalem",
  dateOfShowing: "2026-10-20",
  cinema: "Cinema City",
  showtime: "9:05:00",
  englishHref: "https://tickets.example/en",
  hebrewHref: "https://tickets.example/he",
  screeningTech: "2D",
  screeningType: "Regular",
  dubLanguage: null,
};

const city = {
  name: "Jerusalem",
  altSpellings: ["Yerushalayim"],
  latitude: 31.7683,
  longitude: 35.2137,
  zoomLayer: 10,
  neighboringCities: ["Mevaseret Zion"],
};

function createPublicDataRepository(
  overrides: Partial<PublicDataRepository> = {},
): PublicDataRepository {
  const catalog = createRepository();
  return {
    ...catalog,
    findComingSoonRows: vi.fn(async () => [comingSoonMovie]),
    findShowtimeRows: vi.fn(async () => [showtime]),
    findTicketAvailabilityRows: vi.fn(async () => [showtime]),
    findTheaterCityRows: vi.fn(async () => [
      {
        chain: "Cinema City",
        address: "1 Cinema Road",
        location: "https://tickets.example/theater",
        theaterName: "Cinema City Jerusalem",
        theaterLatitude: 31.77,
        theaterLongitude: 35.21,
        cityName: city.name,
        altSpellings: city.altSpellings,
        cityLatitude: city.latitude,
        cityLongitude: city.longitude,
        zoomLayer: city.zoomLayer,
        neighboringCities: city.neighboringCities,
      },
    ]),
    findMovieCodeByCode: vi.fn(async () => "9100001"),
    findNowPlayingMovieById: vi.fn(async () => validMovie),
    findComingSoonMovieById: vi.fn(async () => comingSoonMovie),
    ...overrides,
  };
}

describe("Express API composition", () => {
  it("is importable without listening and serves liveness", async () => {
    const repository = createRepository();
    const app = createApp({ catalogRepository: repository });
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" }, error: null });
    expect(repository.findNowPlayingRows).not.toHaveBeenCalled();
  });

  it("returns a normalized JSON-safe catalog row, including BigInt and legacy text ratings", async () => {
    const response = await request(
      createApp({ catalogRepository: createRepository() }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        mode: "nowPlaying",
        movieCodesStatus: "ready",
        movies: [
          expect.objectContaining({
            tmdbId: "9100001",
            movieCode: "Ab1",
            title: "A Dev Film",
            year: 2024,
            genres: ["Drama"],
            rtAudienceRating: 92,
            runtime: 118,
            altOptions: [
              {
                tmdbId: "9100002",
                title: "Alternative",
                year: 2023,
                posterUrl: null,
              },
            ],
          }),
        ],
      },
      error: null,
    });
    expect(JSON.stringify(response.body)).not.toContain("n,");
  });

  it("returns an empty successful catalog when there are no rows", async () => {
    const response = await request(
      createApp({ catalogRepository: createRepository([], new Map()) }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(200);
    expect(response.body.data.movies).toEqual([]);
  });

  it("excludes pending solo-update records even when a repository returns them", async () => {
    const response = await request(
      createApp({
        catalogRepository: createRepository([
          { ...validMovie, tmdbId: 9100002, soloUpdate: true },
          validMovie,
        ]),
      }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(200);
    expect(
      response.body.data.movies.map(
        (movie: { tmdbId: string }) => movie.tmdbId,
      ),
    ).toEqual(["9100001"]);
  });

  it("rejects unsupported query input with a safe 400 response", async () => {
    const response = await request(
      createApp({ catalogRepository: createRepository() }),
    ).get("/api/v1/catalog/now-playing?limit=abc");

    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({
      code: "invalid_request",
      message: "The request query is not supported.",
    });
  });

  it("returns a safe 503 when the database repository fails", async () => {
    const logger = { error: vi.fn() };
    const failedRepository: CatalogRepository = {
      findNowPlayingRows: async () => {
        throw new CatalogDatabaseError(new Error("secret connection string"));
      },
      findMovieCodes: async () => new Map(),
    };
    const response = await request(
      createApp({ catalogRepository: failedRepository, logger }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs nested driver codes without logging database error messages", async () => {
    const logger = { error: vi.fn() };
    const driverError = Object.assign(new Error("secret database message"), {
      code: "SELF_SIGNED_CERT_IN_CHAIN",
    });
    const drizzleError = Object.assign(new Error("Failed query: secret SQL"), {
      cause: driverError,
    });
    const failedRepository: CatalogRepository = {
      findNowPlayingRows: async () => {
        throw new CatalogDatabaseError(drizzleError);
      },
      findMovieCodes: async () => new Map(),
    };

    const response = await request(
      createApp({ catalogRepository: failedRepository, logger }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      "Catalog database query failed.",
      {
        name: "Error",
        cause: { name: "Error", code: "SELF_SIGNED_CERT_IN_CHAIN" },
      },
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
  });

  it("returns a safe error for malformed database row data", async () => {
    const response = await request(
      createApp({
        catalogRepository: createRepository([
          { ...validMovie, englishTitle: "  " },
        ]),
      }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("invalid_catalog_data");
  });

  it("returns JSON 404s for unknown API routes instead of SPA HTML", async () => {
    const response = await request(
      createApp({ catalogRepository: createRepository() }),
    ).get("/api/not-a-route");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body.error.code).toBe("not_found");
  });

  it("rejects malformed JSON bodies safely", async () => {
    const response = await request(
      createApp({ catalogRepository: createRepository() }),
    )
      .post("/api/v1/catalog/now-playing")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
  });

  it("keeps catalog rows usable and reports failed code lookup as a completed state", async () => {
    const logger = { error: vi.fn() };
    const repository = createPublicDataRepository({
      findMovieCodes: vi.fn(async () => {
        throw new CatalogDatabaseError(new Error("private database detail"));
      }),
    });

    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
        logger,
      }),
    ).get("/api/v1/catalog/now-playing");

    expect(response.status).toBe(200);
    expect(response.body.data.movieCodesStatus).toBe("failed");
    expect(response.body.data.movies).toHaveLength(1);
    expect(response.body.data.movies[0].movieCode).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(
      "private database detail",
    );
    expect(logger.error).toHaveBeenCalled();
  });

  it("returns the coming-soon catalog and preserves nullable genre normalization", async () => {
    const repository = createPublicDataRepository({
      findMovieCodes: vi.fn(async () => new Map([["9100002", "So1"]])),
    });
    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
      }),
    ).get("/api/v1/catalog/coming-soon");

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ mode: "comingSoon" });
    expect(response.body.data.movies[0]).toMatchObject({
      tmdbId: "9100002",
      movieCode: "So1",
      title: "A Coming Film",
      year: 2027,
      releaseDate: "2027-04-12",
      genres: [],
    });
  });

  it("normalizes bounded showtime responses without timezone-shifting local time", async () => {
    const repository = createPublicDataRepository();
    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
      }),
    ).get(
      "/api/v1/showtimes?city=Jerusalem&startDate=2026-10-20&endDate=2026-10-21&tmdbId=9100001",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.showtimes[0]).toEqual({
      ...showtime,
      tmdbId: "9100001",
      showtime: "09:05",
    });
    expect(repository.findShowtimeRows).toHaveBeenCalledWith({
      city: "Jerusalem",
      startDate: "2026-10-20",
      endDate: "2026-10-21",
      tmdbId: "9100001",
    });
  });

  it.each([
    "city=Jerusalem&startDate=2026-10-20&endDate=2026-10-19",
    "city=Jerusalem&startDate=2026-02-30&endDate=2026-03-01",
    "city=&startDate=2026-10-20&endDate=2026-10-21",
    "city=Jerusalem&startDate=2026-10-20&endDate=2027-05-01",
    "city=Jerusalem&startDate=2026-10-20&endDate=2026-10-21&tmdbId=2147483648",
  ])("rejects invalid or oversized showtime query %s", async (query) => {
    const repository = createPublicDataRepository();
    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
      }),
    ).get(`/api/v1/showtimes?${query}`);

    expect(response.status).toBe(400);
    expect(repository.findShowtimeRows).not.toHaveBeenCalled();
  });

  it("rejects extra query fields for theater data instead of ignoring them", async () => {
    const repository = createPublicDataRepository();
    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
      }),
    ).get("/api/v1/theaters?limit=10");

    expect(response.status).toBe(400);
    expect(repository.findTheaterCityRows).not.toHaveBeenCalled();
  });

  it("returns cities without theaters and their theater metadata in one API DTO", async () => {
    const repository = createPublicDataRepository({
      findTheaterCityRows: vi.fn(async () => [
        {
          chain: "Cinema City",
          address: "1 Cinema Road",
          location: "https://tickets.example/theater",
          theaterName: "Cinema City Jerusalem",
          theaterLatitude: 31.77,
          theaterLongitude: 35.21,
          cityName: city.name,
          altSpellings: city.altSpellings,
          cityLatitude: city.latitude,
          cityLongitude: city.longitude,
          zoomLayer: city.zoomLayer,
          neighboringCities: city.neighboringCities,
        },
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
      ]),
    });
    const response = await request(
      createApp({
        catalogRepository: repository,
        publicDataRepository: repository,
      }),
    ).get("/api/v1/theaters");

    expect(response.status).toBe(200);
    expect(
      response.body.data.cities.map((item: { name: string }) => item.name),
    ).toEqual(["Haifa", "Jerusalem"]);
    expect(response.body.data.theaters).toHaveLength(1);
    expect(response.body.data.theaters[0]).toMatchObject({
      chain: "Cinema City",
      city: { name: "Jerusalem", neighboringCities: ["Mevaseret Zion"] },
      lat: 31.77,
      lng: 35.21,
    });
  });

  it("rejects an orphaned theater and invalid city metadata with actionable error codes", async () => {
    for (const [row, code] of [
      [
        {
          chain: "Cinema City",
          address: "1 Road",
          location: "https://example.test/theater",
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
        "orphaned_theater",
      ],
      [
        {
          chain: null,
          address: null,
          location: null,
          theaterName: null,
          theaterLatitude: null,
          theaterLongitude: null,
          cityName: "Jerusalem",
          altSpellings: null,
          cityLatitude: null,
          cityLongitude: null,
          zoomLayer: null,
          neighboringCities: null,
        },
        "invalid_city_metadata",
      ],
    ] as const) {
      const repository = createPublicDataRepository({
        findTheaterCityRows: vi.fn(async () => [row]),
      });
      const response = await request(
        createApp({
          catalogRepository: repository,
          publicDataRepository: repository,
        }),
      ).get("/api/v1/theaters");

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe(code);
    }
  });

  it("provides all-city ticket candidates and keeps invalid-query failures safe", async () => {
    const repository = createPublicDataRepository();
    const app = createApp({
      catalogRepository: repository,
      publicDataRepository: repository,
    });
    const response = await request(app).get(
      "/api/v1/ticket-availability?tmdbId=9100001&fromDate=2026-10-20",
    );

    expect(response.status).toBe(200);
    expect(response.body.data.showtimes).toEqual([
      {
        screeningCity: "Jerusalem",
        dateOfShowing: "2026-10-20",
        cinema: "Cinema City",
        showtime: "09:05",
        englishHref: "https://tickets.example/en",
        hebrewHref: "https://tickets.example/he",
      },
    ]);
    expect(repository.findTicketAvailabilityRows).toHaveBeenCalledWith(
      "9100001",
      "2026-10-20",
    );

    const invalidResponse = await request(app).get(
      "/api/v1/ticket-availability?tmdbId=9100001&fromDate=2026-02-30",
    );
    expect(invalidResponse.status).toBe(400);
  });
});
