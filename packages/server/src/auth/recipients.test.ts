import express from "express";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createRecipientRouter } from "./recipients.js";
import type { Pool } from "pg";

const secret = "internal-test-secret";
const userId = "00000000-0000-4000-8000-000000000001";
const deliveryId = "00000000-0000-4000-8000-000000000002";

function setup(eligible = true, limit?: number) {
  const insertedHashes: Buffer[] = [];
  const client = {
    query: vi.fn(async (query: string, values: unknown[] = []) => {
      if (query.includes("movie_notification_delivery_has_letterboxd_support"))
        return { rows: [{ eligible }], rowCount: 1 };
      if (query.includes("returning id")) {
        insertedHashes.push(values[3] as Buffer);
        return {
          rows: [{ id: "00000000-0000-4000-8000-000000000099" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  const app = express();
  app.use(express.json());
  app.use("/api/internal", createRecipientRouter(pool, secret, { limit }));
  return { app, client, pool, insertedHashes };
}

describe("internal movie notification unsubscribe token issuance", () => {
  it("rate limits internal requests before processing them", async () => {
    const { app, pool } = setup(true, 1);
    const endpoint = "/api/internal/movie-notification-unsubscribe-tokens";
    expect(
      (await request(app).post(endpoint).send({ userId, deliveryId })).status,
    ).toBe(401);
    const blocked = await request(app)
      .post(endpoint)
      .set("Authorization", `Bearer ${secret}`)
      .send({ userId, deliveryId });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBeDefined();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("also rate limits recipient lookups", async () => {
    const { app } = setup(true, 1);
    const endpoint = "/api/internal/ticket-alert-recipients";
    expect(
      (
        await request(app)
          .post(endpoint)
          .send({ userIds: [userId] })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(endpoint)
          .send({ userIds: [userId] })
      ).status,
    ).toBe(429);
  });

  it("issues distinct scoped bearer tokens and stores only their SHA-256 hashes", async () => {
    const { app, client, insertedHashes } = setup();
    const response = await request(app)
      .post("/api/internal/movie-notification-unsubscribe-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ userId, deliveryId });

    expect(response.status).toBe(200);
    expect(response.body.data.eligible).toBe(true);
    const { manageLetterboxd, oneClickAll } = response.body.data;
    expect(manageLetterboxd).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(oneClickAll).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manageLetterboxd).not.toBe(oneClickAll);
    expect(insertedHashes).toHaveLength(2);
    expect(insertedHashes).toEqual([
      createHash("sha256").update(manageLetterboxd).digest(),
      createHash("sha256").update(oneClickAll).digest(),
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("does not mint tokens when the delivery is no longer Letterboxd-supported", async () => {
    const { app, client, insertedHashes } = setup(false);
    const response = await request(app)
      .post("/api/internal/movie-notification-unsubscribe-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ userId, deliveryId });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ eligible: false });
    expect(insertedHashes).toEqual([]);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("requires the internal credential and validates account and delivery IDs", async () => {
    const { app, pool } = setup();
    const unauthorized = await request(app)
      .post("/api/internal/movie-notification-unsubscribe-tokens")
      .send({ userId, deliveryId });
    expect(unauthorized.status).toBe(401);
    expect(pool.connect).not.toHaveBeenCalled();

    const invalid = await request(app)
      .post("/api/internal/movie-notification-unsubscribe-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ userId, deliveryId: "not-a-uuid" });
    expect(invalid.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
