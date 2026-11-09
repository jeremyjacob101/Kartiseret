import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is required");
const target = new URL(url);
if (
  !["127.0.0.1", "localhost", "::1"].includes(target.hostname) ||
  target.pathname !== "/kartiseret_test"
)
  throw new Error("Timing tests require disposable local kartiseret_test");
const pool = new Pool({ connectionString: url, max: 6 });
afterAll(async () => {
  await pool.end();
});

const append = `SELECT public.append_util_avg_time_transport_history($1, $2, $3, $4, $5)`;
const history = async (name: string) =>
  (
    await pool.query<{
      transport: string;
      recent_times: number[];
      runner_machine: string;
      weekday: string;
    }>(
      `SELECT transport, recent_times, runner_machine, weekday FROM public."utilAvgTimeHistory" WHERE name=$1 ORDER BY transport, runner_machine, weekday`,
      [name],
    )
  ).rows;

function migration(name: string) {
  return readFileSync(
    new URL(`../../../../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  )
    .replace(/^\s*BEGIN;\s*/, "")
    .replace(/\s*COMMIT;\s*$/, "");
}

describe("transport timing history", () => {
  it("preserves an existing last-five and timestamp as legacy during upgrade", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DROP TABLE public."utilAvgTimeHistory"`);
      await client.query(
        migration("20261104091416_util_avg_time_weekday_history.sql"),
      );
      await client.query(
        `INSERT INTO public."utilAvgTimeHistory" (name, runner_machine, weekday, recent_times, updated_at) VALUES ('OldCinema','m5_mac','monday',ARRAY[11,22,33,44,55]::double precision[],'2026-11-01T00:00:00Z')`,
      );
      await client.query(
        migration("20261109081746_util_avg_time_transport_history.sql"),
      );
      const { rows } = await client.query(
        `SELECT transport,recent_times,extract(epoch from updated_at)::double precision AS updated_at FROM public."utilAvgTimeHistory" WHERE name='OldCinema'`,
      );
      expect(rows).toEqual([
        {
          transport: "legacy",
          recent_times: [11, 22, 33, 44, 55],
          updated_at: Date.parse("2026-11-01T00:00:00Z") / 1000,
        },
      ]);
      await client.query(
        `SELECT public.append_util_avg_time_history('OldCinema','m5_mac','monday',66)`,
      );
      await client.query(append, [
        "OldCinema",
        "m5_mac",
        "monday",
        3,
        "requests",
      ]);
      const updated = await client.query(
        `SELECT transport,recent_times FROM public."utilAvgTimeHistory" WHERE name='OldCinema' ORDER BY transport`,
      );
      expect(updated.rows).toEqual([
        { transport: "legacy", recent_times: [22, 33, 44, 55, 66] },
        { transport: "requests", recent_times: [3] },
      ]);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("keeps the newest five independently per transport, runner and weekday", async () => {
    const name = "Transport sequential";
    await pool.query(`DELETE FROM public."utilAvgTimeHistory" WHERE name=$1`, [
      name,
    ]);
    for (const [transport, offset] of [
      ["requests", 0],
      ["selenium", 100],
      ["requests_selenium_fallback", 200],
    ] as const) {
      for (let i = 1; i <= 6; i++)
        await pool.query(append, [
          name,
          "m5_mac",
          "monday",
          offset + i,
          transport,
        ]);
    }
    await pool.query(append, [name, "intel_mac", "monday", 900, "requests"]);
    await pool.query(append, [name, "m5_mac", "tuesday", 800, "requests"]);
    const rows = await history(name);
    const find = (transport: string, machine = "m5_mac", day = "monday") =>
      rows.find(
        (r) =>
          r.transport === transport &&
          r.runner_machine === machine &&
          r.weekday === day,
      )?.recent_times;
    expect(find("requests")).toEqual([2, 3, 4, 5, 6]);
    expect(find("selenium")).toEqual([102, 103, 104, 105, 106]);
    expect(find("requests_selenium_fallback")).toEqual([
      202, 203, 204, 205, 206,
    ]);
    expect(find("requests", "intel_mac")).toEqual([900]);
    expect(find("requests", "m5_mac", "tuesday")).toEqual([800]);
  });

  it("serializes concurrent updates without mixing transports or growing arrays", async () => {
    const name = "Transport concurrent";
    await pool.query(`DELETE FROM public."utilAvgTimeHistory" WHERE name=$1`, [
      name,
    ]);
    await Promise.all(
      ["requests", "selenium", "requests_selenium_fallback"].flatMap(
        (transport, index) =>
          Array.from({ length: 12 }, (_, i) =>
            pool.query(append, [
              name,
              "m5_mac",
              "monday",
              100 * index + i + 1,
              transport,
            ]),
          ),
      ),
    );
    const rows = await history(name);
    expect(rows).toHaveLength(3);
    for (const [index, transport] of [
      "requests",
      "selenium",
      "requests_selenium_fallback",
    ].entries()) {
      const times = rows.find((r) => r.transport === transport)?.recent_times;
      expect(times).toHaveLength(5);
      expect(
        times?.every((t) => t > 100 * index && t <= 100 * index + 12),
      ).toBe(true);
    }
  });

  it("rejects invalid scopes and durations without inserting history", async () => {
    const name = "Transport invalid";
    for (const params of [
      [name, "m5_mac", "monday", 1, "auto"],
      [name, "m5_mac", "monday", 1, null],
      [name, "m5_mac", "monday", 0, "requests"],
      [name, "m5_mac", "monday", "NaN", "requests"],
      [name, "m5_mac", "monday", "Infinity", "requests"],
      [name, "m5_mac", "Monday", 1, "requests"],
    ])
      await expect(pool.query(append, params)).rejects.toThrow();
    expect(await history(name)).toEqual([]);
  });

  it("allows trusted service writes while anonymous execution stays denied", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE service_role");
      await client.query(append, [
        "Transport service",
        "m5_mac",
        "monday",
        5,
        "requests",
      ]);
      await client.query(
        `SELECT public.append_util_avg_time_history('Transport service','m5_mac','monday',50)`,
      );
      await client.query("RESET ROLE");
      await client.query("SET LOCAL ROLE anon");
      await expect(
        client.query(append, [
          "Transport denied",
          "m5_mac",
          "monday",
          5,
          "requests",
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
