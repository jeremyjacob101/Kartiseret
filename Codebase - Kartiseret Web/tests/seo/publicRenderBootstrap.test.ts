import { createEmptyShowtimeCityData, isMovieShowtimeDateCovered, mergeShowtimeCityData, movieCatalogQueryKeys } from "../../src/data/movieCatalog";
import type { PublicPageBootstrap } from "@kartiseret/contracts/public-render";
import { seedPublicPageQueries } from "../../src/publicRenderBootstrap";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

const renderedAt = "2026-11-03T10:00:00.000Z";
const today = "2026-11-03";

function movieBootstrap(): PublicPageBootstrap {
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
        movies: [],
        movieCodesStatus: "ready",
        publicationRevision: "7",
      },
    },
    targetedMovieShowtimes: {
      city: "Jerusalem",
      date: today,
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
});
