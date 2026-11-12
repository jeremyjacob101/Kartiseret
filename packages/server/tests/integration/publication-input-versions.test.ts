import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/kartiseret_test"
)
  throw new Error(
    "Input version tests require local disposable kartiseret_test.",
  );
const pool = new Pool({ connectionString: url, max: 5 });
const cinema = "__input_versions__";
const publications: string[] = [];
const fixes: string[] = [];
const snapshots: string[] = [];
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Part = Record<string, unknown>;
type Queryable = Pick<PoolClient, "query">;

async function version(
  db: Queryable,
  table: string,
  category = "nowplayings",
): Promise<string> {
  return (
    await db.query(
      "SELECT public.get_publication_input_revision($1,$2) AS revision",
      [table, category],
    )
  ).rows[0].revision;
}
async function guard(table: string, category = "nowplayings"): Promise<Part> {
  return {
    kind: "guard",
    table,
    revision: await version(pool, table, category),
    rows: [],
  };
}
async function stage(parts: Part[], category = "nowplayings") {
  const id = randomUUID();
  const payloads = parts.map((part) => JSON.stringify(part));
  const fingerprint = hash(
    payloads.map((payload, i) => `${i}:${hash(payload)}`).join("\n"),
  );
  publications.push(id);
  await pool.query(
    "INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count) VALUES($1,$2,998001,$3,$4)",
    [id, category, fingerprint, parts.length],
  );
  for (const [i, payload] of payloads.entries())
    await pool.query(
      "INSERT INTO public.pipeline_publication_parts VALUES($1,$2,$3)",
      [id, i, payload],
    );
  return { id, fingerprint };
}
async function apply(
  db: Queryable,
  publication: { id: string; fingerprint: string },
) {
  return (
    await db.query(
      "SELECT public.commit_category_publication($1,$2) AS result",
      [publication.id, publication.fingerprint],
    )
  ).rows[0].result;
}
async function rawPublication(extra: Part[] = []) {
  const id = randomUUID();
  const before = (
    await pool.query(
      'INSERT INTO public."allShowtimes"(id,cinema,english_title,added) VALUES($1,$2,\'Original\',false) RETURNING to_jsonb("allShowtimes") AS row',
      [id, cinema],
    )
  ).rows[0].row;
  return {
    id,
    before,
    publication: await stage([
      await guard("allShowtimes"),
      ...extra,
      {
        kind: "changes",
        rows: [
          { table: "allShowtimes", before, after: { ...before, added: true } },
        ],
      },
    ]),
  };
}
async function waitForBlock(pid: number) {
  for (let i = 0; i < 100; i++) {
    const blocked = (
      await pool.query(
        "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
        [pid],
      )
    ).rows[0].blocked;
    if (blocked) return;
    await delay(10);
  }
  throw new Error("Publication did not reach the expected database lock");
}

afterEach(async () => {
  await pool.query(
    "DELETE FROM public.pipeline_scrape_snapshots WHERE snapshot_id=ANY($1::uuid[])",
    [snapshots.splice(0)],
  );
  await pool.query(
    "DELETE FROM public.pipeline_publications WHERE publication_id=ANY($1::uuid[])",
    [publications.splice(0)],
  );
  await pool.query('DELETE FROM public."allShowtimes" WHERE cinema=$1', [
    cinema,
  ]);
  await pool.query('DELETE FROM public."tableFixes" WHERE id=ANY($1::uuid[])', [
    fixes.splice(0),
  ]);
});
afterAll(() => pool.end());

describe("publication input version fencing", () => {
  const tables = [
    ["allShowtimes", "nowplayings", "id", "id,cinema", "$1,'version trigger'"],
    ["allSoons", "comingsoons", "id", "id,cinema", "$1,'version trigger'"],
    ["allTheques", "cinematheques", "id", "id,cinema", "$1,'version trigger'"],
    [
      "finalMovies",
      "nowplayings",
      "tmdb_id",
      "tmdb_id,english_title",
      "$1,'Version film'",
    ],
    [
      "finalSoons",
      "comingsoons",
      "id",
      "id,tmdb_id,release_date,english_title,hebrew_title",
      "$1,2109800002,'2035-01-01','Version film','סרט'",
    ],
    [
      "finalShowtimes",
      "nowplayings",
      "id",
      "id,cinema",
      "$1,'version trigger'",
    ],
    [
      "finalThequeMovies",
      "cinematheques",
      "tmdb_id",
      "tmdb_id,english_title",
      "$1,'Version film'",
    ],
    [
      "finalTheques",
      "cinematheques",
      "id",
      "id,cinema,english_title,date_of_showing,showtime,screening_city,run_id",
      "$1,'version trigger','Version film','2035-01-01','20:00','Haifa',998001",
    ],
    [
      "tableFixes",
      "nowplayings",
      "id",
      "id,tmdb_id,title_fix",
      "$1,'2109800001','Version film'",
    ],
    ["tableSkips", "nowplayings", "name_or_tmdb_id", "name_or_tmdb_id", "$1"],
    [
      "pipeline_scrape_snapshots",
      "nowplayings",
      "snapshot_id",
      "snapshot_id,run_id,table_name,source_name,cinema",
      "$1,998001,'allShowtimes','Version test','version trigger'",
    ],
    [
      "pipeline_publication_checkpoints",
      "nowplayings",
      "snapshot_id",
      "snapshot_id,category,input_fingerprint",
      "$1,'nowplayings','version test'",
    ],
  ];
  it.each(tables)(
    "tracks insert, update, delete, truncate and rollback for %s",
    async (table, category, key, columns, values) => {
      const db = await pool.connect();
      const id = key === "tmdb_id" ? 2109800001 : randomUUID();
      const initial = await version(db, table, category);
      try {
        await db.query("BEGIN");
        if (table === "pipeline_publication_checkpoints")
          await db.query(
            "INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema) VALUES($1,998001,'allShowtimes','Version test','version trigger')",
            [id],
          );
        let previous = BigInt(await version(db, table, category));
        for (const sql of [
          `INSERT INTO public."${table}"(${columns}) VALUES(${values})`,
          `UPDATE public."${table}" SET "${key}"="${key}" WHERE "${key}"=$1`,
          `DELETE FROM public."${table}" WHERE "${key}"=$1`,
          `TRUNCATE public."${table}" CASCADE`,
        ]) {
          await db.query(sql, sql.startsWith("TRUNCATE") ? [] : [id]);
          const next = BigInt(await version(db, table, category));
          expect(next).toBeGreaterThan(previous);
          previous = next;
        }
      } finally {
        await db.query("ROLLBACK");
        db.release();
      }
      expect(await version(pool, table, category)).toBe(initial);
    },
  );

  it("increments ordinary table tokens once per bulk statement", async () => {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const before = BigInt(await version(db, "allShowtimes"));
      await db.query(
        'INSERT INTO public."allShowtimes"(cinema) SELECT $1 FROM generate_series(1,2000)',
        [cinema],
      );
      expect(BigInt(await version(db, "allShowtimes"))).toBe(before + 1n);
      await db.query(
        'UPDATE public."allShowtimes" SET added=true WHERE cinema=$1',
        [cinema],
      );
      expect(BigInt(await version(db, "allShowtimes"))).toBe(before + 2n);
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it.each(["pipeline_scrape_snapshots", "pipeline_publication_checkpoints"])(
    "scopes shared %s tokens by category and fences scope moves",
    async (table) => {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const id = randomUUID();
        const category = "comingsoons";
        await db.query(
          "INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema) VALUES($1,998001,'allSoons','Version test','version trigger')",
          [id],
        );
        if (table === "pipeline_publication_checkpoints")
          await db.query(
            "INSERT INTO public.pipeline_publication_checkpoints(category,snapshot_id,input_fingerprint) VALUES('comingsoons',$1,'test')",
            [id],
          );
        const now = await version(db, table);
        const soon = await version(db, table, category);
        await db.query(
          `UPDATE public.${table} SET ${table === "pipeline_scrape_snapshots" ? "status='complete'" : "phase='prepared'"} WHERE snapshot_id=$1`,
          [id],
        );
        expect(await version(db, table)).toBe(now);
        expect(BigInt(await version(db, table, category))).toBeGreaterThan(
          BigInt(soon),
        );
        const movedFrom = await version(db, table, category);
        await db.query(
          `UPDATE public.${table} SET ${table === "pipeline_scrape_snapshots" ? "table_name='allShowtimes'" : "category='nowplayings'"} WHERE snapshot_id=$1`,
          [id],
        );
        expect(BigInt(await version(db, table))).toBeGreaterThan(BigInt(now));
        expect(BigInt(await version(db, table, category))).toBeGreaterThan(
          BigInt(movedFrom),
        );
      } finally {
        await db.query("ROLLBACK");
        db.release();
      }
    },
  );

  it("permits sequential scrapes and rejects an earlier preparation after the next scrape", async () => {
    const first = await rawPublication();
    await apply(pool, first.publication);
    const stale = await rawPublication();
    const latest = await rawPublication();
    await expect(apply(pool, stale.publication)).rejects.toMatchObject({
      code: "40001",
    });
    expect(
      (
        await pool.query(
          'SELECT added FROM public."allShowtimes" WHERE id=$1',
          [stale.id],
        )
      ).rows[0].added,
    ).toBe(false);
    await apply(pool, latest.publication);
    expect(
      (
        await pool.query(
          'SELECT added FROM public."allShowtimes" WHERE id=$1',
          [latest.id],
        )
      ).rows[0].added,
    ).toBe(true);
    // An applied receipt remains idempotent even after the input token changes.
    expect((await apply(pool, first.publication)).status).toBe("applied");
  });

  it("runs the real Python workspace through token capture, diff staging and the restricted PostgreSQL publisher", async () => {
    const fixture = await rawPublication();
    const child = spawnSync(
      process.env.PYTHON ?? "python3",
      [resolve("tests/integration/fixtures/postgres-publication-workspace.py")],
      {
        cwd: resolve("../.."),
        env: { ...process.env, PYTHONPATH: resolve("../..") },
        input: JSON.stringify({ id: fixture.id }),
        encoding: "utf8",
        timeout: 30000,
      },
    );
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(child.stderr || child.stdout);
    const result = JSON.parse(child.stdout);
    expect(result).toMatchObject({
      receipt: { status: "applied" },
      parts: 5,
      guard_rows: 0,
    });
    expect(result.guard_bytes).toBeLessThan(450);
    expect(
      (
        await pool.query(
          'SELECT added FROM public."allShowtimes" WHERE id=$1',
          [fixture.id],
        )
      ).rows[0].added,
    ).toBe(true);
    await pool.query(
      "DELETE FROM public.pipeline_publications WHERE run_id=998001 AND publication_id <> ALL($1::uuid[])",
      [publications],
    );
  });

  it.each(["UPDATE", "DELETE", "INSERT"])(
    "rejects %s changes even when the changed row was not a publication target",
    async (operation) => {
      const id = randomUUID();
      fixes.push(id);
      if (operation !== "INSERT")
        await pool.query(
          'INSERT INTO public."tableFixes"(id,tmdb_id,title_fix) VALUES($1,$2,$3)',
          [id, "1", "Old correction"],
        );
      const input = await guard("tableFixes");
      const fixture = await rawPublication([input]);
      if (operation === "INSERT") {
        await pool.query(
          "INSERT INTO public.\"tableFixes\" VALUES('1','New correction',$1)",
          [id],
        );
      } else {
        await pool.query(
          operation === "UPDATE"
            ? "UPDATE public.\"tableFixes\" SET title_fix='Changed correction' WHERE id=$1"
            : 'DELETE FROM public."tableFixes" WHERE id=$1',
          [id],
        );
      }
      await expect(apply(pool, fixture.publication)).rejects.toMatchObject({
        code: "40001",
        message: "Publication input changed: tableFixes",
      });
    },
  );

  it("waits for an uncommitted writer, rechecks its committed token, and keeps public reads available", async () => {
    const fixture = await rawPublication();
    const writer = await pool.connect();
    const publisher = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query(
        "UPDATE public.\"allShowtimes\" SET english_title='New scrape' WHERE id=$1",
        [fixture.id],
      );
      const pid = (await publisher.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      pending = apply(publisher, fixture.publication).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForBlock(pid);
      // ACCESS SHARE reads remain compatible with the publisher's table fences.
      expect(
        (
          await pool.query(
            'SELECT english_title FROM public."allShowtimes" WHERE id=$1',
            [fixture.id],
          )
        ).rows[0].english_title,
      ).toBe("Original");
      await writer.query("COMMIT");
      expect(await pending).toMatchObject({ code: "40001" });
    } finally {
      await writer.query("ROLLBACK");
      await pending;
      writer.release();
      publisher.release();
    }
  });

  it("accepts the original token when the concurrent writer rolls back", async () => {
    const fixture = await rawPublication();
    const writer = await pool.connect();
    const publisher = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query('DELETE FROM public."allShowtimes" WHERE id=$1', [
        fixture.id,
      ]);
      const pid = (await publisher.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      pending = apply(publisher, fixture.publication).then(
        (value: unknown) => value,
        (error: unknown) => error,
      );
      await waitForBlock(pid);
      await writer.query("ROLLBACK");
      expect(await pending).toMatchObject({ status: "applied" });
    } finally {
      await writer.query("ROLLBACK");
      await pending;
      writer.release();
      publisher.release();
    }
  });

  it("locks snapshot parents before checkpoint children so a metadata writer can finish", async () => {
    const fixture = await rawPublication(
      await Promise.all(
        ["pipeline_scrape_snapshots", "pipeline_publication_checkpoints"].map(
          (table) => guard(table),
        ),
      ),
    );
    const writer = await pool.connect();
    const publisher = await pool.connect();
    const snapshot = randomUUID();
    snapshots.push(snapshot);
    let pending: Promise<unknown> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("SET LOCAL statement_timeout='2s'");
      await writer.query(
        "LOCK TABLE public.pipeline_scrape_snapshots IN ROW EXCLUSIVE MODE",
      );
      const pid = (await publisher.query("SELECT pg_backend_pid() AS pid"))
        .rows[0].pid;
      pending = apply(publisher, fixture.publication).then(
        () => null,
        (error: unknown) => error,
      );
      await waitForBlock(pid);
      await writer.query(
        "INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema) VALUES($1,998001,'allShowtimes','Version test','version trigger')",
        [snapshot],
      );
      await writer.query(
        "INSERT INTO public.pipeline_publication_checkpoints(category,snapshot_id,input_fingerprint) VALUES('nowplayings',$1,'test')",
        [snapshot],
      );
      await writer.query("COMMIT");
      expect(await pending).toMatchObject({ code: "40001" });
    } finally {
      await writer.query("ROLLBACK");
      await pending;
      writer.release();
      publisher.release();
    }
  });

  it("fences a writer arriving after validation until publication commits", async () => {
    const fixture = await rawPublication();
    const publisher = await pool.connect();
    const writer = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await publisher.query("BEGIN");
      await apply(publisher, fixture.publication);
      const pid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid;
      pending = writer.query(
        "UPDATE public.\"allShowtimes\" SET english_title='Later scrape' WHERE id=$1",
        [fixture.id],
      );
      await waitForBlock(pid);
      expect(
        (
          await pool.query(
            'SELECT added FROM public."allShowtimes" WHERE id=$1',
            [fixture.id],
          )
        ).rows[0].added,
      ).toBe(false);
      await publisher.query("COMMIT");
      await pending;
      expect(
        (
          await pool.query(
            'SELECT added,english_title FROM public."allShowtimes" WHERE id=$1',
            [fixture.id],
          )
        ).rows[0],
      ).toEqual({ added: true, english_title: "Later scrape" });
    } finally {
      await publisher.query("ROLLBACK");
      await pending;
      publisher.release();
      writer.release();
    }
  });

  it("publishes independently prepared categories without invalidating shared metadata guards", async () => {
    const snapshot = randomUUID();
    snapshots.push(snapshot);
    const before = (
      await pool.query(
        "INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema) VALUES($1,998001,'allSoons','Version test','version trigger') RETURNING to_jsonb(pipeline_scrape_snapshots) AS row",
        [snapshot],
      )
    ).rows[0].row;
    const soonGuards = await Promise.all(
      ["pipeline_scrape_snapshots", "pipeline_publication_checkpoints"].map(
        (table) => guard(table, "comingsoons"),
      ),
    );
    const now = await rawPublication(
      await Promise.all(
        ["pipeline_scrape_snapshots", "pipeline_publication_checkpoints"].map(
          (table) => guard(table),
        ),
      ),
    );
    const soon = await stage(
      [
        ...soonGuards,
        {
          kind: "changes",
          rows: [
            {
              table: "pipeline_scrape_snapshots",
              before,
              after: { ...before, status: "complete" },
            },
            {
              table: "pipeline_publication_checkpoints",
              before: null,
              after: {
                category: "comingsoons",
                snapshot_id: snapshot,
                input_fingerprint: "test",
                phase: "published",
              },
            },
          ],
        },
      ],
      "comingsoons",
    );
    await apply(pool, soon);
    await apply(pool, now.publication);
  });

  it.each([
    { rows: [] },
    { revision: "01", rows: [] },
    { revision: "-1", rows: [] },
    { revision: "9223372036854775808", rows: [] },
    { revision: 0, rows: [] },
    { revision: "0", rows: [{ id: "old-row-guard" }] },
  ])("rejects malformed or legacy input guards: %j", async (invalid) => {
    const publication = await stage([
      { kind: "guard", table: "allShowtimes", ...invalid },
    ]);
    await expect(apply(pool, publication)).rejects.toMatchObject({
      code: "40001",
    });
  });

  it("rejects duplicate input guards and cross-category tables", async () => {
    const token = await guard("allShowtimes");
    await expect(apply(pool, await stage([token, token]))).rejects.toThrow(
      "Duplicate publication input guard",
    );
    await expect(
      apply(pool, await stage([token], "comingsoons")),
    ).rejects.toThrow("Guard outside category");
  });

  it("rejects stale transaction snapshots rather than treating old tokens as current", async () => {
    const fixture = await rawPublication();
    const db = await pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await expect(apply(db, fixture.publication)).rejects.toThrow(
        "requires read committed isolation",
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });

  it("limits the revision RPC to the service role and prevents counter forgery", async () => {
    const db = await pool.connect();
    try {
      for (const role of [
        "anon",
        "authenticated",
        "kartiseret_runtime",
        "kartiseret_publisher",
      ]) {
        const row = (
          await db.query(
            "SELECT has_function_privilege($1,'public.get_publication_input_revision(text,text)','EXECUTE') AS read,has_table_privilege($1,'pipeline_internal.publication_input_revisions','UPDATE') AS write",
            [role],
          )
        ).rows[0];
        expect(row).toEqual({ read: false, write: false });
      }
      await db.query("BEGIN");
      await db.query("SET LOCAL ROLE service_role");
      expect(await version(db, "allShowtimes")).toMatch(/^\d+$/);
      await expect(
        db.query(
          "UPDATE pipeline_internal.publication_input_revisions SET revision=0",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await db.query("ROLLBACK");
      await expect(version(db, "allSoons")).rejects.toThrow(
        "outside publication category",
      );
      await expect(version(db, "allShowtimes", "unsupported")).rejects.toThrow(
        "Unsupported publication category",
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
  });
});
