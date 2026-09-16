import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCATION, loadGuestLocation, normalizeLocation, saveGuestLocation } from "../src/prefs/definitions/locations";
import { ALL_RATING_SOURCES, DEFAULT_RATING_SOURCES, normalizeRatingSources } from "../src/prefs/definitions/ratingSources";
import { DEFAULT_SITE_COLOR, SITE_COLOR_OPTIONS, applySiteColor, clearCachedSiteColor, getSiteColorLabel, initializeSiteColorTheme, loadCachedSiteColor, normalizeSiteColor, saveCachedSiteColor } from "../src/prefs/definitions/siteColor";

function installStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

describe("user preference definitions and theme transitions", () => {
  it("canonicalizes locations and safely persists guest location", () => {
    const storage = installStorage();
    expect(normalizeLocation("  jerusalem ")).toBe("jerusalem");
    expect(normalizeLocation("  Tel   Aviv ")).toBe("Tel Aviv");
    expect(normalizeLocation("", "Haifa")).toBe("Haifa");
    expect(normalizeLocation(null)).toBe(DEFAULT_LOCATION);
    saveGuestLocation("Haifa");
    expect(storage.getItem("guest_location_v1")).toBe("Haifa");
    expect(loadGuestLocation()).toBe("Haifa");
  });

  it("filters invalid rating sources while preserving canonical ordering", () => {
    expect(normalizeRatingSources(["tmdbRating", "bad", "tmdbRating"])).toEqual(
      ["tmdbRating"],
    );
    expect(normalizeRatingSources([], { allowEmpty: true })).toEqual([]);
    expect(normalizeRatingSources("bad")).toEqual(DEFAULT_RATING_SOURCES);
    expect(ALL_RATING_SOURCES).toContain("imdbRating");
  });

  it("normalizes, caches, labels, and animates the site color exactly once", () => {
    const storage = installStorage();
    expect(normalizeSiteColor(" #E269BA ")).toBe("#e269ba");
    expect(normalizeSiteColor("#fff")).toBe(DEFAULT_SITE_COLOR);
    expect(getSiteColorLabel(SITE_COLOR_OPTIONS[0].value)).toBe("Pink");
    expect(getSiteColorLabel("#123456")).toBe("#123456");

    saveCachedSiteColor("#E269BA");
    expect(storage.getItem("cached_site_color_v1")).toBe("#e269ba");
    expect(loadCachedSiteColor()).toBe("#e269ba");
    clearCachedSiteColor();
    expect(loadCachedSiteColor()).toBeNull();

    vi.useFakeTimers();
    initializeSiteColorTheme();
    expect(document.documentElement).toHaveAttribute(
      "data-site-color-initialized",
      "true",
    );
    expect(
      document.documentElement.style.getPropertyValue("--main-app-color"),
    ).toBe(DEFAULT_SITE_COLOR);
    expect(document.documentElement).not.toHaveClass(
      "site-color-transitions-enabled",
    );
    vi.runAllTimers();
    expect(document.documentElement).toHaveClass(
      "site-color-transitions-enabled",
    );
    initializeSiteColorTheme();
    applySiteColor("#123456");
    expect(
      document.documentElement.style.getPropertyValue("--main-app-color"),
    ).toBe("#123456");
    vi.useRealTimers();
  });
});
