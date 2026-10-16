import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { CatalogDatabaseError } from "./catalog/errors.js";
import type { CatalogRepository } from "./catalog/service.js";

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
});
