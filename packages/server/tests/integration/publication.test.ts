import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import request from "supertest";
import { createDatabase } from "../../src/db/client.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { createApp } from "../../src/app.js";
import { PUBLICATION_REVISION_HEADER } from "@kartiseret/contracts/public-data";

const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname) ||
  new URL(url).pathname !== "/kartiseret_test"
)
  throw new Error(
    "Publication tests require local disposable kartiseret_test.",
  );
const pool = new Pool({ connectionString: url, max: 4 });
const runtime = createDatabase(process.env.DATABASE_URL!, { poolMax: 2 });
const repository = new DrizzleCatalogRepository(runtime.db);
const app = createApp({
  catalogRepository: repository,
  publicDataRepository: repository,
});
const movieId = 2101000001;
const cinema = "__publication_fixture__";
const publications: string[] = [];
type Row = Record<string, unknown>;
type Change = { table: string; before: Row | null; after: Row | null };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
async function revision() {
  return (
    await pool.query(
      "select revision::text from public.pipeline_catalog_revision",
    )
  ).rows[0].revision as string;
}
async function guard(table: string, category = "nowplayings") {
  const rows = (
    await pool.query("select pipeline_internal.publication_rows($1,$2) rows", [
      table,
      category,
    ])
  ).rows[0].rows;
  return { kind: "guard", table, rows };
}
async function stage(parts: Row[], category = "nowplayings") {
  const payloads = parts.map(canonical);
  const fingerprint = digest(
    payloads.map((payload, index) => `${index}:${digest(payload)}`).join("\n"),
  );
  const id = randomUUID();
  publications.push(id);
  await pool.query(
    "insert into public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count) values($1,$2,901,$3,$4)",
    [id, category, fingerprint, parts.length],
  );
  for (const [index, payload] of payloads.entries())
    await pool.query(
      "insert into public.pipeline_publication_parts(publication_id,part,payload) values($1,$2,$3)",
      [id, index, payload],
    );
  return { id, fingerprint };
}
async function commit(publication: { id: string; fingerprint: string }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await client.query(
      "select public.commit_category_publication($1,$2) result",
      [publication.id, publication.fingerprint],
    );
    await client.query("commit");
    return result.rows[0].result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
async function source(id = movieId, cinemaName = cinema) {
  const snapshot = randomUUID(),
    raw = randomUUID(),
    screening = randomUUID();
  await pool.query(
    "insert into public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count) values($1,901,'allShowtimes','Fixture',$2,'complete',1)",
    [snapshot, cinemaName],
  );
  await pool.query(
    "insert into public.\"allShowtimes\"(id,snapshot_id,run_id,cinema,english_title,date_of_showing,showtime,added) values($1,$2,901,$3,'New film','2035-01-03','20:00',false)",
    [raw, snapshot, cinemaName],
  );
  const before = (
    await pool.query(
      'select to_jsonb(t) row from public."allShowtimes" t where id=$1',
      [raw],
    )
  ).rows[0].row;
  const changes: Change[] = [
    {
      table: "finalMovies",
      before: null,
      after: { tmdb_id: id, english_title: "New film", run_id: 901 },
    },
    {
      table: "finalShowtimes",
      before: null,
      after: {
        id: screening,
        tmdb_id: id,
        english_title: "New film",
        cinema: cinemaName,
        screening_city: "Tel Aviv",
        date_of_showing: "2035-01-03",
        showtime: "20:00:00",
        run_id: 901,
      },
    },
    { table: "allShowtimes", before, after: { ...before, added: true } },
    {
      table: "pipeline_publication_checkpoints",
      before: null,
      after: {
        category: "nowplayings",
        snapshot_id: snapshot,
        input_fingerprint: "fixture",
        phase: "published",
        has_unresolved: false,
      },
    },
  ];
  const guards = await Promise.all(
    [
      "allShowtimes",
      "finalMovies",
      "finalShowtimes",
      "pipeline_scrape_snapshots",
      "pipeline_publication_checkpoints",
      "tableFixes",
      "tableSkips",
    ].map((table) => guard(table)),
  );
  return {
    snapshot,
    raw,
    screening,
    changes,
    guards,
    parts: (changesOverride = changes) => [
      ...guards,
      { kind: "changes", rows: changesOverride },
      { kind: "claims", rows: [{ snapshot_id: snapshot, cinema: cinemaName }] },
    ],
  };
}

describe("atomic category publication and supported readers", () => {
  beforeAll(async () => {
    expect(
      (await pool.query("show server_version_num")).rows[0].server_version_num,
    ).toMatch(/^17/);
  });
  afterEach(async () => {
    for (const table of [
      "finalShowtimes",
      "allShowtimes",
      "pipeline_scrape_snapshots",
    ])
      await pool.query(
        `delete from public."${table}" where cinema = any($1::text[])`,
        [[cinema, `${cinema}2`]],
      );
    for (const table of ["finalMovies", "movieCodes"])
      await pool.query(
        `delete from public."${table}" where tmdb_id = any($1::bigint[])`,
        [[movieId, movieId + 1]],
      );
    await pool.query('delete from public."tableFixes" where title_fix=$1', [
      String(movieId),
    ]);
    await pool.query(
      "delete from public.pipeline_publications where publication_id = any($1::uuid[])",
      [publications.splice(0)],
    );
  });
  afterAll(async () => {
    await Promise.all([pool.end(), runtime.close()]);
  });

  it("keeps staged rows private and commits movie, screenings, raw flag and checkpoint together exactly once", async () => {
    const fixture = await source();
    const publication = await stage(fixture.parts());
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalMovies" where tmdb_id=$1',
          [movieId],
        )
      ).rows[0].n,
    ).toBe(0);
    const before = await revision();
    const result = await commit(publication);
    expect(result.status).toBe("applied");
    expect(BigInt(result.revision)).toBeGreaterThan(BigInt(before));
    expect(
      (
        await pool.query(
          'select added from public."allShowtimes" where id=$1',
          [fixture.raw],
        )
      ).rows[0].added,
    ).toBe(true);
    expect(
      (
        await pool.query(
          "select phase from public.pipeline_publication_checkpoints where snapshot_id=$1",
          [fixture.snapshot],
        )
      ).rows[0].phase,
    ).toBe("published");
    expect(
      (
        await pool.query(
          "select count(*)::int n from public.pipeline_publication_parts where publication_id=$1",
          [publication.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(await commit(publication)).toEqual(result); // Simulate lost commit acknowledgement.
    expect(await revision()).toBe(result.revision);
    await expect(
      commit({ ...publication, fingerprint: "a".repeat(64) }),
    ).rejects.toThrow(/fingerprint/);
  });

  it("rolls back earlier movie writes, revision, raw markers and checkpoint if a later screening write fails", async () => {
    const fixture = await source();
    fixture.changes[1].after!.showtime = "not-a-time";
    const publication = await stage(fixture.parts());
    const before = await revision();
    await expect(commit(publication)).rejects.toThrow(/not-a-time/);
    expect(await revision()).toBe(before);
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalMovies" where tmdb_id=$1',
          [movieId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          'select added from public."allShowtimes" where id=$1',
          [fixture.raw],
        )
      ).rows[0].added,
    ).toBe(false);
    expect(
      (
        await pool.query(
          "select status from public.pipeline_publications where publication_id=$1",
          [publication.id],
        )
      ).rows[0].status,
    ).toBe("prepared");
    expect(
      (
        await pool.query(
          "select count(*)::int n from public.pipeline_publication_checkpoints where snapshot_id=$1",
          [fixture.snapshot],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("rejects an incomplete staging upload and altered chunk contents without touching live rows", async () => {
    const fixture = await source();
    const publication = await stage(fixture.parts());
    const part = (
      await pool.query(
        "delete from public.pipeline_publication_parts where publication_id=$1 and part=0 returning *",
        [publication.id],
      )
    ).rows[0];
    await expect(commit(publication)).rejects.toThrow(/incomplete or changed/);
    await pool.query(
      "insert into public.pipeline_publication_parts values($1,$2,$3)",
      [publication.id, 0, part.payload + " "],
    );
    await expect(commit(publication)).rejects.toThrow(/incomplete or changed/);
    expect(
      (
        await pool.query(
          'select added from public."allShowtimes" where id=$1',
          [fixture.raw],
        )
      ).rows[0].added,
    ).toBe(false);
  });

  it("rejects a newer failed source attempt and row-count changes", async () => {
    const fixture = await source();
    const publication = await stage(fixture.parts());
    await pool.query(
      "insert into public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count) values($1,902,'allShowtimes','Fixture',$2,'failed',0)",
      [randomUUID(), cinema],
    );
    await expect(commit(publication)).rejects.toThrow(/input changed/);
    await pool.query(
      "delete from public.pipeline_scrape_snapshots where cinema=$1 and run_id=902",
      [cinema],
    );
    await pool.query(
      "update public.pipeline_scrape_snapshots set row_count=2 where snapshot_id=$1",
      [fixture.snapshot],
    );
    await expect(commit(publication)).rejects.toThrow(/input changed/);
  });

  it("keeps API multi-query reads coherent while a publication commits and rejects a stale revision", async () => {
    const fixture = await source();
    const publication = await stage(fixture.parts());
    let committedRevision = "";
    const oldRevision = await repository.readSnapshot(
      async (snapshotRevision) => {
        expect(
          (await repository.findNowPlayingRows()).some(
            (r) => (r as Row).tmdbId === movieId,
          ),
        ).toBe(false);
        committedRevision = (await commit(publication)).revision;
        expect(
          (
            await repository.findShowtimeRows({
              city: "Tel Aviv",
              startDate: "2035-01-03",
              endDate: "2035-01-03",
            })
          ).some((r) => (r as Row).tmdbId === movieId),
        ).toBe(false);
        return snapshotRevision;
      },
    );
    expect(oldRevision).not.toBe(committedRevision);
    const response = await request(app).get("/api/v1/catalog/now-playing");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers[PUBLICATION_REVISION_HEADER.toLowerCase()]).toBe(
      committedRevision,
    );
    const stale = await request(app)
      .get("/api/v1/showtimes")
      .query({
        city: "Tel Aviv",
        startDate: "2035-01-03",
        endDate: "2035-01-03",
      })
      .set(PUBLICATION_REVISION_HEADER, oldRevision);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("publication_changed");
    expect(stale.headers["cache-control"]).toContain("no-store");
    const current = await request(app)
      .get("/api/v1/ticket-availability")
      .query({ tmdbId: String(movieId), fromDate: "2035-01-03" })
      .set(PUBLICATION_REVISION_HEADER, committedRevision);
    expect(current.status).toBe(200);
    expect(current.headers[PUBLICATION_REVISION_HEADER.toLowerCase()]).toBe(
      committedRevision,
    );
    expect(current.headers["cache-control"]).toContain("no-store");
  });

  it("revalidates manual evidence after waiting on the admin correction lock", async () => {
    const fixture = await source();
    const publication = await stage(fixture.parts());
    const admin = await pool.connect();
    try {
      await admin.query("begin");
      await admin.query("select pg_advisory_xact_lock($1)", [movieId]);
      await admin.query(
        'insert into public."tableFixes"(tmdb_id,title_fix) values($1,$2)',
        [String(movieId + 1), String(movieId)],
      );
      const pending = commit(publication);
      await admin.query("commit");
      await expect(pending).rejects.toThrow(/input changed: tableFixes/);
    } finally {
      await admin.query("rollback");
      admin.release();
    }
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalMovies" where tmdb_id=$1',
          [movieId],
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("publishes two cinemas in one revision and keeps their permanent codes", async () => {
    const first = await source();
    const second = await source(movieId + 1, `${cinema}2`);
    const changes = [
      ...first.changes,
      ...second.changes,
      {
        table: "movieCodes",
        before: null,
        after: { tmdb_id: movieId, movie_code: "Qp4" },
      },
      {
        table: "movieCodes",
        before: null,
        after: { tmdb_id: movieId + 1, movie_code: "Qp5" },
      },
    ];
    const publication = await stage([
      ...second.guards,
      { kind: "changes", rows: changes },
      {
        kind: "claims",
        rows: [
          { snapshot_id: first.snapshot, cinema },
          { snapshot_id: second.snapshot, cinema: `${cinema}2` },
        ],
      },
    ]);
    const before = BigInt(await revision());
    const receipt = await commit(publication);
    expect(BigInt(receipt.revision)).toBe(before + 1n);
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalShowtimes" where cinema = any($1::text[])',
          [[cinema, `${cinema}2`]],
        )
      ).rows[0].n,
    ).toBe(2);
    const existing = (
      await pool.query(
        'select to_jsonb(t) row from public."movieCodes" t where tmdb_id=$1',
        [movieId],
      )
    ).rows[0].row;
    const overwrite = await stage([
      {
        kind: "changes",
        rows: [
          {
            table: "movieCodes",
            before: existing,
            after: { ...existing, movie_code: "Qp6" },
          },
        ],
      },
    ]);
    await expect(commit(overwrite)).rejects.toThrow(/Permanent movie codes/);
    expect(await revision()).toBe(receipt.revision);
  });

  it("publishes Coming Soon and cinematheque units independently", async () => {
    const comingSoonId = randomUUID(),
      thequeId = randomUUID();
    try {
      const soon = await stage(
        [
          {
            kind: "changes",
            rows: [
              {
                table: "finalSoons",
                before: null,
                after: {
                  id: comingSoonId,
                  tmdb_id: movieId,
                  english_title: "Soon",
                  hebrew_title: "",
                  release_date: "2035-01-01",
                },
              },
            ],
          },
        ],
        "comingsoons",
      );
      await commit(soon);
      const theque = await stage(
        [
          {
            kind: "changes",
            rows: [
              {
                table: "finalThequeMovies",
                before: null,
                after: { tmdb_id: movieId, english_title: "Theque film" },
              },
              {
                table: "finalTheques",
                before: null,
                after: {
                  id: thequeId,
                  tmdb_id: movieId,
                  english_title: "Theque film",
                  date_of_showing: "2035-01-01",
                  showtime: "20:00",
                  screening_city: "Tel Aviv",
                  cinema,
                  run_id: 901,
                },
              },
            ],
          },
        ],
        "cinematheques",
      );
      await commit(theque);
      expect(
        (
          await pool.query(
            'select count(*)::int n from public."finalTheques" where id=$1',
            [thequeId],
          )
        ).rows[0].n,
      ).toBe(1);
      const wrongCategory = await stage(
        [
          {
            kind: "changes",
            rows: [
              {
                table: "finalMovies",
                before: null,
                after: {
                  tmdb_id: movieId + 1,
                  english_title: "Wrong category",
                },
              },
            ],
          },
        ],
        "comingsoons",
      );
      await expect(commit(wrongCategory)).rejects.toThrow(/outside category/);
    } finally {
      await pool.query('delete from public."finalSoons" where id=$1', [
        comingSoonId,
      ]);
      await pool.query('delete from public."finalTheques" where id=$1', [
        thequeId,
      ]);
      await pool.query(
        'delete from public."finalThequeMovies" where tmdb_id=$1',
        [movieId],
      );
    }
  });

  it("grants worker execution explicitly while browser/API roles cannot stage or publish", async () => {
    const result = await pool.query(`select
      has_table_privilege('service_role','public.pipeline_publications','INSERT') worker_stage,
      has_function_privilege('service_role','public.commit_category_publication(uuid,text)','EXECUTE') worker_commit,
      has_table_privilege('anon','public.pipeline_publications','SELECT') anon_stage,
      has_table_privilege('authenticated','public.pipeline_publication_parts','INSERT') browser_stage,
      has_function_privilege('kartiseret_api','public.commit_category_publication(uuid,text)','EXECUTE') api_commit,
      has_table_privilege('kartiseret_api','public.pipeline_catalog_revision','SELECT') api_revision,
      has_table_privilege('kartiseret_api','public.pipeline_catalog_revision','UPDATE') api_revision_write`);
    expect(result.rows[0]).toEqual({
      worker_stage: true,
      worker_commit: true,
      anon_stage: false,
      browser_stage: false,
      api_commit: false,
      api_revision: true,
      api_revision_write: false,
    });
  });
});
