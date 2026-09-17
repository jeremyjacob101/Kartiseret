import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { sampleMovie, sampleShowtimeDays } from "./fixtures";
import { QueryClientProvider } from "@tanstack/react-query";
import { theaterQueryKeys } from "../src/data/theaters";
import { queryClient } from "../src/lib/queryClient";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router";

// The catalog module snapshots the current cinema date at import time. Keep
// fixtures with explicit dates deterministic across CI runs and date rollovers.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-16T16:30:00.000Z"));

const { MovieDetailsContent } =
  await import("../src/components/scroller/MovieDetailsContent");
const { movieCatalogQueryKeys } = await import("../src/data/movieCatalog");

afterAll(() => {
  vi.useRealTimers();
});

vi.mock("../src/components/maps/TheaterMapDialog", () => ({
  TheaterMapDialog: ({ triggerLabel }: { triggerLabel?: string }) => (
    <button type="button">{triggerLabel ?? "Choose city"}</button>
  ),
}));

vi.mock("../src/components/scroller/TicketAlertControl", () => ({
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
});

describe("MovieDetailsContent", () => {
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
      filterState: null,
    });

    await user.click(
      screen.getAllByRole("button", { name: "Watch Sample Movie trailer" })[0]!,
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
    renderDetails({ variant: "comingSoon" });

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
});
