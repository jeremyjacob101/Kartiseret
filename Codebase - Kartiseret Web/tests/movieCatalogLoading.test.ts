import { createClient } from "@supabase/supabase-js";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixedAppDateString, findMovieByCode, movieCatalogQueryKeys, movieCollectionQueryOptions, selectCityHasAnyShowtimesOnDate, showtimeRangeQueryOptions } from "../src/data/movieCatalog";
import { queryClient } from "../src/lib/queryClient";

const { getSupabaseBrowserClientMock } = vi.hoisted(() => ({
  getSupabaseBrowserClientMock: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createCatalogClient(options: {
  movies?: unknown[];
  comingSoon?: unknown[];
  codes?: unknown[];
  showtimes?: unknown[];
  failOptionalMovieColumns?: boolean;
  requests?: Request[];
}) {
  let optionalMovieFailureUsed = false;
  return createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        options.requests?.push(request);
        const url = new URL(request.url);
        const table = url.pathname.split("/").at(-1);
        const select = url.searchParams.get("select") ?? "";

        if (
          table === "finalMovies" &&
          options.failOptionalMovieColumns &&
          select.includes("imdb_id") &&
          !optionalMovieFailureUsed
        ) {
          optionalMovieFailureUsed = true;
          return response({ message: "column imdb_id does not exist" }, 400);
        }

        if (table === "finalMovies") return response(options.movies ?? []);
        if (table === "finalSoons") return response(options.comingSoon ?? []);
        if (table === "movieCodes") return response(options.codes ?? []);
        if (table === "finalShowtimes")
          return response(options.showtimes ?? []);
        return response({ message: `Unexpected table ${table}` }, 500);
      },
    },
  });
}

const baseMovieRow = {
  tmdb_id: 101,
  english_title: ' " A Sample Movie " ',
  release_year: "2026",
  solo_update: false,
  genres: ["Drama", " Drama ", "Comedy"],
  en_poster: " /poster.jpg ",
  backdrop: "/backdrop.jpg",
  en_trailer: " dQw4w9WgXcQ ",
  imdb_id: "tt1234567",
  rt_id: "/m/sample",
  lb_id: "/film/sample",
  lbRating: "4.2",
  lbVotes: "1,200",
  tmdbRating: "8.4",
  tmdbVotes: 9876,
  imdbRating: "8.3",
  rtCriticRating: "80",
  rtCriticVotes: "100",
  rtAudienceRating: "92",
  rtAudienceVotes: "600",
  runtime: "125",
  popularity: "42.5",
  alt_options: [
    { tmdb: "202", title: " Alt Movie ", year: "2027", poster_url: "alt.jpg" },
  ],
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("movie catalog Supabase hydration", () => {
  it("normalizes fields, filters solo updates, maps movie codes, and sorts popularity", async () => {
    getSupabaseBrowserClientMock.mockReturnValue(
      createCatalogClient({
        movies: [
          baseMovieRow,
          {
            ...baseMovieRow,
            tmdb_id: 303,
            english_title: "Less Popular",
            popularity: "4",
            solo_update: "false",
          },
          { ...baseMovieRow, tmdb_id: 404, solo_update: "true" },
        ],
        codes: [
          { tmdb_id: 101, movie_code: "Ab1" },
          { tmdb_id: 303, movie_code: "bad" },
        ],
      }),
    );

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("nowPlaying"),
    );

    expect(data.movies.map((movie) => movie.tmdbId)).toEqual(["101", "303"]);
    expect(data.movies[0]).toMatchObject({
      tmdbId: "101",
      movieCode: "Ab1",
      title: "A Sample Movie",
      year: 2026,
      genres: ["Drama", "Comedy"],
      imageSrc: "/poster.jpg",
      backdropSrc: "/backdrop.jpg",
      trailerKey: "dQw4w9WgXcQ",
      lbRating: 4.2,
      runtime: 125,
      popularity: 42.5,
      altOptions: [
        { tmdbId: "202", title: "Alt Movie", year: 2027, posterUrl: "alt.jpg" },
      ],
    });
    expect(data.moviesByCode.Ab1?.tmdbId).toBe("101");
    expect(data.moviesByCode.bad?.tmdbId).toBe("303");
  });

  it("retries without optional columns when an older Supabase schema rejects them", async () => {
    const requests: Request[] = [];
    getSupabaseBrowserClientMock.mockReturnValue(
      createCatalogClient({
        movies: [baseMovieRow],
        codes: [{ tmdb_id: 101, movie_code: "Ab1" }],
        failOptionalMovieColumns: true,
        requests,
      }),
    );

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("nowPlaying"),
    );

    expect(data.movies).toHaveLength(1);
    expect(
      requests.filter((request) => request.url.includes("finalMovies")),
    ).toHaveLength(2);
    expect(requests[1]?.url).not.toContain("imdb_id");
  });

  it("sorts coming-soon movies by release date and falls back to release year", async () => {
    getSupabaseBrowserClientMock.mockReturnValue(
      createCatalogClient({
        comingSoon: [
          {
            ...baseMovieRow,
            tmdb_id: 1,
            release_date: "2026-12-01",
            release_year: 0,
            popularity: 50,
          },
          {
            ...baseMovieRow,
            tmdb_id: 2,
            release_date: "2026-10-01",
            release_year: 0,
            popularity: 1,
          },
          {
            ...baseMovieRow,
            tmdb_id: 3,
            release_date: "2026-10-01",
            release_year: 0,
            popularity: 5,
          },
        ],
        codes: [],
      }),
    );

    const data = await new QueryClient().fetchQuery(
      movieCollectionQueryOptions("comingSoon"),
    );

    expect(data.movies.map((movie) => movie.tmdbId)).toEqual(["3", "2", "1"]);
    expect(data.movies[0]?.year).toBe(2026);
    expect(data.movies[0]?.releaseDate).toBe("2026-10-01");
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
  it("returns no rows for inverted ranges without contacting Supabase", async () => {
    const requests: Request[] = [];
    getSupabaseBrowserClientMock.mockReturnValue(
      createCatalogClient({ requests, showtimes: [] }),
    );

    const rows = await new QueryClient().fetchQuery(
      showtimeRangeQueryOptions({
        city: "Jerusalem",
        startDate: "2026-09-20",
        endDate: "2026-09-19",
      }),
    );

    expect(rows).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
