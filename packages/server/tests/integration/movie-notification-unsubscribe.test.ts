import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createDatabase } from "../../src/db/client.js";

const target = process.env.TEST_DATABASE_URL;
if (
  !target ||
  !["localhost", "127.0.0.1"].includes(new URL(target).hostname) ||
  new URL(target).pathname !== "/kartiseret_test"
)
  throw new Error(
    "Movie notification unsubscribe integration requires disposable local kartiseret_test.",
  );

const admin = createDatabase(target, { poolMax: 4 });
const runtime = createDatabase(process.env.DATABASE_URL!, { poolMax: 2 });
const userId = "00000000-0000-4000-8000-0000000000f7";
const otherUserId = "00000000-0000-4000-8000-0000000000f8";
const filmA = 9410001;
const filmB = 9410002;
const filmC = 9410003;

const ticket = (tmdbId: number) => ({
  user_id: userId,
  tmdb_id: tmdbId,
  event_type: "showtime",
  scope_city: "Jerusalem",
  notification_mode: "first_any_city",
  status: "pending",
  event_payload: {
    title: `Film ${tmdbId}`,
    screening_city: "Jerusalem",
    cinema: "Cinema City",
    date_of_showing: "2027-01-02",
    showtime: "20:00",
    ticket_href: "https://tickets.example.test/ticket",
  },
});
const date = (tmdbId: number) => ({
  user_id: userId,
  tmdb_id: tmdbId,
  event_type: "coming_soon",
  scope_city: "",
  status: "pending",
  event_payload: {
    title: `Film ${tmdbId}`,
    release_date: "2027-01-01",
  },
});

async function addSource(
  owner: string,
  suffix: string,
  tmdbIds: number[],
): Promise<string> {
  const id = randomUUID();
  const url = `https://letterboxd.com/fixture${suffix}/watchlist/`;
  await admin.pool.query(
    "insert into public.letterboxd_sources(id,user_id,source_url,source_type) values($1,$2,$3,'watchlist')",
    [id, owner, url],
  );
  for (const tmdbId of tmdbIds) {
    await admin.pool.query(
      `insert into public.letterboxd_source_films
         (source_id,user_id,letterboxd_slug,title,tmdb_id,needs_baseline)
       values($1,$2,$3,$4,$5,false)`,
      [id, owner, `film-${tmdbId}`, `Film ${tmdbId}`, tmdbId],
    );
  }
  return id;
}

async function queueAndClaim(rows: object[]) {
  await admin.pool.query("select public.queue_movie_notifications($1::jsonb)", [
    JSON.stringify(rows),
  ]);
  const result = await admin.pool.query(
    "select * from public.claim_movie_notification_delivery($1,$2)",
    [userId, randomUUID()],
  );
  return result.rows[0] as { id: string; events: unknown[] };
}

async function addToken(
  deliveryId: string,
  purpose: "manage_letterboxd" | "one_click_all",
) {
  const tokenHash = randomBytes(32);
  await admin.pool.query(
    `insert into app_auth.movie_notification_unsubscribe_tokens
       (user_id,delivery_id,purpose,token_hash,expires_at)
     values($1,$2,$3,$4,statement_timestamp()+interval '180 days')`,
    [userId, deliveryId, purpose, tokenHash],
  );
  return tokenHash;
}

async function addHistoricalToken(
  purpose: "manage_letterboxd" | "one_click_all",
) {
  const deliveryId = randomUUID();
  await admin.pool.query(
    `insert into public.movie_notification_deliveries(id,user_id,events,status)
     values($1,$2,'[]'::jsonb,'cancelled')`,
    [deliveryId, userId],
  );
  return addToken(deliveryId, purpose);
}

describe.sequential("movie notification unsubscribe database behavior", () => {
  beforeAll(async () => {
    await admin.pool.query(
      `insert into app_auth.users(id,name,email,email_verified) values
       ($1,'Unsubscribe test','unsubscribe-test@example.test',true),
       ($2,'Other unsubscribe test','other-unsubscribe-test@example.test',true)`,
      [userId, otherUserId],
    );
  });

  beforeEach(async () => {
    await admin.pool.query(
      "delete from public.movie_notification_events where user_id=$1",
      [userId],
    );
    await admin.pool.query(
      "delete from public.movie_notification_deliveries where user_id=$1",
      [userId],
    );
    await admin.pool.query(
      "delete from public.ticket_alert_subscriptions where user_id=$1",
      [userId],
    );
    await admin.pool.query(
      "delete from public.coming_soon_date_watches where user_id=$1",
      [userId],
    );
    await admin.pool.query(
      "delete from public.letterboxd_sources where user_id=any($1::uuid[])",
      [[userId, otherUserId]],
    );
    await admin.pool.query(
      "delete from public.movie_notification_events where user_id=$1",
      [otherUserId],
    );
    await admin.pool.query(
      "delete from public.movie_notification_deliveries where user_id=$1",
      [otherUserId],
    );
  });

  afterAll(async () => {
    await admin.pool.query(
      "delete from app_auth.users where id=any($1::uuid[])",
      [[userId, otherUserId]],
    );
    await Promise.all([admin.close(), runtime.close()]);
  });

  it("removes selected Letterboxd lists and preserves overlapping manual support", async () => {
    const overlapOne = await addSource(userId, "-overlap-a", [filmA]);
    const overlapTwo = await addSource(userId, "-overlap-b", [filmA]);
    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [userId, filmA],
    );
    const batch = await queueAndClaim([ticket(filmA)]);
    const tokenHash = await addToken(batch.id, "manage_letterboxd");

    const current = await runtime.pool.query(
      "select * from app_auth.movie_notification_unsubscribe_sources($1)",
      [tokenHash],
    );
    expect(current.rows.map((row) => row.id).sort()).toEqual(
      [overlapOne, overlapTwo].sort(),
    );

    const removed = await runtime.pool.query(
      "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[]) as removed",
      [tokenHash, [overlapOne]],
    );
    expect(removed.rows[0].removed).toHaveLength(1);
    const survivingSources = await admin.pool.query(
      "select id from public.letterboxd_sources where user_id=$1",
      [userId],
    );
    expect(survivingSources.rows.map((row) => row.id)).toEqual([overlapTwo]);
    const pending = await admin.pool.query(
      "select status,delivery_id from public.movie_notification_events where user_id=$1 and tmdb_id=$2",
      [userId, filmA],
    );
    expect(pending.rows[0]).toEqual({
      status: "pending",
      delivery_id: batch.id,
    });
  });

  it("retires an unattempted mixed digest but releases still-supported events", async () => {
    const overlapping = await addSource(userId, "-overlap", [filmA]);
    const removable = await addSource(userId, "-only", [filmB]);
    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [userId, filmA],
    );
    await admin.pool.query(
      "insert into public.coming_soon_date_watches(user_id,tmdb_id,title) values($1,$2,'Film C')",
      [userId, filmC],
    );
    const batch = await queueAndClaim([
      ticket(filmA),
      ticket(filmB),
      date(filmC),
    ]);
    const tokenHash = await addToken(batch.id, "manage_letterboxd");

    await runtime.pool.query(
      "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[])",
      [tokenHash, [overlapping, removable]],
    );

    const statuses = await admin.pool.query(
      "select tmdb_id,event_type,status,delivery_id from public.movie_notification_events where user_id=$1 order by tmdb_id,event_type",
      [userId],
    );
    expect(statuses.rows).toEqual([
      {
        tmdb_id: String(filmA),
        event_type: "showtime",
        status: "pending",
        delivery_id: null,
      },
      {
        tmdb_id: String(filmB),
        event_type: "showtime",
        status: "cancelled",
        delivery_id: null,
      },
      {
        tmdb_id: String(filmC),
        event_type: "coming_soon",
        status: "pending",
        delivery_id: null,
      },
    ]);
    const delivery = await admin.pool.query(
      "select status from public.movie_notification_deliveries where id=$1",
      [batch.id],
    );
    expect(delivery.rows[0].status).toBe("cancelled");

    const repeated = await runtime.pool.query(
      "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[]) as removed",
      [tokenHash, [overlapping, removable]],
    );
    expect(repeated.rows[0].removed).toEqual([]);
    const foreignSource = await addSource(otherUserId, "-foreign", [filmA]);
    await expect(
      runtime.pool.query(
        "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[])",
        [tokenHash, [foreignSource]],
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("one-click removes every current alert, revokes old links, and is idempotent", async () => {
    await addSource(userId, "-all", [filmA]);
    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [userId, filmA],
    );
    await admin.pool.query(
      "insert into public.coming_soon_date_watches(user_id,tmdb_id,title) values($1,$2,'Film C')",
      [userId, filmC],
    );
    const batch = await queueAndClaim([ticket(filmA), date(filmC)]);
    const current = await addToken(batch.id, "one_click_all");
    const oldManager = await addHistoricalToken("manage_letterboxd");
    const oldOneClick = await addHistoricalToken("one_click_all");

    const result = await runtime.pool.query(
      "select app_auth.unsubscribe_all_movie_notifications($1) as unsubscribed",
      [current],
    );
    expect(result.rows[0].unsubscribed).toBe(true);
    const watches = await admin.pool.query(
      `select
         (select count(*) from public.letterboxd_sources where user_id=$1) as sources,
         (select count(*) from public.ticket_alert_subscriptions where user_id=$1) as tickets,
         (select count(*) from public.coming_soon_date_watches where user_id=$1) as dates`,
      [userId],
    );
    expect(watches.rows[0]).toEqual({ sources: "0", tickets: "0", dates: "0" });
    const tokenState = await admin.pool.query(
      `select token_hash,revoked_at,consumed_at
       from app_auth.movie_notification_unsubscribe_tokens
       where user_id=$1 order by created_at`,
      [userId],
    );
    expect(
      tokenState.rows.find((row) => row.token_hash.equals(current))
        ?.consumed_at,
    ).not.toBeNull();
    expect(
      tokenState.rows.find((row) => row.token_hash.equals(oldManager))
        ?.revoked_at,
    ).not.toBeNull();
    expect(
      tokenState.rows.find((row) => row.token_hash.equals(oldOneClick))
        ?.revoked_at,
    ).not.toBeNull();

    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [userId, filmB],
    );
    const repeated = await runtime.pool.query(
      "select app_auth.unsubscribe_all_movie_notifications($1) as unsubscribed",
      [current],
    );
    expect(repeated.rows[0].unsubscribed).toBe(true);
    const newlyAdded = await admin.pool.query(
      "select count(*) from public.ticket_alert_subscriptions where user_id=$1",
      [userId],
    );
    expect(newlyAdded.rows[0].count).toBe("1");
    await expect(
      runtime.pool.query(
        "select * from app_auth.movie_notification_unsubscribe_sources($1)",
        [oldManager],
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("suppresses still-supported events from an attempted mixed delivery", async () => {
    const overlapping = await addSource(userId, "-attempted-overlap", [filmA]);
    const removable = await addSource(userId, "-attempted-only", [filmB]);
    await admin.pool.query(
      "insert into public.ticket_alert_subscriptions(user_id,tmdb_id) values($1,$2)",
      [userId, filmA],
    );
    const batch = await queueAndClaim([ticket(filmA), ticket(filmB)]);
    const tokenHash = await addToken(batch.id, "manage_letterboxd");
    await admin.pool.query(
      "select * from public.start_movie_notification_delivery($1,$2::jsonb)",
      [
        batch.id,
        JSON.stringify({
          subject: "immutable",
          html: "<p>old</p>",
          text: "old",
        }),
      ],
    );

    await runtime.pool.query(
      "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[])",
      [tokenHash, [removable]],
    );

    const events = await admin.pool.query(
      "select tmdb_id,status,delivery_id from public.movie_notification_events where user_id=$1 order by tmdb_id",
      [userId],
    );
    expect(events.rows).toEqual([
      { tmdb_id: String(filmA), status: "suppressed", delivery_id: null },
      { tmdb_id: String(filmB), status: "cancelled", delivery_id: null },
    ]);
    const delivery = await admin.pool.query(
      "select status,attempts,email_snapshot from public.movie_notification_deliveries where id=$1",
      [batch.id],
    );
    expect(delivery.rows[0]).toMatchObject({
      status: "cancelled",
      attempts: 1,
      email_snapshot: { subject: "immutable", html: "<p>old</p>", text: "old" },
    });
    expect(
      await admin.pool.query(
        "select id from public.letterboxd_sources where id=$1",
        [overlapping],
      ),
    ).toMatchObject({ rows: [{ id: overlapping }] });
  });

  it("rejects stale collection results and wrong-purpose or expired credentials", async () => {
    const sourceId = await addSource(userId, "-stale", [filmA]);
    const batch = await queueAndClaim([ticket(filmA)]);
    const manager = await addToken(batch.id, "manage_letterboxd");
    const oneClick = await addToken(batch.id, "one_click_all");

    await expect(
      runtime.pool.query(
        "select * from app_auth.movie_notification_unsubscribe_sources($1)",
        [oneClick],
      ),
    ).rejects.toMatchObject({ code: "22023" });
    await runtime.pool.query(
      "select app_auth.remove_movie_notification_letterboxd_sources($1,$2::uuid[])",
      [manager, [sourceId]],
    );
    await admin.pool.query(
      "select public.queue_movie_notifications($1::jsonb)",
      [JSON.stringify([ticket(filmA)])],
    );
    const staleEvents = await admin.pool.query(
      "select id from public.movie_notification_events where user_id=$1 and tmdb_id=$2 and status='pending'",
      [userId, filmA],
    );
    expect(staleEvents.rows).toEqual([]);

    await admin.pool.query(
      `update app_auth.movie_notification_unsubscribe_tokens
       set created_at=statement_timestamp()-interval '181 days',
           expires_at=statement_timestamp()-interval '1 second'
       where token_hash=$1`,
      [manager],
    );
    await expect(
      runtime.pool.query(
        "select * from app_auth.movie_notification_unsubscribe_sources($1)",
        [manager],
      ),
    ).rejects.toMatchObject({ code: "22023" });
  });

  it("serializes unsubscribe with delivery start", async () => {
    await addSource(userId, "-race", [filmA]);
    const batch = await queueAndClaim([ticket(filmA)]);
    const tokenHash = await addToken(batch.id, "one_click_all");
    const [started] = await Promise.all([
      admin.pool.query(
        "select * from public.start_movie_notification_delivery($1,$2::jsonb)",
        [batch.id, JSON.stringify({ subject: "race", html: "", text: "" })],
      ),
      runtime.pool.query(
        "select app_auth.unsubscribe_all_movie_notifications($1)",
        [tokenHash],
      ),
    ]);
    expect(
      started.rows.length === 0 || started.rows[0].status === "pending",
    ).toBe(true);
    const finalDelivery = await admin.pool.query(
      "select status from public.movie_notification_deliveries where id=$1",
      [batch.id],
    );
    expect(finalDelivery.rows[0].status).toBe("cancelled");
  });
});
