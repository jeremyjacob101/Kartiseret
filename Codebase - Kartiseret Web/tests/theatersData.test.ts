import { theaterDataQueryOptions } from "../src/data/theaters";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("theater data API query", () => {
  it("accepts the normalized city and theater DTO and passes cancellation", async () => {
    let requestSignal: AbortSignal | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal as AbortSignal;
        expect(String(input)).toBe("/api/v1/theaters");
        return response({
          data: {
            cities: [
              {
                name: "Jerusalem",
                altSpellings: ["Jerusalem", "Yerushalayim"],
                latitude: 31.7683,
                longitude: 35.2137,
                zoomLayer: 10,
                neighboringCities: ["Mevaseret Zion"],
              },
            ],
            theaters: [
              {
                city: {
                  name: "Jerusalem",
                  altSpellings: ["Jerusalem", "Yerushalayim"],
                  latitude: 31.7683,
                  longitude: 35.2137,
                  zoomLayer: 10,
                  neighboringCities: ["Mevaseret Zion"],
                },
                chain: "Yes Planet",
                address: "1 Cinema Road",
                theaterName: "Yes Planet Jerusalem",
                location: "https://example.test/theater",
                lat: 31.78,
                lng: 35.2,
              },
            ],
          },
          error: null,
        });
      }),
    );

    const queryClient = new QueryClient();
    const data = await queryClient.fetchQuery(theaterDataQueryOptions());

    expect(data.cities[0]?.altSpellings).toEqual(["Jerusalem", "Yerushalayim"]);
    expect(data.theaters[0]?.chain).toBe("Yes Planet");
    expect(data.theaters[0]?.city.neighboringCities).toEqual([
      "Mevaseret Zion",
    ]);
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  it("preserves server errors instead of returning partial theater data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response(
          {
            data: null,
            error: {
              code: "catalog_unavailable",
              message: "The catalog is temporarily unavailable.",
            },
          },
          503,
        )),
    );

    await expect(
      new QueryClient().fetchQuery(theaterDataQueryOptions()),
    ).rejects.toThrow("The catalog is temporarily unavailable.");
  });

  it("rejects malformed normalized responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ data: [], error: null })),
    );
    await expect(
      new QueryClient().fetchQuery(theaterDataQueryOptions()),
    ).rejects.toThrow("expected data contract");
  });
});
