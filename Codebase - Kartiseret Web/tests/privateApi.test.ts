import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../src/lib/authClient", () => ({
  getAuthClient: () => ({ getSession }),
}));
const alice = "00000000-0000-4000-8000-000000000001";
let boundary: typeof import("../src/data/privateApi");
let client: typeof import("../src/lib/queryClient");
beforeEach(async () => {
  vi.resetModules();
  client = await import("../src/lib/queryClient");
  boundary = await import("../src/data/privateApi");
  getSession.mockResolvedValue({
    data: { user: { id: alice } },
    error: null,
  });
});
afterEach(() => {
  client.queryClient.clear();
  vi.unstubAllGlobals();
});
describe("private request identity and cache ownership", () => {
  it("uses same-origin cookies for the protected transport and rejects a mismatched account", async () => {
    const transport = vi.fn(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    vi.stubGlobal("fetch", transport);
    await expect(
      boundary.privateApiResponse(
        "/api/v1/account",
        z.object({ ok: z.boolean() }),
        { userId: alice },
      ),
    ).resolves.toEqual({ ok: true });
    expect(transport).toHaveBeenCalledWith(
      "/api/v1/account",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-Kartiseret-Account-Id": alice,
        },
      }),
    );
    await expect(
      boundary.privateApiResponse("/api/v1/account", z.unknown(), {
        userId: "other-account",
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("reports unavailable session verification without turning it into a login error", async () => {
    getSession.mockResolvedValueOnce({ data: null, error: { status: 503 } });
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    await expect(
      boundary.privateApiResponse("/api/v1/account", z.unknown()),
    ).rejects.toMatchObject({ status: 503, code: "auth_unavailable" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("allows the expected signup account to activate while its session is being read", async () => {
    boundary.privateIdentityChanged(null);
    let finish!: (value: unknown) => void;
    getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ ok: true })),
    );
    const pending = boundary.privateApiResponse(
      "/api/v1/preferences/initialize",
      z.object({ ok: z.boolean() }),
      { method: "POST", userId: alice, body: {} },
    );
    boundary.privateIdentityChanged(alice);
    finish({
      data: {
        user: { id: alice },
      },
      error: null,
    });
    await expect(pending).resolves.toEqual({ ok: true });
  });
  it("rejects a session read that resolves for a departing account", async () => {
    boundary.privateIdentityChanged(alice);
    let finish!: (value: unknown) => void;
    getSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    const pending = boundary.privateApiResponse(
      "/api/v1/preferences",
      z.unknown(),
      { userId: alice },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    boundary.privateIdentityChanged("00000000-0000-4000-8000-000000000002");
    finish({
      data: { user: { id: alice } },
      error: null,
    });
    await rejected;
    expect(transport).not.toHaveBeenCalled();
  });
  it("discards a delayed departing-account response and clears only private caches", async () => {
    boundary.privateIdentityChanged(alice);
    client.queryClient.setQueryData(
      ["ticketAlerts", "subscriptions", alice],
      ["private"],
    );
    client.queryClient.setQueryData(["adminStatus", "user", alice], true);
    client.queryClient.setQueryData(
      ["movieCatalog", "collection", "nowPlaying"],
      ["public"],
    );
    let finish!: () => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          finish = () => resolve(new Response(JSON.stringify({ ok: true })));
        }),
    );
    const pending = boundary.privateApiResponse(
      "/api/v1/account",
      z.object({ ok: z.boolean() }),
      { userId: alice },
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    boundary.privateIdentityChanged(null);
    finish();
    await rejected;
    expect(
      client.queryClient.getQueryData(["ticketAlerts", "subscriptions", alice]),
    ).toBeUndefined();
    expect(
      client.queryClient.getQueryData(["adminStatus", "user", alice]),
    ).toBeUndefined();
    expect(
      client.queryClient.getQueryData([
        "movieCatalog",
        "collection",
        "nowPlaying",
      ]),
    ).toEqual(["public"]);
  });
  it("does not retry rejected writes", async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: null,
            error: { code: "unauthorized", message: "Session expired" },
          }),
          { status: 401 },
        ),
    );
    vi.stubGlobal("fetch", transport);
    await expect(
      boundary.privateApiResponse("/api/v1/preferences", z.unknown(), {
        method: "PATCH",
        body: { siteColor: "#123456" },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
