import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { HttpError } from "../http-errors.js";
import type { ProtectedWorkflowService } from "./service.js";
import type { ProtectedRateLimitOptions } from "./router.js";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  type TicketAlertCriteria,
} from "@kartiseret/contracts/private-data";
const id = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000099";
const preferences = {
  ratingSources: ["imdbRating" as const],
  location: "Haifa",
  siteColor: "#123456",
};
function setup(protectedRateLimit?: ProtectedRateLimitOptions) {
  const user = { id, email: "qa@example.test" };
  const workflows: ProtectedWorkflowService = {
    account: vi.fn(async () => ({ user, isAdmin: false })),
    preferences: vi.fn(async () => preferences),
    patchPreferences: vi.fn(async () => preferences),
    ticketAlertPreferences: vi.fn(async () => DEFAULT_TICKET_ALERT_CRITERIA),
    patchTicketAlertPreferences: vi.fn(
      async () => DEFAULT_TICKET_ALERT_CRITERIA,
    ),
    subscriptions: vi.fn(async () => ({ subscriptions: [], nextOffset: null })),
    subscribe: vi.fn(async () => ({ kind: "available" as const })),
    updateTicketAlertCriteria: vi.fn(async () => ({
      kind: "available" as const,
    })),
    comingSoonDateWatches: vi.fn(async () => []),
    watchComingSoonDate: vi.fn(async (_user, input) => ({
      kind: "watching" as const,
      watch: {
        ...input,
        createdAt: "2026-10-21T10:00:00.000Z",
        notifiedAt: null,
        comingSoonDate: null,
      },
    })),
    unwatchComingSoonDate: vi.fn(async () => ({ removed: true as const })),
    movieDisplayPreferences: vi.fn(async () => ({
      preferences: [],
      nextCursor: null,
    })),
    upsertMovieDisplayPreference: vi.fn(
      async (_user, preference) => preference,
    ),
    patchMovieDisplayPreference: vi.fn(async (_user, tmdbId, patch) => ({
      tmdbId,
      title: "Sensitive Poster",
      releaseYear: 2026,
      treatment: patch.treatment ?? "standard",
      hideBackdrop: patch.hideBackdrop ?? true,
    })),
    removeMovieDisplayPreference: vi.fn(async () => ({
      removed: true as const,
    })),
    listLetterboxdSources: vi.fn(async () => []),
    addLetterboxdSource: vi.fn(async (_user, input) => ({
      id: sourceId,
      sourceUrl: input.sourceUrl,
      sourceType: "watchlist" as const,
      createdAt: "2026-10-21T10:00:00.000Z",
      lastSyncAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncError: null,
      filmCount: 0,
      matchedFilmCount: 0,
    })),
    removeLetterboxdSource: vi.fn(async () => ({ removed: true as const })),
    cancel: vi.fn(async () => ({
      kind: "account" as const,
      subscription: null,
    })),
    correct: vi.fn(async () => {
      throw new HttpError(
        403,
        "forbidden",
        "Administrator access is required.",
      );
    }),
  };
  const verify = vi.fn(async (token: string) => {
    if (token !== "valid")
      throw new HttpError(401, "unauthorized", "Invalid session.");
    return user;
  });
  return {
    workflows,
    verify,
    app: createApp({
      catalogRepository: {
        findNowPlayingRows: async () => [],
        findMovieCodes: async () => new Map(),
      },
      identityVerifier: { verify },
      protectedWorkflows: workflows,
      trustedOrigins: ["http://localhost"],
      protectedRateLimit,
    }),
  };
}
describe("protected HTTP contracts", () => {
  it("allows generous protected use, returns a retryable 429, and leaves public browsing available", async () => {
    const { app, verify, workflows } = setup({
      limit: 2,
      clientIp: (request) => request.get("x-test-client-ip") ?? undefined,
    });
    const send = () =>
      request(app)
        .get("/api/v1/account")
        .set("x-test-client-ip", "192.0.2.10")
        .set("Cookie", "valid");

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({
      data: null,
      error: {
        code: "rate_limited",
        message: "Please wait briefly and try again.",
      },
    });
    expect(limited.headers["cache-control"]).toBe("no-store");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.headers["ratelimit-limit"]).toBe("2");
    expect(limited.headers["ratelimit-remaining"]).toBe("0");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(workflows.account).toHaveBeenCalledTimes(2);
    expect((await request(app).get("/api/v1/catalog/now-playing")).status).toBe(
      200,
    );
  });

  it("counts invalid-cookie traffic before session verification", async () => {
    const { app, verify, workflows } = setup({
      limit: 2,
      clientIp: (request) => request.get("x-test-client-ip") ?? undefined,
    });
    const send = () =>
      request(app)
        .get("/api/v1/account")
        .set("x-test-client-ip", "192.0.2.12")
        .set("Cookie", "invalid");

    expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(401);
    expect((await send()).status).toBe(429);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(workflows.account).not.toHaveBeenCalled();
  });

  it("uses separate IP counters and groups IPv6 clients by their /64", async () => {
    const { app } = setup({
      limit: 1,
      clientIp: (request) => request.get("x-test-client-ip") ?? undefined,
    });
    const send = (ip: string) =>
      request(app)
        .get("/api/v1/account")
        .set("x-test-client-ip", ip)
        .set("Cookie", "valid");

    expect((await send("192.0.2.10")).status).toBe(200);
    expect((await send("192.0.2.11")).status).toBe(200);
    expect((await send("192.0.2.10")).status).toBe(429);
    expect((await send("2001:db8::1")).status).toBe(200);
    expect((await send("2001:db8::2")).status).toBe(429);
    expect((await send("2001:db8:1::1")).status).toBe(200);
  });

  it("ignores forwarded IPs outside Vercel and lets requests continue when identity or storage is unavailable", async () => {
    const missingIpDiagnostic = vi.fn();
    const missingIp = setup({
      clientIp: () => undefined,
      onDiagnostic: missingIpDiagnostic,
    });
    const missingResult = await request(missingIp.app)
      .get("/api/v1/account")
      .set("Cookie", "valid")
      .set("X-Forwarded-For", "192.0.2.10");
    expect(missingResult.status).toBe(200);
    expect(missingIp.verify).toHaveBeenCalledTimes(1);
    expect(missingIpDiagnostic).toHaveBeenCalledWith("client_ip_unavailable");

    const storeDiagnostic = vi.fn();
    const failedStore = setup({
      store: {
        increment: async () => {
          throw new Error("sensitive SQL detail");
        },
        decrement: () => undefined,
        resetKey: () => undefined,
      },
      onDiagnostic: storeDiagnostic,
    });
    const result = await request(failedStore.app)
      .get("/api/v1/account")
      .set("Cookie", "valid");
    expect(result.status).toBe(200);
    expect(failedStore.verify).toHaveBeenCalledTimes(1);
    expect(storeDiagnostic).toHaveBeenCalledWith("rate_limit_store_error");
  });

  it("resets a fixed-window quota after the window expires", async () => {
    const { app } = setup({
      limit: 1,
      windowMs: 100,
      clientIp: (request) => request.get("x-test-client-ip") ?? undefined,
    });
    const send = () =>
      request(app)
        .get("/api/v1/account")
        .set("x-test-client-ip", "192.0.2.40")
        .set("Cookie", "valid");

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect((await send()).status).toBe(200);
  });

  it("ignores client supplied forwarded IPs outside Vercel", async () => {
    const { app } = setup({
      limit: 1,
      clientIp: (request) => request.socket.remoteAddress ?? undefined,
    });
    const send = (forwardedIp: string) =>
      request(app)
        .get("/api/v1/account")
        .set("X-Forwarded-For", forwardedIp)
        .set("Cookie", "invalid");

    expect((await send("192.0.2.1")).status).toBe(401);
    expect((await send("192.0.2.2")).status).toBe(429);
  });

  it.each([undefined, "Basic valid", "Bearer expired", "Bearer a,b"])(
    "rejects absent/malformed/invalid credentials before repository work: %s",
    async (authorization) => {
      const { app, workflows } = setup();
      const req = request(app).get("/api/v1/account");
      if (authorization) req.set("Authorization", authorization);
      const result = await req;
      expect(result.status).toBe(401);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(workflows.account).not.toHaveBeenCalled();
    },
  );
  it("uses verified identity instead of accepting a caller-selected account", async () => {
    const { app, workflows } = setup();
    const result = await request(app)
      .get("/api/v1/account")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost");
    expect(result.status).toBe(200);
    expect(result.body.data.user.id).toBe(id);
    expect(result.headers.vary).toContain("Cookie");
    expect(workflows.account).toHaveBeenCalledWith({
      id,
      email: "qa@example.test",
    });
    expect(
      (
        await request(app)
          .get("/api/v1/account?userId=other")
          .set("Cookie", "valid")
          .set("Origin", "http://localhost")
      ).status,
    ).toBe(400);
  });
  it("rejects an account expectation that no longer matches the cookie identity", async () => {
    const { app, workflows } = setup();
    const result = await request(app)
      .get("/api/v1/account")
      .set("Cookie", "valid")
      .set("X-Kartiseret-Account-Id", "00000000-0000-4000-8000-000000000002");
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("account_changed");
    expect(workflows.account).not.toHaveBeenCalled();
  });
  it.each([
    { userId: id, siteColor: "#123456" },
    {},
    { siteColor: "bad" },
    { isAdmin: true },
  ])("rejects invalid or mass-assigned preference bodies", async (body) => {
    const { app, workflows } = setup();
    const result = await request(app)
      .patch("/api/v1/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(body);
    expect(result.status).toBe(400);
    expect(workflows.patchPreferences).not.toHaveBeenCalled();
  });
  it("rejects server-owned subscription fields and non-admin corrections", async () => {
    const { app, workflows } = setup();
    expect(
      (
        await request(app)
          .post("/api/v1/ticket-alerts")
          .set("Cookie", "valid")
          .set("Origin", "http://localhost")
          .send({ tmdbId: "101", preferredCity: "Haifa", notifiedAt: null })
      ).status,
    ).toBe(400);
    expect(workflows.subscribe).not.toHaveBeenCalled();
    expect(
      (
        await request(app)
          .post("/api/v1/admin/movie-corrections")
          .set("Cookie", "valid")
          .set("Origin", "http://localhost")
          .send({
            mode: "nowPlaying",
            currentTmdbId: "101",
            selectedTmdbId: "102",
            isManualEntry: true,
          })
      ).status,
    ).toBe(403);
  });
  it("reads and updates owner-scoped ticket alert criteria through protected routes", async () => {
    const { app, workflows } = setup();
    const defaults: TicketAlertCriteria = {
      notificationMode: "first_any_city",
      cities: ["Haifa", "Tel Aviv"],
      filters: {
        showType: ["Premium"],
        screenFormat: [],
        screeningTech: ["IMAX"],
        dubLanguage: [],
      },
    };
    vi.mocked(workflows.ticketAlertPreferences).mockResolvedValue(defaults);
    vi.mocked(workflows.patchTicketAlertPreferences).mockResolvedValue(
      defaults,
    );
    const read = await request(app)
      .get("/api/v1/ticket-alerts/preferences")
      .set("Cookie", "valid");
    expect(read.status).toBe(200);
    expect(read.body.data.preferences).toEqual(defaults);
    expect(read.headers["cache-control"]).toBe("no-store");

    const saved = await request(app)
      .patch("/api/v1/ticket-alerts/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(defaults);
    expect(saved.status).toBe(200);
    expect(workflows.patchTicketAlertPreferences).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      defaults,
    );

    const override = {
      cities: null,
      filters: { screeningTech: ["4DX"] },
    };
    const updated = await request(app)
      .patch("/api/v1/ticket-alerts/101/criteria")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ criteriaOverrides: override });
    expect(updated.status).toBe(200);
    expect(workflows.updateTicketAlertCriteria).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      "101",
      override,
    );
  });
  it("rejects invalid alert criteria and unknown fields", async () => {
    const { app, workflows } = setup();
    const result = await request(app)
      .patch("/api/v1/ticket-alerts/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({
        cities: ["Mars"],
        filters: DEFAULT_TICKET_ALERT_CRITERIA.filters,
      });
    expect(result.status).toBe(400);
    expect(workflows.patchTicketAlertPreferences).not.toHaveBeenCalled();
  });
  it("keeps TMDb date watches behind authenticated owner-scoped routes", async () => {
    const { app, workflows } = setup();
    const anonymous = await request(app).get("/api/v1/coming-soon-watches");
    expect(anonymous.status).toBe(401);

    const read = await request(app)
      .get("/api/v1/coming-soon-watches")
      .set("Cookie", "valid");
    expect(read.status).toBe(200);
    expect(read.body.data.watches).toEqual([]);
    expect(read.headers["cache-control"]).toBe("no-store");

    const watch = await request(app)
      .post("/api/v1/coming-soon-watches")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({
        tmdbId: "9100001",
        title: "Future Film",
        releaseYear: 2027,
        posterPath: "/poster.jpg",
      });
    expect(watch.status).toBe(200);
    expect(watch.body.data.watch.tmdbId).toBe("9100001");
    expect(workflows.watchComingSoonDate).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      {
        tmdbId: "9100001",
        title: "Future Film",
        releaseYear: 2027,
        posterPath: "/poster.jpg",
      },
    );

    const massAssigned = await request(app)
      .post("/api/v1/coming-soon-watches")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({
        tmdbId: "9100001",
        title: "Future Film",
        releaseYear: 2027,
        posterPath: "/poster.jpg",
        notifiedAt: null,
      });
    expect(massAssigned.status).toBe(400);

    const removed = await request(app)
      .delete("/api/v1/coming-soon-watches/9100001")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost");
    expect(removed.status).toBe(200);
    expect(workflows.unwatchComingSoonDate).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      "9100001",
    );
  });
  it("keeps movie display choices behind authenticated owner-scoped routes", async () => {
    const { app, workflows } = setup();
    expect(
      (await request(app).get("/api/v1/preferences/movie-display")).status,
    ).toBe(401);

    const read = await request(app)
      .get("/api/v1/preferences/movie-display")
      .set("Cookie", "valid");
    expect(read.status).toBe(200);
    expect(read.body.data.preferences).toEqual([]);
    expect(read.body.data.nextCursor).toBeNull();
    expect(read.headers["cache-control"]).toBe("no-store");

    const nextPage = await request(app)
      .get("/api/v1/preferences/movie-display?after=9100001")
      .set("Cookie", "valid");
    expect(nextPage.status).toBe(200);
    expect(workflows.movieDisplayPreferences).toHaveBeenLastCalledWith(
      { id, email: "qa@example.test" },
      "9100001",
    );

    const invalidCursor = await request(app)
      .get("/api/v1/preferences/movie-display?after=invalid")
      .set("Cookie", "valid");
    expect(invalidCursor.status).toBe(400);

    const preference = {
      tmdbId: "9100002",
      title: "Sensitive Poster",
      releaseYear: 2026,
      treatment: "standard",
      hideBackdrop: true,
    };
    const created = await request(app)
      .post("/api/v1/preferences/movie-display")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(preference);
    expect(created.status).toBe(200);
    expect(created.body.data.preference).toEqual(preference);
    expect(workflows.upsertMovieDisplayPreference).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      preference,
    );

    const invalidCreate = await request(app)
      .post("/api/v1/preferences/movie-display")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ ...preference, treatment: "blur" });
    expect(invalidCreate.status).toBe(400);

    const updated = await request(app)
      .patch("/api/v1/preferences/movie-display/9100002")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ treatment: "remove" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.preference).toMatchObject({
      tmdbId: "9100002",
      treatment: "remove",
      hideBackdrop: true,
    });
    expect(workflows.patchMovieDisplayPreference).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      "9100002",
      { treatment: "remove" },
    );

    const invalidPatch = await request(app)
      .patch("/api/v1/preferences/movie-display/9100002")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({});
    expect(invalidPatch.status).toBe(400);

    const removed = await request(app)
      .delete("/api/v1/preferences/movie-display/9100002")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost");
    expect(removed.status).toBe(200);
    expect(workflows.removeMovieDisplayPreference).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      "9100002",
    );
  });
  it("keeps public Letterboxd source configuration behind the verified account API", async () => {
    const { app, workflows } = setup();
    expect((await request(app).get("/api/v1/letterboxd-sources")).status).toBe(
      401,
    );
    const source = {
      id: sourceId,
      sourceUrl: "https://letterboxd.com/fixture/watchlist/",
      sourceType: "watchlist" as const,
      createdAt: "2026-10-21T10:00:00.000Z",
      lastSyncAttemptAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncError: null,
      filmCount: 0,
      matchedFilmCount: 0,
    };
    vi.mocked(workflows.listLetterboxdSources).mockResolvedValue([source]);
    const read = await request(app)
      .get("/api/v1/letterboxd-sources")
      .set("Cookie", "valid");
    expect(read.status).toBe(200);
    expect(read.body.data.sources).toEqual([source]);
    expect(read.headers["cache-control"]).toBe("no-store");

    const created = await request(app)
      .post("/api/v1/letterboxd-sources")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ sourceUrl: source.sourceUrl });
    expect(created.status).toBe(200);
    expect(created.body.data.source.id).toBe(sourceId);
    expect(workflows.addLetterboxdSource).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      { sourceUrl: source.sourceUrl },
    );

    const massAssigned = await request(app)
      .post("/api/v1/letterboxd-sources")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ sourceUrl: source.sourceUrl, userId: "another-user" });
    expect(massAssigned.status).toBe(400);

    const removed = await request(app)
      .delete(`/api/v1/letterboxd-sources/${sourceId}`)
      .set("Cookie", "valid")
      .set("Origin", "http://localhost");
    expect(removed.status).toBe(200);
    expect(workflows.removeLetterboxdSource).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      sourceId,
    );
  });
  it("returns a safe uncacheable failure when private persistence fails", async () => {
    const { app, workflows } = setup();
    vi.mocked(workflows.patchPreferences).mockRejectedValue(
      new Error("SQL statement with private details"),
    );
    const result = await request(app)
      .patch("/api/v1/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ location: "Haifa" });
    expect(result.status).toBe(503);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(result.body)).not.toContain("SQL");
  });
  it("keeps invalid private JSON uncacheable and unknown/public routes public", async () => {
    const { app, verify } = setup();
    const invalid = await request(app)
      .patch("/api/v1/preferences")
      .set("Content-Type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/api/v1/health")).status).toBe(200);
    expect((await request(app).get("/api/not-a-route")).status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });
});
