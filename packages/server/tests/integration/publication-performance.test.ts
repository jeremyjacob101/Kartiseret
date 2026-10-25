import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/kartiseret_test"
)
  throw new Error(
    "Publication performance tests require local disposable kartiseret_test.",
  );
const pool = new Pool({
  connectionString: url,
  max: 1,
  statement_timeout: 10_000,
});
afterAll(() => pool.end());
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("publication SQL performance and parity", () => {
  it("matches the original function for successful and rejected publications", async () => {
    const original = readFileSync(
      new URL(
        "../../../../supabase/migrations/20261021044037_atomic_category_publication.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const start = original.indexOf(
      "CREATE FUNCTION public.commit_category_publication",
    );
    const legacy = original
      .slice(start, original.indexOf("\n$$;", start) + 4)
      .replace("public.commit_category_publication", "pg_temp.legacy_commit");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(legacy);
      const results = await client.query(fixture("publication-parity.sql"));
      const result = Array.isArray(results) ? results.at(-1)! : results;
      expect(result.rows).toHaveLength(12);
      expect(
        result.rows.every((row: { identical: boolean }) => row.identical),
      ).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 30_000);

  it("publishes 737 small parts with exact row values and atomic finalization", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let measured: Record<string, unknown> | undefined;
      for (const step of fixture("publication-scale.sql").split(/^-- step$/m)) {
        if (!step.trim()) continue;
        const results = await client.query(step);
        const result = Array.isArray(results) ? results.at(-1)! : results;
        if (result.rows[0]?.seconds !== undefined) measured = result.rows[0];
      }
      expect(measured).toBeDefined();
      if (!measured) throw new Error("Missing scale measurement");
      expect(Number(measured.parts)).toBe(737);
      expect(Number(measured.bytes)).toBeLessThan(20_000_000);
      expect(Number(measured.seconds)).toBeLessThan(5);
      expect(Number(measured.updated)).toBe(7_500);
      expect(Number(measured.movies)).toBe(24);
      expect(Number(measured.screenings)).toBe(300);
      console.info("Publication scale measurement", measured);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 30_000);

  it("atomically publishes a full backlog while retaining pending historical work", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '45s'");
      let measured: Record<string, unknown> | undefined;
      for (const step of fixture("publication-backlog-scale.sql").split(
        /^-- step$/m,
      )) {
        if (!step.trim()) continue;
        const results = await client.query(step);
        const result = Array.isArray(results) ? results.at(-1)! : results;
        if (result.rows[0]?.seconds !== undefined) measured = result.rows[0];
      }
      expect(measured).toBeDefined();
      if (!measured) throw new Error("Missing backlog measurement");
      expect(Number(measured.changes)).toBe(46_244);
      expect(Number(measured.bytes)).toBeGreaterThan(90_000_000);
      expect(Number(measured.bytes)).toBeLessThan(120_000_000);
      expect(Number(measured.seconds)).toBeLessThan(30);
      expect(Number(measured.retained_failed)).toBe(29_057);
      expect(Number(measured.pending_legacy)).toBe(2_673);
      expect(Number(measured.screenings)).toBe(9_044);
      console.info("Publication backlog measurement", measured);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 90_000);
});
