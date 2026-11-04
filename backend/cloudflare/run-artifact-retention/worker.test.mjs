import test from "node:test";
import assert from "node:assert/strict";
import worker, { cleanupByStorage, jsonResponse } from "./worker.mjs";

test("oversized D1 responses return the bounded error body", async () => {
  const response = jsonResponse({ success: true, result: "too long" }, 200, 16);
  assert.equal(response.status, 413);
  assert.match((await response.json()).errors[0].message, /smaller pages/);
});

function retentionD1({ size = 351_000_000, locked = false, runId = 12, objects = [], reserved = 0 } = {}) {
  const calls = [];
  const state = { active: 0, run_id: null, halted: 0, start_size: null, writes_reserved: reserved };
  return {
    calls, state,
    prepare(sql) {
      return { bind(...params) { return { async all() {
        calls.push({ sql, params });
        const meta = { size_after: size, changes: 0, rows_written: 0 };
        let results = [];
        if (sql.startsWith("SELECT * FROM retention_state")) results = [{ ...state }];
        else if (sql.startsWith("UPDATE run_locks SET lease_token = ?")) meta.changes = locked ? 0 : 1;
        else if (sql.startsWith("UPDATE run_locks SET lease_until = ?")) meta.changes = 1;
        else if (sql.startsWith("UPDATE retention_state SET active = 1")) state.active = 1;
        else if (sql.startsWith("SELECT run_id FROM run_logs")) results = runId ? [{ run_id: runId }] : [];
        else if (sql.startsWith("UPDATE retention_state SET run_id = ?, start_size")) { state.run_id = params[0]; state.start_size = params[1]; }
        else if (sql.startsWith("UPDATE retention_state SET writes_reserved")) state.writes_reserved += params[0];
        else if (sql.startsWith("SELECT artifact_id, object_key")) results = objects;
        else if (sql.startsWith("DELETE FROM artifacts WHERE run_id")) meta.changes = objects.length;
        else if (sql.startsWith("DELETE FROM run_logs")) { meta.changes = 1; size -= 1_000_000; }
        else if (sql.startsWith("UPDATE retention_state SET run_id = NULL")) { state.run_id = null; state.active = params[0] || 0; }
        return { results, meta };
      } }; } };
    },
  };
}

test("below the high-water mark retains all runs", async () => {
  const db = retentionD1({ size: 200_000_000 });
  const result = await cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: {} });
  assert.equal(result.pending, false);
  assert.equal(db.calls.some(c => c.sql.startsWith("DELETE")), false);
});

test("missing database size stops before any deletion", async () => {
  const db = retentionD1({ size: undefined });
  const original = db.prepare.bind(db);
  db.prepare = sql => sql === "SELECT 1 AS ok" ? { bind: () => ({ all: async () => ({ results: [{}], meta: {} }) }) } : original(sql);
  await assert.rejects(cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: {} }), /measurement unavailable/);
  assert.equal(db.calls.some(c => c.sql.startsWith("DELETE")), false);
});

test("cleanup deletes linked screenshots before metadata and selects only completed old runs", async () => {
  const db = retentionD1({ objects: [{ artifact_id: "a", object_key: "runs/2026-06-01/12/screenshots/a.webp" }] });
  const deleted = [];
  const result = await cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: { async delete(keys) { deleted.push(...keys); } } }, new Date("2026-11-03T04:00:00Z"));
  assert.equal(result.pending, true);
  assert.equal(deleted.length, 1);
  assert.match(db.calls.find(c => c.sql.startsWith("SELECT run_id FROM run_logs")).sql, /status IN \('successful', 'failed'\)/);
  assert.ok(db.calls.some(c => c.sql.startsWith("DELETE FROM artifacts WHERE run_id")));
  assert.ok(!db.calls.some(c => c.sql.startsWith("DELETE FROM run_logs")));
});

test("an R2 outage leaves screenshot metadata intact for safe resumption", async () => {
  const db = retentionD1({ objects: [{ artifact_id: "a", object_key: "runs/2026-06-01/12/screenshots/a.webp" }] });
  await assert.rejects(cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: { async delete() { throw new Error("offline"); } } }), /offline/);
  assert.ok(!db.calls.some(c => c.sql.startsWith("DELETE FROM artifacts")));
  assert.ok(db.calls.some(c => c.sql.startsWith("UPDATE run_locks SET lease_token = ''")));
});

test("cleanup skips deletion when the daily write budget is exhausted", async () => {
  const db = retentionD1({ reserved: 5000 });
  const result = await cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: {} });
  assert.equal(result.budgetExhausted, true);
  assert.ok(!db.calls.some(c => c.sql.startsWith("DELETE")));
});

test("cleanup refuses to run while another scraper holds the lease", async () => {
  const db = retentionD1({ locked: true });
  await assert.rejects(cleanupByStorage({ RUN_LOGS: db, RUN_ARTIFACTS: {} }), /holds the run lease/);
  assert.ok(!db.calls.some(c => c.sql.startsWith("DELETE")));
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

test("storage cleanup resumes across calls and keeps running and recently imported runs", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../d1/migrations/0001_run_artifacts.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO run_logs (run_id,target,run_from,status,started_at,created_at) VALUES
    (1,'dev','test','successful','2026-01-01','2026-01-01'),
    (2,'dev','test','running','2026-01-01','2026-01-01'),
    (3,'dev','test','successful','2026-01-01','2026-11-03T03:00:00.000Z');
    INSERT INTO scraped_rows (row_key,run_id,scraper,attempt,outcome,row_order,created_at) VALUES ('row',1,'test',1,'successful',0,'2026-01-01');
    INSERT INTO gathering_rows (row_key,run_id,scraper,source_file,row_order,created_at) VALUES ('gather',1,'test','old.csv',0,'2026-01-01');
    INSERT INTO diagnostics (diagnostic_id,chunk_index,chunk_count,run_id,diagnostic_type,diagnostic_name,text_content,created_at) VALUES ('diag',0,1,1,'test','test','hello','2026-01-01');
    INSERT INTO artifacts (artifact_id,run_id,artifact_type,artifact_name,object_key,content_type,created_at) VALUES ('image',1,'screenshots','test','runs/2026-01-01/1/screenshots/a.webp','image/webp','2026-01-01');`);
  let reportedSize = 351_000_000;
  const d1 = { prepare(sql) { return { bind(...params) { return { async all() {
    const statement = db.prepare(sql);
    let results = [], changes = 0;
    if (statement.columns().length) results = statement.all(...params);
    else changes = Number(statement.run(...params).changes);
    if (sql.startsWith("DELETE FROM run_logs") && changes) reportedSize = 299_000_000;
    return { results, meta: { changes, rows_written: changes * 3, size_after: reportedSize } };
  } }; } }; } };
  const deleted = [];
  const env = { RUN_LOGS: d1, RUN_ARTIFACTS: { async delete(keys) { deleted.push(...keys); } } };
  let result;
  for (let i = 0; i < 10; i++) {
    result = await cleanupByStorage(env, new Date("2026-11-03T04:00:00Z"));
    if (!result.pending) break;
  }
  assert.equal(result.pending, false);
  assert.deepEqual(deleted, ["runs/2026-01-01/1/screenshots/a.webp"]);
  assert.deepEqual(db.prepare("SELECT run_id FROM run_logs ORDER BY run_id").all().map(r => r.run_id), [2, 3]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM diagnostics").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM gathering_rows").get().n, 0);
  db.close();
});
