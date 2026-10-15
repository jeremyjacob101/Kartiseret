import { describe, expect, it } from "vitest";
import { toNowPlayingMovie } from "./movie-mapper.js";

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
