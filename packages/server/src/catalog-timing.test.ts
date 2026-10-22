import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  startCatalogTiming,
  timeCatalogStage,
  timeCatalogStageSync,
  withCatalogTiming,
} from "./catalog-timing.js";

function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  }) as unknown as ServerResponse;
}
const metadata = { firstApiRequest: false, dispatcherImportMs: 10 };
const path = "/api/v1/catalog/now-playing";

describe("catalog request timings", () => {
  it("does nothing for other routes and preserves synchronous return values", () => {
    const res = response();
    const write = vi.fn();
    expect(
      withCatalogTiming(
        "/api/auth/get-session",
        res,
        metadata,
        () => 42,
        write,
      ),
    ).toBe(42);
    res.emit("finish");
    expect(write).not.toHaveBeenCalled();
    expect(res.listenerCount("close")).toBe(0);
  });

  it("logs at response finish, marks unfinished work and emits once", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const res = response();
    const write = vi.fn();
    const result = withCatalogTiming(
      path + "?secret=do-not-log",
      res,
      metadata,
      () => {
        const snapshot = startCatalogTiming("snapshot");
        now = 5;
        timeCatalogStageSync("response_json", () => {
          now = 8;
        });
        res.emit("finish");
        expect(write).toHaveBeenCalledTimes(1);
        now = 12;
        snapshot();
        snapshot();
        res.emit("close");
        return "unchanged";
      },
      write,
    );
    expect(result).toBe("unchanged");
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      event: "catalog_timing",
      catalog: "nowPlaying",
      status: 200,
      outcome: "finished",
      responseFinishedMs: 8,
      stages: {
        snapshot: { ms: 8, count: 1, errors: 0, inFlight: 1 },
        response_json: { ms: 3, count: 1, errors: 0 },
      },
    });
    expect(write.mock.calls[0][0]).not.toContain("secret");
  });

  it("keeps concurrent scrollers isolated across asynchronous boundaries", async () => {
    const write = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = response(),
      second = response();
    const one = withCatalogTiming(
      path,
      first,
      metadata,
      async () => {
        await timeCatalogStage("movie_rows", () => gate);
        first.emit("finish");
      },
      write,
    );
    await withCatalogTiming(
      "/api/v1/catalog/coming-soon",
      second,
      metadata,
      async () => {
        await timeCatalogStage("movie_codes", async () => undefined);
        second.emit("finish");
      },
      write,
    );
    release();
    await one;
    const [soon, playing] = write.mock.calls.map(([line]) => JSON.parse(line));
    expect(soon.catalog).toBe("comingSoon");
    expect(Object.keys(soon.stages)).toEqual(["movie_codes"]);
    expect(Object.keys(playing.stages)).toEqual(["movie_rows"]);
    expect(soon.requestId).not.toBe(playing.requestId);
    expect(soon.instanceId).toBe(playing.instanceId);
  });

  it("preserves errors and logs only counts, never error contents", async () => {
    const res = response(),
      write = vi.fn();
    const failure = new Error("postgresql://private-password");
    await withCatalogTiming(
      path,
      res,
      metadata,
      async () => {
        await expect(
          timeCatalogStage("movie_rows", async () => {
            throw failure;
          }),
        ).rejects.toBe(failure);
        res.statusCode = 500;
        res.emit("finish");
      },
      write,
    );
    expect(JSON.parse(write.mock.calls[0][0]).stages.movie_rows).toMatchObject({
      count: 1,
      errors: 1,
    });
    expect(write.mock.calls[0][0]).not.toContain("password");
  });

  it("labels closed responses and synchronous initialization failures", () => {
    const write = vi.fn(),
      res = response();
    withCatalogTiming(
      path,
      res,
      metadata,
      () => {
        const end = startCatalogTiming("movie_rows");
        res.emit("close");
        end();
      },
      write,
    );
    expect(JSON.parse(write.mock.calls[0][0])).toMatchObject({
      outcome: "closed",
      stages: { movie_rows: { inFlight: 1 } },
    });
    const failure = new Error("init failure");
    expect(() =>
      withCatalogTiming(
        path,
        response(),
        metadata,
        () =>
          timeCatalogStageSync("runtime_init", () => {
            throw failure;
          }),
        write,
      ),
    ).toThrow(failure);
    expect(JSON.parse(write.mock.calls[1][0])).toMatchObject({
      outcome: "threw",
      stages: { runtime_init: { errors: 1 } },
    });
  });

  it("never lets a logging failure change the response path", () => {
    const res = response();
    expect(
      withCatalogTiming(
        path,
        res,
        metadata,
        () => {
          res.emit("finish");
          return 42;
        },
        () => {
          throw new Error("logger unavailable");
        },
      ),
    ).toBe(42);
  });
});
