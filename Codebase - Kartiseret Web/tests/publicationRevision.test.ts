import { fixedAppDateString, mergeShowtimeCityData, movieCatalogQueryKeys, movieCollectionQueryOptions, showtimeRangeQueryOptions } from "../src/data/movieCatalog";
import { assertPublication, currentPublicationRevision, publicationOf, tagPublication } from "../src/data/publicationRevision";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticketAlertQueryKeys } from "../src/data/ticketAlerts";
import { getPublicationResponse } from "../src/data/apiClient";
import { queryClient } from "../src/lib/queryClient";
import { z } from "zod";

function response(data: unknown, revision?: string, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(revision === undefined
        ? {}
        : { "X-Kartiseret-Publication": revision }),
    },
  });
}
const catalog = {
  data: {
    mode: "nowPlaying",
    movies: [
      {
        tmdbId: "101",
        movieCode: "Ab1",
        title: "Unchanged film",
        year: 2026,
        genres: [],
        imageSrc: "",
        imdbRating: null,
        lbRating: null,
        lbVotes: null,
        tmdbRating: null,
        tmdbVotes: null,
        rtCriticRating: null,
        rtCriticVotes: null,
        rtAudienceRating: null,
        rtAudienceVotes: null,
        runtime: 90,
        popularity: 1,
        altOptions: [],
      },
    ],
    movieCodesStatus: "ready",
  },
  error: null,
};
const range = {
  city: "Tel Aviv" as const,
  startDate: fixedAppDateString,
  endDate: fixedAppDateString,
};
beforeEach(() => queryClient.clear());
afterEach(() => vi.unstubAllGlobals());

describe("publication generations across browser requests", () => {
  it("requires a revision, pins the expected revision and disables the HTTP cache", async () => {
    const fetch = vi.fn((_input, init?: RequestInit) => {
      expect(init?.cache).toBe("no-store");
      expect(init?.headers).toMatchObject({ "X-Kartiseret-Publication": "12" });
      return Promise.resolve(response({ ok: true }, "12"));
    });
    vi.stubGlobal("fetch", fetch);
    expect(
      (
        await getPublicationResponse(
          "/fixture",
          z.object({ ok: z.boolean() }),
          undefined,
          "12",
        )
      ).revision,
    ).toBe("12");
    fetch.mockImplementation(() =>
      Promise.resolve(response({ ok: true }, "13")));
    await expect(
      getPublicationResponse(
        "/fixture",
        z.object({ ok: z.boolean() }),
        undefined,
        "12",
      ),
    ).rejects.toMatchObject({ code: "publication_changed" });
    fetch.mockImplementation(() => Promise.resolve(response({ ok: true })));
    await expect(
      getPublicationResponse("/fixture", z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("refreshes the catalog after a stale range without retrying that old revision", async () => {
    let published = "12";
    const fetch = vi.fn((input, init?: RequestInit) => {
      if (String(input).includes("/catalog/"))
        return Promise.resolve(response(catalog, published));
      expect(init?.headers).toMatchObject({ "X-Kartiseret-Publication": "12" });
      return Promise.resolve(
        response(
          {
            data: null,
            error: { code: "publication_changed", message: "Reload" },
          },
          undefined,
          409,
        ),
      );
    });
    vi.stubGlobal("fetch", fetch);
    const before = await queryClient.fetchQuery(
      movieCollectionQueryOptions("nowPlaying"),
    );
    const oldCityKey = movieCatalogQueryKeys.showtimeCity("Tel Aviv");
    const oldTicketKey = ticketAlertQueryKeys.availability(
      "101",
      fixedAppDateString,
    );
    published = "13";
    await expect(
      queryClient.fetchQuery(showtimeRangeQueryOptions(range)),
    ).rejects.toMatchObject({ code: "publication_changed" });
    const after = queryClient.getQueryData(
      movieCatalogQueryKeys.collection("nowPlaying"),
    );
    expect(before).not.toBe(after); // Even when all movie fields are unchanged.
    expect(currentPublicationRevision()).toBe("13");
    expect(movieCatalogQueryKeys.showtimeCity("Tel Aviv")).not.toEqual(
      oldCityKey,
    );
    expect(
      ticketAlertQueryKeys.availability("101", fixedAppDateString),
    ).not.toEqual(oldTicketKey);
    expect(
      fetch.mock.calls.filter(([url]) => String(url).includes("/showtimes")),
    ).toHaveLength(1);
  });

  it("rejects a delayed old response after a newer catalog arrived", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(response(catalog, "12")));
    await queryClient.fetchQuery(movieCollectionQueryOptions("nowPlaying"));
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = queryClient.fetchQuery(showtimeRangeQueryOptions(range));
    vi.stubGlobal("fetch", () => Promise.resolve(response(catalog, "13")));
    await queryClient.fetchQuery({
      ...movieCollectionQueryOptions("nowPlaying"),
      staleTime: 0,
    });
    finish(response({ data: { showtimes: [] }, error: null }, "12"));
    const oldRows = await pending;
    expect(publicationOf(oldRows)).toBe("12");
    expect(() => assertPublication(oldRows)).toThrow(/changed/);
    expect(
      queryClient.getQueryData(movieCatalogQueryKeys.showtimeRange(range)),
    ).toBeUndefined();
  });

  it("drops broad and targeted coverage when the revision changes", () => {
    const old = mergeShowtimeCityData(undefined, {
      city: "Tel Aviv",
      dates: [fixedAppDateString],
      rows: tagPublication([], "12"),
      movies: [],
      scope: "broad",
      visibleDayCount: 7,
    });
    const targeted = mergeShowtimeCityData(old, {
      city: "Tel Aviv",
      dates: ["2035-01-01"],
      rows: tagPublication([], "12"),
      movies: [],
      scope: { tmdbId: "101" },
      visibleDayCount: 7,
    });
    expect(targeted.targetedFetchedDatesByTmdbId["101"]).toEqual([
      "2035-01-01",
    ]);
    const fresh = mergeShowtimeCityData(targeted, {
      city: "Tel Aviv",
      dates: [fixedAppDateString],
      rows: tagPublication([], "13"),
      movies: [],
      scope: "broad",
      visibleDayCount: 1,
    });
    expect(fresh.publicationRevision).toBe("13");
    expect(fresh.targetedFetchedDatesByTmdbId).toEqual({});
    expect(fresh.broadVisibleDayCount).toBe(1);
  });
});
