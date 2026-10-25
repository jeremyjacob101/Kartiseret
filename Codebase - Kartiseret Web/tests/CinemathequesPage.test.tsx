import type { MovieCollectionData, ShowtimeCityData } from "../src/data/movieCatalog";
import { fixedAppDateString, movieCatalogQueryKeys } from "../src/data/movieCatalog";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CinemathequesPage } from "../src/components/CinemathequesPage";
import { DEFAULT_LOCATION } from "../src/prefs/definitions/locations";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { queryClient } from "../src/lib/queryClient";
import { sampleMovie } from "./fixtures";

vi.mock("../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: ({ triggerLabel }: { triggerLabel?: string }) => (
    <button type="button">{triggerLabel ?? "Choose city"}</button>
  ),
}));

function seedData() {
  const location = DEFAULT_LOCATION;
  const movieCollection: MovieCollectionData = {
    mode: "nowPlaying",
    movies: [sampleMovie],
    moviesByCode: {},
    movieCodesStatus: "ready",
  };
  const cityData: ShowtimeCityData = {
    city: location,
    broadFetchedDates: [fixedAppDateString],
    broadLoadedDayCount: 15,
    broadReady: true,
    broadVisibleDayCount: 1,
    movieShowtimesByTmdbId: {
      [sampleMovie.tmdbId]: [
        {
          date: fixedAppDateString,
          theaters: [
            {
              theater: "Jerusalem Cinematheque",
              showtimes: [
                {
                  time: "20:00",
                  href: "https://tickets.example.test/cinematheque",
                  screeningTech: "35mm",
                  screeningType: "Film",
                  dubLanguage: null,
                },
              ],
            },
            {
              theater: "Cinema City Jerusalem",
              showtimes: [
                {
                  time: "18:00",
                  href: null,
                  screeningTech: "2D",
                  screeningType: "Regular",
                  dubLanguage: null,
                },
              ],
            },
          ],
        },
      ],
    },
    rowsByKey: {},
    targetedFetchedDatesByTmdbId: {},
    targetedLoadedDayCountByTmdbId: {},
    visibleDayCount: 1,
  };

  queryClient.setQueryData(
    movieCatalogQueryKeys.collection("nowPlaying"),
    movieCollection,
  );
  queryClient.setQueryData(
    movieCatalogQueryKeys.showtimeCity(location),
    cityData,
  );
}

beforeEach(() => {
  queryClient.clear();
  useUserPreferencesStore.setState((state) => ({
    preferences: { ...state.preferences, location: DEFAULT_LOCATION },
  }));
  seedData();
});

afterEach(() => {
  queryClient.clear();
});

describe("CinemathequesPage", () => {
  it("shows the city, shared date scroller, and only cinematheque showtimes", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <CinemathequesPage />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Cinematheque Showtimes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DEFAULT_LOCATION }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", {
        name: "Choose cinematheque showtime day",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Jerusalem Cinematheque")).toBeInTheDocument();
    expect(screen.queryByText("Cinema City Jerusalem")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /20:00 showtime/ }),
    ).toHaveAttribute("href", "https://tickets.example.test/cinematheque");
  });
});
