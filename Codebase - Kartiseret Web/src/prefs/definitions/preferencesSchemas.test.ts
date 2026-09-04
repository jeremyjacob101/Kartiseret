import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCATION, loadInitialPreferenceLocation, normalizeLocation } from "./locations.js";
import { DEFAULT_RATING_SOURCES, normalizeRatingSources, ratingSourceSchema } from "./ratingSources.js";
import { DEFAULT_SITE_COLOR, normalizeSiteColor, siteColorSchema } from "./siteColor.js";

afterEach(() => vi.unstubAllGlobals());

describe("preference schemas", () => {
  it("prefers validated signup metadata without reading the guest location", () => {
    const getItem = vi.fn(() => "Haifa");
    vi.stubGlobal("window", { localStorage: { getItem } });
    expect(loadInitialPreferenceLocation(" Tel   Aviv ")).toBe("Tel Aviv");
    expect(getItem).not.toHaveBeenCalled();
  });

  it("falls back from invalid signup metadata to validated guest storage", () => {
    const getItem = vi.fn(() => " Haifa ");
    vi.stubGlobal("window", { localStorage: { getItem } });
    for (const metadata of [null, undefined, " ", 123, { city: "Tel Aviv" }]) {
      expect(loadInitialPreferenceLocation(metadata)).toBe("Haifa");
    }
    expect(getItem).toHaveBeenCalledWith("guest_location_v1");
  });

  it("uses defaults when both signup metadata and browser storage are unavailable", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("unavailable");
      },
    });
    expect(loadInitialPreferenceLocation(null)).toBe(DEFAULT_LOCATION);
    vi.stubGlobal("window", { localStorage: { getItem: () => " " } });
    expect(loadInitialPreferenceLocation(null)).toBe(DEFAULT_LOCATION);
  });

  it("normalizes non-empty locations and falls back on invalid values", () => {
    expect(normalizeLocation("  Tel   Aviv ")).toBe("Tel Aviv");
    expect(normalizeLocation(" ")).toBe(DEFAULT_LOCATION);
    expect(normalizeLocation({ city: "Tel Aviv" })).toBe(DEFAULT_LOCATION);
  });

  it("keeps only supported rating sources in canonical order", () => {
    expect(
      normalizeRatingSources([
        "tmdbRating",
        "not-a-source",
        "imdbRating",
        "tmdbRating",
      ]),
    ).toEqual(["imdbRating", "tmdbRating"]);
    expect(ratingSourceSchema.safeParse("not-a-source").success).toBe(false);
    expect(normalizeRatingSources(null)).toEqual(DEFAULT_RATING_SOURCES);
  });

  it("normalizes six-digit colors and rejects CSS injection strings", () => {
    expect(normalizeSiteColor(" #A66AE3 ")).toBe("#a66ae3");
    expect(siteColorSchema.safeParse("red").success).toBe(false);
    expect(siteColorSchema.safeParse("#fff; background: red").success).toBe(
      false,
    );
    expect(normalizeSiteColor(null)).toBe(DEFAULT_SITE_COLOR);
  });
});
