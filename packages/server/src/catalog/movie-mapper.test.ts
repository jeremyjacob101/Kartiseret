import { describe, expect, it } from "vitest";
import { toComingSoonMovie, toNowPlayingMovie } from "./movie-mapper.js";
import { createSocialPreviewFingerprint } from "../social-preview.js";

const record = {
  tmdbId: 9100001,
  englishTitle: '  "Feature   Film" ',
  releaseYear: 2024n,
  genres: [" Drama ", "Drama", ""],
  enPoster: null,
  backdrop: "/backdrop.jpg",
  enTrailer: null,
  imdbId: "tt1234567",
  rtId: null,
  imdbRating: "7.5",
  imdbVotes: "125",
  rtAudienceRating: "93%",
  rtAudienceVotes: "18",
  rtCriticRating: null,
  rtCriticVotes: null,
  lbId: null,
  lbRating: "4.0",
  lbVotes: "2",
  tmdbRating: 81,
  tmdbVotes: "1000",
  runtime: 122.9,
  popularity: 0,
  altOptions: [
    { tmdb: "9100002", title: " Other film ", year: 2025, poster_url: null },
  ],
  soloUpdate: false,
};

const posterPath = `/api/images/v1/poster/${"a".repeat(64)}/342.webp`;
const backdropPath = `/api/images/v1/backdrop/${"b".repeat(64)}/1280.webp`;
const productionDelivery = {
  VERCEL_ENV: "production",
  R2_BUCKET: "kartiseret-artwork-prod",
  ARTWORK_DELIVERY_ORIGIN: "https://img.seret.site",
};

describe("toNowPlayingMovie", () => {
  it("normalizes the observed mixed row types into the shared DTO", () => {
    expect(toNowPlayingMovie(record, "Ab1")).toMatchObject({
      tmdbId: "9100001",
      movieCode: "Ab1",
      title: "Feature Film",
      year: 2024,
      genres: ["Drama"],
      imageSrc: "/backdrop.jpg",
      backdropSrc: "/backdrop.jpg",
      imdbRating: 7.5,
      rtAudienceRating: 93,
      runtime: 122,
      popularity: 0,
      altOptions: [
        {
          tmdbId: "9100002",
          title: "Other film",
          year: 2025,
          posterUrl: null,
        },
      ],
    });
  });

  it("turns nullable genres into an empty JSON-safe list and omits missing codes", () => {
    expect(toNowPlayingMovie({ ...record, genres: null })).toMatchObject({
      genres: [],
      movieCode: undefined,
    });
  });

  it("adds responsive variants only for app artwork URLs", () => {
    const movie = toNowPlayingMovie({
      ...record,
      enPoster: `https://seret.site/api/images/v1/poster/${"a".repeat(64)}/342.webp`,
      backdrop: `https://seret.site/api/images/v1/backdrop/${"b".repeat(64)}/1280.webp`,
    });
    expect(movie.imageSrcSet).toContain("/185.webp 185w");
    expect(movie.imageSrcSet).toContain("/780.webp 780w");
    expect(movie.backdropSrcSet).toContain("/780.webp 780w");
    expect(movie.backdropSrcSet).toContain("/1280.webp 1280w");
    expect(toNowPlayingMovie(record).imageSrcSet).toBeUndefined();
  });

  it("uses the production R2 origin for the source and all responsive variants without invalidating social cards", () => {
    const source = {
      ...record,
      enPoster: `https://seret.site${posterPath}`,
      backdrop: backdropPath,
    };
    const fingerprint = createSocialPreviewFingerprint({
      tmdbId: "9100001",
      title: "Feature Film",
      posterUrl: source.enPoster,
      backdropUrl: source.backdrop,
      isComingSoon: false,
      year: 2024,
      releaseDate: null,
      runtime: 122,
      genres: ["Drama"],
      imdbRating: 7.5,
      rtCriticRating: null,
      rtCriticVotes: null,
      rtAudienceRating: 93,
      rtAudienceVotes: 18,
      lbRating: 4,
    });
    const movie = toNowPlayingMovie(
      { ...source, socialPreviewFingerprint: fingerprint },
      "Ab1",
      productionDelivery,
    );
    const origin = productionDelivery.ARTWORK_DELIVERY_ORIGIN;
    const posterBase = `${origin}/artwork/v1/poster/${"a".repeat(64)}`;
    const backdropBase = `${origin}/artwork/v1/backdrop/${"b".repeat(64)}`;
    expect(movie).toMatchObject({
      imageSrc: `${posterBase}/342.webp`,
      imageSrcSet: `${posterBase}/185.webp 185w, ${posterBase}/342.webp 342w, ${posterBase}/780.webp 780w`,
      backdropSrc: `${backdropBase}/1280.webp`,
      backdropSrcSet: `${backdropBase}/780.webp 780w, ${backdropBase}/1280.webp 1280w`,
      socialPreviewFingerprint: fingerprint,
    });
  });

  it.each([
    {},
    { ...productionDelivery, VERCEL_ENV: "preview" },
    { ...productionDelivery, R2_BUCKET: "kartiseret-artwork-dev" },
    { ...productionDelivery, ARTWORK_DELIVERY_ORIGIN: "http://img.seret.site" },
    {
      ...productionDelivery,
      ARTWORK_DELIVERY_ORIGIN: "https://img.seret.site/",
    },
  ])(
    "keeps the legacy route if direct delivery is disabled or mismatched (%j)",
    (environment) => {
      const movie = toNowPlayingMovie(
        { ...record, enPoster: posterPath },
        undefined,
        environment,
      );
      expect(movie.imageSrc).toBe(posterPath);
      expect(movie.imageSrcSet).toContain(`${posterPath} 342w`);
    },
  );

  it.each([
    "https://image.tmdb.org/t/p/w342/source.jpg",
    `https://external.example${posterPath}`,
    posterPath.replace("342.webp", "0342.webp"),
    posterPath.replace("342.webp", "800.webp"),
    posterPath.replace("342.webp", "342.webp?modified=1"),
  ])("does not rewrite an external or invalid source (%s)", (source) => {
    const movie = toNowPlayingMovie(
      { ...record, enPoster: source },
      undefined,
      productionDelivery,
    );
    expect(movie.imageSrc).toBe(source);
    expect(movie.imageSrcSet ?? "").not.toContain("img.seret.site");
  });

  it("exposes a stored social card only when it matches the current rendered data", () => {
    const fingerprint = createSocialPreviewFingerprint({
      tmdbId: "9100001",
      title: "Feature Film",
      posterUrl: "/backdrop.jpg",
      backdropUrl: "/backdrop.jpg",
      isComingSoon: false,
      year: 2024,
      releaseDate: null,
      runtime: 122,
      genres: ["Drama"],
      imdbRating: 7.5,
      rtCriticRating: null,
      rtCriticVotes: null,
      rtAudienceRating: 93,
      rtAudienceVotes: 18,
      lbRating: 4,
    });
    const current = toNowPlayingMovie({
      ...record,
      socialPreviewFingerprint: fingerprint,
    });
    const changed = toNowPlayingMovie({
      ...record,
      enPoster: "/new-poster.jpg",
      socialPreviewFingerprint: fingerprint,
    });

    expect(current.socialPreviewFingerprint).toBe(fingerprint);
    expect(changed.socialPreviewFingerprint).toBeUndefined();
  });

  it("rejects unsafe bigint years and a non-array alternatives value", () => {
    expect(() =>
      toNowPlayingMovie({ ...record, releaseYear: 9_007_199_254_740_992n }),
    ).toThrow("outside the JSON-safe integer range.");
    expect(() =>
      toNowPlayingMovie({ ...record, altOptions: { bad: true } }),
    ).toThrow("not a JSON array.");
  });

  it("fails closed for malformed rows and pending work", () => {
    expect(() => toNowPlayingMovie({ ...record, englishTitle: "" })).toThrow();
    expect(() => toNowPlayingMovie({ ...record, soloUpdate: true })).toThrow(
      "pending solo-update",
    );
  });
});

describe("toComingSoonMovie", () => {
  const comingSoonRecord = {
    tmdbId: 9100003,
    englishTitle: ' " Coming Film " ',
    releaseYear: 0,
    releaseDate: "2027-04-12",
    genres: null,
    enPoster: null,
    backdrop: "/coming-backdrop.jpg",
    enTrailer: " trailer-key ",
    runtime: 101,
    popularity: null,
    altOptions: [
      { tmdb: "9100004", title: "Other Film", year: "2028", poster_url: null },
    ],
    soloUpdate: false,
  };

  it("uses the dev R2 origin for coming-soon sources in a Vercel preview", () => {
    const movie = toComingSoonMovie(
      {
        ...comingSoonRecord,
        enPoster: `https://kartiseret-dev.vercel.app${posterPath}`,
      },
      undefined,
      {
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        ARTWORK_DELIVERY_ORIGIN: "https://img-dev.seret.site",
      },
    );
    const url = `https://img-dev.seret.site${posterPath.replace("/api/images/", "/artwork/")}`;
    expect(movie.imageSrc).toBe(url);
    expect(movie.imageSrcSet).toContain(`${url} 342w`);
    expect(movie.backdropSrc).toBe(comingSoonRecord.backdrop);
  });

  it("normalizes future movie data without inventing an original year", () => {
    expect(toComingSoonMovie(comingSoonRecord, "So1")).toMatchObject({
      tmdbId: "9100003",
      movieCode: "So1",
      title: "Coming Film",
      year: 0,
      releaseDate: "2027-04-12",
      genres: [],
      imageSrc: "/coming-backdrop.jpg",
      backdropSrc: "/coming-backdrop.jpg",
      trailerKey: "trailer-key",
      popularity: 0,
      altOptions: [
        {
          tmdbId: "9100004",
          title: "Other Film",
          year: 2028,
          posterUrl: null,
        },
      ],
    });
  });

  it("preserves original years separately from upcoming rerelease dates", () => {
    expect(
      toComingSoonMovie({ ...comingSoonRecord, releaseYear: 1987 }),
    ).toMatchObject({ year: 1987, releaseDate: "2027-04-12" });
    expect(
      toComingSoonMovie({ ...comingSoonRecord, releaseYear: null }),
    ).toMatchObject({ year: 0, releaseDate: "2027-04-12" });
  });

  it("rejects pending and malformed coming-soon rows", () => {
    expect(() =>
      toComingSoonMovie({ ...comingSoonRecord, soloUpdate: true }),
    ).toThrow("pending solo-update");
    expect(() =>
      toComingSoonMovie({ ...comingSoonRecord, releaseDate: "not-a-date" }),
    ).toThrow();
  });
});
