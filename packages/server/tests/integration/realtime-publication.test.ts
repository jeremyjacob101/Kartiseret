import { readFile } from "node:fs/promises";
import { afterAll, expect, it } from "vitest";
import { createDatabase } from "../../src/db/client.js";

const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !["localhost", "127.0.0.1"].includes(new URL(target).hostname) ||
  new URL(target).pathname !== "/kartiseret_test"
) {
  throw new Error(
    "Realtime publication test requires disposable local kartiseret_test.",
  );
}
const admin = createDatabase(target, { poolMax: 1 });
afterAll(async () => admin.pool.end());

it("enables all watcher tables without replacing existing replication or failing on reapply", async () => {
  await admin.pool.query(`
    CREATE PUBLICATION supabase_realtime FOR TABLE public."finalMovies", public."finalSoons";
  `);
  try {
    const sql = await readFile(
      new URL(
        "../../../../supabase/migrations/20261106091615_enable_cinematheque_realtime.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await admin.pool.query(sql);
    await admin.pool.query(sql);
    const result = await admin.pool.query(
      "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename",
    );
    expect(
      result.rows.map((row: { tablename: string }) => row.tablename),
    ).toEqual(["finalMovies", "finalSoons", "finalThequeMovies"]);
  } finally {
    await admin.pool.query("DROP PUBLICATION supabase_realtime");
  }
});
