import { theaterDataQueryOptions } from "../src/data/theaters";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { QueryClient } from "@tanstack/react-query";

const { getSupabaseBrowserClientMock } = vi.hoisted(() => ({
  getSupabaseBrowserClientMock: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

function createTheaterClient(response: () => Response | Promise<Response>) {
  return createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: async () => response() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("theater data query", () => {
  it("normalizes joined city metadata and sorts the result deterministically", async () => {
    getSupabaseBrowserClientMock.mockReturnValue(
      createTheaterClient(
        () =>
          new Response(
            JSON.stringify([
              {
                chain: " Cinema City ",
                address: " 2 Main Street ",
                location: " Tel Aviv Mall ",
                theater_name: " Cinema City Tel Aviv ",
                latitude: 32.08,
                longitude: 34.78,
                city_details: {
                  name: " Tel Aviv ",
                  alt_spellings: ["Tel Aviv", " TA ", "TA"],
                  latitude: 32.08,
                  longitude: 34.78,
                  zoom_layer: 10,
                  neighboring_cities: [
                    " Tel Aviv ",
                    "Jerusalem",
                    " Jerusalem ",
                  ],
                },
              },
              {
                chain: "Yes Planet",
                address: "1 Cinema Road",
                location: "Jerusalem",
                theater_name: "Yes Planet Jerusalem",
                latitude: 31.78,
                longitude: 35.2,
                city_details: {
                  name: "Jerusalem",
                  alt_spellings: [],
                  latitude: 31.78,
                  longitude: 35.2,
                  zoom_layer: 10,
                  neighboring_cities: ["Tel Aviv"],
                },
              },
              {
                chain: "Cinema City",
                address: "1 Main Street",
                location: "Tel Aviv Port",
                theater_name: "Cinema City Port",
                latitude: 32.09,
                longitude: 34.77,
                city_details: {
                  name: "Tel Aviv",
                  alt_spellings: ["Tel Aviv"],
                  latitude: 32.08,
                  longitude: 34.78,
                  zoom_layer: 10,
                  neighboring_cities: [],
                },
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const data = await new QueryClient().fetchQuery(theaterDataQueryOptions());

    expect(data.cities.map((city) => city.name)).toEqual([
      "Jerusalem",
      "Tel Aviv",
    ]);
    expect(data.theaters.map((theater) => theater.address)).toEqual([
      "1 Cinema Road",
      "1 Main Street",
      "2 Main Street",
    ]);
    expect(data.theaters[2]?.city).toEqual({
      name: "Tel Aviv",
      altSpellings: ["Tel Aviv", "TA"],
      latitude: 32.08,
      longitude: 34.78,
      zoomLayer: 10,
      neighboringCities: ["Jerusalem"],
    });
    expect(data.theaters[2]?.location).toBe("Tel Aviv Mall");
  });

  it("preserves Supabase failures instead of returning partial theater data", async () => {
    getSupabaseBrowserClientMock.mockReturnValue(
      createTheaterClient(
        () =>
          new Response(JSON.stringify({ message: "RLS denied" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(
      new QueryClient().fetchQuery(theaterDataQueryOptions()),
    ).rejects.toThrow("RLS denied");
  });
});
