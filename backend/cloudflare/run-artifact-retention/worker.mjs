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

export function subtractCalendarMonths(date, months = 2) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const day = date.getUTCDate();
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();
  const second = date.getUTCSeconds();
  const targetMonthStart = new Date(Date.UTC(year, month, 1, hour, minute, second));
  const daysInTargetMonth = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(day, daysInTargetMonth));
  return targetMonthStart;
}

function keyDate(key) {
  const match = /^runs\/(\d{4}-\d{2}-\d{2})\//.exec(key);
  if (!match) return null;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : match[1];
}

async function cleanupOldObjects(bucket, cutoffDate) {
  const page = await bucket.list({ prefix: "runs/", limit: OBJECT_PAGE_SIZE });
  const oldKeys = [];
  let reachedRetentionWindow = false;
  for (const object of page.objects ?? []) {
    const date = keyDate(object.key);
    if (date && date < cutoffDate) oldKeys.push(object.key);
    else if (date) {
      // R2 lists keys lexicographically, and the date is the first path part.
      // Once the first in-window date appears, later keys cannot be expired.
      reachedRetentionWindow = true;
      break;
    }
  }
  if (oldKeys.length) await bucket.delete(oldKeys);
  // Deleting the first page makes the next daily tick advance to the next
  // oldest objects. Do not clean D1 metadata while older object pages remain.
  return { deleted: oldKeys.length, pending: Boolean(page.truncated && !reachedRetentionWindow) };
}

function resultWrites(result) {
  return Number(result?.meta?.rows_written ?? 0);
}

function resultChanges(result) {
  return Number(result?.meta?.changes ?? 0);
}

async function deleteBatch(db, sql, parameters) {
  return db.prepare(sql).bind(...parameters).run();
}

async function cleanupD1(db, cutoffIso) {
  let rowsWritten = 0;
  let rowsDeleted = 0;
  let artifactsDeleted = 0;
  let runsDeleted = 0;

  while (rowsWritten < D1_WRITE_BUDGET_PER_TICK) {
    const result = await deleteBatch(
      db,
      `DELETE FROM scraped_rows WHERE row_key IN (
        SELECT s.row_key FROM scraped_rows AS s
        JOIN run_logs AS r ON r.run_id = s.run_id
        WHERE r.started_at < ? ORDER BY r.started_at, s.row_key LIMIT ?
      )`,
      [cutoffIso, Math.min(D1_BATCH_SIZE, Math.max(1, Math.floor((D1_WRITE_BUDGET_PER_TICK - rowsWritten) / 3)))],
    );
    const changes = resultChanges(result);
    rowsWritten += resultWrites(result);
    rowsDeleted += changes;
    if (changes === 0) break;
  }

  if (rowsWritten < D1_WRITE_BUDGET_PER_TICK) {
    while (rowsWritten < D1_WRITE_BUDGET_PER_TICK) {
      const result = await deleteBatch(
        db,
        `DELETE FROM artifacts WHERE artifact_id IN (
          SELECT a.artifact_id FROM artifacts AS a
          LEFT JOIN run_logs AS r ON r.run_id = a.run_id
          WHERE (a.run_id IS NOT NULL AND r.started_at < ?)
             OR (a.run_id IS NULL AND a.created_at < ?)
          ORDER BY COALESCE(r.started_at, a.created_at), a.artifact_id LIMIT ?
        )`,
        // The statement uses the same cutoff for each branch; repeated binding
        // is preferable to string interpolation for an operator controlled date.
        [cutoffIso, cutoffIso, Math.min(D1_BATCH_SIZE, Math.max(1, Math.floor((D1_WRITE_BUDGET_PER_TICK - rowsWritten) / 2)))],
      );
      const changes = resultChanges(result);
      rowsWritten += resultWrites(result);
      artifactsDeleted += changes;
      if (changes === 0) break;
    }
  }

  if (rowsWritten < D1_WRITE_BUDGET_PER_TICK) {
    const result = await db.prepare(
      `DELETE FROM run_logs WHERE run_id IN (
        SELECT r.run_id FROM run_logs AS r
        WHERE r.started_at < ?
          AND NOT EXISTS (SELECT 1 FROM scraped_rows AS s WHERE s.run_id = r.run_id)
          AND NOT EXISTS (SELECT 1 FROM artifacts AS a WHERE a.run_id = r.run_id)
        ORDER BY r.started_at, r.run_id LIMIT ?
      )`,
    ).bind(cutoffIso, Math.min(500, Math.max(1, D1_WRITE_BUDGET_PER_TICK - rowsWritten))).run();
    runsDeleted += resultChanges(result);
    rowsWritten += resultWrites(result);
  }

  return { rowsWritten, rowsDeleted, artifactsDeleted, runsDeleted, budgetExhausted: rowsWritten >= D1_WRITE_BUDGET_PER_TICK };
}

export async function cleanupExpiredArtifacts(env, now = new Date()) {
  if (!env?.RUN_ARTIFACTS || !env?.RUN_LOGS) throw new Error("RUN_ARTIFACTS and RUN_LOGS bindings are required");
  const cutoff = subtractCalendarMonths(now, 2);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);
  const objects = await cleanupOldObjects(env.RUN_ARTIFACTS, cutoffDate);
  if (objects.pending) {
    return { cutoff: cutoffIso, objectsDeleted: objects.deleted, d1: null, pending: true };
  }
  const d1 = await cleanupD1(env.RUN_LOGS, cutoffIso);
  return { cutoff: cutoffIso, objectsDeleted: objects.deleted, d1, pending: d1.budgetExhausted };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/d1/query") return jsonResponse({ success: false, errors: [{ message: "Not found" }] }, 404);
    if (request.method !== "POST") return jsonResponse({ success: false, errors: [{ message: "Method not allowed" }] }, 405);
    if (!authorized(request, env.RUN_LOGS_API_SECRET)) return jsonResponse({ success: false, errors: [{ message: "Unauthorized" }] }, 401);
    if (!env.RUN_LOGS) return jsonResponse({ success: false, errors: [{ message: "D1 binding unavailable" }] }, 503);
    return queryD1(env.RUN_LOGS, request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredArtifacts(env).then((result) => {
      console.log("Run-artifact retention completed", JSON.stringify(result));
    }).catch((error) => {
      console.error("Run-artifact retention failed", JSON.stringify({ error: error?.name ?? "Error" }));
      throw error;
    }));
  },
};
