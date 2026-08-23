import { describe, expect, it } from "vitest";
import { buildMovieShowtimeShareUrl, encodeDateCode, encodeMovieRouteCode, migrateShowtimeFilterJson, migrateShowtimeFilterState, parseMovieRouteCode } from "./showtimeLinkCodec.js";

describe("showtime filter persistence validation", () => {
  it("migrates legacy version-one screen formats and drops invalid entries", () => {
    expect(
      migrateShowtimeFilterState({
        version: 1,
        unchecked: {
          showType: ["VIP", 4, " VIP "],
          screeningTech: ["2D", "IMAX", "3D"],
          dubLanguage: ["Hebrew"],
        },
      }),
    ).toEqual({
      version: 3,
      unchecked: {
        showType: ["VIP"],
        screeningTech: ["IMAX"],
        screenFormat: ["2D", "3D"],
        dubLanguage: ["Hebrew"],
      },
    });
  });

  it("rejects unsupported persistence versions and malformed containers", () => {
    expect(
      migrateShowtimeFilterState({ version: 4, unchecked: {} }),
    ).toBeNull();
    expect(migrateShowtimeFilterState([])).toBeNull();
    expect(migrateShowtimeFilterState(null)).toBeNull();
  });

  it("decodes and validates persisted JSON in one migration pass", () => {
    expect(
      migrateShowtimeFilterJson(
        JSON.stringify({ version: 3, unchecked: { showType: ["VIP"] } }),
      ),
    ).toMatchObject({
      version: 3,
      unchecked: { showType: ["VIP"] },
    });
    expect(migrateShowtimeFilterJson("not json")).toBeNull();
    expect(
      migrateShowtimeFilterJson(JSON.stringify({ version: 9 })),
    ).toBeNull();
  });
});

describe("movie route runtime validation", () => {
  it("round-trips validated encoded route state", () => {
    const routeCode = encodeMovieRouteCode({
      movieCode: "A7z",
      cityCode: "i",
      dateCode: "a",
      filterMask: 42,
      mode: "edit",
    });

    expect(routeCode).not.toBeNull();
    expect(parseMovieRouteCode(routeCode ?? "")).toMatchObject({
      kind: "encoded",
      movieCode: "A7z",
      cityCode: "i",
      dateCode: "a",
      filterMask: 42,
      mode: "edit",
    });
  });

  it("rejects malformed route state before encoding", () => {
    expect(
      encodeMovieRouteCode({
        movieCode: "bad-code",
        cityCode: "i",
        dateCode: "a",
        filterMask: 0,
        mode: "share",
      }),
    ).toBeNull();
    expect(
      encodeMovieRouteCode({
        movieCode: "A7z",
        cityCode: "?",
        dateCode: "a",
        filterMask: 0,
        mode: "share",
      }),
    ).toBeNull();
  });

  it("rejects malformed external route strings", () => {
    expect(parseMovieRouteCode("A7")).toBeNull();
    expect(parseMovieRouteCode("A7z<script>")).toBeNull();
    expect(parseMovieRouteCode("A7zi?j")).toBeNull();
  });

  it("builds share URLs only from valid state and HTTP origins", () => {
    const date = "2026-08-20";
    expect(encodeDateCode(date)).not.toBeNull();
    expect(
      buildMovieShowtimeShareUrl(
        {
          movieCode: "A7z",
          city: "Jerusalem",
          date,
          filterMask: 0,
        },
        "https://seret.site/some/path",
      ),
    ).toMatch(/^https:\/\/seret\.site\/A7z/);
    expect(
      buildMovieShowtimeShareUrl(
        {
          movieCode: "A7z",
          city: "Jerusalem",
          date: "2026-02-30",
          filterMask: 0,
        },
        "https://seret.site",
      ),
    ).toBeNull();
    expect(
      buildMovieShowtimeShareUrl(
        {
          movieCode: "A7z",
          city: "Jerusalem",
          date,
          filterMask: 0,
        },
        "javascript:alert(1)",
      ),
    ).toBeNull();
  });
});
