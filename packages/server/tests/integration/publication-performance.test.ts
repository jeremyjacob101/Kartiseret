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
const pool = new Pool({ connectionString: url, max: 1 });
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
      expect(result.rows).toHaveLength(11);
      expect(
        result.rows.every((row: { identical: boolean }) => row.identical),
      ).toBe(true);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 120_000);

  it("publishes 737 parts exceeding 128 MB within the existing deadline", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const results = await client.query(fixture("publication-scale.sql"));
      const result = Array.isArray(results) ? results.at(-1)! : results;
      const measured = result.rows[0];
      expect(Number(measured.parts)).toBe(737);
      expect(Number(measured.bytes)).toBeGreaterThanOrEqual(128_000_000);
      expect(Number(measured.seconds)).toBeLessThan(60);
      expect(Number(measured.updated)).toBe(45_488);
      expect(Number(measured.movies)).toBe(156);
      expect(Number(measured.screenings)).toBe(10_519);
      console.info("Publication scale measurement", measured);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }, 240_000);
});
