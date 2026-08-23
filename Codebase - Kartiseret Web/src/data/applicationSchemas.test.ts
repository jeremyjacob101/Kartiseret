import { describe, expect, it } from "vitest";
import { movieSchema, theaterSchema } from "./applicationSchemas.js";

describe("application model schemas", () => {
  it("validates normalized movie models", () => {
    expect(
      movieSchema.safeParse({
        tmdbId: "693134",
        title: "Dune: Part Three",
        year: 2026,
        genres: ["Science Fiction"],
        imageSrc: "/poster.jpg",
        imdbRating: null,
        lbRating: null,
        lbVotes: null,
        tmdbRating: null,
        tmdbVotes: null,
        rtCriticRating: null,
        rtCriticVotes: null,
        rtAudienceRating: null,
        rtAudienceVotes: null,
        runtime: 165,
        popularity: 120,
        altOptions: [],
      }).success,
    ).toBe(true);
  });

  it("validates normalized theater models independently of raw rows", () => {
    expect(
      theaterSchema.safeParse({
        city: {
          name: "Jerusalem",
          altSpellings: ["Jerusalem"],
          latitude: 31.768,
          longitude: 35.214,
          zoomLayer: 8,
          neighboringCities: [],
        },
        chain: "Cinema City",
        address: "Sderot Yitshak Rabin 10",
        theaterName: "Cinema City Jerusalem",
        location: "Jerusalem",
        lat: 31.792,
        lng: 35.202,
      }).success,
    ).toBe(true);
  });
});
