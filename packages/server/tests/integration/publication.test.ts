import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const publicationCleanupRunIds: number[] = [];
const publisherFinalSoonIds: string[] = [];
const publisherFinalThequeIds: string[] = [];
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const publisherScript = resolve(
  repositoryRoot,
  "packages/server/tests/integration/fixtures/postgres-publication-publisher.py",
);
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
function publisherRequest(payload: Record<string, unknown>, timeout = 30_000) {
  return spawnSync(process.env.PYTHON ?? "python3", [publisherScript], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PYTHONPATH: [repositoryRoot, process.env.PYTHONPATH]
        .filter(Boolean)
        .join(delimiter),
    },
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 220 * 1024 * 1024,
    timeout,
  });
}
function publisherRequestAsync(payload: Record<string, unknown>) {
  return new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolveRequest, rejectRequest) => {
    const child = spawn(process.env.PYTHON ?? "python3", [publisherScript], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PYTHONPATH: [repositoryRoot, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectRequest);
    child.once("close", (status) => resolveRequest({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}
function publisherIdentity(
  parts: Row[],
  category = "nowplayings",
  runId = 901,
) {
  const payloads = parts.map(canonical);
  const id = randomUUID();
  publications.push(id);
  return {
    publication_id: id,
    category,
    run_id: runId,
    fingerprint: digest(
      payloads
        .map((payload, index) => `${index}:${digest(payload)}`)
        .join("\n"),
    ),
    part_count: payloads.length,
  };
}
function runPublisher(payload: Record<string, unknown>, timeout = 30_000) {
  const result = publisherRequest(payload, timeout);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `Publisher exited ${result.status}`,
    );
  }
  return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
}
async function revision() {
  return (
    await pool.query(
      "select revision::text from public.pipeline_catalog_revision",
    )
  ).rows[0].revision as string;
}
async function guard(table: string, category = "nowplayings") {
  const revision = (
    await pool.query(
      "select public.get_publication_input_revision($1,$2) revision",
      [table, category],
    )
  ).rows[0].revision;
  return { kind: "guard", table, revision, rows: [] };
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
      "finalTheques",
      "allShowtimes",
      "pipeline_scrape_snapshots",
    ])
      await pool.query(
        `delete from public."${table}" where cinema = any($1::text[])`,
        [[cinema, `${cinema}2`]],
      );
    for (const table of [
      "finalMovies",
      "finalThequeMovies",
      "movieCodes",
      "movie_release_dates",
    ])
      await pool.query(
        `delete from public."${table}" where tmdb_id = any($1::bigint[])`,
        [[movieId, movieId + 1, movieId + 2]],
      );
    if (publisherFinalSoonIds.length)
      await pool.query(
        'delete from public."finalSoons" where id = any($1::uuid[])',
        [publisherFinalSoonIds.splice(0)],
      );
    if (publisherFinalThequeIds.length)
      await pool.query(
        'delete from public."finalTheques" where id = any($1::uuid[])',
        [publisherFinalThequeIds.splice(0)],
      );
    await pool.query('delete from public."tableFixes" where title_fix=$1', [
      String(movieId),
    ]);
    await pool.query(
      "delete from public.pipeline_publications where publication_id = any($1::uuid[])",
      [publications.splice(0)],
    );
    await pool.query(
      'delete from public."utilRunLogs" where run_id = any($1::int[])',
      [publicationCleanupRunIds.splice(0)],
    );
  });
  afterAll(async () => {
    await Promise.all([pool.end(), runtime.close()]);
  });

  it("prunes recent inactive preparations in dry-run and apply while preserving active runs and receipts", async () => {
    const baseRunId = 1_500_000_000 + Math.floor(Math.random() * 100_000_000);
    const cases = [
      { status: "prepared", running: false },
      { status: "prepared", running: true },
      { status: "applied", running: false },
    ] as const;
    const ids: string[] = [];
    for (const [index, item] of cases.entries()) {
      const publicationId = randomUUID();
      const runId = baseRunId + index;
      ids.push(publicationId);
      publications.push(publicationId);
      publicationCleanupRunIds.push(runId);
      await pool.query(
        'insert into public."utilRunLogs" (run_id, running_now, run_from) values ($1,$2,$3)',
        [runId, item.running, "publication-cleanup-test"],
      );
      await pool.query(
        `insert into public.pipeline_publications
           (publication_id,category,run_id,fingerprint,part_count,status,revision,completed_at)
         values ($1,'nowplayings',$2,$3,1,$4,case when $4='applied' then 1 end,
                 case when $4='applied' then now() end)`,
        [publicationId, runId, digest(publicationId), item.status],
      );
      await pool.query(
        "insert into public.pipeline_publication_parts(publication_id,part,payload) values ($1,0,$2)",
        [publicationId, '{"kind":"claims","rows":[]}'],
      );
    }

    const dryRun = await pool.query(
      "select public.prune_abandoned_publications(false) result",
    );
    expect(dryRun.rows[0].result).toEqual({ eligible: 1, deleted: 0 });
    const applied = await pool.query(
      "select public.prune_abandoned_publications(true) result",
    );
    expect(applied.rows[0].result).toEqual({ eligible: 1, deleted: 1 });
    const remaining = await pool.query(
      `select p.status,count(x.part)::int staged_parts
       from public.pipeline_publications p
       left join public.pipeline_publication_parts x using (publication_id)
       where p.publication_id = any($1::uuid[])
       group by p.publication_id
       order by p.status`,
      [ids],
    );
    expect(remaining.rows).toEqual([
      { status: "applied", staged_parts: 1 },
      { status: "prepared", staged_parts: 1 },
    ]);
    const access = await pool.query(`select
      has_function_privilege('service_role','public.prune_abandoned_publications(boolean)','EXECUTE') service_role,
      has_function_privilege('anon','public.prune_abandoned_publications(boolean)','EXECUTE') anon`);
    expect(access.rows[0]).toEqual({ service_role: true, anon: false });
  });

  it("deletes publications in 100-row batches and cascades their parts", async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    const baseRunId = 1_700_000_000 + Math.floor(Math.random() * 100_000_000);
    const runIds = ids.map((_, index) => baseRunId + index);
    publications.push(...ids);
    await pool.query(
      `insert into public.pipeline_publications
         (publication_id,category,run_id,fingerprint,part_count,status)
       select publication_id,'nowplayings',run_id,fingerprint,1,'prepared'
       from unnest($1::uuid[],$2::int[],$3::text[]) as rows(publication_id,run_id,fingerprint)`,
      [ids, runIds, ids.map(digest)],
    );
    await pool.query(
      `insert into public.pipeline_publication_parts(publication_id,part,payload)
       select publication_id,0,'{"kind":"claims","rows":[]}'
       from unnest($1::uuid[]) as rows(publication_id)`,
      [ids],
    );

    const firstBatch = await pool.query(
      "select public.prune_abandoned_publications(true) result",
    );
    expect(firstBatch.rows[0].result).toEqual({ eligible: 101, deleted: 100 });
    const lastBatch = await pool.query(
      "select public.prune_abandoned_publications(true) result",
    );
    expect(lastBatch.rows[0].result).toEqual({ eligible: 1, deleted: 1 });
    const remaining = await pool.query(
      `select
         (select count(*)::int from public.pipeline_publications where publication_id=any($1::uuid[])) publications,
         (select count(*)::int from public.pipeline_publication_parts where publication_id=any($1::uuid[])) parts`,
      [ids],
    );
    expect(remaining.rows[0]).toEqual({ publications: 0, parts: 0 });
  });

  it("runs through the restricted publisher login and reconciles a lost commit acknowledgement", async () => {
    const servicePrivileges = await pool.query(
      `select
         has_function_privilege('service_role', 'pipeline_internal.commit_category_publication_impl(uuid,text,integer)', 'EXECUTE') as can_call_impl,
         has_function_privilege('service_role', 'public.commit_category_publication(uuid,text)', 'EXECUTE') as can_call_rest`,
    );
    expect(servicePrivileges.rows[0]).toEqual({
      can_call_impl: false,
      can_call_rest: true,
    });

    const permissions = runPublisher({ mode: "permissions" });
    expect(permissions).toEqual({
      can_publish: true,
      can_call_impl: false,
      can_read_catalog: false,
      can_stage: true,
      can_update_receipt: false,
      can_read_auth: false,
    });

    const fixture = await source();
    const parts = fixture.parts();
    const identity = publisherIdentity(parts);
    const before = await revision();
    const receipt = runPublisher({ identity, parts, simulate_lost_ack: true });
    expect(receipt.status).toBe("applied");
    expect(BigInt(String(receipt.revision))).toBeGreaterThan(BigInt(before));
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
          "select status from public.pipeline_publications where publication_id=$1",
          [identity.publication_id],
        )
      ).rows[0].status,
    ).toBe("applied");
    expect(
      (
        await pool.query(
          "select count(*)::int n from public.pipeline_publication_parts where publication_id=$1",
          [identity.publication_id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(runPublisher({ identity, parts })).toEqual(receipt);
    expect(await revision()).toBe(receipt.revision);
    expect(() =>
      runPublisher({
        identity: { ...identity, fingerprint: "a".repeat(64) },
        parts,
      }),
    ).toThrow(/Publication identity was reused with different content/);
    const conflictingIdentity = publisherRequest({
      identity: { ...identity, run_id: identity.run_id + 1 },
      parts,
    });
    expect(conflictingIdentity.status).not.toBe(0);
    expect(conflictingIdentity.stderr).toContain(
      "Publication identity was reused with different content",
    );
  });

  it("publishes coming-soon and cinematheque categories through the same adapter", async () => {
    const soonId = randomUUID();
    publisherFinalSoonIds.push(soonId);
    const soonParts = [
      {
        kind: "changes",
        rows: [
          {
            table: "finalSoons",
            before: null,
            after: {
              id: soonId,
              tmdb_id: movieId + 1,
              english_title: "Publisher soon",
              hebrew_title: "סרט בקרוב",
              release_date: "2035-01-01",
            },
          },
        ],
      },
    ];
    const soonIdentity = publisherIdentity(soonParts, "comingsoons");
    expect(
      runPublisher({ identity: soonIdentity, parts: soonParts }).status,
    ).toBe("applied");

    const thequeId = randomUUID();
    publisherFinalThequeIds.push(thequeId);
    const thequeParts = [
      {
        kind: "changes",
        rows: [
          {
            table: "finalThequeMovies",
            before: null,
            after: {
              tmdb_id: movieId + 2,
              english_title: "Publisher cinematheque",
            },
          },
          {
            table: "finalTheques",
            before: null,
            after: {
              id: thequeId,
              tmdb_id: movieId + 2,
              english_title: "Publisher cinematheque",
              hebrew_title: "סרט בסינמטק",
              cinema: cinema,
              screening_city: "Tel Aviv",
              date_of_showing: "2035-01-01",
              showtime: "20:00:00",
              run_id: 901,
            },
          },
        ],
      },
    ];
    const thequeIdentity = publisherIdentity(thequeParts, "cinematheques");
    expect(
      runPublisher({ identity: thequeIdentity, parts: thequeParts }).status,
    ).toBe("applied");
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalSoons" where id=$1',
          [soonId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "select local_release_date::text from public.movie_release_dates where tmdb_id=$1",
          [movieId + 1],
        )
      ).rows[0].local_release_date,
    ).toBe("2035-01-01");
    expect(
      (
        await pool.query(
          'select count(*)::int n from public."finalTheques" where id=$1',
          [thequeId],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it("resumes matching prepared parts and rejects attempts to overwrite a staged part", async () => {
    const fixture = await source();
    const parts = fixture.parts();
    const identity = publisherIdentity(parts);
    runPublisher({ mode: "stage_only", identity, parts });
    await pool.query(
      "delete from public.pipeline_publication_parts where publication_id=$1 and part=0",
      [identity.publication_id],
    );
    expect(runPublisher({ identity, parts }).status).toBe("applied");

    const secondFixture = await source(movieId + 1, `${cinema}2`);
    const secondParts = secondFixture.parts();
    const secondIdentity = publisherIdentity(secondParts);
    runPublisher({
      mode: "stage_only",
      identity: secondIdentity,
      parts: secondParts,
    });
    const originalPart = (
      await pool.query(
        "select payload from public.pipeline_publication_parts where publication_id=$1 and part=0",
        [secondIdentity.publication_id],
      )
    ).rows[0].payload as string;
    await pool.query(
      "update public.pipeline_publication_parts set payload=payload || ' ' where publication_id=$1 and part=0",
      [secondIdentity.publication_id],
    );
    const rejected = publisherRequest({
      identity: secondIdentity,
      parts: secondParts,
    });
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain(
      "Prepared publication part differs from its immutable payload",
    );
    expect(
      (
        await pool.query(
          "select payload from public.pipeline_publication_parts where publication_id=$1 and part=0",
          [secondIdentity.publication_id],
        )
      ).rows[0].payload,
    ).toBe(`${originalPart} `);
  });

  it("fails staging and rolls back a mutation batch without marking the receipt applied", async () => {
    const invalidIdentity = publisherIdentity([
      "not-an-object" as unknown as Row,
    ]);
    const stageFailure = publisherRequest({
      identity: invalidIdentity,
      parts: ["not-an-object"],
    });
    expect(stageFailure.status).not.toBe(0);
    expect(stageFailure.stderr).toMatch(
      /pipeline_publication_parts|check constraint/i,
    );
    expect(
      (
        await pool.query(
          "select count(*)::int n from public.pipeline_publications where publication_id=$1",
          [invalidIdentity.publication_id],
        )
      ).rows[0].n,
    ).toBe(0);

    const fixture = await source();
    const parts = fixture.parts();
    const identity = publisherIdentity(parts);
    const triggerName = `publisher_mutation_failure_${identity.publication_id.replaceAll("-", "")}`;
    await pool.query(`
      CREATE FUNCTION pipeline_internal.${triggerName}() RETURNS trigger
      LANGUAGE plpgsql SET search_path = '' AS $$
      BEGIN
        IF NEW.id = '${fixture.screening}'::uuid THEN
          RAISE EXCEPTION 'injected publisher mutation batch failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON public."finalShowtimes"
      FOR EACH ROW EXECUTE FUNCTION pipeline_internal.${triggerName}()
    `);
    const before = await revision();
    let rejected;
    try {
      rejected = publisherRequest({ identity, parts });
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON public."finalShowtimes"`,
      );
      await pool.query(`DROP FUNCTION pipeline_internal.${triggerName}()`);
    }
    expect(rejected!.status).not.toBe(0);
    expect(rejected!.stderr).toContain(
      "injected publisher mutation batch failure",
    );
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
          [identity.publication_id],
        )
      ).rows[0].status,
    ).toBe("prepared");
  });

  it("rolls back every live write if receipt finalization fails", async () => {
    const fixture = await source();
    const parts = fixture.parts();
    const identity = publisherIdentity(parts);
    const functionName = `publisher_finalize_failure_${identity.publication_id.replaceAll("-", "")}`;
    await pool.query(`
      CREATE FUNCTION pipeline_internal.${functionName}() RETURNS trigger
      LANGUAGE plpgsql SET search_path = '' AS $$
      BEGIN
        IF NEW.publication_id = '${identity.publication_id}'::uuid AND NEW.status = 'applied' THEN
          RAISE EXCEPTION 'injected publisher receipt finalization failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER ${functionName}
      BEFORE UPDATE OF status ON public.pipeline_publications
      FOR EACH ROW EXECUTE FUNCTION pipeline_internal.${functionName}()
    `);
    try {
      const rejected = publisherRequest({ identity, parts });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain(
        "injected publisher receipt finalization failure",
      );
    } finally {
      await pool.query(
        "DROP TRIGGER IF EXISTS " +
          functionName +
          " ON public.pipeline_publications",
      );
      await pool.query(`DROP FUNCTION pipeline_internal.${functionName}()`);
    }
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
          [identity.publication_id],
        )
      ).rows[0].status,
    ).toBe("prepared");
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

  it("waits for concurrent manual edits and rejects stale evidence on the direct publisher", async () => {
    const fixture = await source();
    const parts = fixture.parts();
    const identity = publisherIdentity(parts);
    runPublisher({ mode: "stage_only", identity, parts });
    const admin = await pool.connect();
    let adminCommitted = false;
    try {
      await admin.query("begin");
      await admin.query("select pg_advisory_xact_lock($1)", [movieId]);
      await admin.query(
        'insert into public."tableFixes"(tmdb_id,title_fix) values($1,$2)',
        [String(movieId + 1), String(movieId)],
      );
      let publisherFinished = false;
      const pending = publisherRequestAsync({ identity, parts }).finally(() => {
        publisherFinished = true;
      });
      await admin.query("select pg_catalog.pg_sleep(0.25)");
      const blockedByAdminTransaction = !publisherFinished;
      await admin.query("commit");
      adminCommitted = true;
      const rejected = await pending;
      expect(blockedByAdminTransaction).toBe(true);
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain(
        "Publication input changed: tableFixes",
      );
    } finally {
      if (!adminCommitted) await admin.query("rollback");
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
          [identity.publication_id],
        )
      ).rows[0].status,
    ).toBe("prepared");
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

  it("commits provider provenance with values, retains prior success after a failed check, and never exposes it in public DTOs", async () => {
    const fixture = await source();
    const successAt = "2026-10-01T10:00:00+00:00";
    const freshness = {
      imdb: {
        outcome: "success",
        attempted_at: successAt,
        checked_at: successAt,
        last_success_at: successAt,
        source: { imdb_id: "ttFixture", dataset_sha256: "a".repeat(64) },
        fields: { imdbRating: { state: "refreshed", observed_at: successAt } },
      },
    };
    fixture.changes[0].after = {
      ...fixture.changes[0].after,
      imdbRating: "8.0",
      provider_freshness: freshness,
    };
    const published = await commit(await stage(fixture.parts()));
    const before = (
      await pool.query(
        'select to_jsonb(t) row from public."finalMovies" t where tmdb_id=$1',
        [movieId],
      )
    ).rows[0].row;
    const failedCheck = {
      ...freshness,
      imdb: {
        ...freshness.imdb,
        outcome: "blocked",
        attempted_at: "2026-10-02T10:00:00+00:00",
        checked_at: "2026-10-02T10:00:01+00:00",
        reason: "http_403",
        fields: {
          imdbRating: {
            ...freshness.imdb.fields.imdbRating,
            state: "retained",
          },
        },
      },
    };
    const check = await stage([
      {
        kind: "changes",
        rows: [
          {
            table: "finalMovies",
            before,
            after: { ...before, provider_freshness: failedCheck },
          },
        ],
      },
    ]);
    const receipt = await commit(check);
    expect(BigInt(receipt.revision)).toBeGreaterThan(
      BigInt(published.revision),
    );
    const current = (
      await pool.query(
        'select to_jsonb(t) row from public."finalMovies" t where tmdb_id=$1',
        [movieId],
      )
    ).rows[0].row;
    expect(current.imdbRating).toBe(8);
    expect(current.provider_freshness.imdb.last_success_at).toBe(successAt);
    expect(current.provider_freshness.imdb.outcome).toBe("blocked");
    const broken = await stage([
      {
        kind: "changes",
        rows: [
          {
            table: "finalMovies",
            before: current,
            after: {
              ...current,
              imdbRating: "9.0",
              provider_freshness: freshness,
            },
          },
          {
            table: "finalShowtimes",
            before: null,
            after: {
              id: randomUUID(),
              english_title: "Invalid later write",
              cinema,
              showtime: "invalid-time",
            },
          },
        ],
      },
    ]);
    await expect(commit(broken)).rejects.toThrow();
    const rolledBack = (
      await pool.query(
        'select to_jsonb(t) row from public."finalMovies" t where tmdb_id=$1',
        [movieId],
      )
    ).rows[0].row;
    expect(rolledBack).toEqual(current);
    const invalidMetadata = await stage([
      {
        kind: "changes",
        rows: [
          {
            table: "finalMovies",
            before: current,
            after: { ...current, imdbRating: "9.0", provider_freshness: [] },
          },
        ],
      },
    ]);
    await expect(commit(invalidMetadata)).rejects.toThrow(/check constraint/);
    expect(
      (
        await pool.query(
          'select to_jsonb(t) row from public."finalMovies" t where tmdb_id=$1',
          [movieId],
        )
      ).rows[0].row,
    ).toEqual(current);
    expect(await revision()).toBe(receipt.revision);
    const response = await request(app).get("/api/v1/catalog/now-playing");
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain("provider_freshness");
    expect(JSON.stringify(response.body)).not.toContain("dataset_sha256");
    const privileges = (
      await pool.query(`select
      has_column_privilege('service_role','public."finalMovies"','provider_freshness','UPDATE') worker,
      has_column_privilege('anon','public."finalMovies"','provider_freshness','SELECT') browser,
      has_column_privilege('authenticated','public."finalMovies"','provider_freshness','SELECT') signed_in`)
    ).rows[0];
    expect(privileges).toEqual({
      worker: true,
      browser: false,
      signed_in: false,
    });
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
