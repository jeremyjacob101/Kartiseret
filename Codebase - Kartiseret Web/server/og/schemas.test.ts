import { describe, expect, it } from "vitest";
import { databaseMovieSchema, databaseShowtimeSchema, ogRequestQuerySchema, previewDataSchema } from "./schemas.js";

describe("Open Graph request schemas", () => {
  it("parses scalar query parameters", () => {
    expect(
      ogRequestQuerySchema.parse({ routeCode: "A7z", home: "1" }),
    ).toMatchObject({ routeCode: "A7z", home: true });
    expect(ogRequestQuerySchema.parse({}).home).toBe(false);
  });

  it("rejects duplicate array query parameters", () => {
    expect(
      ogRequestQuerySchema.safeParse({ routeCode: ["A7z", "B8y"] }).success,
    ).toBe(false);
    expect(ogRequestQuerySchema.safeParse({ home: ["1", "0"] }).success).toBe(
      false,
    );
  });

  it("caps route input before it reaches preview lookup", () => {
    expect(
      ogRequestQuerySchema.safeParse({ routeCode: "A".repeat(11) }).success,
    ).toBe(false);
  });
});

describe("Open Graph external response schemas", () => {
  it("normalizes absent rating fields on coming-soon rows", () => {
    expect(
      databaseMovieSchema.parse({
        english_title: "Dune: Part Three",
        en_poster: null,
        backdrop: null,
        release_year: 2026,
        release_date: "2026-12-18",
        runtime: null,
        genres: ["Science Fiction"],
      }),
    ).toMatchObject({
      imdbRating: null,
      rtCriticRating: null,
      rtAudienceRating: null,
      lbRating: null,
    });
  });

  it("rejects wrong showtime field types", () => {
    expect(
      databaseShowtimeSchema.safeParse({
        cinema: "Cinema City",
        showtime: 1930,
        screening_tech: null,
        screening_type: null,
        dub_language: null,
      }).success,
    ).toBe(false);
  });

  it("validates the final preview model", () => {
    const preview = {
      routeCode: "A7z",
      movieCode: "A7z",
      tmdbId: "693134",
      title: "Dune: Part Three",
      city: "Jerusalem",
      date: "2026-08-20",
      dateLabel: "Thursday, Aug 20",
      posterUrl: "",
      backdropUrl: "",
      isComingSoon: true,
      theaters: [],
      year: 2026,
      releaseDate: "2026-12-18",
      runtime: 165,
      genres: ["Science Fiction"],
      imdbRating: null,
      rtCriticRating: null,
      rtCriticVotes: null,
      rtAudienceRating: null,
      rtAudienceVotes: null,
      lbRating: null,
    };

    expect(previewDataSchema.safeParse(preview).success).toBe(true);
    expect(
      previewDataSchema.safeParse({ ...preview, date: "2026-02-30" }).success,
    ).toBe(false);
  });
});
