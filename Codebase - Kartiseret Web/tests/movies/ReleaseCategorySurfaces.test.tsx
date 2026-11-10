import { filterMoviesByReleaseCategory } from "../../src/domain/movieRelease";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AllShowtimesPage } from "../../src/components/AllShowtimesPage";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as movieCatalog from "../../src/data/movieCatalog";
import { sampleMovie, sampleShowtimes } from "../fixtures";
import type { Movie } from "../../src/data/movieCatalog";
import { CatalogRoute, HomeRoute } from "../../src/App";
import userEvent from "@testing-library/user-event";
import * as theaters from "../../src/data/theaters";
import { MemoryRouter } from "react-router";

vi.mock("../../src/components/scroller/MovieScroller", () => ({
  MovieScroller: ({
    movieItems,
    mode,
  }: {
    movieItems: readonly { tmdbId: string; title: string }[];
    mode: string;
  }) => (
    <div data-testid={"movie-scroller-" + mode}>
      {movieItems.map((movie) => (
        <span key={movie.tmdbId}>{movie.title}</span>
      ))}
    </div>
  ),
}));

vi.mock("../../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: ({ triggerLabel }: { triggerLabel: string }) => (
    <button type="button">{triggerLabel}</button>
  ),
}));

vi.mock("../../src/components/showtimes/ShowtimeDayPicker", () => ({
  ShowtimeDayPicker: () => <div data-testid="showtime-day-picker" />,
}));

vi.mock("../../src/components/showtimes/ShowtimeFilterMenu", () => ({
  ShowtimeFilterMenu: () => <div data-testid="showtime-filter-menu" />,
}));

vi.mock("../../src/components/showtimes/ShowtimesMovieRow", () => ({
  ShowtimesMovieRow: ({ movie }: { movie: { title: string } }) => (
    <div data-testid="showtimes-movie-row">{movie.title}</div>
  ),
}));

vi.mock("../../src/components/showtimes/ShowtimeShared", () => ({
  MovieTrailerModal: () => null,
}));

function makeMovie(tmdbId: string, title: string, year: number): Movie {
  return { ...sampleMovie, tmdbId, title, year };
}

function makeShowtimeData(movies: readonly Movie[]) {
  const date = movieCatalog.fixedAppDateString;
  return {
    city: movieCatalog.defaultCity,
    broadFetchedDates: [date],
    broadLoadedDayCount: 1,
    broadReady: true,
    broadVisibleDayCount: 1,
    movieShowtimesByTmdbId: Object.fromEntries(
      movies.map((movie) => [
        movie.tmdbId,
        [{ date, theaters: sampleShowtimes }],
      ]),
    ),
    rowsByKey: {},
    targetedFetchedDatesByTmdbId: {},
    targetedLoadedDayCountByTmdbId: {},
    visibleDayCount: 1,
  } as movieCatalog.ShowtimeCityData;
}

function installShowtimesQueryFixtures(movies: readonly Movie[]) {
  const showtimeData = makeShowtimeData(movies);
  vi.spyOn(movieCatalog, "movieCollectionQueryOptions").mockImplementation(
    () =>
      ({
        queryKey: ["release-category-test", "movies"],
        queryFn: async () => ({
          mode: "nowPlaying",
          movies,
          moviesByCode: {},
          movieCodesStatus: "ready",
        }),
      }) as never,
  );
  vi.spyOn(movieCatalog, "showtimeCityQueryOptions").mockImplementation(
    (city) =>
      ({
        queryKey: ["release-category-test", "showtimes", city],
        queryFn: async () => showtimeData,
      }) as never,
  );
  vi.spyOn(theaters, "theaterDataQueryOptions").mockReturnValue({
    queryKey: ["release-category-test", "theaters"],
    queryFn: async () => ({ theaters: [], cities: [] }),
  } as never);
}

function renderAllShowtimes() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AllShowtimesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

const emptyAdminSave = async () => {};
const emptyRefresh = async () => {};

describe("release category surfaces", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the home page's third Re-Releases scroller", () => {
    const newMovie = makeMovie(
      "current",
      "Current release",
      new Date().getFullYear(),
    );
    const comingSoonMovie = makeMovie(
      "upcoming",
      "Upcoming release",
      new Date().getFullYear(),
    );
    const reRelease = makeMovie("classic", "Classic re-release", 2000);

    render(
      <HomeRoute
        catalogError={null}
        cardHeight={240}
        cardWidth={160}
        comingSoonReady
        comingSoonMovies={[comingSoonMovie]}
        gap={18}
        nowPlayingReady
        nowPlayingMovies={[newMovie]}
        nowPlayingReReleaseMovies={[reRelease]}
        scrollerSlotMinHeight={300}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "New Releases" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Coming Soon" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Re-Releases" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Current release")).toBeInTheDocument();
    expect(screen.getByText("Upcoming release")).toBeInTheDocument();
    expect(screen.getByText("Classic re-release")).toBeInTheDocument();
    expect(screen.getAllByTestId("movie-scroller-nowPlaying")).toHaveLength(2);
  });

  it.each([
    ["Now Playing", "nowPlaying"],
    ["Coming Soon", "comingSoon"],
  ] as const)("offers release category switching on %s", async (
    routeLabel,
    jumpMode,
  ) => {
    const user = userEvent.setup();
    const onReleaseCategoryChange = vi.fn();
    render(
      <CatalogRoute
        catalogMovieJumpRequest={null}
        cardHeight={330}
        cardWidth={220}
        gap={22}
        jumpMode={jumpMode}
        movies={[makeMovie("test", "Movie", 2026)]}
        onExitDetail={vi.fn()}
        onPosterSelect={vi.fn()}
        isAdmin={false}
        view="scroller"
        onAdminSaveEdit={emptyAdminSave}
        onRefreshRequested={emptyRefresh}
        releaseCategory="newReleases"
        onReleaseCategoryChange={onReleaseCategoryChange}
        scrollerSlotMinHeight={420}
      />,
    );

    expect(
      screen.getByRole("group", {
        name: routeLabel + " release category",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Re-Releases" }));
    expect(onReleaseCategoryChange).toHaveBeenCalledWith("reReleases");
  });

  it("filters All Showtimes rows when changing release category", async () => {
    const user = userEvent.setup();
    const currentYear = new Date().getFullYear();
    const newMovie = makeMovie(
      "new-movie",
      "New release in showtimes",
      currentYear,
    );
    const reRelease = makeMovie(
      "old-movie",
      "Re-release in showtimes",
      currentYear - 3,
    );
    installShowtimesQueryFixtures([newMovie, reRelease]);
    const { queryClient } = renderAllShowtimes();

    expect(
      await screen.findByText("New release in showtimes"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Re-release in showtimes"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Re-Releases" }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Re-Releases" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Re-release in showtimes")).toBeInTheDocument();
    });
    expect(
      screen.queryByText("New release in showtimes"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("showtime-day-picker")).toBeInTheDocument();
    queryClient.clear();
  });

  it("shows a category-specific empty state in All Showtimes", async () => {
    const user = userEvent.setup();
    const onlyNewMovie = makeMovie(
      "new-only",
      "Only new release",
      new Date().getFullYear(),
    );
    installShowtimesQueryFixtures([onlyNewMovie]);
    const { queryClient } = renderAllShowtimes();

    expect(await screen.findByText("Only new release")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Re-Releases" }));

    expect(
      await screen.findByText(
        "No re-releases with showtimes are currently available in Jerusalem.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("showtime-day-picker")).not.toBeInTheDocument();
    queryClient.clear();
  });

  it("uses the shared classifier for both catalog lists and their showtime list", () => {
    const currentYear = new Date().getFullYear();
    const newMovie = makeMovie("current", "Current", currentYear);
    const reRelease = makeMovie("old", "Old", currentYear - 3);
    const unknown = makeMovie("unknown", "Unknown", 0);
    const nowPlaying = [newMovie, reRelease, unknown];
    const comingSoon = [reRelease, newMovie];

    expect(filterMoviesByReleaseCategory(nowPlaying, "newReleases")).toEqual([
      newMovie,
      unknown,
    ]);
    expect(filterMoviesByReleaseCategory(comingSoon, "reReleases")).toEqual([
      reRelease,
    ]);
    expect(
      filterMoviesByReleaseCategory(nowPlaying, "reReleases").map(
        (movie) => movie.tmdbId,
      ),
    ).toEqual(["old"]);
  });
});
