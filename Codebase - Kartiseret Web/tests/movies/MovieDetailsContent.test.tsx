import { useUserPreferencesStore } from "../../src/stores/userPreferencesStore";
import { sampleMovie, sampleShowtimeDays, sampleShowtimes } from "../fixtures";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Theater } from "@kartiseret/contracts/movies";
import { theaterQueryKeys } from "../../src/data/theaters";
import { queryClient } from "../../src/lib/queryClient";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";

// The catalog module snapshots the current cinema date at import time. Keep
// fixtures with explicit dates deterministic across CI runs and date rollovers.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-16T16:30:00.000Z"));

const { MovieDetailsContent } =
  await import("../../src/components/scroller/MovieDetailsContent");
const movieCatalog = await import("../../src/data/movieCatalog");
const { movieCatalogQueryKeys } = movieCatalog;

afterAll(() => {
  vi.useRealTimers();
});

vi.mock("../../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: ({ triggerLabel }: { triggerLabel?: string }) => (
    <button type="button">{triggerLabel ?? "Choose city"}</button>
  ),
}));

vi.mock("../../src/components/scroller/TicketAlertControl", () => ({
  TicketAlertControl: ({ movie }: { movie: { title: string } }) => (
    <div>Alert control for {movie.title}</div>
  ),
}));

function seedData() {
  queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity("Jerusalem"), {
    city: "Jerusalem",
    broadFetchedDates: sampleShowtimeDays.map((day) => day.date),
    broadLoadedDayCount: 2,
    broadReady: true,
    broadVisibleDayCount: 2,
    movieShowtimesByTmdbId: { [sampleMovie.tmdbId]: sampleShowtimeDays },
    rowsByKey: {},
    targetedFetchedDatesByTmdbId: {},
    targetedLoadedDayCountByTmdbId: {},
    visibleDayCount: 2,
  });
  queryClient.setQueryData(theaterQueryKeys.all, {
    theaters: [],
    cities: [],
  });
}

function renderDetails(
  props: Partial<ComponentProps<typeof MovieDetailsContent>> = {},
) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <MovieDetailsContent
          movie={sampleMovie}
          titleId="sample-title"
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  queryClient.clear();
  seedData();
  useUserPreferencesStore.setState(
    {
      ...useUserPreferencesStore.getInitialState(),
      loading: false,
      loadError: false,
      user: null,
    },
    true,
  );
});

describe("MovieDetailsContent", () => {
  it("loads the full targeted window for the active movie and city", () => {
    const loadWindow = vi
      .spyOn(movieCatalog, "loadAdditionalShowtimeDays")
      .mockResolvedValue(undefined);
    try {
      const TestDetails = ({
        city,
        tmdbId,
      }: {
        city: "Jerusalem" | "Haifa";
        tmdbId: string;
      }) => (
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <MovieDetailsContent
              movie={{ ...sampleMovie, tmdbId }}
              titleId="sample-title"
              variant="comingSoon"
              targetShowtimeQueries
              locationOverride={city}
            />
          </QueryClientProvider>
        </MemoryRouter>
      );
      const { rerender } = render(
        <TestDetails city="Jerusalem" tmdbId="101" />,
      );
      rerender(<TestDetails city="Haifa" tmdbId="101" />);
      rerender(<TestDetails city="Haifa" tmdbId="102" />);

      expect(loadWindow.mock.calls).toEqual([
        ["Jerusalem", 180, "101"],
        ["Haifa", 180, "101"],
        ["Haifa", 180, "102"],
      ]);
    } finally {
      loadWindow.mockRestore();
    }
  });

  it("loads a Coming Soon trailer only after Play and resets for a different movie", async () => {
    const user = userEvent.setup();
    const content = (movie: typeof sampleMovie) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <MovieDetailsContent
            movie={movie}
            titleId="sample-title"
            variant="comingSoon"
          />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const { container, rerender } = render(
      content({ ...sampleMovie, tmdbId: "201" }),
    );
    const play = screen.getByRole("button", {
      name: "Play trailer on YouTube: Sample Movie",
    });
    expect(play).toHaveAccessibleDescription(
      "Playing this trailer connects to YouTube (Google).",
    );
    expect(container.querySelector("iframe")).toBeNull();

    await user.click(play);
    expect(screen.getByTitle("Sample Movie official trailer")).toHaveAttribute(
      "src",
      expect.stringContaining("youtube-nocookie.com/embed/dQw4w9WgXcQ"),
    );

    rerender(content({ ...sampleMovie, tmdbId: "202", title: "Second Movie" }));
    expect(container.querySelector("iframe")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Play trailer on YouTube: Second Movie",
      }),
    ).toBeVisible();
  });

  it("renders metadata, ratings, showtimes, sharing, and trailer overlay behavior", async () => {
    const user = userEvent.setup();
    const onShareShowtimes = vi.fn();
    const onPreferredShowtimeDateChange = vi.fn();
    renderDetails({
      preferredShowtimeDate: "2026-09-17",
      onShareShowtimes,
      onPreferredShowtimeDateChange,
    });

    expect(
      screen.getByRole("heading", { name: "Sample Movie" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Drama, Comedy")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/IMDb rating 8.3/)).toHaveLength(2);
    expect(screen.getByText("Cinema City")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /19:30 showtime/ }),
    ).toHaveAttribute("href", "https://tickets.example.test/sample");

    await user.click(
      screen.getByRole("button", { name: "Share these showtimes" }),
    );
    expect(onShareShowtimes).toHaveBeenCalledWith({
      date: "2026-09-17",
      location: "Jerusalem",
      filterState: {
        version: 3,
        unchecked: {
          showType: [],
          screenFormat: [],
          screeningTech: [],
          dubLanguage: [],
        },
      },
      excludedCinemaIds: [],
    });

    await user.click(
      screen.getAllByRole("button", {
        name: "Play Sample Movie trailer on YouTube",
      })[0]!,
    );
    expect(
      screen.getByRole("dialog", { name: "Sample Movie trailer" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Sample Movie trailer")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1&playsinline=1&autoplay=1",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /September 16, 2026/ }));
    expect(onPreferredShowtimeDateChange).toHaveBeenCalledWith("2026-09-16");
  });

  it("paints fallback theater tickets with the themed background variable", () => {
    renderDetails({ preferredShowtimeDate: "2026-09-17" });

    const pill = screen
      .getByText("22:15")
      .closest<HTMLElement>(".details-time-pill");

    expect(
      pill?.style.getPropertyValue("--details-showtime-pill-background"),
    ).toContain("linear-gradient");
    expect(pill?.style.background).toBe("");
  });

  it("links a verified screening venue to its stable cinema short URL", () => {
    const cinema = CINEMA_IDENTITIES.find(
      (identity) => identity.displayName === "Cinema City Jerusalem",
    )!;
    const theater: Theater = {
      city: {
        name: cinema.city,
        altSpellings: [],
        latitude: 31.78,
        longitude: 35.2,
        zoomLayer: 10,
        neighboringCities: [],
      },
      chain: "Cinema City",
      address: "Derech Yitzhak Rabin 10",
      theaterName: cinema.displayName,
      location: cinema.locationKeys[0]!,
      lat: 31.78,
      lng: 35.2,
    };
    queryClient.setQueryData(theaterQueryKeys.all, {
      theaters: [theater],
      cities: [theater.city],
    });

    renderDetails({ preferredShowtimeDate: "2026-09-17" });

    expect(
      screen.getByRole("link", { name: "Cinema City Jerusalem" }),
    ).toHaveAttribute("href", `/c/${cinema.id}`);
  });

  it("renders a precise no-results state when every loaded filter option is unchecked", () => {
    renderDetails({
      preferredShowtimeDate: "2026-09-17",
      showtimeFilterStateOverride: {
        version: 3,
        unchecked: {
          showType: [],
          screenFormat: ["2D", "3D"],
          screeningTech: [],
          dubLanguage: [],
        },
      },
    });

    expect(
      screen.getByLabelText(/No showtimes match current filters/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cinema City")).not.toBeInTheDocument();
  });

  it("keeps coming-soon movies focused on release metadata and alert affordance", () => {
    queryClient.removeQueries({
      queryKey: movieCatalogQueryKeys.showtimeCity("Jerusalem"),
    });
    renderDetails({
      variant: "comingSoon",
    });

    expect(
      screen.getByText("Release date: September 18, 2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Alert control for Sample Movie"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Sample Movie showtimes/),
    ).not.toBeInTheDocument();
  });

  it("shows the selected empty date for a coming-soon availability link", () => {
    queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity("Jerusalem"), {
      city: "Jerusalem",
      broadFetchedDates: [],
      broadLoadedDayCount: 0,
      broadReady: false,
      broadVisibleDayCount: 0,
      movieShowtimesByTmdbId: {
        [sampleMovie.tmdbId]: [{ date: "2026-12-01", theaters: [] }],
      },
      rowsByKey: {},
      targetedFetchedDatesByTmdbId: { [sampleMovie.tmdbId]: ["2026-12-01"] },
      targetedLoadedDayCountByTmdbId: { [sampleMovie.tmdbId]: 0 },
      visibleDayCount: 180,
    });

    renderDetails({
      variant: "comingSoon",
      exactDateShowtimeQueries: true,
      preferredShowtimeDate: "2026-12-01",
      showtimeDateWindowStart: "2026-09-16",
    });

    expect(
      screen.getByRole("radio", { name: /Tuesday, December 1, 2026/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText(/No showtimes on/)).toBeInTheDocument();
  });

  it("offers a jump to a far future showing in the selected city", async () => {
    const farShowtimeDate = "2026-12-15";
    const onPreferredShowtimeDateChange = vi.fn();
    const user = userEvent.setup();

    queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity("Jerusalem"), {
      city: "Jerusalem",
      broadFetchedDates: ["2026-09-16"],
      broadLoadedDayCount: 1,
      broadReady: true,
      broadVisibleDayCount: 1,
      movieShowtimesByTmdbId: {
        [sampleMovie.tmdbId]: [
          { date: "2026-09-16", theaters: [] },
          { date: farShowtimeDate, theaters: sampleShowtimes },
        ],
      },
      rowsByKey: {},
      targetedFetchedDatesByTmdbId: {},
      targetedLoadedDayCountByTmdbId: {},
      visibleDayCount: 180,
    });

    renderDetails({
      variant: "comingSoon",
      preferredShowtimeDate: "2026-09-16",
      onPreferredShowtimeDateChange,
    });

    const jumpButton = screen.getByRole("button", {
      name: "Skip to showing day",
    });
    expect(jumpButton).toBeInTheDocument();

    await user.click(jumpButton);

    expect(onPreferredShowtimeDateChange).toHaveBeenCalledWith(farShowtimeDate);
  });

  it("shows the loading state when an exact-date showtime request has no selected day yet", () => {
    queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity("Jerusalem"), {
      city: "Jerusalem",
      broadReady: false,
      broadVisibleDayCount: 0,
      movieShowtimesByTmdbId: {},
    });
    renderDetails({
      exactDateShowtimeQueries: true,
      showtimeDateLoading: true,
      showtimeDateWindowStart: "2026-09-16",
    });

    expect(screen.getByLabelText("Loading showtimes…")).toBeInTheDocument();
  });

  it("keeps adjacent dates selectable for an exact far-ahead movie link", () => {
    const farDate = "2026-12-01";
    queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity("Jerusalem"), {
      city: "Jerusalem",
      broadFetchedDates: sampleShowtimeDays.map((day) => day.date),
      broadLoadedDayCount: 2,
      broadReady: true,
      broadVisibleDayCount: 2,
      movieShowtimesByTmdbId: {
        [sampleMovie.tmdbId]: [
          ...sampleShowtimeDays,
          { date: farDate, theaters: sampleShowtimes },
        ],
      },
      rowsByKey: {},
      targetedFetchedDatesByTmdbId: { [sampleMovie.tmdbId]: [farDate] },
      targetedLoadedDayCountByTmdbId: { [sampleMovie.tmdbId]: 0 },
      visibleDayCount: 180,
    });
    const onPreferredShowtimeDateChange = vi.fn();

    renderDetails({
      exactDateShowtimeQueries: true,
      preferredShowtimeDate: farDate,
      onPreferredShowtimeDateChange,
      showtimeDateWindowStart: "2026-09-16",
    });

    const previousDate = screen.getByRole("radio", {
      name: /Monday, November 30, 2026/,
    });
    expect(previousDate).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByRole("radio", { name: /Tuesday, December 1, 2026/ }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(previousDate);
    expect(onPreferredShowtimeDateChange).toHaveBeenCalledWith("2026-11-30");
  });
});
