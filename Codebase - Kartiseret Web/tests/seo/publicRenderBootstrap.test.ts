import { createEmptyShowtimeCityData, isMovieShowtimeDateCovered, mergeShowtimeCityData, movieCatalogQueryKeys } from "../../src/data/movieCatalog";
import type { PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { seedPublicPageQueries } from "../../src/publicRenderBootstrap";
import { addCalendarDays } from "@kartiseret/contracts/showtime-links";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { sampleMovie } from "../fixtures";

const renderedAt = "2026-11-03T10:00:00.000Z";
const today = "2026-11-03";

function movieBootstrap(date = today): PublicPageBootstrap {
  return {
    version: 1,
    pathname: "/Ab1",
    renderedAt,
    publicationRevision: "7",
    catalogs: {
      nowPlaying: {
        mode: "nowPlaying",
        movies: [],
        movieCodesStatus: "ready",
        publicationRevision: "7",
      },
      comingSoon: {
        mode: "comingSoon",
        movies: [sampleMovie],
        movieCodesStatus: "ready",
        publicationRevision: "7",
      },
    },
    targetedMovieShowtimes: {
      city: "Jerusalem",
      date,
      tmdbId: "101",
      showtimes: [],
    },
  };
}

describe("public route bootstrap showtime coverage", () => {
  it("keeps movie-targeted rows separate from broad city coverage", () => {
    const queryClient = new QueryClient();
    const bootstrap = movieBootstrap();

    seedPublicPageQueries(queryClient, bootstrap);

    const cityQueryKey = movieCatalogQueryKeys.showtimeCity(
      "Jerusalem",
      bootstrap.publicationRevision,
    );
    const targeted =
      queryClient.getQueryData<ReturnType<typeof createEmptyShowtimeCityData>>(
        cityQueryKey,
      );
    expect(targeted).toMatchObject({
      broadReady: false,
      broadFetchedDates: [],
      targetedFetchedDatesByTmdbId: { "101": [today] },
    });
    expect(isMovieShowtimeDateCovered(targeted, "202", today, today)).toBe(
      false,
    );

    const broad = mergeShowtimeCityData(targeted, {
      city: "Jerusalem",
      todayDate: today,
      dates: [today],
      movies: [],
      rows: [],
      scope: "broad",
      publicationRevision: bootstrap.publicationRevision,
      visibleDayCount: 1,
    });

    expect(broad.broadReady).toBe(true);
    expect(broad.broadFetchedDates).toEqual([today]);
    expect(isMovieShowtimeDateCovered(broad, "202", today, today)).toBe(true);
    queryClient.clear();
  });

  it("does not treat one far-ahead bootstrap day as a contiguous window", () => {
    const queryClient = new QueryClient();
    const farDate = addCalendarDays(today, 75)!;
    const bootstrap = movieBootstrap(farDate);

    seedPublicPageQueries(queryClient, bootstrap);

    const targeted = queryClient.getQueryData<
      ReturnType<typeof createEmptyShowtimeCityData>
    >(
      movieCatalogQueryKeys.showtimeCity(
        "Jerusalem",
        bootstrap.publicationRevision,
      ),
    );
    expect(isMovieShowtimeDateCovered(targeted, "101", farDate, today)).toBe(
      true,
    );
    expect(isMovieShowtimeDateCovered(targeted, "101", today, today)).toBe(
      false,
    );
    expect(targeted?.targetedLoadedDayCountByTmdbId["101"]).toBe(0);
    expect(
      targeted?.movieShowtimesByTmdbId["101"]?.map((day) => day.date),
    ).toContain(farDate);
    queryClient.clear();
  });
});
