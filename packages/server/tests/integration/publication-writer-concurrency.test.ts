import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/kartiseret_test"
)
  throw new Error("Writer tests require disposable local kartiseret_test");
const pool = new Pool({ connectionString: url, max: 8 });
const cinema = "__revision_writers__";
const runId = 998702;
const snapshots: string[] = [],
  publications: string[] = [];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function revision(
  table = "allShowtimes",
  db: Pick<PoolClient, "query"> = pool,
) {
  return (
    await db.query(
      "SELECT public.get_publication_input_revision($1,'nowplayings') AS revision",
      [table],
    )
  ).rows[0].revision as string;
}
async function begin(db: PoolClient) {
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE service_role");
  await db.query("SET LOCAL statement_timeout='8s'");
  await db.query("SET LOCAL lock_timeout='8s'");
  await db.query("SET LOCAL work_mem='2184kB'");
}
async function snapshot() {
  const id = randomUUID();
  snapshots.push(id);
  await pool.query(
    "INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema) VALUES($1,$2,'allShowtimes','Diagnostic',$3)",
    [id, runId, cinema],
  );
  return id;
}
async function compact(table = "allShowtimes") {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE kartiseret_publication_executor");
    await db.query(
      "SELECT pipeline_internal.compact_publication_input_revision($1,'nowplayings')",
      [table],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
async function stage(parts: Record<string, unknown>[]) {
  const payloads = parts.map((p) => JSON.stringify(p)),
    id = randomUUID();
  publications.push(id);
  const fingerprint = hash(
    payloads.map((p, i) => `${i}:${hash(p)}`).join("\n"),
  );
  await pool.query(
    "INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count) VALUES($1,'nowplayings',$2,$3,$4)",
    [id, runId, fingerprint, parts.length],
  );
  for (const [i, p] of payloads.entries())
    await pool.query(
      "INSERT INTO public.pipeline_publication_parts VALUES($1,$2,$3)",
      [id, i, p],
    );
  return { id, fingerprint };
}
async function apply(
  db: Pick<PoolClient, "query">,
  p: { id: string; fingerprint: string },
) {
  return (
    await db.query(
      "SELECT public.commit_category_publication($1,$2) AS result",
      [p.id, p.fingerprint],
    )
  ).rows[0].result;
}
afterEach(async () => {
  await pool.query('DELETE FROM public."allShowtimes" WHERE cinema=$1', [
    cinema,
  ]);
  await pool.query(
    "DELETE FROM public.pipeline_scrape_snapshots WHERE snapshot_id=ANY($1::uuid[])",
    [snapshots.splice(0)],
  );
  await pool.query(
    "DELETE FROM public.pipeline_publications WHERE publication_id=ANY($1::uuid[])",
    [publications.splice(0)],
  );
  await compact();
  await compact("pipeline_scrape_snapshots");
  await compact("pipeline_publication_checkpoints");
});
afterAll(() => pool.end());

describe("noncontending transactional input revisions", () => {
  it("does not block unrelated uploads behind an uncommitted raw insert", async () => {
    const holder = await pool.connect();
    try {
      await begin(holder);
      await holder.query(
        "INSERT INTO public.\"allShowtimes\"(cinema,english_title) VALUES($1,'Uncommitted')",
        [cinema],
      );
      const started = performance.now();
      const sizes = [1412, 3587, 4481, 3904];
      const inserted = await Promise.all(
        sizes.map(async (n) => {
          const db = await pool.connect();
          try {
            await begin(db);
            const r = await db.query(
              "INSERT INTO public.\"allShowtimes\"(cinema,english_title,run_id) SELECT $1,'Parallel film '||g,$2 FROM generate_series(1,$3::integer) g",
              [cinema, runId, n],
            );
            await db.query("COMMIT");
            return r.rowCount;
          } catch (e) {
            await db.query("ROLLBACK");
            throw e;
          } finally {
            db.release();
          }
        }),
      );
      expect(inserted).toEqual(sizes);
      expect(performance.now() - started).toBeLessThan(3000);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("does not queue independent snapshot updates on a category counter", async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => snapshot()));
    const before = BigInt(await revision("pipeline_scrape_snapshots"));
    const holder = await pool.connect();
    try {
      await begin(holder);
      await holder.query(
        "UPDATE public.pipeline_scrape_snapshots SET status='complete' WHERE snapshot_id=$1",
        [ids[0]],
      );
      const started = performance.now();
      await Promise.all(
        ids.slice(1).map(async (id) => {
          const db = await pool.connect();
          try {
            await begin(db);
            await db.query(
              "UPDATE public.pipeline_scrape_snapshots SET status='failed' WHERE snapshot_id=$1",
              [id],
            );
            await db.query("COMMIT");
          } catch (e) {
            await db.query("ROLLBACK");
            throw e;
          } finally {
            db.release();
          }
        }),
      );
      expect(performance.now() - started).toBeLessThan(2000);
      expect(BigInt(await revision("pipeline_scrape_snapshots"))).toBe(
        before + 3n,
      );
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
    expect(BigInt(await revision("pipeline_scrape_snapshots"))).toBe(
      before + 3n,
    );
  });

  it("does not require a lock on the old base counter when writing", async () => {
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        "UPDATE pipeline_internal.publication_input_revisions SET revision=revision+1 WHERE relation='allShowtimes' AND scope='*'",
      );
      const db = await pool.connect();
      try {
        await begin(db);
        await db.query('INSERT INTO public."allShowtimes"(cinema) VALUES($1)', [
          cinema,
        ]);
        await db.query("COMMIT");
      } catch (e) {
        await db.query("ROLLBACK");
        throw e;
      } finally {
        db.release();
      }
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });

  it("keeps uncommitted increments private and reuses only the current transaction's slot", async () => {
    await compact();
    const before = BigInt(await revision());
    const writer = await pool.connect();
    try {
      await begin(writer);
      for (let i = 0; i < 3; i++)
        await writer.query(
          'INSERT INTO public."allShowtimes"(cinema) VALUES($1)',
          [cinema],
        );
      expect(BigInt(await revision("allShowtimes", writer))).toBe(before + 3n);
      expect(BigInt(await revision())).toBe(before);
      const slot = (
        await writer
          .query(
            "SELECT count(*)::int AS n,sum(delta)::int AS delta FROM pipeline_internal.publication_input_revision_deltas WHERE relation='allShowtimes' AND scope='*'",
          )
          .catch(() => ({ rows: [] }))
      ).rows;
      // The service role cannot inspect or forge internal writer slots.
      expect(slot).toEqual([]);
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
    expect(BigInt(await revision())).toBe(before);
    const admin = await pool.connect();
    try {
      await admin.query("BEGIN");
      for (let i = 0; i < 3; i++)
        await admin.query(
          'INSERT INTO public."allShowtimes"(cinema) VALUES($1)',
          [cinema],
        );
      const slots = (
        await admin.query(
          "SELECT count(*)::int AS n,sum(delta)::int AS delta FROM pipeline_internal.publication_input_revision_deltas WHERE relation='allShowtimes' AND writer=pg_current_xact_id()",
        )
      ).rows[0];
      expect(slots).toEqual({ n: 1, delta: 3 });
      await admin.query("COMMIT");
    } finally {
      await admin.query("ROLLBACK");
      admin.release();
    }
    expect(BigInt(await revision())).toBe(before + 3n);
  });

  it("preserves tokens when compacting and does not invalidate an already prepared guard", async () => {
    for (let i = 0; i < 4; i++)
      await pool.query('INSERT INTO public."allShowtimes"(cinema) VALUES($1)', [
        cinema,
      ]);
    const token = await revision();
    const p = await stage([
      { kind: "guard", table: "allShowtimes", revision: token, rows: [] },
    ]);
    await compact();
    expect(await revision()).toBe(token);
    expect((await apply(pool, p)).status).toBe("applied");
    const remaining = (
      await pool.query(
        "SELECT count(*)::int AS n FROM pipeline_internal.publication_input_revision_deltas WHERE relation='allShowtimes'",
      )
    ).rows[0].n;
    expect(remaining).toBe(0);
  });

  it("rejects an actual change after compaction and rolls back receipt and data", async () => {
    const row = (
      await pool.query(
        'INSERT INTO public."allShowtimes"(cinema,added) VALUES($1,false) RETURNING to_jsonb("allShowtimes") AS row',
        [cinema],
      )
    ).rows[0].row;
    const p = await stage([
      {
        kind: "guard",
        table: "allShowtimes",
        revision: await revision(),
        rows: [],
      },
      {
        kind: "changes",
        rows: [
          {
            table: "allShowtimes",
            before: row,
            after: { ...row, added: true },
          },
        ],
      },
    ]);
    await compact();
    await pool.query('INSERT INTO public."allShowtimes"(cinema) VALUES($1)', [
      cinema,
    ]);
    await expect(apply(pool, p)).rejects.toMatchObject({ code: "40001" });
    expect(
      (
        await pool.query(
          'SELECT added FROM public."allShowtimes" WHERE id=$1',
          [row.id],
        )
      ).rows[0].added,
    ).toBe(false);
    expect(
      (
        await pool.query(
          "SELECT status FROM public.pipeline_publications WHERE publication_id=$1",
          [p.id],
        )
      ).rows[0].status,
    ).toBe("prepared");
  });

  it("rolls back compaction together with a cancelled publication transaction", async () => {
    await pool.query('INSERT INTO public."allShowtimes"(cinema) VALUES($1)', [
      cinema,
    ]);
    const token = await revision();
    const original = (
      await pool.query(
        "SELECT revision::text FROM pipeline_internal.publication_input_revisions WHERE relation='allShowtimes' AND scope='*'",
      )
    ).rows[0].revision;
    const p = await stage([
      { kind: "guard", table: "allShowtimes", revision: token, rows: [] },
    ]);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await apply(db, p);
      await db.query("ROLLBACK");
    } finally {
      db.release();
    }
    expect(await revision()).toBe(token);
    expect(
      (
        await pool.query(
          "SELECT revision::text FROM pipeline_internal.publication_input_revisions WHERE relation='allShowtimes' AND scope='*'",
        )
      ).rows[0].revision,
    ).toBe(original);
    expect(
      (
        await pool.query(
          "SELECT status FROM public.pipeline_publications WHERE publication_id=$1",
          [p.id],
        )
      ).rows[0].status,
    ).toBe("prepared");
  });

  it("does not form a counter deadlock when writers touch raw and metadata in opposite order", async () => {
    const ids = await Promise.all(Array.from({ length: 4 }, () => snapshot()));
    await Promise.all(
      ids.map(async (id, i) => {
        const db = await pool.connect();
        try {
          await begin(db);
          const raw = () =>
            db.query('INSERT INTO public."allShowtimes"(cinema) VALUES($1)', [
              cinema,
            ]);
          const meta = () =>
            db.query(
              "UPDATE public.pipeline_scrape_snapshots SET status='complete' WHERE snapshot_id=$1",
              [id],
            );
          if (i % 2) {
            await raw();
            await meta();
          } else {
            await meta();
            await raw();
          }
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }),
    );
  });

  it("requires the table writer fence for compaction and respects a bounded lock timeout", async () => {
    const holder = await pool.connect();
    const collector = await pool.connect();
    try {
      await begin(holder);
      await holder.query(
        'INSERT INTO public."allShowtimes"(cinema) VALUES($1)',
        [cinema],
      );
      await collector.query("BEGIN");
      await collector.query("SET LOCAL ROLE kartiseret_publication_executor");
      await collector.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        collector.query(
          "SELECT pipeline_internal.compact_publication_input_revision('allShowtimes','nowplayings')",
        ),
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await holder.query("ROLLBACK");
      await collector.query("ROLLBACK");
      holder.release();
      collector.release();
    }
  });

  it("keeps writer slots and compaction inaccessible to browser, API, service and publisher roles", async () => {
    for (const role of [
      "anon",
      "authenticated",
      "kartiseret_runtime",
      "service_role",
      "kartiseret_publisher",
    ]) {
      const p = (
        await pool.query(
          "SELECT has_table_privilege($1,'pipeline_internal.publication_input_revision_deltas','INSERT') AS write,has_function_privilege($1,'pipeline_internal.compact_publication_input_revision(text,text)','EXECUTE') AS compact",
          [role],
        )
      ).rows[0];
      expect(p).toEqual({ write: false, compact: false });
    }
  });
});
