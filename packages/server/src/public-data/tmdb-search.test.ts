import { describe, expect, it, vi } from "vitest";
import {
  createTmdbSearchProvider,
  TmdbSearchUnavailableError,
} from "./tmdb-search.js";

describe("server-side TMDb title search", () => {
  it("uses the server key upstream and returns only normalized movie metadata", async () => {
    let requestUrl: URL | undefined;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestUrl = new URL(String(input));
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 9876,
              title: "Future Film",
              release_date: "2027-04-12",
              poster_path: "/poster.jpg",
              overview: "not returned",
            },
          ],
        }),
        { status: 200 },
      );
    });

    const search = createTmdbSearchProvider("private-test-key", fetcher);
    const results = await search("Future Film");

    expect(requestUrl?.origin).toBe("https://api.themoviedb.org");
    expect(requestUrl?.pathname).toBe("/3/search/movie");
    expect(requestUrl?.searchParams.get("api_key")).toBe("private-test-key");
    expect(requestUrl?.searchParams.get("query")).toBe("Future Film");
    expect(results).toEqual([
      {
        tmdbId: "9876",
        title: "Future Film",
        releaseYear: 2027,
        posterPath: "/poster.jpg",
      },
    ]);
    expect(JSON.stringify(results)).not.toContain("private-test-key");
    expect(JSON.stringify(results)).not.toContain("overview");
  });

  it("fails safely when the server key or upstream search is unavailable", async () => {
    await expect(createTmdbSearchProvider(undefined)("Film")).rejects.toThrow(
      TmdbSearchUnavailableError,
    );
    const search = createTmdbSearchProvider(
      "private-test-key",
      vi.fn(async () => new Response("failure", { status: 401 })),
    );
    await expect(search("Film")).rejects.toThrow(TmdbSearchUnavailableError);
  });
});
