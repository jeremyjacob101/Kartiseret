import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { CatalogDatabaseError } from "../../src/catalog/errors.js";
import { PrismaCatalogRepository } from "../../src/catalog/prisma-repository.js";
import { createPrismaClient } from "../../src/prisma.js";

const connectionString = process.env.TEST_DATABASE_URL;
const runtimeConnectionString = process.env.DATABASE_URL;
if (!connectionString || !runtimeConnectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required; integration tests never skip.",
  );
}
const testTarget = new URL(connectionString);
const runtimeTarget = new URL(runtimeConnectionString);
if (
  !["localhost", "127.0.0.1", "::1"].includes(testTarget.hostname) ||
  decodeURIComponent(testTarget.pathname.replace(/^\/+/, "")) !==
    "kartiseret_test" ||
  testTarget.port !== runtimeTarget.port ||
  !["localhost", "127.0.0.1", "::1"].includes(runtimeTarget.hostname) ||
  decodeURIComponent(runtimeTarget.pathname.replace(/^\/+/, "")) !==
    "kartiseret_test"
) {
  throw new Error(
    "Integration tests only run against local disposable kartiseret_test.",
  );
}

const prisma = createPrismaClient(runtimeConnectionString, 2);
const adminPrisma = createPrismaClient(connectionString, 2);
const app = createApp({
  catalogRepository: new PrismaCatalogRepository(prisma),
});

describe("PostgreSQL 17 integration", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await adminPrisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await adminPrisma.$disconnect();
  });

  it("queries the bootstrapped schema and maps real Postgres catalog rows", async () => {
    const response = await request(app).get("/api/v1/catalog/now-playing");
    expect(response.status).toBe(200);
    expect(response.body.error).toBeNull();

    const movies = response.body.data.movies as Array<Record<string, unknown>>;
    const fixture = movies.find((movie) => movie.tmdbId === "9100001");
    expect(fixture).toMatchObject({
      movieCode: "D01",
      title: "Dev Catalog Film",
      year: 2024,
      genres: ["Drama", "Mystery"],
      imdbRating: 7.6,
      rtAudienceRating: 92,
      runtime: 118,
      altOptions: [
        {
          tmdbId: "9100002",
          title: "Alternate Dev Film",
          year: 2023,
          posterUrl: null,
        },
      ],
    });
    expect(movies.some((movie) => movie.tmdbId === "9100002")).toBe(false);
    expect(movies.find((movie) => movie.tmdbId === "9100003")).toMatchObject({
      genres: [],
    });
    expect(JSON.stringify(response.body)).not.toContain("BigInt");
  });

  it("confirms the runtime role can read only the public catalog slice", async () => {
    const visible = await prisma.finalMovie.findMany({
      where: { tmdbId: { in: [9100001, 9100002, 9100003] } },
      orderBy: { tmdbId: "asc" },
      select: { tmdbId: true, soloUpdate: true },
    });

    expect(visible.map((row) => row.tmdbId)).toEqual([
      9100001, 9100002, 9100003,
    ]);
    await expect(prisma.userPreference.findMany()).rejects.toThrow();
  });

  it("preserves PostgreSQL bigint, Decimal, date, and time mappings", async () => {
    const movieCode = await adminPrisma.movieCode.findUnique({
      where: { tmdbId: 9100001n },
    });
    expect(movieCode?.tmdbId).toBe(9100001n);

    const cinemathequeMovie = await adminPrisma.finalThequeMovie.findUnique({
      where: { tmdbId: 9100012 },
      select: { imdbRating: true, imdbVotes: true },
    });
    expect(cinemathequeMovie?.imdbRating?.toNumber()).toBe(7.1);
    expect(cinemathequeMovie?.imdbVotes).toBe(400n);

    const screening = await adminPrisma.finalShowtime.findUnique({
      where: { id: "00000000-0000-4000-8000-000000009001" },
      select: { dateOfShowing: true, showtime: true },
    });
    if (!screening) {
      throw new Error("The deterministic showtime fixture was not seeded.");
    }
    if (!screening.dateOfShowing || !screening.showtime) {
      throw new Error("The deterministic showtime fixture is incomplete.");
    }
    expect(screening.dateOfShowing).toBeInstanceOf(Date);
    expect(screening.dateOfShowing.toISOString()).toMatch(
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
    );
    expect(screening.showtime.toISOString().slice(11, 16)).toBe("19:30");
  });

  it("enforces SQL constraints and transaction rollback in real PostgreSQL", async () => {
    await expect(
      adminPrisma.$transaction(async (transaction) => {
        await transaction.utilRunLog.create({
          data: { runId: 9199999 },
        });
        throw new Error("rollback fixture transaction");
      }),
    ).rejects.toThrow("rollback fixture transaction");

    expect(
      await adminPrisma.utilRunLog.findUnique({ where: { runId: 9199999 } }),
    ).toBeNull();

    const rawClient = new Client({ connectionString });
    await rawClient.connect();
    try {
      await expect(
        rawClient.query(
          "INSERT INTO public.\"movieCodes\" (tmdb_id, movie_code) VALUES (9199999, 'bad')",
        ),
      ).rejects.toThrow();
      const absent = await rawClient.query(
        'SELECT tmdb_id FROM public."movieCodes" WHERE tmdb_id = 9199999',
      );
      expect(absent.rows).toHaveLength(0);
    } finally {
      await rawClient.end();
    }
  });

  it("keeps the actual Prisma repository failure distinct and safe", async () => {
    const failing = {
      findNowPlayingRows: async () => {
        throw new CatalogDatabaseError(new Error("private connection detail"));
      },
      findMovieCodes: async () => new Map<string, string>(),
    };
    const failingApp = createApp({ catalogRepository: failing });
    const response = await request(failingApp).get(
      "/api/v1/catalog/now-playing",
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain(
      "private connection detail",
    );
  });
});
