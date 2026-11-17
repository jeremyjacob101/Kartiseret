import { getShowtimesCityBySlug, getShowtimesCityFromPath, getShowtimesCityPath, getShowtimesCitySlug } from "@kartiseret/contracts/showtime-routes";
import { ALL_LOCATIONS } from "@kartiseret/contracts/preferences";
import { describe, expect, it } from "vitest";

describe("showtimes city routes", () => {
  it("creates one reversible crawlable path for every supported city", () => {
    const paths = ALL_LOCATIONS.map((city) => getShowtimesCityPath(city));

    expect(new Set(paths).size).toBe(ALL_LOCATIONS.length);
    for (const city of ALL_LOCATIONS) {
      const slug = getShowtimesCitySlug(city);
      expect(getShowtimesCityBySlug(slug)).toBe(city);
      expect(getShowtimesCityFromPath(`/showtimes/${slug}`)).toBe(city);
    }
  });

  it("ignores slug case and an optional trailing slash, and rejects unknown cities", () => {
    expect(getShowtimesCityFromPath("/showtimes/Tel-Aviv/")).toBe("Tel Aviv");
    expect(getShowtimesCityFromPath("/showtimes/not-a-city")).toBeNull();
    expect(getShowtimesCityFromPath("/showtimes/tel-aviv/extra")).toBeNull();
  });
});
