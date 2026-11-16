import { randomInt, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (
  !["127.0.0.1", "localhost", "::1"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
)
  throw new Error(
    "Storage-guard tests require disposable local kartiseret_test",
  );

const pool = new Pool({ connectionString: url, max: 2 });
afterAll(async () => pool.end());

describe.sequential("Supabase storage guard migration", () => {
  it("exposes the size RPC to service_role only", async () => {
    const client = await pool.connect();
    try {
      const permissions = await client.query<{
        anonymous: boolean;
        authenticated: boolean;
        runtime: boolean;
        service: boolean;
      }>(`
        SELECT
          has_function_privilege('anon','public.get_database_size_bytes()','EXECUTE') AS anonymous,
          has_function_privilege('authenticated','public.get_database_size_bytes()','EXECUTE') AS authenticated,
          has_function_privilege('kartiseret_runtime','public.get_database_size_bytes()','EXECUTE') AS runtime,
          has_function_privilege('service_role','public.get_database_size_bytes()','EXECUTE') AS service
      `);
      expect(permissions.rows[0]).toEqual({
        anonymous: false,
        authenticated: false,
        runtime: false,
        service: true,
      });

      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE service_role");
      const size = await client.query<{ size_bytes: string }>(
        "SELECT public.get_database_size_bytes() AS size_bytes",
      );
      expect(Number(size.rows[0].size_bytes)).toBeGreaterThan(0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("deletes only published processed rows and repairs snapshot counts", async () => {
    const client = await pool.connect();
    const baseRunId = randomInt(1_700_000_000, 1_900_000_000);
    const snapshots = {
      eligible: randomUUID(),
      unresolved: randomUUID(),
      active: randomUUID(),
      pending: randomUUID(),
      incomplete: randomUUID(),
    };
    const cases = [
      {
        key: "eligible",
        added: true,
        status: "complete",
        phase: "published",
        unresolved: false,
      },
      {
        key: "unresolved",
        added: true,
        status: "complete",
        phase: "published",
        unresolved: true,
      },
      {
        key: "active",
        added: true,
        status: "complete",
        phase: "published",
        unresolved: false,
      },
      {
        key: "pending",
        added: false,
        status: "complete",
        phase: "in_progress",
        unresolved: false,
      },
      {
        key: "incomplete",
        added: true,
        status: "running",
        phase: null,
        unresolved: false,
      },
    ] as const;

    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE service_role");
      for (const [index, item] of cases.entries()) {
        const runId = baseRunId + index;
        await client.query(
          `INSERT INTO public.pipeline_scrape_snapshots
             (snapshot_id,run_id,table_name,source_name,cinema,status,row_count)
           VALUES ($1,$2,'allShowtimes','storage-guard-test','storage-guard-test',$3,1)`,
          [snapshots[item.key], runId, item.status],
        );
        await client.query(
          `INSERT INTO public."allShowtimes" (date_of_showing,run_id,snapshot_id,cleaned,added)
           VALUES ('1900-01-01',$1,$2,true,$3)`,
          [runId, snapshots[item.key], item.added],
        );
        if (item.phase) {
          await client.query(
            `INSERT INTO public.pipeline_publication_checkpoints
               (category,snapshot_id,input_fingerprint,phase,has_unresolved)
             VALUES ('nowplayings',$1,$2,$3,$4)`,
            [snapshots[item.key], "a".repeat(64), item.phase, item.unresolved],
          );
        }
      }
      await client.query(
        `INSERT INTO public."utilRunLogs" (run_id,running_now)
         VALUES ($1,true)`,
        [baseRunId + 2],
      );

      const dryRun = await client.query<{
        result: { eligible: number; deleted: number };
      }>(
        "SELECT public.retire_expired_rows('allShowtimes','1900-01-01',false,10) AS result",
      );
      expect(dryRun.rows[0].result).toMatchObject({ eligible: 1, deleted: 0 });

      const applied = await client.query<{
        result: { eligible: number; deleted: number };
      }>(
        "SELECT public.retire_expired_rows('allShowtimes','1900-01-01',true,10) AS result",
      );
      expect(applied.rows[0].result).toMatchObject({ eligible: 1, deleted: 1 });

      const rows = await client.query<{ snapshot_id: string }>(
        `SELECT snapshot_id FROM public."allShowtimes"
         WHERE snapshot_id = ANY($1::uuid[]) ORDER BY snapshot_id`,
        [Object.values(snapshots)],
      );
      expect(rows.rows.map((row) => row.snapshot_id)).toHaveLength(4);

      const manifest = await client.query<{ row_count: number }>(
        "SELECT row_count FROM public.pipeline_scrape_snapshots WHERE snapshot_id=$1",
        [snapshots.eligible],
      );
      expect(manifest.rows[0].row_count).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});
