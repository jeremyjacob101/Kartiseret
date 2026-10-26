import { describe, expect, it } from "vitest";
import { toComingSoonMovie, toNowPlayingMovie } from "./movie-mapper.js";

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

  it("normalizes future movie data and falls back from a zero release year", () => {
    expect(toComingSoonMovie(comingSoonRecord, "So1")).toMatchObject({
      tmdbId: "9100003",
      movieCode: "So1",
      title: "Coming Film",
      year: 2027,
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

  it("rejects pending and malformed coming-soon rows", () => {
    expect(() =>
      toComingSoonMovie({ ...comingSoonRecord, soloUpdate: true }),
    ).toThrow("pending solo-update");
    expect(() =>
      toComingSoonMovie({ ...comingSoonRecord, releaseDate: "not-a-date" }),
    ).toThrow();
  });
});
