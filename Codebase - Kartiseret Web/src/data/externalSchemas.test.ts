import { describe, expect, it } from "vitest";
import { adminMovieEditPayloadSchema, comingSoonMovieRowSchema, movieRowSchema, movieSchema, showtimeRowSchema, theaterRowSchema } from "./externalSchemas.js";

const validMovieRow = {
  tmdb_id: 693134,
  english_title: "Dune: Part Three",
  release_year: "2026",
  solo_update: false,
  genres: ["Science Fiction", "Adventure"],
  en_poster: "/poster.jpg",
  alt_options: [],
  en_trailer: null,
  backdrop: "/backdrop.jpg",
  imdbRating: null,
  rtCriticRating: "91",
  rtAudienceRating: 88,
  runtime: "165",
  popularity: 120.5,
};

describe("Supabase row schemas", () => {
  it("accepts the supported number/string representations for movie rows", () => {
    expect(movieRowSchema.parse(validMovieRow)).toMatchObject({
      tmdb_id: 693134,
      english_title: "Dune: Part Three",
      runtime: "165",
    });
  });

  it("rejects a missing required movie column", () => {
    const invalidRow: Record<string, unknown> = { ...validMovieRow };
    delete invalidRow.english_title;
    expect(movieRowSchema.safeParse(invalidRow).success).toBe(false);
  });

  it("rejects malformed alternate movie options before mapping", () => {
    expect(
      movieRowSchema.safeParse({
        ...validMovieRow,
        alt_options: [{ tmdb: 42, title: null }],
      }).success,
    ).toBe(false);
  });

  it("requires a real release date for coming-soon rows", () => {
    const comingSoonRow = {
      tmdb_id: "693134",
      english_title: "Dune: Part Three",
      release_year: 2026,
      release_date: "2026-12-18",
      solo_update: false,
      genres: ["Science Fiction"],
      en_poster: null,
      alt_options: null,
      backdrop: null,
      en_trailer: null,
    };

    expect(comingSoonMovieRowSchema.safeParse(comingSoonRow).success).toBe(
      true,
    );
    expect(
      comingSoonMovieRowSchema.safeParse({
        ...comingSoonRow,
        release_date: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it("fills optional legacy showtime metadata with safe empty strings", () => {
    const row = showtimeRowSchema.parse({
      tmdb_id: 693134,
      screening_city: "Jerusalem",
      date_of_showing: "2026-08-20",
      cinema: "Cinema City",
      showtime: "19:30:00",
      english_href: null,
    });

    expect(row.screening_tech).toBe("");
    expect(row.screening_type).toBe("");
    expect(row.dub_language).toBe("");
  });

  it("rejects impossible showtime dates and times", () => {
    const baseRow = {
      tmdb_id: "1",
      screening_city: "Jerusalem",
      date_of_showing: "2026-08-20",
      cinema: "Cinema City",
      showtime: "19:30",
      english_href: null,
    };
    expect(
      showtimeRowSchema.safeParse({ ...baseRow, showtime: "29:70" }).success,
    ).toBe(false);
    expect(
      showtimeRowSchema.safeParse({
        ...baseRow,
        date_of_showing: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it("bounds theater coordinates and map zoom levels", () => {
    const theaterRow = {
      chain: "Cinema City",
      address: "Sderot Yitshak Rabin 10",
      location: "Jerusalem",
      theater_name: "Cinema City Jerusalem",
      latitude: 31.792,
      longitude: 35.202,
      city_details: {
        name: "Jerusalem",
        alt_spellings: ["Jerusalem"],
        latitude: 31.768,
        longitude: 35.214,
        zoom_layer: 8,
        neighboring_cities: [],
      },
    };

    expect(theaterRowSchema.safeParse(theaterRow).success).toBe(true);
    expect(
      theaterRowSchema.safeParse({ ...theaterRow, latitude: 120 }).success,
    ).toBe(false);
  });
});

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

  it("validates and normalizes admin edit payload ids before any write path", () => {
    expect(
      adminMovieEditPayloadSchema.parse({
        mode: "nowPlaying",
        currentTmdbId: 10,
        selectedTmdbId: "20",
        isManualEntry: true,
      }),
    ).toMatchObject({ currentTmdbId: "10", selectedTmdbId: "20" });
    expect(
      adminMovieEditPayloadSchema.safeParse({
        mode: "nowPlaying",
        currentTmdbId: "10",
        selectedTmdbId: "0",
        isManualEntry: true,
      }).success,
    ).toBe(false);
  });
});
