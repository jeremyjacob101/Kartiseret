import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/kartiseret_test"
)
  throw new Error("Safeupdate tests require local disposable kartiseret_test.");

// Supply an absolute path to the real pg-safeupdate library to reproduce the
// Supabase API session hook. Ordinary integration runs still test all categories.
const library = process.env.TEST_SAFEUPDATE_LIBRARY;
const pool = new Pool({ connectionString: url, max: 1 });
afterAll(() => pool.end());
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe("publication with explicit temporary-work-table qualification", () => {
  it.each([
    ["nowplayings", "allShowtimes"],
    ["comingsoons", "allSoons"],
    ["cinematheques", "allTheques"],
  ])(
    "publishes inserts, updates and deletes for %s",
    async (category, table) => {
      const client = await pool.connect();
      try {
        if (library) {
          await client.query(`LOAD '${library.replaceAll("'", "''")}'`);
          expect(
            (await client.query("SHOW safeupdate.enabled")).rows[0],
          ).toEqual({
            "safeupdate.enabled": "on",
          });
        }
        await client.query("BEGIN");
        const ids = [randomUUID(), randomUUID(), randomUUID()];
        await client.query(
          `INSERT INTO public."${table}" (id,english_title,added) VALUES ($1,'Keep',false),($2,'Remove',false)`,
          ids.slice(0, 2),
        );
        const rows = (
          await client.query(
            `SELECT to_jsonb(t) AS row FROM public."${table}" t WHERE id=ANY($1)`,
            [ids.slice(0, 2)],
          )
        ).rows.map((result) => result.row);
        const before = rows.find((row) => row.id === ids[0]);
        const removed = rows.find((row) => row.id === ids[1]);
        const payload = JSON.stringify({
          kind: "changes",
          rows: [
            { table, before, after: { ...before, added: true } },
            { table, before: null, after: { ...before, id: ids[2] } },
            { table, before: removed, after: null },
          ],
        });
        const publication = randomUUID();
        const fingerprint = hash(`0:${hash(payload)}`);
        await client.query(
          "INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count) VALUES($1,$2,990003,$3,1)",
          [publication, category, fingerprint],
        );
        await client.query(
          "INSERT INTO public.pipeline_publication_parts VALUES($1,0,$2)",
          [publication, payload],
        );
        // Reproduce the exact production failure using the unpatched function,
        // then roll back that attempt before exercising the installed migration.
        if (library) {
          const original = readFileSync(
            new URL(
              "../../../../supabase/migrations/20261023112849_optimize_category_publication.sql",
              import.meta.url,
            ),
            "utf8",
          ).replace(
            "public.commit_category_publication",
            "pg_temp.unpatched_commit",
          );
          await client.query(original);
          await client.query("SAVEPOINT unpatched");
          await expect(
            client.query("SELECT pg_temp.unpatched_commit($1,$2)", [
              publication,
              fingerprint,
            ]),
          ).rejects.toMatchObject({
            code: "21000",
            message: "UPDATE requires a WHERE clause",
          });
          await client.query("ROLLBACK TO SAVEPOINT unpatched");
          expect(
            (
              await client.query(
                `SELECT added FROM public."${table}" WHERE id=$1`,
                [ids[0]],
              )
            ).rows[0].added,
          ).toBe(false);
        }
        await client.query("SET LOCAL ROLE service_role");
        const commit = () =>
          client.query(
            "SELECT public.commit_category_publication($1,$2) AS receipt",
            [publication, fingerprint],
          );
        const receipt = (await commit()).rows[0].receipt;
        expect(receipt.status).toBe("applied");
        expect((await commit()).rows[0].receipt).toEqual(receipt);
        const actual = (
          await client.query(
            `SELECT id,added FROM public."${table}" WHERE id=ANY($1) ORDER BY id`,
            [ids],
          )
        ).rows;
        expect(actual).toEqual(
          [
            { id: ids[0], added: true },
            { id: ids[2], added: false },
          ].sort((a, b) => a.id.localeCompare(b.id)),
        );
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM public.pipeline_publication_parts WHERE publication_id=$1",
              [publication],
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await client.query("ROLLBACK");
        client.release();
      }
    },
  );
});
