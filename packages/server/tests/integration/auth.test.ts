import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { toNodeHandler } from "better-auth/node";
import { createEmailVerificationToken } from "better-auth/api";
import { createApplicationAuth } from "../../src/auth/auth.js";
import type { AuthEmail } from "../../src/auth/mail.js";
import { createRecipientRouter } from "../../src/auth/recipients.js";
import { BetterAuthIdentityVerifier } from "../../src/protected/identity.js";
import { createDatabase } from "../../src/db/client.js";
import { ProtectedWorkflows } from "../../src/protected/service.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { createApp } from "../../src/app.js";

const adminUrl = process.env.TEST_DATABASE_URL,
  runtimeUrl = process.env.DATABASE_URL;
if (
  !adminUrl ||
  !runtimeUrl ||
  [adminUrl, runtimeUrl].some((value) => {
    const url = new URL(value);
    return (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/kartiseret_test"
    );
  })
)
  throw new Error(
    "Auth integration requires disposable local kartiseret_test.",
  );
const admin = createDatabase(adminUrl, { poolMax: 3 });
const runtime = createDatabase(runtimeUrl, { poolMax: 3 });
const origin = "http://localhost";
const secret = "integration-auth-secret-at-least-32-characters";
const internalSecret = "integration-internal-secret-at-least-32-characters";
const captured: AuthEmail[] = [];
const auth = createApplicationAuth(runtime.pool, {
  baseURL: origin,
  secret,
  cookiePrefix: "integration",
  trustedOrigins: [origin],
  mailer: async (email) => {
    captured.push(email);
  },
});
const repository = new DrizzleCatalogRepository(runtime.db);
const app = createApp({
  catalogRepository: repository,
  publicDataRepository: repository,
  authHandler: toNodeHandler(auth),
  identityVerifier: new BetterAuthIdentityVerifier(auth),
  protectedWorkflows: new ProtectedWorkflows(runtime.db, repository),
  recipientRouter: createRecipientRouter(runtime.pool, internalSecret),
  trustedOrigins: [origin],
});
const email = "pr5-auth@example.test",
  password = "first-password-123";
let cookie = "",
  userId = "";
let requestIp = 1;
function post(path: string, body: object, session = "") {
  const req = request(app)
    .post(path)
    .set("Origin", origin)
    .set("X-Forwarded-For", `192.0.2.${requestIp++}`);
  if (session) req.set("Cookie", session);
  return req.send(body);
}
function cookies(response: request.Response) {
  const values = response.headers["set-cookie"] as unknown as
    string[] | undefined;
  return (values ?? []).map((value) => value.split(";")[0]).join("; ");
}
function latest(kind: AuthEmail["kind"], to = email) {
  const message = captured.findLast(
    (item) => item.kind === kind && item.to === to,
  );
  if (!message) throw new Error("Expected captured auth email.");
  return new URL(message.url);
}
function signup(to: string) {
  return post("/api/auth/sign-up/email", {
    name: "Test member",
    email: to,
    password,
    signupLocation: "Haifa",
    callbackURL: `${origin}/?verified=1`,
  });
}
async function login(to = email, value = password) {
  const response = await post("/api/auth/sign-in/email", {
    email: to,
    password: value,
  });
  expect(response.status).toBe(200);
  return cookies(response);
}

describe.sequential(
  "real Better Auth, Drizzle and restricted PostgreSQL",
  () => {
    beforeAll(async () => {
      await runtime.pool.query("SELECT 1");
    });
    afterAll(async () => {
      await admin.pool.query(
        "DROP TRIGGER IF EXISTS pr5_reject_account ON app_auth.accounts; DROP FUNCTION IF EXISTS app_auth.pr5_reject_account()",
      );
      await admin.pool.query(
        "DELETE FROM app_auth.users WHERE email LIKE 'pr5-%@example.test' OR email='legacy@example.test'",
      );
      await admin.pool.query(
        "DELETE FROM app_auth.verifications WHERE value=$1",
        [userId],
      );
      await Promise.all([admin.close(), runtime.close()]);
    });
    it("upgrades existing UUID references without importing passwords/sessions and isolates auth tables", async () => {
      expect(
        (
          await admin.pool.query(
            `SELECT rating_sources,location,site_color FROM public."userPreferences" WHERE user_id='00000000-0000-4000-8000-0000000000c1'`,
          )
        ).rows[0],
      ).toEqual({
        rating_sources: [],
        location: "Raanana",
        site_color: "#123456",
      });
      expect(
        (
          await admin.pool.query(
            "SELECT delivery_id,notified_at IS NOT NULL AS notified FROM public.ticket_alert_subscriptions WHERE user_id='00000000-0000-4000-8000-0000000000c1'",
          )
        ).rows[0],
      ).toEqual({
        delivery_id: "00000000-0000-4000-8000-0000000000d1",
        notified: true,
      });
      const legacy = (
        await admin.pool.query(
          "SELECT u.id,u.email_verified,a.user_id FROM app_auth.users u JOIN public.admin_users a ON a.user_id=u.id WHERE u.email='legacy@example.test'",
        )
      ).rows;
      expect(legacy).toEqual([
        {
          id: "00000000-0000-4000-8000-0000000000c1",
          email_verified: true,
          user_id: "00000000-0000-4000-8000-0000000000c1",
        },
      ]);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM app_auth.accounts a WHERE a.user_id=$1",
            [legacy[0].id],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND confrelid='auth.users'::regclass",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await admin.pool.query(
            "SELECT has_schema_privilege('anon','app_auth','USAGE') AS anon, has_schema_privilege('authenticated','app_auth','USAGE') AS browser",
          )
        ).rows[0],
      ).toEqual({ anon: false, browser: false });
      await expect(
        runtime.pool.query("SELECT * FROM auth.users"),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        runtime.pool.query(
          "INSERT INTO public.admin_users(user_id) VALUES (gen_random_uuid())",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("requires verification, persists real credentials and rejects an expired verification token", async () => {
      const created = await signup(email);
      expect(created.status).toBe(200);
      userId = created.body.user.id;
      const signupVerification = latest("verification");
      expect(created.body.token).toBeNull();
      expect(
        (await post("/api/auth/sign-in/email", { email, password })).status,
      ).toBe(403);
      const expired = await createEmailVerificationToken(
        secret,
        email,
        undefined,
        -1,
      );
      const denied = await request(app).get(
        `/api/auth/verify-email?token=${encodeURIComponent(expired)}`,
      );
      expect(denied.status).toBeGreaterThanOrEqual(400);
      const url = signupVerification;
      const confirmed = await request(app).get(url.pathname + url.search);
      expect(confirmed.status).toBe(302);
      expect(confirmed.headers.location).toBe(`${origin}/?verified=1`);
      const replay = await request(app).get(url.pathname + url.search);
      expect(replay.status).toBe(302);
      expect(replay.headers["set-cookie"]).toBeUndefined(); // Verified replay is an idempotent no-op, never a sign-in.
      cookie = await login();
      expect(cookie).toContain("integration.session_token=");
      const result = await request(app)
        .get("/api/v1/account")
        .set("Cookie", cookie);
      expect(result.body.data.user).toEqual({ id: userId, email });
      expect(result.headers.vary).toContain("Cookie");
      expect(result.headers["cache-control"]).toBe("no-store");
      const preference = await request(app)
        .get("/api/v1/preferences")
        .set("Cookie", cookie);
      expect(preference.body.data.location).toBe("Haifa");
    });
    it("keeps real cookie accounts isolated across preferences, alerts and admin commands", async () => {
      const otherEmail = "pr5-other@example.test";
      expect((await signup(otherEmail)).status).toBe(200);
      const link = latest("verification", otherEmail);
      expect((await request(app).get(link.pathname + link.search)).status).toBe(
        302,
      );
      const other = await login(otherEmail);
      const changed = await request(app)
        .patch("/api/v1/preferences")
        .set("Cookie", other)
        .set("Origin", origin)
        .send({ location: "Tel Aviv" });
      expect(changed.status).toBe(200);
      expect(
        (await request(app).get("/api/v1/preferences").set("Cookie", cookie))
          .body.data.location,
      ).toBe("Haifa");
      expect(
        (
          await request(app)
            .patch("/api/v1/preferences")
            .set("Cookie", other)
            .set("Origin", origin)
            .send({ userId, location: "Haifa" })
        ).status,
      ).toBe(400);
      expect(
        (await post("/api/v1/ticket-alerts", { tmdbId: "9100011" }, cookie))
          .status,
      ).toBe(200);
      expect(
        (await request(app).get("/api/v1/ticket-alerts").set("Cookie", other))
          .body.data.subscriptions,
      ).toEqual([]);
      expect(
        (
          await request(app)
            .delete("/api/v1/ticket-alerts/9100011")
            .set("Cookie", other)
            .set("Origin", origin)
        ).status,
      ).toBe(200);
      expect(
        (await request(app).get("/api/v1/ticket-alerts").set("Cookie", cookie))
          .body.data.subscriptions,
      ).toHaveLength(1);
      expect(
        (
          await post(
            "/api/v1/admin/movie-corrections",
            {
              mode: "nowPlaying",
              currentTmdbId: "9100001",
              selectedTmdbId: "9100001",
              isManualEntry: true,
            },
            other,
          )
        ).status,
      ).toBe(403);
    });
    it("denies old bearer tokens, fabricated cookies, cross-origin writes and unsafe callbacks", async () => {
      expect(
        (
          await request(app)
            .get("/api/v1/account")
            .set("Authorization", "Bearer old-supabase-token")
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .get("/api/v1/account")
            .set("Cookie", "integration.session_token=fabricated")
        ).status,
      ).toBe(401);
      expect(
        (
          await request(app)
            .patch("/api/v1/preferences")
            .set("Cookie", cookie)
            .set("Origin", "https://evil.test")
            .send({ location: "Haifa" })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .patch("/api/v1/preferences")
            .set("Cookie", cookie)
            .send({ location: "Haifa" })
        ).status,
      ).toBe(403);
      expect(
        (
          await post("/api/auth/request-password-reset", {
            email,
            redirectTo: "https://evil.test/reset",
          })
        ).status,
      ).toBe(403);
      expect(
        (await request(app).get("/api/v1/catalog/now-playing")).status,
      ).toBe(200);
    });
    it("rolls back a late credential failure during real signup", async () => {
      await admin.pool.query(
        `CREATE FUNCTION app_auth.pr5_reject_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM app_auth.users WHERE id=NEW.user_id AND email='pr5-rollback@example.test') THEN RAISE EXCEPTION 'controlled account write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pr5_reject_account BEFORE INSERT ON app_auth.accounts FOR EACH ROW EXECUTE FUNCTION app_auth.pr5_reject_account()`,
      );
      try {
        expect(
          (await signup("pr5-rollback@example.test")).status,
        ).toBeGreaterThanOrEqual(400);
        expect(
          (
            await admin.pool.query(
              "SELECT count(*)::int AS count FROM app_auth.users WHERE email='pr5-rollback@example.test'",
            )
          ).rows[0].count,
        ).toBe(0);
      } finally {
        await admin.pool.query(
          "DROP TRIGGER pr5_reject_account ON app_auth.accounts; DROP FUNCTION app_auth.pr5_reject_account()",
        );
      }
    });
    it("requires the current password for changes and revokes other sessions", async () => {
      const second = await login();
      expect(
        (
          await post(
            "/api/auth/change-password",
            {
              currentPassword: "incorrect",
              newPassword: "changed-password-123",
              revokeOtherSessions: true,
            },
            cookie,
          )
        ).status,
      ).toBe(400);
      const changed = await post(
        "/api/auth/change-password",
        {
          currentPassword: password,
          newPassword: "changed-password-123",
          revokeOtherSessions: true,
        },
        cookie,
      );
      expect(changed.status).toBe(200);
      cookie = cookies(changed) || cookie;
      expect(
        (await request(app).get("/api/v1/account").set("Cookie", second))
          .status,
      ).toBe(401);
    });
    it("rolls back reset-token consumption and session revocation on failure, then consumes the token once", async () => {
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin}/reset-password`,
      });
      const url = latest("reset"),
        token = url.pathname.split("/").at(-1)!;
      const callback = await request(app).get(url.pathname + url.search);
      expect(callback.status).toBe(302);
      expect(callback.headers.location).toContain(
        `/reset-password?token=${token}`,
      );
      await admin.pool.query(
        `CREATE FUNCTION app_auth.pr5_reject_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.user_id='${userId}'::uuid THEN RAISE EXCEPTION 'controlled password write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER pr5_reject_account BEFORE UPDATE ON app_auth.accounts FOR EACH ROW EXECUTE FUNCTION app_auth.pr5_reject_account()`,
      );
      try {
        expect(
          (
            await post("/api/auth/reset-password", {
              token,
              newPassword: "reset-password-123",
            })
          ).status,
        ).toBeGreaterThanOrEqual(400);
        expect(
          (await request(app).get("/api/v1/account").set("Cookie", cookie))
            .status,
        ).toBe(200);
        expect(
          (
            await admin.pool.query(
              "SELECT count(*)::int AS count FROM app_auth.verifications WHERE identifier=$1",
              [`reset-password:${token}`],
            )
          ).rows[0].count,
        ).toBe(1);
      } finally {
        await admin.pool.query(
          "DROP TRIGGER pr5_reject_account ON app_auth.accounts; DROP FUNCTION app_auth.pr5_reject_account()",
        );
      }
      expect(
        (
          await post("/api/auth/reset-password", {
            token,
            newPassword: "reset-password-123",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post("/api/auth/reset-password", {
            token,
            newPassword: "another-password-123",
          })
        ).status,
      ).toBe(400);
      expect(
        (await request(app).get("/api/v1/account").set("Cookie", cookie))
          .status,
      ).toBe(401);
      cookie = await login(email, "reset-password-123");
    });
    it("rejects expired reset tokens and does not consume a new token twice under concurrency", async () => {
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin}/reset-password`,
      });
      const expired = latest("reset").pathname.split("/").at(-1)!;
      await admin.pool.query(
        "UPDATE app_auth.verifications SET expires_at=now()-interval '1 minute' WHERE identifier=$1",
        [`reset-password:${expired}`],
      );
      expect(
        (
          await post("/api/auth/reset-password", {
            token: expired,
            newPassword: "expired-password-123",
          })
        ).status,
      ).toBe(400);
      await post("/api/auth/request-password-reset", {
        email,
        redirectTo: `${origin}/reset-password`,
      });
      const token = latest("reset").pathname.split("/").at(-1)!;
      const results = await Promise.all([
        post("/api/auth/reset-password", {
          token,
          newPassword: "reset-password-123",
        }),
        post("/api/auth/reset-password", {
          token,
          newPassword: "reset-password-123",
        }),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    });
    it("establishes credentials for a migrated identity through the library reset flow", async () => {
      const to = "legacy@example.test";
      await post("/api/auth/request-password-reset", {
        email: to,
        redirectTo: `${origin}/reset-password`,
      });
      const token = latest("reset", to).pathname.split("/").at(-1)!;
      expect(
        (
          await post("/api/auth/reset-password", {
            token,
            newPassword: password,
          })
        ).status,
      ).toBe(200);
      const legacyCookie = await login(to);
      const account = await request(app)
        .get("/api/v1/account")
        .set("Cookie", legacyCookie);
      expect(account.body.data.isAdmin).toBe(true);
      expect(account.body.data.user.id).toBe(
        "00000000-0000-4000-8000-0000000000c1",
      );
    });
    it("bounds internal recipient lookup and exposes only canonical identity fields", async () => {
      expect(
        (
          await post("/api/internal/ticket-alert-recipients", {
            userIds: [userId],
          })
        ).status,
      ).toBe(401);
      const result = await post("/api/internal/ticket-alert-recipients", {
        userIds: [userId],
      }).set("Authorization", `Bearer ${internalSecret}`);
      expect(result.status).toBe(200);
      expect(result.body.data).toEqual([
        { id: userId, email, emailVerified: true },
      ]);
      expect(result.headers["cache-control"]).toBe("no-store");
      expect(
        (
          await post("/api/internal/ticket-alert-recipients", {
            userIds: Array(101).fill(userId),
          }).set("Authorization", `Bearer ${internalSecret}`)
        ).status,
      ).toBe(400);
    });
    it("enforces the auth limiter using persistent database state", async () => {
      let status = 0;
      for (let attempt = 0; attempt < 15 && status !== 429; attempt++) {
        const result = await request(app)
          .post("/api/auth/sign-in/email")
          .set("Origin", origin)
          .set("X-Forwarded-For", "192.0.2.240")
          .send({
            email: "pr5-unknown@example.test",
            password: "incorrect-password-123",
          });
        status = result.status;
      }
      expect(status).toBe(429);
    });
    it("expires and revokes database sessions and persists limiter state", async () => {
      await admin.pool.query(
        "UPDATE app_auth.sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
        [userId],
      );
      expect(
        (await request(app).get("/api/v1/account").set("Cookie", cookie))
          .status,
      ).toBe(401);
      cookie = await login(email, "reset-password-123");
      expect((await post("/api/auth/sign-out", {}, cookie)).status).toBe(200);
      expect(
        (await request(app).get("/api/v1/account").set("Cookie", cookie))
          .status,
      ).toBe(401);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM app_auth.rate_limits",
          )
        ).rows[0].count,
      ).toBeGreaterThan(0);
    });
  },
);
