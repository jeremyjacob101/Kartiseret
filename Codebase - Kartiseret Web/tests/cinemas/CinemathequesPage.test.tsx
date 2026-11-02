import { cinemathequeQueryKeys, type CinemathequeData } from "../../src/data/cinemathequeCatalog";
import { fixedAppDateString, movieCatalogQueryKeys } from "../../src/data/movieCatalog";
import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CinemathequesPage } from "../../src/components/CinemathequesPage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCATION } from "../../src/prefs/definitions/locations";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { queryClient } from "../../src/lib/queryClient";
import { sampleMovie } from "../fixtures";

vi.mock("../../src/components/maps/TheaterMapDialog", () => ({
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
  it("sorts poster tiles by earliest time and shows all ticket times", () => {
    const key = cinemathequeQueryKeys.data(DEFAULT_LOCATION);
    const current = queryClient.getQueryData<CinemathequeData>(key)!;
    const first = current.showtimes[0]!;
    const earlier = { ...sampleMovie, tmdbId: "102", title: "Earlier Film" };
    queryClient.setQueryData(key, {
      ...current,
      movies: [sampleMovie, earlier],
      showtimes: [
        first,
        { ...first, showtime: "22:00" },
        { ...first, tmdbId: earlier.tmdbId, showtime: "17:00" },
      ],
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CinemathequesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const tiles = [...container.querySelectorAll(".cinematheques-poster-tile")];
    expect(
      within(tiles[0] as HTMLElement).getByRole("button", {
        name: "View details for Earlier Film",
      }),
    ).toBeInTheDocument();
    expect(within(tiles[1] as HTMLElement).getAllByRole("link")).toHaveLength(
      2,
    );
    expect(
      screen.queryByRole("heading", { name: sampleMovie.title }),
    ).not.toBeInTheDocument();
  });

  it("opens and closes details for a cinematheque-only movie", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CinemathequesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const poster = screen.getByRole("button", {
      name: `View details for ${sampleMovie.title}`,
    });
    fireEvent.click(poster);
    expect(screen.getByRole("dialog")).toHaveTextContent(sampleMovie.title);
    fireEvent.click(
      screen.getByRole("button", { name: "Close movie details" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(poster).toHaveFocus();
  });

  it("opens the existing details route for a catalog movie", () => {
    queryClient.setQueryData(movieCatalogQueryKeys.collection("nowPlaying"), {
      mode: "nowPlaying",
      movies: [sampleMovie],
      moviesByCode: { [sampleMovie.movieCode!]: sampleMovie },
      movieCodesStatus: "ready",
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/cinematheques"]}>
          <Routes>
            <Route path="/cinematheques" element={<CinemathequesPage />} />
            <Route path="/:movieCode" element={<p>Movie page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `View details for ${sampleMovie.title}`,
      }),
    );
    expect(screen.getByText("Movie page")).toBeInTheDocument();
  });

  it("renders multiple dates with distinct cinema sections", () => {
    const current = queryClient.getQueryData<CinemathequeData>(
      cinemathequeQueryKeys.data(DEFAULT_LOCATION),
    )!;
    const first = current.showtimes[0]!;
    queryClient.setQueryData(cinemathequeQueryKeys.data(DEFAULT_LOCATION), {
      ...current,
      showtimes: [
        first,
        { ...first, cinema: "Jaffa Cinema" },
        { ...first, dateOfShowing: "2099-01-01" },
      ],
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CinemathequesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll("[data-showtime-date]")).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Jaffa Cinema" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { name: "Jerusalem Cinematheque" }),
    ).toHaveLength(2);
  });

  it("shows the city and vertical schedule with only cinematheque showtimes", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CinemathequesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Cinematheque Showtimes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: DEFAULT_LOCATION }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", {
        name: "Choose cinematheque showtime day",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Jerusalem Cinematheque" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cinema City Jerusalem")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /20:00 showtime/ }),
    ).toHaveAttribute("href", "https://tickets.example.test/cinematheque");
  });
});
