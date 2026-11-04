import test from "node:test";
import assert from "node:assert/strict";
import worker, { cleanupExpiredArtifacts, jsonResponse, subtractCalendarMonths } from "./worker.mjs";

test("oversized D1 responses return the bounded error body", async () => {
  const response = jsonResponse({ success: true, result: "too long" }, 200, 16);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), {
    success: false,
    errors: [{ message: "D1 result too large; request smaller pages" }],
  });
});

function fakeD1({ failFirst = false } = {}) {
  const queries = [];
  let shouldFail = failFirst;
  return {
    queries,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              queries.push({ sql, params });
              if (shouldFail) {
                shouldFail = false;
                throw new Error("simulated D1 interruption");
              }
              return { meta: { changes: 0, rows_written: 0 } };
            },
          };
        },
      };
    },
  };
}

function fakeR2(objects) {
  const remaining = new Map(objects.map((key) => [key, { key }]));
  const deleted = [];
  return {
    deleted,
    async list({ prefix, limit }) {
      const matching = [...remaining.values()].filter((item) => item.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
      return {
        objects: matching.slice(0, limit),
        truncated: matching.length > limit,
      };
    },
    async delete(keys) {
      const values = Array.isArray(keys) ? keys : [keys];
      for (const key of values) {
        deleted.push(key);
        remaining.delete(key);
      }
    },
  };
}

test("subtracts two calendar months and clamps month-end safely", () => {
  assert.equal(subtractCalendarMonths(new Date("2026-11-30T04:17:25Z")).toISOString(), "2026-09-30T04:17:25.000Z");
  assert.equal(subtractCalendarMonths(new Date("2026-05-31T00:00:00Z")).toISOString(), "2026-03-31T00:00:00.000Z");
  assert.equal(subtractCalendarMonths(new Date("2026-04-30T00:00:00Z")).toISOString(), "2026-02-28T00:00:00.000Z");
});

test("deletes expired private objects before D1 metadata and uses run start for row retention", async () => {
  const r2 = fakeR2([
    "runs/2026-08-01/12/screenshots/old.webp",
    "runs/2026-09-20/13/screenshots/new.webp",
  ]);
  const d1 = fakeD1();
  const result = await cleanupExpiredArtifacts({ RUN_ARTIFACTS: r2, RUN_LOGS: d1 }, new Date("2026-11-03T04:00:00Z"));
  assert.deepEqual(r2.deleted, ["runs/2026-08-01/12/screenshots/old.webp"]);
  assert.equal(result.cutoff, "2026-09-03T04:00:00.000Z");
  assert.equal(result.pending, false);
  assert.match(d1.queries[0].sql, /JOIN run_logs AS r/);
  assert.equal(d1.queries[0].params[0], result.cutoff);
});

test("an interrupted D1 cleanup safely resumes after already-deleted R2 keys", async () => {
  const r2 = fakeR2(["runs/2026-07-01/3/screenshots/old.webp"]);
  const d1 = fakeD1({ failFirst: true });
  const env = { RUN_ARTIFACTS: r2, RUN_LOGS: d1 };
  await assert.rejects(cleanupExpiredArtifacts(env, new Date("2026-11-03T04:00:00Z")), /simulated D1 interruption/);
  assert.equal(r2.deleted.length, 1);
  const resumed = await cleanupExpiredArtifacts(env, new Date("2026-11-03T04:00:00Z"));
  assert.equal(r2.deleted.length, 1);
  assert.equal(resumed.pending, false);
  assert.equal(d1.queries.length, 4);
});

test("large expired R2 inventories advance one page before touching D1", async () => {
  const oldKeys = Array.from({ length: 1001 }, (_, index) => `runs/2026-07-01/3/screenshots/${index}.webp`);
  const r2 = fakeR2(oldKeys);
  const d1 = fakeD1();
  const env = { RUN_ARTIFACTS: r2, RUN_LOGS: d1 };
  const first = await cleanupExpiredArtifacts(env, new Date("2026-11-03T04:00:00Z"));
  assert.equal(first.pending, true);
  assert.equal(first.objectsDeleted, 1000);
  assert.equal(d1.queries.length, 0);
  const second = await cleanupExpiredArtifacts(env, new Date("2026-11-03T04:00:00Z"));
  assert.equal(second.pending, false);
  assert.equal(r2.deleted.length, 1001);
  assert.equal(d1.queries.length, 3);
});

test("requires both environment-specific Cloudflare bindings", async () => {
  await assert.rejects(cleanupExpiredArtifacts({}, new Date()), /RUN_ARTIFACTS and RUN_LOGS/);
});

function queryDatabase() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async all() {
          calls.push({ sql: this.sql, params: this.params });
          return { results: [{ value: 7 }], success: true, meta: { rows_written: 0, changes: 0 } };
        },
      };
    },
    async batch(statements) {
      calls.push(...statements.map((statement) => ({ sql: statement.sql, params: statement.params })));
      return statements.map(() => ({ results: [], success: true, meta: { rows_written: 2, changes: 1 } }));
    },
  };
}

test("D1 endpoint requires its environment Worker secret and only exposes the bound database", async () => {
  const db = queryDatabase();
  const env = { RUN_LOGS: db, RUN_LOGS_API_SECRET: "dev-secret-that-is-long-enough-for-testing" };
  const unauthorized = await worker.fetch(new Request("https://worker.example/v1/d1/query", {
    method: "POST", body: JSON.stringify({ sql: "SELECT 1", params: [] }),
  }), env);
  assert.equal(unauthorized.status, 401);
  assert.equal(db.calls.length, 0);

  const notFound = await worker.fetch(new Request("https://worker.example/v1/d1/other", {
    method: "POST", headers: { authorization: `Bearer ${env.RUN_LOGS_API_SECRET}` }, body: "{}",
  }), env);
  assert.equal(notFound.status, 404);
  assert.equal(db.calls.length, 0);

  const response = await worker.fetch(new Request("https://worker.example/v1/d1/query", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RUN_LOGS_API_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ sql: "SELECT ? AS value", params: [7] }),
  }), env);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).result[0].results, [{ value: 7 }]);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].params[0], 7);
});

test("D1 endpoint validates batches and never returns database error details", async () => {
  const db = queryDatabase();
  const secret = "dev-secret-that-is-long-enough-for-testing";
  const headers = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  const invalid = await worker.fetch(new Request("https://worker.example/v1/d1/query", {
    method: "POST", headers, body: JSON.stringify({ batch: [{ sql: "SELECT 1", params: [] }, { sql: "", params: [] }] }),
  }), { RUN_LOGS: db, RUN_LOGS_API_SECRET: secret });
  assert.equal(invalid.status, 400);
  assert.equal(db.calls.length, 0);

  const response = await worker.fetch(new Request("https://worker.example/v1/d1/query", {
    method: "POST", headers,
    body: JSON.stringify({ batch: [{ sql: "INSERT INTO t VALUES (?)", params: [1] }, { sql: "INSERT INTO t VALUES (?)", params: [2] }] }),
  }), { RUN_LOGS: db, RUN_LOGS_API_SECRET: secret });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.length, 2);
  assert.equal(db.calls.length, 2);

  const brokenDb = { prepare() { throw new Error("private SQL and secret detail"); } };
  const failed = await worker.fetch(new Request("https://worker.example/v1/d1/query", {
    method: "POST", headers, body: JSON.stringify({ sql: "SELECT 1", params: [] }),
  }), { RUN_LOGS: brokenDb, RUN_LOGS_API_SECRET: secret });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private SQL and secret detail/);
});
