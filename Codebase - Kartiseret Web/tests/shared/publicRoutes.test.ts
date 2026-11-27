import { PUBLIC_ROUTE_CODE_CAPACITY, PUBLIC_ROUTE_CODE_LENGTH, getPublicRouteRenderPath } from "@kartiseret/contracts/public-routes";
import { addCalendarDays, buildMovieShowtimeSharePath } from "@kartiseret/contracts/showtime-links";
import { createPublicShowtimeSharePath } from "../../src/data/publicRoutes.js";
import { getCinemaDayDate } from "@kartiseret/contracts/showtime-day";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("opaque public routes", () => {
  it("uses eight lowercase alphanumeric characters with the expected capacity", () => {
    expect(PUBLIC_ROUTE_CODE_LENGTH).toBe(8);
    expect(PUBLIC_ROUTE_CODE_CAPACITY).toBe(36 ** 8);
    expect(PUBLIC_ROUTE_CODE_CAPACITY).toBe(2_821_109_907_456);
  });

  it("moves an expired shared showtime route to today without an extra notice state", () => {
    const today = getCinemaDayDate(new Date());
    const yesterday = addCalendarDays(today, -1);
    expect(yesterday).not.toBeNull();
    const state = {
      movieCode: "Ab1",
      city: "Jerusalem",
      date: yesterday!,
      filterMask: 0,
      excludedCinemaIds: [],
    };
    const path = getPublicRouteRenderPath({
      code: "abcde123",
      destinationKey: "movie-share:expired",
      kind: "share",
      destinationId: "Ab1",
      payload: state,
    });

    expect(path).toBe(buildMovieShowtimeSharePath({ ...state, date: today }));
  });

  it("requests an opaque one-segment code when creating a public showtime share", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { path: "/abcde123" }, error: null }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPublicShowtimeSharePath({
        movieCode: "Ab1",
        city: "Jerusalem",
        date: "2027-01-15",
        filterMask: 0,
        excludedCinemaIds: [],
      }),
    ).resolves.toBe("/abcde123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/public-routes/shares",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          movieCode: "Ab1",
          city: "Jerusalem",
          date: "2027-01-15",
          filterMask: 0,
          excludedCinemaIds: [],
        }),
      }),
    );
  });
});
