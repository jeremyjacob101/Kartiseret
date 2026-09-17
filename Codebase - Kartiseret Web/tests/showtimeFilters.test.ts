import { buildShowtimeFilterSelections, cloneUncheckedGroups, filterTheatersBySelections, getCanonicalShowtimeMeta, getShowtimeFilterOptions, normalizeScreeningTech, normalizeScreeningType, updateShowtimeFilterState, type FilterableShowtime, type FilterableTheater } from "../src/domain/showtimeFilters";
import { describe, expect, it, vi } from "vitest";

describe("showtime filter normalization", () => {
  it("normalizes missing display values to the app defaults", () => {
    expect(normalizeScreeningType("  ")).toBe("Regular");
    expect(normalizeScreeningTech("  ")).toBe("2D");
    expect(cloneUncheckedGroups({ showType: ["VIP"] })).toEqual({
      showType: ["VIP"],
      screenFormat: [],
      screeningTech: [],
      dubLanguage: [],
    });
  });

  it("maps compound screening metadata into canonical filter tokens", () => {
    expect(
      getCanonicalShowtimeMeta({
        time: "20:00",
        screeningTech: "3D + IMAX + Atmos",
        screeningType: "VIP Light",
        dubLanguage: " french ",
      }),
    ).toEqual({
      showTypeTokens: ["VIP", "VIP Light"],
      screenFormatToken: "3D",
      screeningTechTokens: ["IMAX", "Atmos"],
      dubLanguage: "French",
    });
  });

  it("does not expose unsupported show types or languages as accidental options", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(
      getCanonicalShowtimeMeta({
        time: "20:00",
        screeningTech: "2D",
        screeningType: "4DX Lounge",
        dubLanguage: "Spanish",
      }),
    ).toEqual({
      showTypeTokens: ["Lounge"],
      screenFormatToken: "2D",
      screeningTechTokens: ["Standard"],
      dubLanguage: "Spanish",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("builds selections from persisted unchecked values and filters theaters", () => {
    const theaters: FilterableTheater<FilterableShowtime>[] = [
      {
        theater: "Cinema A",
        showtimes: [
          {
            time: "20:00",
            screeningTech: "3D IMAX",
            screeningType: "VIP",
            dubLanguage: "Original",
          },
          {
            time: "21:00",
            screeningTech: "2D",
            screeningType: "Regular",
            dubLanguage: "French",
          },
        ],
      },
      {
        theater: "Cinema B",
        showtimes: [
          {
            time: "22:00",
            screeningTech: "2D",
            screeningType: "Premium",
            dubLanguage: "Hebrew",
          },
        ],
      },
    ];
    const options = getShowtimeFilterOptions(theaters);
    const selections = buildShowtimeFilterSelections(options, {
      version: 3,
      unchecked: {
        showType: ["Regular"],
        screenFormat: ["2D"],
        screeningTech: ["Standard"],
        dubLanguage: ["French", "Hebrew"],
      },
    });

    expect(
      filterTheatersBySelections(theaters, selections).map((theater) => ({
        theater: theater.theater,
        times: theater.showtimes.map((showtime) => showtime.time),
      })),
    ).toEqual([{ theater: "Cinema A", times: ["20:00"] }]);
  });

  it("updates only known options and preserves unknown persisted values", () => {
    const options = {
      showType: ["Regular", "VIP"],
      screenFormat: ["2D", "3D"],
      screeningTech: ["Standard", "IMAX"],
      dubLanguage: ["Original", "Hebrew"],
    } as const;
    const state = updateShowtimeFilterState(
      {
        version: 3,
        unchecked: {
          showType: ["VIP", "Unreleased"],
          screenFormat: [],
          screeningTech: [],
          dubLanguage: [],
        },
      },
      options,
      {
        showType: new Set(["Regular"]),
        screenFormat: new Set(["2D", "3D"]),
        screeningTech: new Set(["IMAX"]),
        dubLanguage: new Set(["Original"]),
      },
    );

    expect(state).toEqual({
      version: 3,
      unchecked: {
        showType: ["Unreleased", "VIP"],
        screenFormat: [],
        screeningTech: ["Standard"],
        dubLanguage: ["Hebrew"],
      },
    });
  });
});
