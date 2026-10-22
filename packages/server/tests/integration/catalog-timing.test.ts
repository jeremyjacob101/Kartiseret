import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { createDatabase } from "../../src/db/client.js";
import { withCatalogTiming } from "../../src/catalog-timing.js";

const connectionString = process.env.DATABASE_URL;
const target = new URL(connectionString ?? "http://invalid");
if (
  !["localhost", "127.0.0.1", "::1"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
)
  throw new Error("Timing tests require local disposable kartiseret_test.");

const path = "/api/v1/catalog/now-playing";
const metadata = { firstApiRequest: false, dispatcherImportMs: 0 };

describe("catalog timings with PostgreSQL", () => {
  it("preserves responses and records new connections, reuse and queued checkout", async () => {
    const database = createDatabase(connectionString!, { poolMax: 1 });
    const repository = new DrizzleCatalogRepository(database.db);
    const app = createApp({
      catalogRepository: repository,
      publicDataRepository: repository,
    });
    const write = vi.fn();
    const timed = request((req: IncomingMessage, res: ServerResponse) =>
      withCatalogTiming(req.url, res, metadata, () => app(req, res), write),
    );
    try {
      const first = await timed.get(path).expect(200);
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const cold = JSON.parse(write.mock.calls[0][0]);
      for (const stage of [
        "db_checkout",
        "db_connect",
        "snapshot",
        "revision_read",
        "movie_rows",
        "movie_codes",
        "response_json",
      ])
        expect(cold.stages[stage]).toMatchObject({ count: 1, errors: 0 });
      expect(cold.stages.db_checkout.ms).toBeGreaterThanOrEqual(
        cold.stages.db_connect.ms,
      );

      const baseline = await request(app).get(path).expect(200);
      expect(first.body).toEqual(baseline.body);
      for (const header of [
        "cache-control",
        "vary",
        "x-kartiseret-publication",
        "content-type",
        "etag",
      ])
        expect(first.headers[header]).toBe(baseline.headers[header]);
      expect(first.headers["server-timing"]).toBeUndefined();

      await timed.get(path).expect(200);
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
      expect(
        JSON.parse(write.mock.calls[1][0]).stages.db_connect,
      ).toBeUndefined();

      const held = await database.pool.connect();
      let released = false;
      try {
        const queued = timed.get(path).then((res) => res);
        await vi.waitFor(() => expect(database.pool.waitingCount).toBe(1));
        held.release();
        released = true;
        const result = await queued;
        expect(result.status).toBe(200);
        expect(result.body).toEqual(first.body);
        await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));
        const log = JSON.parse(write.mock.calls[2][0]);
        expect(log.stages.db_checkout.ms).toBeGreaterThan(0);
        expect(log.stages.db_connect).toBeUndefined();
      } finally {
        if (!released) held.release();
      }
    } finally {
      await database.close();
    }
  });

  it("preserves connection failures and records failed checkout without secrets", async () => {
    const database = createDatabase(connectionString!, {
      connectionOptions: "-c definitely_unknown_setting=1",
    });
    const repository = new DrizzleCatalogRepository(database.db);
    const app = createApp({
      catalogRepository: repository,
      publicDataRepository: repository,
    });
    const write = vi.fn();
    try {
      await request((req: IncomingMessage, res: ServerResponse) =>
        withCatalogTiming(req.url, res, metadata, () => app(req, res), write),
      )
        .get(path)
        .expect(500);
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      const log = JSON.parse(write.mock.calls[0][0]);
      expect(log.stages.db_checkout.errors).toBe(1);
      expect(log.stages.snapshot.errors).toBe(1);
      expect(write.mock.calls[0][0]).not.toContain(
        "definitely_unknown_setting",
      );
      expect(write.mock.calls[0][0]).not.toContain(connectionString);
    } finally {
      await database.close();
    }
  });

  it("retains callback checkout and pool.query behavior outside catalog requests", async () => {
    const database = createDatabase(connectionString!, { poolMax: 1 });
    try {
      await new Promise<void>((resolve, reject) => {
        expect(
          database.pool.connect((error, client, release) => {
            if (error) return reject(error);
            expect(client).toBeDefined();
            release();
            resolve();
          }),
        ).toBeUndefined();
      });
      expect((await database.pool.query("select 42 as result")).rows).toEqual([
        { result: 42 },
      ]);
    } finally {
      await database.close();
    }
  });
});
