const OBJECT_PAGE_SIZE = 1000;
const D1_BATCH_SIZE = 1000;
const D1_WRITE_BUDGET_PER_TICK = 5000;
const MAX_QUERY_BODY_BYTES = 1_000_000;
const MAX_QUERY_RESPONSE_BYTES = 40_000_000;
const MAX_QUERY_SQL_LENGTH = 100_000;
const MAX_QUERY_PARAMS = 100;
const MAX_BATCH_SIZE = 100;

export function jsonResponse(payload, status = 200, maxBytes = MAX_QUERY_RESPONSE_BYTES) {
  let body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    body = JSON.stringify({ success: false, errors: [{ message: "D1 result too large; request smaller pages" }] });
    status = 413;
  }
  // Keep the actual response body aligned with the size check above.
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function authorized(request, secret) {
  if (!secret) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  // Compare the complete strings without returning early on the first mismatch.
  let difference = supplied.length ^ expected.length;
  const size = Math.max(supplied.length, expected.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (supplied.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function validateStatement(statement) {
  if (!statement || typeof statement !== "object" || Array.isArray(statement)) return false;
  return typeof statement.sql === "string"
    && statement.sql.trim().length > 0
    && statement.sql.length <= MAX_QUERY_SQL_LENGTH
    && Array.isArray(statement.params ?? [])
    && (statement.params ?? []).length <= MAX_QUERY_PARAMS;
}

async function queryD1(db, request) {
  if ((request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return jsonResponse({ success: false, errors: [{ message: "Expected application/json" }] }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_QUERY_BODY_BYTES) return jsonResponse({ success: false, errors: [{ message: "Request too large" }] }, 413);
  let bytes;
  try {
    const reader = request.body?.getReader();
    if (!reader) return jsonResponse({ success: false, errors: [{ message: "Invalid request body" }] }, 400);
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_QUERY_BODY_BYTES) {
        await reader.cancel();
        return jsonResponse({ success: false, errors: [{ message: "Request too large" }] }, 413);
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  } catch {
    return jsonResponse({ success: false, errors: [{ message: "Invalid request body" }] }, 400);
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return jsonResponse({ success: false, errors: [{ message: "Invalid JSON" }] }, 400);
  }

  try {
    if (Array.isArray(payload?.batch)) {
      if (payload.batch.length < 1 || payload.batch.length > MAX_BATCH_SIZE || !payload.batch.every(validateStatement)) {
        return jsonResponse({ success: false, errors: [{ message: "Invalid D1 batch" }] }, 400);
      }
      const prepared = payload.batch.map(({ sql, params = [] }) => db.prepare(sql).bind(...params));
      const results = await db.batch(prepared);
      return jsonResponse({ success: true, result: results.map((result) => ({ ...result, success: result?.success !== false })), errors: [], messages: [] });
    }
    if (!validateStatement(payload)) {
      return jsonResponse({ success: false, errors: [{ message: "Invalid D1 query" }] }, 400);
    }
    const result = await db.prepare(payload.sql).bind(...(payload.params ?? [])).all();
    return jsonResponse({ success: true, result: [{ ...result, success: result?.success !== false }], errors: [], messages: [] });
  } catch {
    // Never echo SQL, bound values, or database errors to the caller.
    return jsonResponse({ success: false, errors: [{ message: "D1 query failed" }] }, 502);
  }
}

const HIGH_WATER_BYTES = 350_000_000;
const LOW_WATER_BYTES = 300_000_000;
const CLEANUP_LEASE_MS = 10 * 60 * 1000;

async function statement(db, sql, params = []) {
  return db.prepare(sql).bind(...params).all();
}

async function databaseSize(db) {
  const result = await statement(db, "SELECT 1 AS ok");
  const size = result?.meta?.size_after;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("D1 storage measurement unavailable");
  return size;
}

/** Delete a bounded amount of one old completed run, coordinating with the scraper lease. */
export async function cleanupByStorage(env, now = new Date()) {
  if (!env?.RUN_ARTIFACTS || !env?.RUN_LOGS) throw new Error("RUN_ARTIFACTS and RUN_LOGS bindings are required");
  const db = env.RUN_LOGS;
  let size = await databaseSize(db);
  const stateQuery = await statement(db, "SELECT * FROM retention_state WHERE id = 1");
  let state = stateQuery.results?.[0];
  if (!state) throw new Error("Retention state missing");
  if (state.halted) throw new Error("Cleanup halted because storage did not shrink; operator review required");
  if (!state.active && size < HIGH_WATER_BYTES) return { size, pending: false, deleted: 0 };

  const token = crypto.randomUUID();
  const nowIso = now.toISOString();
  const startedWall = Date.now();
  const expires = new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString();
  const lock = await statement(db, "UPDATE run_locks SET lease_token = ?, run_id = NULL, lease_until = ? WHERE id = 1 AND lease_until <= ?", [token, expires, nowIso]);
  if (Number(lock.meta?.changes) !== 1) throw new Error("A scraper or cleanup holds the run lease");
  try {
    const renewLease = async () => {
      const current = new Date(now.getTime() + Math.max(0, Date.now() - startedWall));
      const deadline = new Date(current.getTime() + CLEANUP_LEASE_MS).toISOString();
      const result = await statement(db, "UPDATE run_locks SET lease_until = ? WHERE id = 1 AND lease_token = ? AND lease_until > ?", [deadline, token, current.toISOString()]);
      if (Number(result.meta?.changes) !== 1) throw new Error("Cleanup lease expired or was lost");
    };
    size = await databaseSize(db);
    const day = nowIso.slice(0, 10);
    await statement(db, "UPDATE retention_state SET active = 1, budget_day = ?, writes_reserved = CASE WHEN budget_day = ? THEN writes_reserved ELSE 0 END WHERE id = 1", [day, day]);
    state = (await statement(db, "SELECT * FROM retention_state WHERE id = 1")).results?.[0];
    if (!state) throw new Error("Retention state missing");
    if (size <= LOW_WATER_BYTES && !state.run_id) {
      await statement(db, "UPDATE retention_state SET active = 0 WHERE id = 1");
      return { size, pending: false, deleted: 0 };
    }
    let runId = state.run_id;
    if (!runId) {
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const candidate = await statement(db, "SELECT run_id FROM run_logs WHERE status IN ('successful', 'failed') AND started_at < ? AND created_at < ? ORDER BY started_at, run_id LIMIT 1", [cutoff, cutoff]);
      runId = candidate.results?.[0]?.run_id;
      if (!runId) throw new Error("No safely removable completed run is available");
      await statement(db, "UPDATE retention_state SET run_id = ?, start_size = ? WHERE id = 1", [runId, size]);
      state.run_id = runId;
      state.start_size = size;
    }
    const remaining = D1_WRITE_BUDGET_PER_TICK - Number(state.writes_reserved || 0);
    if (remaining < 40) return { size, runId, pending: true, budgetExhausted: true };
    // Reserve an upper bound before deleting so an interruption cannot evade the daily budget.
    const count = Math.min(80, Math.floor((remaining - 20) / 4));
    const reservation = count * 4 + 20;
    await statement(db, "UPDATE retention_state SET writes_reserved = writes_reserved + ? WHERE id = 1", [reservation]);
    const objects = await statement(db, "SELECT artifact_id, object_key FROM artifacts WHERE run_id = ? AND object_key <> '' ORDER BY artifact_id LIMIT ?", [runId, count]);
    const objectRows = objects.results || [];
    if (objectRows.length) {
      for (const row of objectRows) {
        if (!new RegExp(`^runs/\\d{4}-\\d{2}-\\d{2}/${runId}/`).test(row.object_key)) throw new Error("Invalid screenshot key in D1");
      }
      await renewLease();
      await env.RUN_ARTIFACTS.delete(objectRows.map(row => row.object_key));
      await renewLease();
      const placeholders = objectRows.map(() => "?").join(",");
      await statement(db, `DELETE FROM artifacts WHERE run_id = ? AND artifact_id IN (${placeholders})`, [runId, ...objectRows.map(row => row.artifact_id)]);
      return { size: await databaseSize(db), runId, pending: true, deletedObjects: objectRows.length };
    }
    for (const table of ["scraped_rows", "gathering_rows", "diagnostics", "artifacts"]) {
      const key = ["scraped_rows", "gathering_rows"].includes(table) ? "row_key" : table === "diagnostics" ? "rowid" : "artifact_id";
      await renewLease();
      const result = await statement(db, `DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE run_id = ? LIMIT ?)`, [runId, count]);
      if (Number(result.meta?.changes || 0) > 0) return { size: await databaseSize(db), runId, pending: true, deleted: Number(result.meta.changes) };
    }
    await renewLease();
    const deleted = await statement(db, "DELETE FROM run_logs WHERE run_id = ? AND status IN ('successful', 'failed')", [runId]);
    if (Number(deleted.meta?.changes) !== 1) throw new Error("Run changed during cleanup");
    const after = await databaseSize(db);
    if (after >= Number(state.start_size) && after > LOW_WATER_BYTES) {
      await statement(db, "UPDATE retention_state SET run_id = NULL, halted = 1 WHERE id = 1");
      throw new Error("Cleanup stopped: reported D1 size did not decrease");
    }
    await statement(db, "UPDATE retention_state SET run_id = NULL, start_size = NULL, active = ? WHERE id = 1", [after > LOW_WATER_BYTES ? 1 : 0]);
    return { size: after, runId, pending: after > LOW_WATER_BYTES, deletedRuns: 1 };
  } finally {
    await statement(db, "UPDATE run_locks SET lease_token = '', run_id = NULL, lease_until = '1970-01-01T00:00:00+00:00' WHERE id = 1 AND lease_token = ?", [token]);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!["/v1/d1/query", "/v1/d1/cleanup"].includes(url.pathname)) return jsonResponse({ success: false, errors: [{ message: "Not found" }] }, 404);
    if (request.method !== "POST") return jsonResponse({ success: false, errors: [{ message: "Method not allowed" }] }, 405);
    if (!authorized(request, env.RUN_LOGS_API_SECRET)) return jsonResponse({ success: false, errors: [{ message: "Unauthorized" }] }, 401);
    if (!env.RUN_LOGS) return jsonResponse({ success: false, errors: [{ message: "D1 binding unavailable" }] }, 503);
    if (url.pathname === "/v1/d1/cleanup") {
      try { return jsonResponse({ success: true, result: await cleanupByStorage(env) }); }
      catch (error) {
        console.error("Storage cleanup unavailable", error?.message ?? "unknown error");
        return jsonResponse({ success: false, errors: [{ message: "Storage cleanup unavailable; inspect Worker logs" }] }, 503);
      }
    }
    return queryD1(env.RUN_LOGS, request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupByStorage(env).then((result) => {
      console.log("Run-artifact retention completed", JSON.stringify(result));
    }).catch((error) => {
      console.error("Run-artifact retention failed", JSON.stringify({ error: error?.name ?? "Error" }));
      throw error;
    }));
  },
};
