import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { HttpError } from "../http-errors.js";
import type { ProtectedWorkflowService } from "./service.js";
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
    subscriptions: vi.fn(async () => ({ subscriptions: [], nextOffset: null })),
    subscribe: vi.fn(async () => ({ kind: "available" as const })),
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
      .set("Authorization", "Bearer valid");
    expect(result.status).toBe(200);
    expect(result.body.data.user.id).toBe(id);
    expect(result.headers.vary).toContain("Authorization");
    expect(workflows.account).toHaveBeenCalledWith({
      id,
      email: "qa@example.test",
    });
    expect(
      (
        await request(app)
          .get("/api/v1/account?userId=other")
          .set("Authorization", "Bearer valid")
      ).status,
    ).toBe(400);
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
      .set("Authorization", "Bearer valid")
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
          .set("Authorization", "Bearer valid")
          .send({ tmdbId: "101", preferredCity: "Haifa", notifiedAt: null })
      ).status,
    ).toBe(400);
    expect(workflows.subscribe).not.toHaveBeenCalled();
    expect(
      (
        await request(app)
          .post("/api/v1/admin/movie-corrections")
          .set("Authorization", "Bearer valid")
          .send({
            mode: "nowPlaying",
            currentTmdbId: "101",
            selectedTmdbId: "102",
            isManualEntry: true,
          })
      ).status,
    ).toBe(403);
  });
  it("returns a safe uncacheable failure when private persistence fails", async () => {
    const { app, workflows } = setup();
    vi.mocked(workflows.patchPreferences).mockRejectedValue(
      new Error("SQL statement with private details"),
    );
    const result = await request(app)
      .patch("/api/v1/preferences")
      .set("Authorization", "Bearer valid")
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
