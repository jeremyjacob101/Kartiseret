import { useShowtimeViewPreferences } from "../../src/components/showtimes/useShowtimeViewPreferences";
import { DEFAULT_SHOWTIME_PREFERENCES } from "@kartiseret/contracts/showtime-preferences";
import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const savedPreferences = {
  screeningFilters: {
    version: 3 as const,
    unchecked: {
      showType: [],
      screenFormat: [],
      screeningTech: [],
      dubLanguage: ["Hebrew"],
    },
  },
  excludedCinemaIds: ["aK90TvH244M7"],
};

function installAccountPreferences(
  showtimePreferences = savedPreferences,
  location: "Jerusalem" | "Tel Aviv" = "Jerusalem",
) {
  useUserPreferencesStore.setState((current) => ({
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "qa@example.test",
    },
    loading: false,
    loadError: false,
    preferences: {
      ...current.preferences,
      location,
      showtimePreferences,
    },
    saveShowtimePreferences: vi.fn(async () => true),
  }));
}

afterEach(() => {
  useUserPreferencesStore.setState(
    useUserPreferencesStore.getInitialState(),
    true,
  );
});

describe("showtime view preferences", () => {
  it("keeps browsing edits together for the current view and reloads defaults after leaving", () => {
    installAccountPreferences();
    const { result, unmount } = renderHook(() =>
      useShowtimeViewPreferences("all-showtimes"));

    expect(result.current.ready).toBe(true);
    act(() => {
      result.current.setLocation("Haifa");
      result.current.setScreeningFilters({
        version: 3,
        unchecked: {
          showType: [],
          screenFormat: ["3D"],
          screeningTech: [],
          dubLanguage: ["French"],
        },
      });
      result.current.setExcludedCinemaIds([]);
    });

    expect(result.current.location).toBe("Haifa");
    expect(result.current.screeningFilters.unchecked).toEqual({
      showType: [],
      screenFormat: ["3D"],
      screeningTech: [],
      dubLanguage: ["French"],
    });
    expect(result.current.excludedCinemaIds).toEqual([]);

    act(() => {
      useUserPreferencesStore.setState((current) => ({
        preferences: {
          ...current.preferences,
          location: "Tel Aviv",
          showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
        },
      }));
    });

    expect(result.current.location).toBe("Haifa");
    expect(result.current.screeningFilters.unchecked.dubLanguage).toEqual([
      "French",
    ]);

    unmount();
    const reopened = renderHook(() =>
      useShowtimeViewPreferences("all-showtimes"));

    expect(reopened.result.current.location).toBe("Tel Aviv");
    expect(
      reopened.result.current.screeningFilters.unchecked.dubLanguage,
    ).toEqual([]);
    expect(reopened.result.current.excludedCinemaIds).toEqual([]);
  });
});
