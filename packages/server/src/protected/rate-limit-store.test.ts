import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresProtectedRateLimitStore } from "./rate-limit-store.js";

describe("PostgreSQL protected rate limit store", () => {
  it("stores HMAC keys and keeps serving requests when bounded cleanup fails", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;
    const onDiagnostic = vi.fn();
    const resetTime = new Date("2026-10-26T12:01:00.000Z");
    query
      .mockResolvedValueOnce({ rows: [{ count: 1, reset_at: resetTime }] })
      .mockRejectedValueOnce(new Error("database cleanup failure"))
      .mockResolvedValueOnce({ rows: [{ count: 2, reset_at: resetTime }] });
    const store = new PostgresProtectedRateLimitStore(
      pool,
      "unit-test-secret",
      60_000,
      onDiagnostic,
      () => 120_000,
    );

    await expect(store.increment("192.0.2.10")).resolves.toEqual({
      totalHits: 1,
      resetTime,
    });
    await expect(store.increment("192.0.2.10")).resolves.toEqual({
      totalHits: 2,
      resetTime,
    });

    const persistedKey = query.mock.calls[0]?.[1]?.[0];
    expect(persistedKey).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedKey).not.toBe("192.0.2.10");
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT (key) DO UPDATE");
    expect(query.mock.calls[0]?.[0]).toContain("statement_timestamp()");
    expect(onDiagnostic).toHaveBeenCalledOnce();
    expect(onDiagnostic).toHaveBeenCalledWith("rate_limit_cleanup_error");
    expect(query).toHaveBeenCalledTimes(3);
  });
});
