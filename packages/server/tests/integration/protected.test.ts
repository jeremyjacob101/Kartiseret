import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createDatabase } from "../../src/db/client.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { ProtectedWorkflows } from "../../src/protected/service.js";
import { createApp } from "../../src/app.js";
import { HttpError } from "../../src/http-errors.js";
import {
  DEFAULT_TICKET_ALERT_CRITERIA,
  type TicketAlertCriteriaOverride,
} from "@kartiseret/contracts/private-data";

const adminUrl = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.DATABASE_URL;
if (
  !adminUrl ||
  !runtimeUrl ||
  [adminUrl, runtimeUrl].some((value) => {
    const u = new URL(value);
    return (
      !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
      u.pathname !== "/kartiseret_test"
    );
  })
)
  throw new Error(
    "Protected integration requires disposable local kartiseret_test.",
  );
const admin = createDatabase(adminUrl, { poolMax: 3 });
const runtime = createDatabase(runtimeUrl, { poolMax: 3 });
const alice = {
  id: "00000000-0000-4000-8000-000000000041",
  email: "alice@example.test",
  signupLocation: "Haifa",
};
const bob = {
  id: "00000000-0000-4000-8000-000000000042",
  email: "bob@example.test",
};
const owner = {
  id: "00000000-0000-4000-8000-000000000043",
  email: "workflow-admin@example.test",
};
const publicRepository = new DrizzleCatalogRepository(runtime.db);
const workflows = new ProtectedWorkflows(
  runtime.db,
  publicRepository,
  () => new Date("2026-10-19T12:00:00Z"),
);
const identities = { alice, bob, admin: owner };
const app = createApp({
  catalogRepository: publicRepository,
  publicDataRepository: publicRepository,
  protectedWorkflows: workflows,
  trustedOrigins: ["http://localhost"],
  identityVerifier: {
    async verify(token) {
      const identity = identities[token as keyof typeof identities];
      if (!identity)
        throw new HttpError(401, "unauthorized", "Invalid session.");
      return identity;
    },
  },
});
const correction = (
  mode: "nowPlaying" | "comingSoon",
  source: number,
  target: number,
) => ({
  mode,
  currentTmdbId: String(source),
  selectedTmdbId: String(target),
  selectedTitle: "Correct title",
  isManualEntry: true,
});
async function movie(id: number) {
  await admin.pool.query(
    'INSERT INTO public."finalMovies" (tmdb_id,english_title) VALUES ($1,$2)',
    [id, `Fixture ${id}`],
  );
}
async function soon(id: number) {
  await admin.pool.query(
    'INSERT INTO public."finalSoons" (tmdb_id,english_title,hebrew_title,release_date) VALUES ($1,$2,$3,$4)',
    [id, `Soon ${id}`, "סרט", "2026-11-01"],
  );
}

describe.sequential(
  "protected workflows through the restricted runtime role",
  () => {
    beforeAll(async () => {
      for (const user of [alice, bob, owner])
        await admin.pool.query(
          "INSERT INTO app_auth.users (id,name,email,email_verified) VALUES ($1,'Fixture',$2,true)",
          [user.id, user.email],
        );
      await admin.pool.query(
        "INSERT INTO public.admin_users (user_id) VALUES ($1)",
        [owner.id],
      );
    });
    afterAll(async () => {
      await admin.pool.query(
        'ALTER TABLE public."finalShowtimes" DROP CONSTRAINT IF EXISTS pr4_late_failure',
      );
      await admin.pool.query(
        'DELETE FROM public."finalShowtimes" WHERE tmdb_id BETWEEN 9200000 AND 9200999',
      );
      await admin.pool.query(
        'DELETE FROM public."finalMovies" WHERE tmdb_id BETWEEN 9200000 AND 9200999',
      );
      await admin.pool.query(
        'DELETE FROM public."finalSoons" WHERE tmdb_id BETWEEN 9200000 AND 9200999',
      );
      await admin.pool.query(
        "DELETE FROM public.\"tableFixes\" WHERE title_fix ~ '^920[0-9]{4}$'",
      );
      await admin.pool.query(
        'DELETE FROM public."movieCodes" WHERE tmdb_id BETWEEN 9200000 AND 9200999',
      );
      await admin.pool.query(
        "DELETE FROM app_auth.users WHERE id = ANY($1::uuid[])",
        [[alice.id, bob.id, owner.id]],
      );
      await Promise.all([runtime.close(), admin.close()]);
    });
    it("initializes signup location once and preserves empty source choices and existing preferences", async () => {
      await admin.pool.query(
        'INSERT INTO public."userPreferences" (user_id,location,rating_sources,site_color) VALUES ($1,$2,$3,$4)',
        [alice.id, "Jerusalem", [], "#a66ae3"],
      );
      const first = await workflows.preferences(alice);
      expect(first).toEqual({
        location: "Haifa",
        ratingSources: [],
        siteColor: "#a66ae3",
      });
      await workflows.patchPreferences(alice, { location: "Tel Aviv" });
      expect((await workflows.preferences(alice)).location).toBe("Tel Aviv");
      expect((await workflows.account(alice)).isAdmin).toBe(false);
      expect((await workflows.account(owner)).isAdmin).toBe(true);
    });
    it("serializes concurrent initialization and partial updates without clobbering fields", async () => {
      await Promise.all(
        Array.from({ length: 5 }, () => workflows.preferences(bob)),
      );
      await Promise.all([
        workflows.patchPreferences(bob, { location: "Raanana" }),
        workflows.patchPreferences(bob, { siteColor: "#123456" }),
        workflows.patchPreferences(bob, { ratingSources: ["lbRating"] }),
      ]);
      expect(await workflows.preferences(bob)).toEqual({
        location: "Raanana",
        siteColor: "#123456",
        ratingSources: ["lbRating"],
      });
      expect(
        (await workflows.preferences({ ...bob, signupLocation: "Haifa" }))
          .location,
      ).toBe("Raanana");
    });
    it("persists account defaults and sparse title overrides through owner-scoped API routes", async () => {
      expect(await workflows.ticketAlertPreferences(alice)).toEqual(
        DEFAULT_TICKET_ALERT_CRITERIA,
      );
      const defaults = {
        cities: ["Haifa", "Jerusalem"],
        filters: {
          showType: ["Premium"],
          screenFormat: [],
          screeningTech: [],
          dubLanguage: [],
        },
      } as const;
      const savedDefaults = await request(app)
        .patch("/api/v1/ticket-alerts/preferences")
        .set("Cookie", "alice")
        .set("Origin", "http://localhost")
        .send(defaults);
      expect(savedDefaults.status).toBe(200);
      expect(savedDefaults.body.data.preferences).toEqual(defaults);
      expect(await workflows.ticketAlertPreferences(bob)).toEqual(
        DEFAULT_TICKET_ALERT_CRITERIA,
      );

      expect(await workflows.subscribe(alice, "9200010")).toMatchObject({
        kind: "account",
      });
      const override: TicketAlertCriteriaOverride = {
        cities: ["Tel Aviv"],
        filters: { screeningTech: ["IMAX"] },
      };
      const savedOverride = await request(app)
        .patch("/api/v1/ticket-alerts/9200010/criteria")
        .set("Cookie", "alice")
        .set("Origin", "http://localhost")
        .send({ criteriaOverrides: override });
      expect(savedOverride.status).toBe(200);
      expect(
        (await workflows.subscriptions(alice, 0)).subscriptions[0]
          ?.criteriaOverrides,
      ).toEqual(override);
      await expect(
        workflows.updateTicketAlertCriteria(bob, "9200010", override),
      ).rejects.toMatchObject({ code: "subscription_not_found" });
      expect(await workflows.cancel(alice, "9200010")).toMatchObject({
        kind: "account",
      });
    });
    it("isolates accounts in SQL and HTTP, and never leaks context into a reused pool connection", async () => {
      expect(
        (
          await request(app)
            .get("/api/v1/preferences")
            .set("Cookie", "alice")
            .set("Origin", "http://localhost")
        ).body.data.location,
      ).toBe("Tel Aviv");
      expect(
        (
          await request(app)
            .get("/api/v1/preferences")
            .set("Cookie", "bob")
            .set("Origin", "http://localhost")
        ).body.data.location,
      ).toBe("Raanana");
      expect(
        (
          await runtime.pool.query(
            'SELECT user_id FROM public."userPreferences"',
          )
        ).rows,
      ).toEqual([]);
      const connection = await runtime.pool.connect();
      try {
        await connection.query("BEGIN");
        await connection.query("select set_config('app.user_id',$1,true)", [
          alice.id,
        ]);
        expect(
          (
            await connection.query(
              'SELECT user_id FROM public."userPreferences"',
            )
          ).rows,
        ).toEqual([{ user_id: alice.id }]);
        expect(
          (
            await connection.query(
              'UPDATE public."userPreferences" SET location=$1 WHERE user_id=$2 RETURNING user_id',
              ["bad", bob.id],
            )
          ).rows,
        ).toEqual([]);
        await expect(
          connection.query(
            'INSERT INTO public."userPreferences" (user_id) VALUES ($1)',
            [owner.id],
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await connection.query("ROLLBACK");
        connection.release();
      }
      expect(
        (
          await request(app)
            .get("/api/v1/preferences?userId=" + bob.id)
            .set("Cookie", "alice")
            .set("Origin", "http://localhost")
        ).status,
      ).toBe(400);
      expect((await request(app).get("/api/v1/ticket-alerts")).status).toBe(
        401,
      );
    });
    it("handles racing subscriptions, preserves sent delivery state, and scopes cancellation", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => workflows.subscribe(alice, "9200001")),
      );
      expect(results.every((result) => result.kind === "account")).toBe(true);
      expect(
        (await workflows.subscriptions(alice, 0)).subscriptions,
      ).toHaveLength(1);
      await admin.pool.query(
        "UPDATE public.ticket_alert_subscriptions SET notified_at=now(),delivery_id=gen_random_uuid(),delivery_attempts=2,delivery_title='Sent fixture' WHERE user_id=$1 AND tmdb_id=9200001",
        [alice.id],
      );
      const before = (
        await admin.pool.query(
          "SELECT * FROM public.ticket_alert_subscriptions WHERE user_id=$1",
          [alice.id],
        )
      ).rows;
      await workflows.subscribe(alice, "9200001");
      expect(
        (
          await admin.pool.query(
            "SELECT * FROM public.ticket_alert_subscriptions WHERE user_id=$1",
            [alice.id],
          )
        ).rows,
      ).toEqual(before);
      await workflows.cancel(bob, "9200001");
      expect(
        (await workflows.subscriptions(alice, 0)).subscriptions,
      ).toHaveLength(1);
      await expect(
        runtime.pool.query(
          "UPDATE public.ticket_alert_subscriptions SET delivery_attempts=0",
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await workflows.cancel(alice, "9200001");
      expect((await workflows.subscriptions(alice, 0)).subscriptions).toEqual(
        [],
      );
    });
    it("preserves bigint alert identities beyond JavaScript integer precision on read and cancellation", async () => {
      await admin.pool.query(
        "INSERT INTO public.ticket_alert_subscriptions (user_id,tmdb_id) VALUES ($1,$2)",
        [alice.id, "9007199254740993"],
      );
      expect(
        (await workflows.subscriptions(alice, 0)).subscriptions.some(
          (row) => row.tmdbId === "9007199254740993",
        ),
      ).toBe(true);
      const result = await request(app)
        .delete("/api/v1/ticket-alerts/9007199254740993")
        .set("Cookie", "alice")
        .set("Origin", "http://localhost");
      expect(result.status).toBe(200);
      expect(
        (await workflows.subscriptions(alice, 0)).subscriptions.some(
          (row) => row.tmdbId === "9007199254740993",
        ),
      ).toBe(false);
    });
    it("checks valid all-city availability on the server instead of trusting the client", async () => {
      await admin.pool.query(
        "INSERT INTO public.\"finalShowtimes\" (tmdb_id,screening_city,date_of_showing,showtime,cinema,english_href) VALUES (9200002,'Haifa','2026-10-20','20:00','Fixture Cinema','https://example.test/tickets')",
      );
      const result = await request(app)
        .post("/api/v1/ticket-alerts")
        .set("Cookie", "alice")
        .set("Origin", "http://localhost")
        .send({ tmdbId: "9200002" });
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual({ kind: "available" });
      expect((await workflows.subscriptions(alice, 0)).subscriptions).toEqual(
        [],
      );
    });
    it.each(["nowPlaying", "comingSoon"] as const)(
      "atomically merges an existing %s target",
      async (mode) => {
        const source = mode === "nowPlaying" ? 9200010 : 9200020,
          target = source + 1;
        if (mode === "nowPlaying") {
          await movie(source);
          await movie(target);
          await admin.pool.query(
            'INSERT INTO public."finalShowtimes" (tmdb_id) VALUES ($1)',
            [source],
          );
        } else {
          await soon(source);
          await soon(target);
        }
        expect(
          (
            await request(app)
              .post("/api/v1/admin/movie-corrections")
              .set("Cookie", "alice")
              .set("Origin", "http://localhost")
              .send(correction(mode, source, target))
          ).status,
        ).toBe(403);
        expect(
          await workflows.correct(owner, correction(mode, source, target)),
        ).toEqual({ changed: true });
        const table = mode === "nowPlaying" ? '"finalMovies"' : '"finalSoons"';
        expect(
          (
            await admin.pool.query(
              `SELECT tmdb_id FROM public.${table} WHERE tmdb_id=$1`,
              [source],
            )
          ).rows,
        ).toEqual([]);
        expect(
          (
            await admin.pool.query(
              'SELECT tmdb_id,title_fix FROM public."tableFixes" WHERE title_fix=$1',
              [String(source)],
            )
          ).rows,
        ).toEqual([{ tmdb_id: String(target), title_fix: String(source) }]);
        if (mode === "nowPlaying")
          expect(
            (
              await admin.pool.query(
                'SELECT tmdb_id,english_title FROM public."finalShowtimes" WHERE tmdb_id=$1',
                [target],
              )
            ).rows,
          ).toEqual([{ tmdb_id: target, english_title: "Correct title" }]);
      },
    );
    it.each(["nowPlaying", "comingSoon"] as const)(
      "flags a new %s target for external enrichment while preserving permanent codes and required dates",
      async (mode) => {
        const source = mode === "nowPlaying" ? 9200030 : 9200040,
          target = source + 1;
        if (mode === "nowPlaying") await movie(source);
        else await soon(source);
        await admin.pool.query(
          'INSERT INTO public."movieCodes" (tmdb_id,movie_code) VALUES ($1,$2)',
          [source, mode === "nowPlaying" ? "Q4a" : "Q4b"],
        );
        await workflows.correct(owner, correction(mode, source, target));
        const table = mode === "nowPlaying" ? '"finalMovies"' : '"finalSoons"';
        const row = (
          await admin.pool.query(
            `SELECT * FROM public.${table} WHERE tmdb_id=$1`,
            [target],
          )
        ).rows[0];
        expect(row.solo_update).toBe(true);
        expect(row.english_title).toBe("");
        if (mode === "comingSoon")
          expect(
            (
              await admin.pool.query(
                'SELECT release_date::text FROM public."finalSoons" WHERE tmdb_id=$1',
                [target],
              )
            ).rows[0].release_date,
          ).toBe("2026-11-01");
        expect(
          (
            await admin.pool.query(
              'SELECT tmdb_id FROM public."movieCodes" WHERE tmdb_id=$1',
              [source],
            )
          ).rowCount,
        ).toBe(1);
      },
    );
    it("rejects ambiguous coming-soon targets using their real UUID keys", async () => {
      await soon(9200050);
      await soon(9200051);
      await soon(9200051);
      await expect(
        workflows.correct(owner, correction("comingSoon", 9200050, 9200051)),
      ).rejects.toMatchObject({ status: 409, code: "ambiguous_movie" });
      expect(
        (
          await admin.pool.query(
            'SELECT id FROM public."finalSoons" WHERE tmdb_id=9200050',
          )
        ).rowCount,
      ).toBe(1);
    });
    it("rolls back the persistent fix and source mutation on a real late SQL constraint failure", async () => {
      await movie(9200098);
      await admin.pool.query(
        'INSERT INTO public."finalShowtimes" (tmdb_id) VALUES (9200098)',
      );
      await admin.pool.query(
        'ALTER TABLE public."finalShowtimes" ADD CONSTRAINT pr4_late_failure CHECK (tmdb_id <> 9200099) NOT VALID',
      );
      try {
        await expect(
          workflows.correct(owner, correction("nowPlaying", 9200098, 9200099)),
        ).rejects.toThrow();
        expect(
          (
            await admin.pool.query(
              'SELECT tmdb_id,solo_update FROM public."finalMovies" WHERE tmdb_id=9200098',
            )
          ).rows,
        ).toEqual([{ tmdb_id: 9200098, solo_update: false }]);
        expect(
          (
            await admin.pool.query(
              "SELECT id FROM public.\"tableFixes\" WHERE title_fix='9200098'",
            )
          ).rows,
        ).toEqual([]);
      } finally {
        await admin.pool.query(
          'ALTER TABLE public."finalShowtimes" DROP CONSTRAINT pr4_late_failure',
        );
      }
    });
  },
);
