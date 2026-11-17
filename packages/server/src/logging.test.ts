import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import {
  createServerLogger,
  resolveLogLevel,
  safeErrorSummary,
} from "./logging.js";

function captureLogger(level = "trace") {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { logger: createServerLogger(destination, level), lines };
}

function records(lines: string[]) {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("structured server logging", () => {
  it("uses info for an invalid threshold and allows supported levels", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel("DEBUG")).toBe("debug");
    expect(resolveLogLevel("silent")).toBe("silent");
    expect(resolveLogLevel("verbose")).toBe("info");
  });

  it("redacts sensitive field names from structured records", () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        authorization: "auth-canary",
        headers: { cookie: "cookie-canary", "set-cookie": "set-cookie-canary" },
        request: {
          body: { password: "password-canary" },
          databaseUrl: "db-canary",
        },
      },
      "redaction test",
    );

    const line = lines.join("");
    for (const secret of [
      "auth-canary",
      "cookie-canary",
      "set-cookie-canary",
      "password-canary",
      "db-canary",
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line.match(/\[Redacted\]/g)).toHaveLength(5);
  });

  it("logs one correlated completion for a successful API request without its query string", async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({
      catalogRepository: {
        findNowPlayingRows: async () => [],
        findMovieCodes: async () => new Map(),
      },
      artworkStore: null,
      requestLogger: logger,
    });

    const response = await request(app).get(
      "/api/v1/health?token=query-canary",
    );
    expect(response.status).toBe(200);

    const output = records(lines);
    const completions = output.filter(
      (record) => record.event === "http_request_complete",
    );
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      method: "GET",
      route: "/api/v1/health",
      status: 200,
      outcome: "finished",
    });
    expect(completions[0]?.requestId).toEqual(expect.any(String));
    expect(lines.join("")).not.toContain("query-canary");
  });

  it("correlates safe API errors with the completion record and isolates concurrent requests", async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({
      catalogRepository: {
        findNowPlayingRows: async () => [],
        findMovieCodes: async () => new Map(),
      },
      artworkStore: null,
      requestLogger: logger,
    });

    await Promise.all([
      request(app).get("/api/v1/health?cookie=first-canary"),
      request(app).get("/api/v1/health?cookie=second-canary"),
      request(app).get("/api/private-path-canary"),
    ]);

    const output = records(lines);
    const completions = output.filter(
      (record) => record.event === "http_request_complete",
    );
    expect(completions).toHaveLength(3);
    const ids = completions.map((record) => record.requestId);
    expect(new Set(ids).size).toBe(3);
    expect(lines.join("")).not.toContain("first-canary");
    expect(lines.join("")).not.toContain("second-canary");
    expect(lines.join("")).not.toContain("private-path-canary");
    expect(completions.find((record) => record.status === 404)?.route).toBe(
      "unmatched",
    );
  });

  it("logs a safe API failure with the same request ID as its completion", async () => {
    const { logger, lines } = captureLogger();
    const app = createApp({
      catalogRepository: {
        findNowPlayingRows: async () => {
          throw new Error("postgresql://user:private-password@db.example");
        },
        findMovieCodes: async () => new Map(),
      },
      artworkStore: null,
      requestLogger: logger,
    });

    const response = await request(app).get("/api/v1/catalog/now-playing");
    expect(response.status).toBe(500);

    const output = records(lines);
    const apiError = output.find((record) => record.event === "api_error");
    const completion = output.find(
      (record) => record.event === "http_request_complete",
    );
    expect(apiError?.requestId).toEqual(expect.any(String));
    expect(completion?.requestId).toBe(apiError?.requestId);
    expect(JSON.stringify(apiError)).not.toContain("private-password");
    expect(JSON.stringify(apiError)).not.toContain("db.example");
  });

  it("summarizes nested errors without messages and bounds circular causes", () => {
    const first = Object.assign(new Error("password-in-error-message"), {
      code: "TEST_CODE",
    });
    const second = new Error("secret SQL");
    first.cause = second;
    second.cause = first;

    const summary = safeErrorSummary(first);
    expect(summary).toEqual({
      name: "Error",
      code: "TEST_CODE",
      cause: {
        name: "Error",
        cause: {
          name: "Error",
          code: "TEST_CODE",
          cause: {
            name: "Error",
            cause: {
              name: "Error",
              code: "TEST_CODE",
            },
          },
        },
      },
    });
    expect(JSON.stringify(summary)).not.toContain("password");
    expect(JSON.stringify(summary)).not.toContain("SQL");
  });
});
