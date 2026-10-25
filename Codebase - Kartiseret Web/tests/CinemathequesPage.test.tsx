import { cinemathequeQueryKeys, type CinemathequeData } from "../src/data/cinemathequeCatalog";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CinemathequesPage } from "../src/components/CinemathequesPage";
import { DEFAULT_LOCATION } from "../src/prefs/definitions/locations";
import { fixedAppDateString } from "../src/data/movieCatalog";
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
  const data: CinemathequeData = {
    movies: [sampleMovie],
    movieCodesStatus: "ready",
    publicationRevision: "1",
    showtimes: [
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: location,
        dateOfShowing: fixedAppDateString,
        cinema: "Jerusalem Cinematheque",
        showtime: "20:00",
        englishHref: "https://tickets.example.test/cinematheque",
        hebrewHref: null,
        screeningTech: "35mm",
        screeningType: "Film",
        dubLanguage: null,
      },
      {
        tmdbId: sampleMovie.tmdbId,
        screeningCity: location,
        dateOfShowing: fixedAppDateString,
        cinema: "Cinema City Jerusalem",
        showtime: "18:00",
        englishHref: null,
        hebrewHref: null,
        screeningTech: "2D",
        screeningType: "Regular",
        dubLanguage: null,
      },
    ],
  };
  queryClient.setQueryData(cinemathequeQueryKeys.data(location), data);
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
