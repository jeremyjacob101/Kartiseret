import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { HttpError } from "../http-errors.js";
import type { ProtectedWorkflowService } from "./service.js";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  type TicketAlertCriteria,
} from "@kartiseret/contracts/private-data";
const id = "00000000-0000-4000-8000-000000000001";
const preferences = {
  ratingSources: ["imdbRating" as const],
  location: "Haifa",
  siteColor: "#123456",
};
function setup() {
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
    }),
  };
}
describe("protected HTTP contracts", () => {
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
