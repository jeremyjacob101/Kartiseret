import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { HttpError } from "../http-errors.js";
import type { ProtectedWorkflowService } from "./service.js";
import type { ProtectedRateLimitOptions } from "./router.js";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  walletTicketCreateSchema,
  type TicketAlertCriteria,
} from "@kartiseret/contracts/private-data";
import { DEFAULT_SHOWTIME_PREFERENCES } from "@kartiseret/contracts/showtime-preferences";
const id = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000099";
const preferences = {
  ratingSources: ["imdbRating" as const],
  location: "Haifa",
  siteColor: "#123456",
  hideReReleases: false,
  notificationDelivery: "email" as const,
  showtimePreferences: DEFAULT_SHOWTIME_PREFERENCES,
};
function setup(
  protectedRateLimit?: ProtectedRateLimitOptions,
  isAdmin = false,
) {
  const user = { id, email: "qa@example.test" };
  const requireAdmin = () => {
    if (!isAdmin)
      throw new HttpError(
        403,
        "forbidden",
        "Administrator access is required.",
      );
  };
  const workflows: ProtectedWorkflowService = {
    account: vi.fn(async () => ({ user, isAdmin })),
    preferences: vi.fn(async () => preferences),
    patchPreferences: vi.fn(async () => preferences),
    pushDeviceStatus: vi.fn(async () => ({ registered: true })),
    registerPushDevice: vi.fn(async () => ({ registered: true })),
    unregisterPushDevice: vi.fn(async () => ({ registered: false })),
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
    walletTickets: vi.fn(async () => []),
    walletListedScreenings: vi.fn(async () => []),
    walletTicketDetails: vi.fn(async () => []),
    walletTicket: vi.fn(async () => {
      throw new HttpError(404, "ticket_not_found", "Ticket not found.");
    }),
    appendWalletTicketQrCodes: vi.fn(
      async (_user, _ticketId, input: { qrMessages: string[] }) => ({
        id,
        tmdbId: null,
        title: "Movie",
        city: "Jerusalem",
        cinema: "Cinema",
        screeningDate: "2026-10-21",
        screeningTime: "19:00",
        reminderEnabled: false,
        createdAt: "2026-10-21T10:00:00.000Z",
        updatedAt: "2026-10-21T10:00:00.000Z",
        qrMessage: "primary",
        qrCodes: [
          { id, qrMessage: "primary" },
          ...input.qrMessages.map((qrMessage, index) => ({
            id: `00000000-0000-4000-8000-00000000000${index + 2}`,
            qrMessage,
          })),
        ],
      }),
    ),
    createWalletTicket: vi.fn(async (_user, input) => ({
      id,
      tmdbId: input.tmdbId,
      title: input.title,
      city: input.city,
      cinema: input.cinema,
      screeningDate: input.screeningDate,
      screeningTime: input.screeningTime,
      reminderEnabled: input.reminderEnabled,
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T10:00:00.000Z",
    })),
    updateWalletTicket: vi.fn(async (_user, _ticketId, input) => ({
      id,
      tmdbId: input.tmdbId ?? null,
      title: input.title ?? "Movie",
      city: input.city ?? "Jerusalem",
      cinema: input.cinema ?? "Cinema",
      screeningDate: input.screeningDate ?? "2026-10-21",
      screeningTime: input.screeningTime ?? "19:00",
      reminderEnabled: input.reminderEnabled ?? false,
      createdAt: "2026-10-21T10:00:00.000Z",
      updatedAt: "2026-10-21T10:00:00.000Z",
    })),
    deleteWalletTicket: vi.fn(async () => ({ removed: true as const })),
    recordWalletShowtimeClick: vi.fn(async (_user, input) => input),
    recentWalletShowtimeClick: vi.fn(async () => null),
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
    homepageAdminData: vi.fn(async () => {
      requireAdmin();
      return {
        data: { highlights: [], promotions: [] },
        error: null,
      };
    }),
    upsertHomepageHighlight: vi.fn(async (_user, highlight) => {
      requireAdmin();
      return { data: { highlight }, error: null };
    }),
    removeHomepageHighlight: vi.fn(async () => {
      requireAdmin();
      return { data: { removed: true as const }, error: null };
    }),
    upsertHomepagePromotion: vi.fn(async (_user, promotion) => {
      requireAdmin();
      return {
        data: {
          promotion: {
            id: promotion.id ?? sourceId,
            ...promotion,
          },
        },
        error: null,
      };
    }),
  };
  const verify = vi.fn(
    async (credentials: { cookie?: string; authorization?: string }) => {
      const token =
        credentials.cookie ??
        credentials.authorization?.replace(/^Bearer /i, "");
      if (token !== "valid")
        throw new HttpError(401, "unauthorized", "Invalid session.");
      return user;
    },
  );
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
  it("requires an account and validates the listed screening lookup", async () => {
    const { app, workflows } = setup();
    const path = "/api/v1/ticket-passes/listed-screenings";
    const query = { city: "Jerusalem", date: "2026-11-27" };
    expect((await request(app).get(path).query(query)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(path)
          .set("Cookie", "valid")
          .query({ ...query, date: "bad" })
      ).status,
    ).toBe(400);
    const result = await request(app)
      .get(path)
      .set("Cookie", "valid")
      .query(query);
    expect(result.status).toBe(200);
    expect(result.body.data.screenings).toEqual([]);
    expect(workflows.walletListedScreenings).toHaveBeenCalledExactlyOnceWith(
      { id, email: "qa@example.test" },
      "Jerusalem",
      "2026-11-27",
    );
  });

  it("serves a private QR image at the query-free ticket URL", async () => {
    const { app, workflows } = setup();
    vi.mocked(workflows.walletTicket).mockResolvedValue({
      id,
      tmdbId: null,
      title: "Test Movie",
      city: "Jerusalem",
      cinema: "Test Cinema",
      screeningDate: "2026-12-01",
      screeningTime: "19:30",
      reminderEnabled: false,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
      qrMessage: "private-ticket-payload",
      qrCodes: [{ id, qrMessage: "private-ticket-payload" }],
    });

    const result = await request(app)
      .get(`/api/v1/ticket-passes/${id}/qr.svg`)
      .set("Cookie", "valid");

    expect(result.status).toBe(200);
    expect(result.headers["content-type"]).toContain("image/svg+xml");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.toString()).toContain("<svg");
    expect(workflows.walletTicket).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      id,
    );
  });

  it("appends distinct QR codes to one private booking and returns family details", async () => {
    const { app, workflows } = setup();
    const result = await request(app)
      .post(`/api/v1/ticket-passes/${id}/qr-codes`)
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ qrMessages: ["second-ticket-qr"] });

    expect(result.status).toBe(200);
    expect(result.body.data.ticket.qrCodes).toEqual([
      { id, qrMessage: "primary" },
      {
        id: "00000000-0000-4000-8000-000000000002",
        qrMessage: "second-ticket-qr",
      },
    ]);
    expect(workflows.appendWalletTicketQrCodes).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      id,
      { qrMessages: ["second-ticket-qr"] },
    );
  });

  it("keeps the existing strict single-ticket endpoint compatible and exposes all QRs on family endpoint", async () => {
    const { app, workflows } = setup();
    vi.mocked(workflows.walletTicket).mockResolvedValue({
      id,
      tmdbId: null,
      title: "Test Movie",
      city: "Jerusalem",
      cinema: "Test Cinema",
      screeningDate: "2026-12-01",
      screeningTime: "19:30",
      reminderEnabled: false,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
      qrMessage: "primary",
      qrCodes: [
        { id, qrMessage: "primary" },
        { id: sourceId, qrMessage: "family-seat" },
      ],
    });

    const legacy = await request(app)
      .get(`/api/v1/ticket-passes/${id}`)
      .set("Cookie", "valid");
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.ticket.qrMessage).toBe("primary");
    expect(legacy.body.data.ticket.qrCodes).toBeUndefined();

    const family = await request(app)
      .get(`/api/v1/ticket-passes/${id}/family`)
      .set("Cookie", "valid");
    expect(family.status).toBe(200);
    expect(family.body.data.ticket.qrCodes).toHaveLength(2);
  });

  it("rejects ticket imports containing more than ten QR codes", () => {
    const result = walletTicketCreateSchema.safeParse({
      tmdbId: null,
      title: "Movie",
      city: "Jerusalem",
      cinema: "Cinema",
      screeningDate: "2026-12-01",
      screeningTime: "19:30",
      qrMessages: Array.from({ length: 11 }, (_, index) => `qr-${index}`),
    });
    expect(result.success).toBe(false);
  });

  it("returns the signed-in account’s ticket details for protected offline caching", async () => {
    const { app, workflows } = setup();
    vi.mocked(workflows.walletTicketDetails).mockResolvedValue([
      {
        id,
        tmdbId: null,
        title: "Test Movie",
        city: "Jerusalem",
        cinema: "Test Cinema",
        screeningDate: "2026-12-01",
        screeningTime: "19:30",
        reminderEnabled: false,
        createdAt: "2026-11-26T10:00:00.000Z",
        updatedAt: "2026-11-26T10:00:00.000Z",
        qrMessage: "private-ticket-payload",
        qrCodes: [{ id, qrMessage: "private-ticket-payload" }],
      },
    ]);

    const result = await request(app)
      .get("/api/v1/ticket-passes/offline-cache")
      .set("Cookie", "valid");

    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.data.tickets[0].qrMessage).toBe(
      "private-ticket-payload",
    );
    expect(workflows.walletTicketDetails).toHaveBeenCalledWith({
      id,
      email: "qa@example.test",
    });
  });

  it("stores notification delivery preferences and scopes device registration to the signed-in account", async () => {
    const { app, workflows } = setup();
    const unauthorized = await request(app).get("/api/v1/push/devices/status");
    expect(unauthorized.status).toBe(401);

    const saved = await request(app)
      .patch("/api/v1/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ notificationDelivery: "both" });
    expect(saved.status).toBe(200);
    expect(workflows.patchPreferences).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      { notificationDelivery: "both" },
    );

    const status = await request(app)
      .get("/api/v1/push/devices/status")
      .set("Cookie", "valid");
    expect(status.body.data.registered).toBe(true);

    const registration = {
      token: "a1".repeat(32),
      environment: "development",
    };
    const currentDeviceStatus = await request(app)
      .get(`/api/v1/push/devices/status?token=${registration.token}`)
      .set("Cookie", "valid");
    expect(currentDeviceStatus.status).toBe(200);
    expect(workflows.pushDeviceStatus).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      registration.token,
    );

    const invalidStatus = await request(app)
      .get("/api/v1/push/devices/status?token=invalid")
      .set("Cookie", "valid");
    expect(invalidStatus.status).toBe(400);

    const registered = await request(app)
      .post("/api/v1/push/devices/register")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(registration);
    expect(registered.status).toBe(200);
    expect(workflows.registerPushDevice).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      registration,
    );

    const invalid = await request(app)
      .post("/api/v1/push/devices/register")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ ...registration, token: "not-a-device-token" });
    expect(invalid.status).toBe(400);
    expect(workflows.registerPushDevice).toHaveBeenCalledTimes(1);

    const removed = await request(app)
      .delete("/api/v1/push/devices/current")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ token: registration.token });
    expect(removed.status).toBe(200);
    expect(workflows.unregisterPushDevice).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      registration.token,
    );
  });

  it("accepts native bearer requests for reads and mutations without a browser origin", async () => {
    const { app, verify, workflows } = setup();
    const account = await request(app)
      .get("/api/v1/account")
      .set("Authorization", "Bearer valid");
    expect(account.status).toBe(200);
    const saved = await request(app)
      .patch("/api/v1/preferences")
      .set("Authorization", "Bearer valid")
      .send({ siteColor: "#a66ae3" });
    expect(saved.status).toBe(200);
    expect(verify).toHaveBeenCalledWith({ authorization: "Bearer valid" });
    expect(workflows.patchPreferences).toHaveBeenCalled();
  });

  it("rejects requests that combine native bearer and browser cookie credentials", async () => {
    const { app, verify } = setup();
    const response = await request(app)
      .get("/api/v1/account")
      .set("Authorization", "Bearer valid")
      .set("Cookie", "valid");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("ambiguous_credentials");
    expect(verify).not.toHaveBeenCalled();
  });

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
    {
      showtimePreferences: {
        screeningFilters: {
          version: 3,
          unchecked: {
            showType: [],
            screenFormat: [],
            screeningTech: [],
            dubLanguage: [],
          },
        },
        excludedCinemaIds: ["unknown-cinema"],
      },
    },
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
  it("accepts the hide Re-Releases preference", async () => {
    const { app, workflows } = setup();
    const result = await request(app)
      .patch("/api/v1/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ hideReReleases: true });

    expect(result.status).toBe(200);
    expect(workflows.patchPreferences).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      { hideReReleases: true },
    );
  });
  it("accepts account-scoped showtime defaults", async () => {
    const { app, workflows } = setup();
    const showtimePreferences = {
      screeningFilters: {
        version: 3,
        unchecked: {
          showType: [],
          screenFormat: [],
          screeningTech: ["IMAX"],
          dubLanguage: ["Hebrew"],
        },
      },
      excludedCinemaIds: ["aK90TvH244M7"],
    };
    const result = await request(app)
      .patch("/api/v1/preferences")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ showtimePreferences });

    expect(result.status).toBe(200);
    expect(workflows.patchPreferences).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      { showtimePreferences },
    );
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
  it("protects and validates homepage carousel management routes", async () => {
    const nonAdmin = setup();
    const denied = await request(nonAdmin.app)
      .get("/api/v1/admin/homepage-featured")
      .set("Cookie", "valid");
    expect(denied.status).toBe(403);

    const { app, workflows } = setup(undefined, true);
    const read = await request(app)
      .get("/api/v1/admin/homepage-featured")
      .set("Cookie", "valid");
    expect(read.status).toBe(200);
    expect(read.body.data).toEqual({ highlights: [], promotions: [] });

    const highlight = {
      tmdbId: "101",
      startsOn: "2026-11-19",
      endsOn: "2026-11-30",
      priority: 4,
      label: "kids",
      enabled: true,
    };
    const savedHighlight = await request(app)
      .post("/api/v1/admin/homepage-highlights")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(highlight);
    expect(savedHighlight.status).toBe(200);
    expect(savedHighlight.body.data.highlight).toEqual(highlight);
    expect(workflows.upsertHomepageHighlight).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      highlight,
    );

    const invalidHighlight = await request(app)
      .post("/api/v1/admin/homepage-highlights")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send({ ...highlight, endsOn: "2026-11-18" });
    expect(invalidHighlight.status).toBe(400);
    for (const priority of [-1, 11, 5.5]) {
      const invalidRating = await request(app)
        .post("/api/v1/admin/homepage-highlights")
        .set("Cookie", "valid")
        .set("Origin", "http://localhost")
        .send({ ...highlight, priority });
      expect(invalidRating.status).toBe(400);
    }
    expect(workflows.upsertHomepageHighlight).toHaveBeenCalledTimes(1);

    const removed = await request(app)
      .delete("/api/v1/admin/homepage-highlights/101")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost");
    expect(removed.status).toBe(200);
    expect(removed.body.data.removed).toBe(true);
    expect(workflows.removeHomepageHighlight).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      "101",
    );

    const promotion = {
      title: "Cinema day",
      body: "Tickets for ₪10 nationwide.",
      startsOn: "2026-11-19",
      endsOn: "2026-11-20",
      priority: 3,
      ctaLabel: "Get tickets now",
      ctaHref: "/showtimes",
      enabled: true,
    };
    const savedPromotion = await request(app)
      .post("/api/v1/admin/homepage-promotions")
      .set("Cookie", "valid")
      .set("Origin", "http://localhost")
      .send(promotion);
    expect(savedPromotion.status).toBe(200);
    expect(savedPromotion.body.data.promotion).toEqual({
      id: sourceId,
      ...promotion,
    });
    expect(workflows.upsertHomepagePromotion).toHaveBeenCalledWith(
      { id, email: "qa@example.test" },
      promotion,
    );
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
