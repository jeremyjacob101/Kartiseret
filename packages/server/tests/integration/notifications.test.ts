import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../src/db/client.js";
import { ProtectedWorkflows } from "../../src/protected/service.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { DEFAULT_TICKET_ALERT_CRITERIA } from "@kartiseret/contracts/private-data";

const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !["localhost", "127.0.0.1"].includes(new URL(target).hostname) ||
  new URL(target).pathname !== "/kartiseret_test"
)
  throw new Error(
    "Notification integration requires disposable local kartiseret_test.",
  );
const admin = createDatabase(target, { poolMax: 5 });
const runtime = createDatabase(process.env.DATABASE_URL!, { poolMax: 2 });
const user = {
  id: "00000000-0000-4000-8000-0000000000f1",
  email: "notifications@example.test",
  signupLocation: "Haifa",
};
const movie = 9400001;
const candidate = (
  city = "Jerusalem",
  mode = "first_any_city",
  type = "showtime",
) => ({
  user_id: user.id,
  tmdb_id: movie,
  event_type: type,
  scope_city: type === "coming_soon" ? "" : city,
  notification_mode: mode,
  status: "pending",
  event_payload: {
    title: "Tracked film",
    screening_city: city,
    cinema: "Cinema City",
    date_of_showing: "2027-01-02",
    showtime: "20:00",
    ticket_href: "https://tickets.example.test/1",
    release_date: "2027-01-01",
  },
});
const queue = (rows: ReturnType<typeof candidate>[]) =>
  admin.pool.query("select public.queue_movie_notifications($1::jsonb)", [
    JSON.stringify(rows),
  ]);
const claim = async () =>
  (
    await admin.pool.query(
      "select * from public.claim_movie_notification_delivery($1,$2)",
      [user.id, randomUUID()],
    )
  ).rows[0];
const events = async () =>
  (
    await admin.pool.query(
      "select * from public.movie_notification_events where user_id=$1 order by scope_city",
      [user.id],
    )
  ).rows;

describe.sequential("shared first availability notifications", () => {
  beforeAll(async () => {
    await admin.pool.query(
      "insert into app_auth.users(id,name,email,email_verified) values($1,'Notifications',$2,true)",
      [user.id, user.email],
    );
  });
  beforeEach(async () => {
    await admin.pool.query(
      "delete from public.movie_notification_events where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "delete from public.movie_notification_deliveries where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "delete from public.ticket_alert_subscriptions where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "delete from public.coming_soon_date_watches where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "delete from public.letterboxd_sources where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "delete from public.ticket_alert_preferences where user_id=$1",
      [user.id],
    );
    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [user.id, movie],
    );
  });
  afterAll(async () => {
    await admin.pool.query("delete from app_auth.users where id=$1", [user.id]);
    await Promise.all([admin.close(), runtime.close()]);
  });
  it("collapses migrated sessions, preserves sent/baseline history, and retires uncertain attempts", async () => {
    const migrated = (
      await admin.pool.query(
        "select tmdb_id,event_type,scope_city,status from public.movie_notification_events where user_id='00000000-0000-4000-8000-0000000000e1' order by tmdb_id",
      )
    ).rows;
    expect(migrated).toEqual([
      {
        tmdb_id: "9300001",
        event_type: "showtime",
        scope_city: "Jerusalem",
        status: "sent",
      },
      {
        tmdb_id: "9300002",
        event_type: "showtime",
        scope_city: "Haifa",
        status: "suppressed",
      },
      {
        tmdb_id: "9300003",
        event_type: "showtime",
        scope_city: "Haifa",
        status: "suppressed",
      },
      {
        tmdb_id: "9300005",
        event_type: "coming_soon",
        scope_city: "",
        status: "sent",
      },
    ]);
    const legacy = await admin.pool.query(
      "select criteria_overrides from public.ticket_alert_subscriptions where user_id='00000000-0000-4000-8000-0000000000e1' and tmdb_id=9300001",
    );
    expect(legacy.rows[0].criteria_overrides).toEqual({
      filters: { screenFormat: ["3D"] },
    });
    expect(
      (
        await admin.pool.query(
          "select count(*) from public.letterboxd_event_alerts where user_id='00000000-0000-4000-8000-0000000000e1' and status='pending'",
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await admin.pool.query(
          "select count(*) from public.letterboxd_event_alerts where user_id='00000000-0000-4000-8000-0000000000e1' and status='sent'",
        )
      ).rows[0].count,
    ).toBe("2");
  });
  it("atomically closes any-city alerts after the first scope and deduplicates concurrent claims", async () => {
    await Promise.all([
      queue([candidate(), candidate("Haifa")]),
      queue([candidate(), candidate("Haifa")]),
    ]);
    expect(await events()).toHaveLength(1);
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.id).toBe(b.id);
    expect(a.events).toHaveLength(1);
    await admin.pool.query(
      "select public.complete_movie_notification_delivery($1,'sent')",
      [a.id],
    );
    const changed = candidate("Haifa");
    changed.event_payload.date_of_showing = "2027-01-09";
    changed.event_payload.ticket_href = "https://tickets.test/new";
    await queue([changed]);
    expect((await events()).map((e) => e.status)).toEqual(["sent"]);
    expect(await claim()).toBeUndefined();
  });
  it("supports per-city progress, mode changes, and newly selected cities without repeating a city", async () => {
    await queue([candidate()]);
    const first = await claim();
    await admin.pool.query(
      "select public.complete_movie_notification_delivery($1,'sent')",
      [first.id],
    );
    await queue([
      candidate("Jerusalem", "first_per_city"),
      candidate("Haifa", "first_per_city"),
    ]);
    const second = await claim();
    expect(second.events).toHaveLength(1);
    expect(second.events[0].event_payload.screening_city).toBe("Haifa");
    await admin.pool.query(
      "select public.complete_movie_notification_delivery($1,'sent-2')",
      [second.id],
    );
    await queue([
      candidate("Jerusalem", "first_per_city"),
      candidate("Haifa", "first_per_city"),
    ]);
    expect(await claim()).toBeUndefined();
  });
  it("narrows unclaimed per-city scopes when the user switches to any-city mode", async () => {
    await queue([
      candidate("Jerusalem", "first_per_city"),
      candidate("Haifa", "first_per_city"),
    ]);
    await queue([candidate("Jerusalem"), candidate("Haifa")]);
    const batch = await claim();
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0].event_payload.screening_city).toBe("Jerusalem");
  });
  it("reconciles unclaimed scopes when selected criteria change", async () => {
    await queue([candidate()]);
    await queue([candidate("Haifa")]);
    expect((await events()).map((e) => [e.scope_city, e.status])).toEqual([
      ["Haifa", "pending"],
      ["Jerusalem", "cancelled"],
    ]);
  });
  it("keeps the complete provider payload immutable across retries and expires uncertain old attempts", async () => {
    await queue([candidate()]);
    const batch = await claim();
    const snapshot = {
      subject: "Original",
      recipient: "original@example.test",
      html: "Original",
      text: "Original",
      from: "alerts@example.test",
    };
    const start = async (body: object) =>
      (
        await admin.pool.query(
          "select * from public.start_movie_notification_delivery($1,$2::jsonb)",
          [batch.id, JSON.stringify(body)],
        )
      ).rows;
    expect((await start(snapshot))[0].email_snapshot).toEqual(snapshot);
    expect(
      (await start({ ...snapshot, subject: "Changed" }))[0].email_snapshot,
    ).toEqual(snapshot);
    await admin.pool.query(
      "update public.movie_notification_deliveries set first_attempt_at=now()-interval '24 hours' where id=$1",
      [batch.id],
    );
    expect(await start(snapshot)).toEqual([]);
    expect((await events())[0].status).toBe("suppressed");
    await queue([candidate()]);
    expect(await claim()).toBeUndefined();
  });
  it("shares history across watch sources and cancels only after the last relevant watch is removed", async () => {
    const source = (
      await admin.pool.query(
        "insert into public.letterboxd_sources(user_id,source_url,source_type) values($1,'https://letterboxd.com/fixture/watchlist/','watchlist') returning id",
        [user.id],
      )
    ).rows[0];
    await admin.pool.query(
      "insert into public.letterboxd_source_films(source_id,user_id,letterboxd_slug,title,tmdb_id,needs_baseline) values($1,$2,'film','Film',$3,false)",
      [source.id, user.id, movie],
    );
    await queue([candidate()]);
    const batch = await claim();
    await admin.pool.query(
      "delete from public.ticket_alert_subscriptions where user_id=$1",
      [user.id],
    );
    expect((await events())[0].status).toBe("pending");
    await admin.pool.query(
      "delete from public.letterboxd_sources where id=$1",
      [source.id],
    );
    expect((await events())[0].status).toBe("cancelled");
    expect(
      (
        await admin.pool.query(
          "select status from public.movie_notification_deliveries where id=$1",
          [batch.id],
        )
      ).rows[0].status,
    ).toBe("cancelled");
  });
  it("keeps date watches independent and sends date and showtime events in one batch", async () => {
    await admin.pool.query(
      "insert into public.coming_soon_date_watches(user_id,tmdb_id,title) values($1,$2,'Film')",
      [user.id, movie],
    );
    await queue([candidate(), candidate("", "first_any_city", "coming_soon")]);
    const batch = await claim();
    expect(batch.events).toHaveLength(2);
    await admin.pool.query(
      "select public.complete_movie_notification_delivery($1,'mixed')",
      [batch.id],
    );
    const changed = candidate("", "first_any_city", "coming_soon");
    changed.event_payload.release_date = "2027-02-01";
    await queue([changed]);
    expect(await claim()).toBeUndefined();
    expect(
      (
        await admin.pool.query(
          "select notified_at from public.coming_soon_date_watches where user_id=$1",
          [user.id],
        )
      ).rows[0].notified_at,
    ).toBeTruthy();
  });
  it("exposes completed cities to the owner and denies client mutation of delivery history", async () => {
    await queue([candidate()]);
    const batch = await claim();
    await admin.pool.query(
      "select public.complete_movie_notification_delivery($1,'sent')",
      [batch.id],
    );
    const workflows = new ProtectedWorkflows(
      runtime.db,
      new DrizzleCatalogRepository(runtime.db),
    );
    expect(
      (await workflows.subscriptions(user, 0)).subscriptions[0].completedCities,
    ).toEqual(["Jerusalem"]);
    const client = await runtime.pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role kartiseret_runtime");
      await client.query("select set_config('app.user_id',$1,true)", [user.id]);
      await expect(
        client.query("select public.queue_movie_notifications('[]')"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("allows a per-city manual watch when only some selected cities already have tickets", async () => {
    await admin.pool.query(
      "delete from public.ticket_alert_subscriptions where user_id=$1",
      [user.id],
    );
    const workflows = new ProtectedWorkflows(
      runtime.db,
      new DrizzleCatalogRepository(runtime.db),
      () => new Date("2026-10-21T12:00:00Z"),
    );
    await workflows.patchTicketAlertPreferences(user, {
      ...DEFAULT_TICKET_ALERT_CRITERIA,
      cities: ["Haifa", "Jerusalem"],
      notificationMode: "first_per_city",
    });
    await admin.pool.query(
      "insert into public.\"finalShowtimes\"(tmdb_id,english_title,screening_city,cinema,date_of_showing,showtime,english_href) values($1,'Film','Haifa','Cinema','2026-10-22','20:00','https://tickets.test/haifa')",
      [movie],
    );
    try {
      expect((await workflows.subscribe(user, String(movie))).kind).toBe(
        "account",
      );
      expect(
        (
          await admin.pool.query(
            "select baseline_cities from public.ticket_alert_subscriptions where user_id=$1",
            [user.id],
          )
        ).rows[0].baseline_cities,
      ).toEqual(["Haifa"]);
    } finally {
      await admin.pool.query(
        'delete from public."finalShowtimes" where tmdb_id=$1',
        [movie],
      );
    }
  });
});
