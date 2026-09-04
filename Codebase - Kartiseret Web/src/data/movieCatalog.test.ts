import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { fixedAppDateString, invalidateAdminMovieEditQueries, mergeShowtimeCityData, movieCatalogQueryKeys, type Movie, type ShowtimeRow } from "./movieCatalog";
import { ticketAlertQueryKeys } from "./ticketAlerts";

function addDay(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function createMovie(tmdbId = "101"): Movie {
  return {
    tmdbId,
    movieCode: "Ab1",
    title: "Test Movie",
    year: 2026,
    genres: ["Drama"],
    imageSrc: "/poster.jpg",
    imdbRating: null,
    lbRating: null,
    lbVotes: null,
    tmdbRating: null,
    tmdbVotes: null,
    rtCriticRating: null,
    rtCriticVotes: null,
    rtAudienceRating: null,
    rtAudienceVotes: null,
    runtime: 100,
    popularity: 10,
    altOptions: [],
  };
}

function createShowtimeRow(
  date: string,
  overrides: Partial<ShowtimeRow> = {},
): ShowtimeRow {
  return {
    tmdb_id: "101",
    screening_city: "Jerusalem",
    date_of_showing: date,
    cinema: "Cinema City",
    showtime: "20:00",
    english_href: "https://example.test/tickets",
    screening_tech: "2D",
    screening_type: "Regular",
    dub_language: null,
    ...overrides,
  };
}

describe("movie catalog query keys", () => {
  it("includes every showtime request dimension and normalizes no movie id", () => {
    expect(
      movieCatalogQueryKeys.showtimeRange({
        city: "Jerusalem",
        startDate: "2026-08-23",
        endDate: "2026-09-06",
      }),
    ).toEqual([
      "movieCatalog",
      "showtimes",
      "ranges",
      {
        city: "Jerusalem",
        startDate: "2026-08-23",
        endDate: "2026-09-06",
        tmdbId: null,
      },
    ]);

    expect(
      movieCatalogQueryKeys.showtimeRange({
        city: "Haifa",
        startDate: "2026-08-25",
        endDate: "2026-08-25",
        tmdbId: "101",
      }),
    ).toEqual([
      "movieCatalog",
      "showtimes",
      "ranges",
      {
        city: "Haifa",
        startDate: "2026-08-25",
        endDate: "2026-08-25",
        tmdbId: "101",
      },
    ]);

    expect(
      movieCatalogQueryKeys.showtimeRange({
        city: "Jerusalem",
        startDate: "2026-08-23",
        endDate: "2026-08-23",
        tmdbId: "   ",
      })[3].tmdbId,
    ).toBeNull();
  });
});

describe("showtime city cache merging", () => {
  it("keeps targeted readiness separate and merges rows idempotently", () => {
    const movie = createMovie();
    const todayRow = createShowtimeRow(fixedAppDateString);
    const targeted = mergeShowtimeCityData(undefined, {
      city: "Jerusalem",
      dates: [fixedAppDateString],
      movies: [movie],
      rows: [todayRow],
      scope: { tmdbId: movie.tmdbId },
      visibleDayCount: 1,
    });

    expect(targeted.broadReady).toBe(false);
    expect(targeted.broadLoadedDayCount).toBe(0);
    expect(targeted.broadVisibleDayCount).toBe(0);
    expect(targeted.targetedFetchedDatesByTmdbId[movie.tmdbId]).toEqual([
      fixedAppDateString,
    ]);

    const broad = mergeShowtimeCityData(targeted, {
      city: "Jerusalem",
      dates: [fixedAppDateString, addDay(fixedAppDateString)],
      movies: [movie],
      rows: [todayRow, createShowtimeRow(addDay(fixedAppDateString))],
      scope: "broad",
      visibleDayCount: 2,
    });

    expect(broad.broadReady).toBe(true);
    expect(broad.broadLoadedDayCount).toBe(2);
    expect(broad.broadVisibleDayCount).toBe(2);
    expect(Object.keys(broad.rowsByKey)).toHaveLength(2);
    expect(broad.movieShowtimesByTmdbId[movie.tmdbId]).toHaveLength(2);
  });

  it("does not mistake an arbitrary future jump for contiguous coverage", () => {
    const movie = createMovie();
    const tomorrow = addDay(fixedAppDateString);
    const futureDate = addDay(tomorrow);
    const cache = mergeShowtimeCityData(undefined, {
      city: "Jerusalem",
      dates: [futureDate],
      movies: [movie],
      rows: [createShowtimeRow(futureDate)],
      scope: "broad",
      visibleDayCount: 3,
    });

    expect(cache.broadReady).toBe(true);
    expect(cache.broadLoadedDayCount).toBe(0);
    expect(cache.broadFetchedDates).toEqual([futureDate]);
  });

  it("replaces a fetched range so server-side updates and deletions do not linger", () => {
    const movie = createMovie();
    const initial = mergeShowtimeCityData(undefined, {
      city: "Jerusalem",
      dates: [fixedAppDateString],
      movies: [movie],
      rows: [createShowtimeRow(fixedAppDateString)],
      scope: "broad",
      visibleDayCount: 1,
    });
    const refreshed = mergeShowtimeCityData(initial, {
      city: "Jerusalem",
      dates: [fixedAppDateString],
      movies: [movie],
      rows: [
        createShowtimeRow(fixedAppDateString, {
          english_href: "https://example.test/updated",
        }),
      ],
      scope: "broad",
      visibleDayCount: 1,
    });

    expect(Object.keys(refreshed.rowsByKey)).toHaveLength(1);
    expect(
      refreshed.movieShowtimesByTmdbId[movie.tmdbId]?.[0]?.theaters[0]
        ?.showtimes[0]?.href,
    ).toBe("https://example.test/updated");
  });
});

describe("admin invalidation", () => {
  it("invalidates now-playing and resets every showtime cache without touching coming soon", async () => {
    const client = new QueryClient();
    const cityKey = movieCatalogQueryKeys.showtimeCity("Jerusalem");
    const rangeKey = movieCatalogQueryKeys.showtimeRange({
      city: "Jerusalem",
      startDate: fixedAppDateString,
      endDate: fixedAppDateString,
    });

    client.setQueryData(movieCatalogQueryKeys.collection("nowPlaying"), {});
    client.setQueryData(movieCatalogQueryKeys.collection("comingSoon"), {});
    client.setQueryData(cityKey, {});
    client.setQueryData(rangeKey, []);
    const availabilityKey = ticketAlertQueryKeys.availability(
      "101",
      fixedAppDateString,
    );
    const subscriptionsKey = ticketAlertQueryKeys.subscriptions("user-a");
    client.setQueryData(availabilityKey, []);
    client.setQueryData(subscriptionsKey, []);

    await invalidateAdminMovieEditQueries(client, "nowPlaying", "none");

    expect(
      client.getQueryState(movieCatalogQueryKeys.collection("nowPlaying"))
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryData(cityKey)).toBeUndefined();
    expect(client.getQueryData(rangeKey)).toBeUndefined();
    expect(client.getQueryState(availabilityKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(subscriptionsKey)?.isInvalidated).toBe(false);
    expect(
      client.getQueryState(movieCatalogQueryKeys.collection("comingSoon"))
        ?.isInvalidated,
    ).toBe(false);
  });

  it("keeps coming-soon invalidation scoped to its collection", async () => {
    const client = new QueryClient();
    const comingSoonKey = movieCatalogQueryKeys.collection("comingSoon");
    const cityKey = movieCatalogQueryKeys.showtimeCity("Jerusalem");

    client.setQueryData(comingSoonKey, {});
    client.setQueryData(cityKey, {});

    await invalidateAdminMovieEditQueries(client, "comingSoon", "none");

    expect(client.getQueryState(comingSoonKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(cityKey)?.isInvalidated).toBe(false);
  });
});
