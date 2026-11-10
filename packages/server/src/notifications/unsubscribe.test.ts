import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import {
  createMovieNotificationUnsubscribeRouter,
  type MovieNotificationUnsubscribeService,
} from "./unsubscribe.js";

const token = "a".repeat(43);
const source = {
  id: "00000000-0000-4000-8000-000000000099",
  sourceUrl: "https://letterboxd.com/fixture/watchlist/",
  sourceType: "watchlist" as const,
};

function appFor(service: MovieNotificationUnsubscribeService) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/unsubscribe",
    createMovieNotificationUnsubscribeRouter(service, {
      limit: 100,
      clientIp: () => "192.0.2.10",
    }),
  );
  return app;
}

describe("public movie notification unsubscribe routes", () => {
  it("returns only current lists for a bearer token and does not mutate on GET", async () => {
    const service: MovieNotificationUnsubscribeService = {
      sources: vi.fn(async () => [source]),
      removeSources: vi.fn(async () => []),
      unsubscribeAll: vi.fn(async () => true),
    };
    const response = await request(appFor(service))
      .get("/api/v1/unsubscribe/letterboxd")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.sources).toEqual([source]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(service.sources).toHaveBeenCalledWith(expect.any(Buffer));
    expect(service.removeSources).not.toHaveBeenCalled();
    expect(service.unsubscribeAll).not.toHaveBeenCalled();
  });

  it("requires a valid bearer token and selected source IDs", async () => {
    const service: MovieNotificationUnsubscribeService = {
      sources: vi.fn(async () => []),
      removeSources: vi.fn(async () => []),
      unsubscribeAll: vi.fn(async () => false),
    };
    const app = appFor(service);
    const missing = await request(app).get("/api/v1/unsubscribe/letterboxd");
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).not.toContain("account");

    const invalid = await request(app)
      .post("/api/v1/unsubscribe/letterboxd")
      .set("Authorization", `Bearer ${token}`)
      .send({ sourceIds: [] });
    expect(invalid.status).toBe(400);
    expect(service.removeSources).not.toHaveBeenCalled();
  });

  it("removes only explicitly selected sources", async () => {
    const service: MovieNotificationUnsubscribeService = {
      sources: vi.fn(async () => [source]),
      removeSources: vi.fn(async (_hash, ids) => ids.map(() => source)),
      unsubscribeAll: vi.fn(async () => false),
    };
    const response = await request(appFor(service))
      .post("/api/v1/unsubscribe/letterboxd")
      .set("Authorization", `Bearer ${token}`)
      .send({ sourceIds: [source.id] });

    expect(response.status).toBe(200);
    expect(response.body.data.removed).toEqual([source]);
    expect(service.removeSources).toHaveBeenCalledWith(expect.any(Buffer), [
      source.id,
    ]);
    expect(service.unsubscribeAll).not.toHaveBeenCalled();
  });

  it("accepts only the standards-defined one-click POST and never mutates on GET", async () => {
    const service: MovieNotificationUnsubscribeService = {
      sources: vi.fn(async () => []),
      removeSources: vi.fn(async () => []),
      unsubscribeAll: vi.fn(async () => true),
    };
    const app = appFor(service);
    const url = `/api/v1/unsubscribe/one-click/${token}`;
    expect((await request(app).get(url)).status).toBe(404);
    expect(service.unsubscribeAll).not.toHaveBeenCalled();

    const wrongPost = await request(app)
      .post(url)
      .type("form")
      .send({ "List-Unsubscribe": "one-click" });
    expect(wrongPost.status).toBe(400);
    expect(service.unsubscribeAll).not.toHaveBeenCalled();

    const response = await request(app)
      .post(url)
      .type("form")
      .send({ "List-Unsubscribe": "One-Click" });
    expect(response.status).toBe(200);
    expect(response.text).toBe("");
    expect(service.unsubscribeAll).toHaveBeenCalledWith(expect.any(Buffer));
  });
});
