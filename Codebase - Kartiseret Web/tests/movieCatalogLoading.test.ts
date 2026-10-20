import { fixedAppDateString, findMovieByCode, movieCatalogQueryKeys, movieCollectionQueryOptions, selectCityHasAnyShowtimesOnDate, showtimeRangeQueryOptions } from "../src/data/movieCatalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/queryClient";
import { QueryClient } from "@tanstack/react-query";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function movie(overrides: Record<string, unknown> = {}) {
  return {
    tmdbId: "101",
    movieCode: "Ab1",
    title: "A Sample Movie",
    year: 2026,
    genres: ["Drama", "Comedy"],
    imageSrc: "/poster.jpg",
    backdropSrc: "/backdrop.jpg",
    trailerKey: "dQw4w9WgXcQ",
    imdbRating: 8.3,
    lbRating: 4.2,
    lbVotes: 1200,
    tmdbRating: 8.4,
    tmdbVotes: 9876,
    rtCriticRating: 80,
    rtCriticVotes: 100,
    rtAudienceRating: 92,
    rtAudienceVotes: 600,
    runtime: 125,
    popularity: 42.5,
    altOptions: [
      { tmdbId: "202", title: "Alt Movie", year: 2027, posterUrl: "alt.jpg" },
    ],
    ...overrides,
  };
}

function catalog(
  mode: "nowPlaying" | "comingSoon",
  movies: unknown[],
  movieCodesStatus = "ready",
) {
  return { data: { mode, movies, movieCodesStatus }, error: null };
}

function installFetch(
  handler: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("movie catalog API queries", () => {
  it("fetches the normalized catalog and permanent codes in one request", async () => {
    const fetchMock = installFetch((input, init) => {
      expect(String(input)).toBe("/api/v1/catalog/now-playing");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response(
        catalog("nowPlaying", [
          movie(),
          movie({ tmdbId: "303", movieCode: undefined, title: "Less Popular" }),
        ]),
      );
    });

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("nowPlaying"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.movies.map((item) => item.tmdbId)).toEqual(["101", "303"]);
    expect(data.moviesByCode.Ab1?.tmdbId).toBe("101");
    expect(data.movieCodesStatus).toBe("ready");
  });

  it("settles failed code lookup readiness while retaining catalog movies", async () => {
    installFetch(() =>
      response(
        catalog("nowPlaying", [movie({ movieCode: undefined })], "failed"),
      ));

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("nowPlaying"),
    );

    expect(data.movieCodesStatus).toBe("failed");
    expect(data.movies).toHaveLength(1);
    expect(data.moviesByCode).toEqual({});
  });

  it("loads the coming-soon DTO from its dedicated route and indexes included codes", async () => {
    const movies = [
      movie({
        tmdbId: "3",
        movieCode: "So3",
        releaseDate: "2026-10-01",
        year: 2026,
      }),
      movie({
        tmdbId: "2",
        movieCode: "So2",
        releaseDate: "2026-10-01",
        year: 2026,
      }),
      movie({
        tmdbId: "1",
        movieCode: undefined,
        releaseDate: "2026-12-01",
        year: 2026,
      }),
    ];
    const fetchMock = installFetch((input) => {
      expect(String(input)).toBe("/api/v1/catalog/coming-soon");
      return response(catalog("comingSoon", movies));
    });

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("comingSoon"),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.movies.map((item) => item.tmdbId)).toEqual(["3", "2", "1"]);
    expect(data.moviesByCode.So3?.tmdbId).toBe("3");
  });

  it("rejects a mismatched server catalog mode instead of caching it under another key", async () => {
    installFetch(() => response(catalog("comingSoon", [movie()])));
    await expect(
      new QueryClient().fetchQuery(movieCollectionQueryOptions("nowPlaying")),
    ).rejects.toThrow("wrong catalog mode");
  });
});

describe("movie catalog cache selectors", () => {
  it("prefers now-playing route matches and distinguishes invalid codes", () => {
    const movie = {
      tmdbId: "101",
      movieCode: "Ab1",
    };
    queryClient.setQueryData(movieCatalogQueryKeys.collection("nowPlaying"), {
      mode: "nowPlaying",
      movies: [movie],
      moviesByCode: { Ab1: movie },
      movieCodesStatus: "ready",
    });

    expect(findMovieByCode("not-valid")).toBeNull();
    expect(findMovieByCode("Ab1")).toEqual({ movie, mode: "nowPlaying" });
  });

  it("reports city showtime presence only inside the visible broad window", () => {
    const data = {
      broadReady: true,
      broadVisibleDayCount: 2,
      movieShowtimesByTmdbId: {
        "101": [
          { date: fixedAppDateString, theaters: [] },
          {
            date: "2099-01-01",
            theaters: [{ theater: "Cinema City", showtimes: [] }],
          },
        ],
      },
    };

    expect(
      selectCityHasAnyShowtimesOnDate(data as never, fixedAppDateString),
    ).toBe(false);
    expect(selectCityHasAnyShowtimesOnDate(data as never, "2099-01-01")).toBe(
      false,
    );
  });
});

describe("showtime range loading guards", () => {
  it("requests a normalized same-origin range and passes cancellation", async () => {
    let requestUrl = "";
    let requestSignal: AbortSignal | undefined;
    installFetch((input, init) => {
      requestUrl = String(input);
      requestSignal = init?.signal as AbortSignal;
      return response({
        data: {
          showtimes: [
            {
              tmdbId: "101",
              screeningCity: "Jerusalem",
              dateOfShowing: "2026-09-20",
              cinema: "Cinema City",
              showtime: "20:00",
              englishHref: "https://tickets.example",
              hebrewHref: null,
              screeningTech: "2D",
              screeningType: "Regular",
              dubLanguage: null,
            },
          ],
        },
        error: null,
      });
    });

    const rows = await new QueryClient().fetchQuery(
      showtimeRangeQueryOptions({
        city: "Jerusalem",
        startDate: "2026-09-20",
        endDate: "2026-09-20",
        tmdbId: "101",
      }),
    );

    expect(new URL(requestUrl, "https://example.test").pathname).toBe(
      "/api/v1/showtimes",
    );
    expect(new URLSearchParams(requestUrl.split("?")[1]).get("tmdbId")).toBe(
      "101",
    );
    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(rows[0]?.showtime).toBe("20:00");
  });

  it("returns no rows for inverted ranges without making an API request", async () => {
    const fetchMock = installFetch(() =>
      response({ data: { showtimes: [] }, error: null }));

    const rows = await new QueryClient().fetchQuery(
      showtimeRangeQueryOptions({
        city: "Jerusalem",
        startDate: "2026-09-20",
        endDate: "2026-09-19",
      }),
    );

    expect(rows).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
