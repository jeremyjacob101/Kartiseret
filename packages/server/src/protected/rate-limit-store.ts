import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import type { ClientRateLimitInfo, Store } from "express-rate-limit";

const MAX_STORED_HITS = 601;
const CLEANUP_INTERVAL_MS = 60_000;
const KEY_PREFIX = "protected-api:";

export type ProtectedRateLimitStoreDiagnostic =
  "rate_limit_store_error" | "rate_limit_cleanup_error";

export class PostgresProtectedRateLimitStore implements Store {
  readonly prefix = KEY_PREFIX;
  readonly localKeys = false;
  private lastCleanupAttemptAt = 0;

  constructor(
    private readonly pool: Pool,
    private readonly secret: string,
    private readonly windowMs: number,
    private readonly onDiagnostic: (
      kind: ProtectedRateLimitStoreDiagnostic,
    ) => void = () => undefined,
    private readonly now: () => number = Date.now,
  ) {}

  private storageKey(key: string): string {
    return createHmac("sha256", this.secret)
      .update(`${KEY_PREFIX}${key}`)
      .digest("hex");
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await this.pool.query<{
      count: number;
      reset_at: Date;
    }>(
      `INSERT INTO app_auth.protected_rate_limits (key, count, reset_at)
       VALUES ($1, 1, statement_timestamp() + ($2 * INTERVAL '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         count = CASE
           WHEN protected_rate_limits.reset_at <= statement_timestamp() THEN 1
           ELSE LEAST(protected_rate_limits.count + 1, $3)
         END,
         reset_at = CASE
           WHEN protected_rate_limits.reset_at <= statement_timestamp()
             THEN statement_timestamp() + ($2 * INTERVAL '1 millisecond')
           ELSE protected_rate_limits.reset_at
         END
       RETURNING count, reset_at`,
      [this.storageKey(key), this.windowMs, MAX_STORED_HITS],
    );
    const result = rows[0];
    if (!result) throw new Error("Rate limit counter was not returned.");
    await this.maybeCleanup();
    return {
      totalHits: result.count,
      resetTime: new Date(result.reset_at),
    };
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const { rows } = await this.pool.query<{
      count: number;
      reset_at: Date;
    }>(
      `SELECT count, reset_at
       FROM app_auth.protected_rate_limits
       WHERE key = $1`,
      [this.storageKey(key)],
    );
    const result = rows[0];
    return result
      ? { totalHits: result.count, resetTime: new Date(result.reset_at) }
      : undefined;
  }

  async decrement(key: string): Promise<void> {
    await this.pool.query(
      `UPDATE app_auth.protected_rate_limits
       SET count = GREATEST(count - 1, 0)
       WHERE key = $1`,
      [this.storageKey(key)],
    );
  }

  async resetKey(key: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM app_auth.protected_rate_limits WHERE key = $1`,
      [this.storageKey(key)],
    );
  }

  async resetAll(): Promise<void> {
    await this.pool.query("DELETE FROM app_auth.protected_rate_limits");
  }

  private async maybeCleanup(): Promise<void> {
    const now = this.now();
    if (now - this.lastCleanupAttemptAt < CLEANUP_INTERVAL_MS) return;
    this.lastCleanupAttemptAt = now;
    try {
      await this.pool.query(
        `WITH expired AS MATERIALIZED (
           SELECT key
           FROM app_auth.protected_rate_limits
           WHERE reset_at < statement_timestamp() - INTERVAL '24 hours'
           ORDER BY reset_at
           LIMIT 1000
           FOR UPDATE SKIP LOCKED
         )
         DELETE FROM app_auth.protected_rate_limits AS limits
         USING expired
         WHERE limits.key = expired.key`,
      );
    } catch {
      this.onDiagnostic("rate_limit_cleanup_error");
    }
  }
}
