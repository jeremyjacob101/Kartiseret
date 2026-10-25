import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const publisherScript = resolve(
  repositoryRoot,
  "packages/server/tests/integration/fixtures/postgres-publication-publisher.py",
);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

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

  it.skipIf(process.env.RUN_POSTGRES_PUBLISHER_BACKLOG_PERF !== "true")(
    "replays the full backlog through COPY and the restricted PostgreSQL publisher",
    async () => {
      const client = await pool.connect();
      let setupCommitted = false;
      const publicationId = randomUUID();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '45s'");
        const sql = fixture("publication-backlog-scale.sql");
        const headerInsert = sql.indexOf(
          "INSERT INTO public.pipeline_publications(publication_id",
        );
        expect(headerInsert).toBeGreaterThan(0);
        await client.query(sql.slice(0, headerInsert));
        const databaseParts = (
          await client.query("SELECT payload FROM backlog_parts ORDER BY part")
        ).rows.map((row: { payload: string }) => row.payload);
        // Run 660 staged 638 parts across six cinema sources. Split existing
        // immutable fixture parts to match that part count while preserving
        // every row and order; this fixture intentionally carries more changes.
        let remainingSplits = 638 - databaseParts.length;
        const parts: string[] = [];
        for (const payload of databaseParts) {
          const part = JSON.parse(payload) as {
            rows: unknown[];
            [key: string]: unknown;
          };
          if (remainingSplits > 0 && part.rows.length > 1) {
            parts.push(canonical({ ...part, rows: part.rows.slice(0, 1) }));
            parts.push(canonical({ ...part, rows: part.rows.slice(1) }));
            remainingSplits -= 1;
          } else {
            parts.push(canonical(part));
          }
        }
        expect(remainingSplits).toBe(0);
        const changeCount = parts
          .map((part) => JSON.parse(part) as { kind: string; rows: unknown[] })
          .filter((part) => part.kind === "changes")
          .reduce((total, part) => total + part.rows.length, 0);
        expect(parts.length).toBe(638);
        expect(changeCount).toBe(46_244);
        const fingerprint = digest(
          parts
            .map((part: string, index: number) => `${index}:${digest(part)}`)
            .join("\n"),
        );
        const identity = {
          publication_id: publicationId,
          category: "nowplayings",
          run_id: 990004,
          fingerprint,
          part_count: parts.length,
        };
        const payloadBytes = parts.reduce(
          (total: number, part: string) => total + Buffer.byteLength(part),
          0,
        );
        expect(payloadBytes).toBeGreaterThan(90_000_000);
        expect(payloadBytes).toBeLessThan(120_000_000);
        await client.query("COMMIT");
        setupCommitted = true;

        const request = spawnSync(
          process.env.PYTHON ?? "python3",
          [publisherScript],
          {
            cwd: repositoryRoot,
            env: {
              ...process.env,
              PYTHONPATH: [repositoryRoot, process.env.PYTHONPATH]
                .filter(Boolean)
                .join(delimiter),
            },
            input: JSON.stringify({ identity, parts }),
            encoding: "utf8",
            maxBuffer: 220 * 1024 * 1024,
            timeout: 320_000,
          },
        );
        if (request.error) throw request.error;
        if (request.status !== 0)
          throw new Error(
            request.stderr ||
              request.stdout ||
              `Publisher exited ${request.status}`,
          );
        const receipt = JSON.parse(request.stdout.trim()) as {
          status: string;
          revision: string;
        };
        expect(receipt.status).toBe("applied");

        const metrics = request.stderr
          .split(/\r?\n/)
          .filter((line) => line.includes("publication_metric="))
          .map((line) =>
            JSON.parse(line.slice(line.indexOf("publication_metric=") + 19)),
          );
        const staging = metrics.find(
          (metric: { event: string }) =>
            metric.event === "publication_stage_complete",
        );
        const committed = metrics.find(
          (metric: { event: string }) =>
            metric.event === "publication_apply_committed",
        );
        expect(staging).toBeDefined();
        expect(committed).toBeDefined();
        if (!staging || !committed)
          throw new Error("Missing publisher timing metrics");
        expect(staging.parts).toBe(parts.length);
        expect(staging.payload_bytes).toBe(payloadBytes);
        expect(Number(staging.seconds)).toBeLessThanOrEqual(120);
        expect(Number(committed.function_seconds)).toBeLessThanOrEqual(300);
        expect(Number(committed.transaction_seconds)).toBeLessThanOrEqual(330);

        const retained = (
          await client.query(
            `
            SELECT
              (SELECT count(*) FROM public."allShowtimes" WHERE run_id=990003 AND cleaned=false AND added IS NULL)::int AS retained_failed,
              (SELECT count(*) FROM public."allShowtimes" WHERE run_id=990004 AND snapshot_id IS NULL AND cleaned=true AND added IS NULL)::int AS pending_legacy,
              (SELECT count(*) FROM public."finalShowtimes" WHERE cinema LIKE 'Backlog scale %')::int AS screenings,
              (SELECT count(*) FROM public.pipeline_publication_parts WHERE publication_id=$1)::int AS remaining_parts,
              (SELECT status FROM public.pipeline_publications WHERE publication_id=$1) AS publication_status
          `,
            [publicationId],
          )
        ).rows[0];
        expect(retained).toEqual({
          retained_failed: 29_057,
          pending_legacy: 2_673,
          screenings: 9_044,
          remaining_parts: 0,
          publication_status: "applied",
        });
        console.info("PostgreSQL publisher backlog replay", {
          payload_bytes: payloadBytes,
          parts: parts.length,
          changes: changeCount,
          receipt,
          timings: metrics,
          retained,
        });
      } finally {
        if (setupCommitted) {
          await client.query("BEGIN");
          await client.query(
            "DELETE FROM public.pipeline_publication_checkpoints c USING public.pipeline_scrape_snapshots s WHERE c.snapshot_id=s.snapshot_id AND s.cinema LIKE 'Backlog scale %'",
          );
          await client.query(
            "DELETE FROM public.pipeline_publication_parts WHERE publication_id=$1",
            [publicationId],
          );
          await client.query(
            "DELETE FROM public.pipeline_publications WHERE publication_id=$1",
            [publicationId],
          );
          await client.query(
            "DELETE FROM public.\"allShowtimes\" WHERE cinema LIKE 'Backlog scale %'",
          );
          await client.query(
            "DELETE FROM public.\"finalShowtimes\" WHERE cinema LIKE 'Backlog scale %'",
          );
          await client.query(
            'DELETE FROM public."movieCodes" WHERE tmdb_id BETWEEN 1100001 AND 1100310',
          );
          await client.query(
            'DELETE FROM public."finalMovies" WHERE tmdb_id BETWEEN 1100001 AND 1100310',
          );
          await client.query(
            "DELETE FROM public.pipeline_scrape_snapshots WHERE cinema LIKE 'Backlog scale %'",
          );
          await client.query("COMMIT");
        } else {
          await client.query("ROLLBACK");
        }
        client.release();
      }
    },
    360_000,
  );
});
