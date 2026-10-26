import { applyMovieDisplayPreference, applyMovieDisplayPreferences, indexMovieDisplayPreferences, type MovieDisplayPreference } from "../src/data/movieDisplayPreferences";
import { movieDisplayPreferencePatchSchema, movieDisplayPreferenceSchema } from "@kartiseret/contracts/private-data";
import { describe, expect, it } from "vitest";
import { sampleMovie } from "./fixtures";

const standardPreference: MovieDisplayPreference = {
  tmdbId: sampleMovie.tmdbId,
  title: sampleMovie.title,
  releaseYear: sampleMovie.year,
  treatment: "standard",
  hideBackdrop: true,
};

describe("movie display preferences", () => {
  it("replaces source art with the title-only fallback and hides backdrop by default", () => {
    const preferences = indexMovieDisplayPreferences([standardPreference]);
    const displayed = applyMovieDisplayPreference(sampleMovie, preferences);

    expect(displayed?.imageSrc).toBe("");
    expect(displayed).not.toHaveProperty("backdropSrc");
  });

  it("allows a standard poster to keep its detail backdrop when requested", () => {
    const preferences = indexMovieDisplayPreferences([
      { ...standardPreference, hideBackdrop: false },
    ]);
    const displayed = applyMovieDisplayPreference(sampleMovie, preferences);

    expect(displayed?.imageSrc).toBe("");
    expect(displayed?.backdropSrc).toBe(sampleMovie.backdropSrc);
  });

  it("removes selected titles and leaves other movies unchanged", () => {
    const preferences = indexMovieDisplayPreferences([
      { ...standardPreference, treatment: "remove" },
    ]);

    expect(applyMovieDisplayPreference(sampleMovie, preferences)).toBeNull();
    expect(applyMovieDisplayPreferences([sampleMovie], preferences)).toEqual(
      [],
    );
    expect(
      applyMovieDisplayPreference(
        { ...sampleMovie, tmdbId: "102" },
        preferences,
      ),
    ).toEqual({ ...sampleMovie, tmdbId: "102" });
  });

  it("validates supported treatments, IDs and non-empty updates", () => {
    expect(
      movieDisplayPreferenceSchema.safeParse(standardPreference).success,
    ).toBe(true);
    expect(
      movieDisplayPreferenceSchema.safeParse({
        ...standardPreference,
        treatment: "blur",
      }).success,
    ).toBe(false);
    expect(
      movieDisplayPreferenceSchema.safeParse({
        ...standardPreference,
        tmdbId: "0",
      }).success,
    ).toBe(false);
    expect(movieDisplayPreferencePatchSchema.safeParse({}).success).toBe(false);
    expect(
      movieDisplayPreferencePatchSchema.safeParse({ hideBackdrop: false })
        .success,
    ).toBe(true);
  });
});
