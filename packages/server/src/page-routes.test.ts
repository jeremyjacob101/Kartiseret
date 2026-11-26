import { describe, expect, it, vi } from "vitest";
import {
  PostgresPublicRouteRegistry,
  resolveLegacyPublicRoute,
} from "./page-routes.js";
import { getPublicRouteRenderPath } from "@kartiseret/contracts/public-routes";

function poolReturning(rows: unknown[] = []) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { pool: { query } as never, query };
}

describe("public page route registry", () => {
  it("does not recognize the obsolete cinema URL format", () => {
    expect(resolveLegacyPublicRoute("/c/smBcm2HtRvQA")).toBeNull();
  });

  it("maps the static index alias to the opaque home page route", () => {
    expect(resolveLegacyPublicRoute("/index.html")).toMatchObject({
      destinationKey: "page:/",
      kind: "page",
      destinationId: "/",
    });
  });

  it("allows the linked license document to resolve through one opaque segment", () => {
    const input = resolveLegacyPublicRoute("/third-party-licenses.txt");
    expect(input).toMatchObject({
      destinationKey: "page:/third-party-licenses.txt",
      kind: "page",
      destinationId: "/third-party-licenses.txt",
    });
    expect(
      getPublicRouteRenderPath({
        code: "licens01",
        ...input!,
        payload: {},
      }),
    ).toBe("/third-party-licenses.txt");
  });

  it("moves expired share routes to the current Israel date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-26T12:00:00.000Z"));
    try {
      const renderPath = getPublicRouteRenderPath({
        code: "share123",
        destinationKey: "share:expired",
        kind: "share",
        destinationId: "D01",
        payload: {
          movieCode: "D01",
          city: "Jerusalem",
          date: "2020-01-01",
          filterMask: 0,
        },
      });
      expect(renderPath).not.toBeNull();
      expect(
        new URL(renderPath!, "https://seret.site").searchParams.get("date"),
      ).toBe("2026-11-26");
    } finally {
      vi.useRealTimers();
    }
  });

  it("recognizes authentication error callbacks so they can be made opaque", () => {
    expect(resolveLegacyPublicRoute("/?authError=1")).toMatchObject({
      kind: "page",
      destinationId: "/?authError=1",
    });
    expect(
      resolveLegacyPublicRoute("/?error=account_not_linked"),
    ).toMatchObject({
      kind: "page",
      destinationId: "/?error=account_not_linked",
    });
  });

  it("uses an idempotent destination key and a random eight-character code", async () => {
    const { pool, query } = poolReturning([
      {
        code: "a1b2c3d4",
        destination_key: "movie:123",
        destination_type: "movie",
        destination_id: "123",
        payload: {},
      },
    ]);
    const registry = new PostgresPublicRouteRegistry(pool);

    await expect(
      registry.getOrCreate({
        destinationKey: "movie:123",
        kind: "movie",
        destinationId: "123",
      }),
    ).resolves.toMatchObject({ code: "a1b2c3d4", kind: "movie" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (destination_key)"),
      expect.arrayContaining(["movie:123"]),
    );
  });

  it("returns null for malformed codes without querying the database", async () => {
    const { pool, query } = poolReturning();
    const registry = new PostgresPublicRouteRegistry(pool);

    await expect(registry.getByCode("AB12")).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("retries a code collision and returns the destination created concurrently", async () => {
    const pool = {
      query: vi
        .fn()
        .mockRejectedValueOnce({ code: "23505" })
        .mockResolvedValueOnce({
          rows: [
            {
              code: "c3d4e5f6",
              destination_key: "page:home",
              destination_type: "page",
              destination_id: "/",
              payload: {},
            },
          ],
        }),
    } as never;
    const codes = ["a1b2c3d4", "e5f6g7h8"];
    const registry = new PostgresPublicRouteRegistry(pool, () =>
      codes.shift()!,
    );

    await expect(
      registry.getOrCreate({
        destinationKey: "page:home",
        kind: "page",
        destinationId: "/",
      }),
    ).resolves.toMatchObject({ code: "c3d4e5f6" });
  });
});
