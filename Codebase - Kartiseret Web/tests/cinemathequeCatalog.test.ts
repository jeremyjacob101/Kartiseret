import { cinemathequeQueryOptions, getCinemathequeDateRange } from "../src/data/cinemathequeCatalog";
import { PUBLICATION_REVISION_HEADER } from "@kartiseret/contracts/public-data";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { sampleMovie } from "./fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cinematheque query", () => {
  it("requests the dedicated endpoint with the selected city and full date window", async () => {
    const range = getCinemathequeDateRange();
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(String(input)).toBe(
        `/api/v1/cinematheques?city=Jerusalem&startDate=${range.startDate}&endDate=${range.endDate}`,
      );
      expect(new Headers(init?.headers).get(PUBLICATION_REVISION_HEADER)).toBe(
        "7",
      );
      return new Response(
        JSON.stringify({
          data: {
            movies: [sampleMovie],
            movieCodesStatus: "ready",
            showtimes: [],
          },
          error: null,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            [PUBLICATION_REVISION_HEADER]: "7",
          },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const result = await queryClient.fetchQuery(
      cinemathequeQueryOptions("Jerusalem", "7"),
    );

    expect(result).toMatchObject({
      movies: [sampleMovie],
      movieCodesStatus: "ready",
      showtimes: [],
      publicationRevision: "7",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});
