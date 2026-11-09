import { getTheaterTheme } from "../../src/components/showtimes/theaterTheme";
import { describe, expect, it } from "vitest";

describe("cinematheque theater colors", () => {
  it("assigns the map green shades by the stable venue order in each city", () => {
    expect(
      getTheaterTheme("Jerusalem Cinematheque", 0, "Jerusalem").accent,
    ).toBe("#31a26d");
    expect(getTheaterTheme("Sam Spiegel Cinema", 0, "Jerusalem").accent).toBe(
      "#76c99f",
    );
    expect(getTheaterTheme("Jaffa Cinema", 0, "Tel Aviv").accent).toBe(
      "#31a26d",
    );
    expect(getTheaterTheme("Tel Aviv Cinematheque", 0, "Tel Aviv").accent).toBe(
      "#76c99f",
    );
  });

  it("uses the map green for an unregistered cinematheque venue", () => {
    expect(getTheaterTheme("Later Cinematheque", 0, "Jerusalem").accent).toBe(
      "#31a26d",
    );
  });
});
