import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { toNodeHandler } from "better-auth/node";
import { createEmailVerificationToken } from "better-auth/api";
import {
  createApplicationAuth,
  type ApplicationAuthOptions,
} from "../../src/auth/auth.js";
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
const appleKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const appleClientId = "com.example.kartiseret.web";
const googleClientId = "kartiseret-integration.apps.googleusercontent.com";
const authOptions: ApplicationAuthOptions = {
  baseURL: origin,
  secret,
  cookiePrefix: "integration",
  trustedOrigins: [origin],
  socialProviders: {
    google: { clientId: googleClientId, clientSecret: "test-secret" },
    apple: {
      clientId: appleClientId,
      teamId: "TESTTEAM",
      keyId: "TESTKEY",
      privateKey: appleKey.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
  },
  mailer: async (email) => {
    captured.push(email);
  },
};
const auth = createApplicationAuth(runtime.pool, authOptions);
const repository = new DrizzleCatalogRepository(runtime.db);
const app = createApp({
  catalogRepository: repository,
  publicDataRepository: repository,
  authHandler: toNodeHandler(auth),
  identityVerifier: new BetterAuthIdentityVerifier(auth),
  protectedWorkflows: new ProtectedWorkflows(runtime.db, repository),
  recipientRouter: createRecipientRouter(runtime.pool, internalSecret),
  trustedOrigins: [origin],
  socialProviderIds: ["google", "apple"],
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
function emailActionToken(kind: AuthEmail["kind"], to = email): string {
  const prefix = { verification: "e", reset: "r", deletion: "d" }[kind];
  const url = latest(kind, to);
  expect(url.origin).toBe(origin);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");
  expect(url.pathname.startsWith(`/${prefix}`)).toBe(true);
  return url.pathname.slice(2);
}
async function verifyEmail(to = email) {
  const token = emailActionToken("verification", to);
  const response = await request(app)
    .get("/api/auth/verify-email")
    .query({ token });
  expect(response.status).toBe(200);
  expect(response.body.status).toBe(true);
  return response;
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

async function createVerifiedMember(address: string) {
  const created = await signup(address);
  expect(created.status).toBe(200);
  await verifyEmail(address);
  return { id: created.body.user.id as string, cookie: await login(address) };
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
    it("upgrades existing UUID references, resets legacy alert settings, and isolates auth tables", async () => {
      expect(
        (
          await admin.pool.query(
            `SELECT rating_sources,location,site_color,hide_re_releases FROM public."userPreferences" WHERE user_id='00000000-0000-4000-8000-0000000000c1'`,
          )
        ).rows[0],
      ).toEqual({
        rating_sources: [],
        location: "Raanana",
        site_color: "#123456",
        hide_re_releases: false,
      });
      expect(
        (
          await admin.pool.query(
            "SELECT delivery_id,notified_at FROM public.ticket_alert_subscriptions WHERE user_id='00000000-0000-4000-8000-0000000000c1'",
          )
        ).rows,
      ).toEqual([]);
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
      const verificationToken = emailActionToken("verification");
      const confirmed = await request(app)
        .get("/api/auth/verify-email")
        .query({ token: verificationToken });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.status).toBe(true);
      const replay = await request(app)
        .get("/api/auth/verify-email")
        .query({ token: verificationToken });
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe(true);
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
      const socialOptions = await request(app).get("/api/v1/auth/providers");
      expect(socialOptions.body).toEqual({
        data: { providers: ["google", "apple"] },
        error: null,
      });
      expect(socialOptions.headers["cache-control"]).toBe("no-store");
    });
    it("keeps a 30-day session valid and refreshes it after eight days away", async () => {
      const session = (
        await admin.pool.query(
          "SELECT token, created_at, expires_at FROM app_auth.sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
          [userId],
        )
      ).rows[0];
      expect(session).toBeDefined();
      const thirtyDaysInSeconds = 30 * 24 * 60 * 60;
      expect(
        Math.round(
          (session.expires_at.getTime() - session.created_at.getTime()) / 1000,
        ),
      ).toBe(thirtyDaysInSeconds);
      const sessionToken: string | undefined = session?.token;
      await admin.pool.query(
        "UPDATE app_auth.sessions SET expires_at=now()+interval '22 days',updated_at=now()-interval '8 days' WHERE token=$1 AND user_id=$2",
        [sessionToken, userId],
      );
      const before = (
        await admin.pool.query(
          "SELECT expires_at FROM app_auth.sessions WHERE token=$1 AND user_id=$2",
          [sessionToken, userId],
        )
      ).rows[0];
      expect(before).toBeDefined();

      const refreshed = await request(app)
        .get("/api/auth/get-session")
        .set("Cookie", cookie);
      const after = (
        await admin.pool.query(
          "SELECT expires_at FROM app_auth.sessions WHERE token=$1 AND user_id=$2",
          [sessionToken, userId],
        )
      ).rows[0];
      expect(after).toBeDefined();

      expect(refreshed.status).toBe(200);
      expect(refreshed.body.session).not.toBeNull();
      expect(refreshed.headers["set-cookie"]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            new RegExp(
              `^integration\\.session_token=.*; Max-Age=${thirtyDaysInSeconds}(;|$)`,
            ),
          ),
        ]),
      );
      expect(after.expires_at.valueOf()).toBeGreaterThan(
        before.expires_at.valueOf(),
      );
    });
    it("keeps real cookie accounts isolated across preferences, alerts and admin commands", async () => {
      const otherEmail = "pr5-other@example.test";
      expect((await signup(otherEmail)).status).toBe(200);
      await verifyEmail(otherEmail);
      const other = await login(otherEmail);
      const otherId = (
        await request(app).get("/api/v1/account").set("Cookie", other)
      ).body.data.user.id;
      const crossed = await request(app)
        .get("/api/v1/preferences")
        .set("Cookie", other)
        .set("X-Kartiseret-Account-Id", userId);
      expect(crossed.status).toBe(409);
      expect(crossed.body.data).toBeNull();
      expect(otherId).not.toBe(userId);
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
      const url = latest("reset");
      const token = emailActionToken("reset");
      expect(url.pathname).toBe(`/r${token}`);
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
      const expired = emailActionToken("reset");
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
      const token = emailActionToken("reset");
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
    it("deletes the authenticated account and cascades account-owned data", async () => {
      const deleteEmail = "pr5-delete@example.test";
      const created = await signup(deleteEmail);
      expect(created.status).toBe(200);
      const deleteUserId: string = created.body.user.id;
      await verifyEmail(deleteEmail);
      const deleteCookie = await login(deleteEmail);

      await admin.pool.query(
        `INSERT INTO public."userPreferences" (user_id, location)
         VALUES ($1, 'Haifa')`,
        [deleteUserId],
      );
      await admin.pool.query(
        "INSERT INTO public.ticket_alert_preferences (user_id) VALUES ($1)",
        [deleteUserId],
      );
      await admin.pool.query(
        "INSERT INTO public.ticket_alert_subscriptions (user_id, tmdb_id) VALUES ($1, 9100021)",
        [deleteUserId],
      );
      await admin.pool.query(
        "INSERT INTO public.coming_soon_date_watches (user_id, tmdb_id, title) VALUES ($1, 9100022, 'Test watch')",
        [deleteUserId],
      );
      await admin.pool.query(
        "INSERT INTO public.user_movie_display_preferences (user_id, tmdb_id, title, treatment) VALUES ($1, 9100023, 'Test preference', 'remove')",
        [deleteUserId],
      );
      const source = (
        await admin.pool.query(
          `INSERT INTO public.letterboxd_sources (user_id, source_url, source_type)
           VALUES ($1, 'https://letterboxd.com/pr5delete/watchlist/', 'watchlist')
           RETURNING id`,
          [deleteUserId],
        )
      ).rows[0];
      await admin.pool.query(
        `INSERT INTO public.letterboxd_source_films (source_id, user_id, letterboxd_slug, title)
         VALUES ($1, $2, 'test-film', 'Test Film')`,
        [source.id, deleteUserId],
      );
      await admin.pool.query(
        `INSERT INTO public.letterboxd_event_alerts (user_id, tmdb_id, event_key, event_type, event_payload)
         VALUES ($1, 9100024, repeat('a', 64), 'coming_soon', '{}'::jsonb)`,
        [deleteUserId],
      );

      const denied = await post(
        "/api/auth/delete-user",
        { password: "incorrect-password-123" },
        deleteCookie,
      );
      expect(denied.status).toBeGreaterThanOrEqual(400);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM app_auth.users WHERE id=$1",
            [deleteUserId],
          )
        ).rows[0].count,
      ).toBe(1);

      const deleted = await post(
        "/api/auth/delete-user",
        { password },
        deleteCookie,
      );
      expect(deleted.status).toBe(200);
      const token = emailActionToken("deletion", deleteEmail);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM app_auth.users WHERE id=$1",
            [deleteUserId],
          )
        ).rows[0].count,
      ).toBe(1);
      const callbackURL = `${origin}/?accountDeleted=1`;
      const confirmed = await request(app)
        .get(
          `/api/auth/delete-user/callback?token=${encodeURIComponent(token!)}&callbackURL=${encodeURIComponent(callbackURL)}`,
        )
        .set("Origin", origin)
        .set("Cookie", deleteCookie);
      expect(confirmed.status).toBe(302);
      expect(confirmed.headers.location).toBe(callbackURL);
      for (const [table, userColumn] of [
        ["app_auth.users", "id"],
        ["app_auth.accounts", "user_id"],
        ["app_auth.sessions", "user_id"],
        ['public."userPreferences"', "user_id"],
        ["public.ticket_alert_preferences", "user_id"],
        ["public.ticket_alert_subscriptions", "user_id"],
        ["public.coming_soon_date_watches", "user_id"],
        ["public.user_movie_display_preferences", "user_id"],
        ["public.letterboxd_sources", "user_id"],
        ["public.letterboxd_source_films", "user_id"],
        ["public.letterboxd_event_alerts", "user_id"],
      ] as const) {
        const count = await admin.pool.query(
          `SELECT count(*)::int AS count FROM ${table} WHERE ${userColumn}=$1`,
          [deleteUserId],
        );
        expect(count.rows[0].count, `${table} rows remain`).toBe(0);
      }
      expect(
        (await request(app).get("/api/v1/account").set("Cookie", deleteCookie))
          .status,
      ).toBe(401);
      const replacement = await createVerifiedMember(deleteEmail);
      expect(replacement.id).not.toBe(deleteUserId);
    });
    it("links Apple to an existing Google account only from the initiating session", async () => {
      const address = "pr5-apple-link@example.test";
      const otherMember = await createVerifiedMember(
        "pr5-apple-other@example.test",
      );
      const { socialProviders } = await auth.$context;
      const appleProvider = socialProviders.find((item) => item.id === "apple");
      const googleProvider = socialProviders.find(
        (item) => item.id === "google",
      );
      const googleToken = await new SignJWT({
        email: address,
        email_verified: true,
        name: "Test member",
      })
        .setProtectedHeader({ alg: "ES256", kid: "TESTKEY" })
        .setSubject("integration-google-subject")
        .setIssuer("https://accounts.google.com")
        .setAudience(googleClientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(appleKey.privateKey);
      if (!appleProvider || !googleProvider) {
        throw new Error("Expected Apple and Google providers.");
      }
      for (const provider of [appleProvider, googleProvider]) {
        if (!provider.idToken || !("jwks" in provider.idToken)) {
          throw new Error("Expected JWKS verification.");
        }
        vi.spyOn(provider.idToken, "jwks").mockResolvedValue(
          appleKey.publicKey,
        );
      }
      const tokens = await Promise.all(
        [address, "pr5-apple-relay@example.test"].map((email) =>
          new SignJWT({ email, email_verified: true })
            .setProtectedHeader({ alg: "ES256", kid: "TESTKEY" })
            .setSubject(`apple-${email}`)
            .setIssuer("https://appleid.apple.com")
            .setAudience(appleClientId)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(appleKey.privateKey),
        ),
      );
      const exchange = vi.spyOn(appleProvider, "validateAuthorizationCode");
      const signIn = (token: string, provider = "apple") =>
        post("/api/auth/sign-in/social", {
          provider,
          idToken: { token },
        });
      const startLink = (session: string) =>
        post(
          "/api/auth/link-social",
          {
            provider: "apple",
            callbackURL: `${origin}/user?linked=1`,
            errorCallbackURL: `${origin}/user?linkError=1`,
          },
          session,
        );
      async function completeLink(
        initiator: string,
        activeSession: string,
        token: string,
      ) {
        const start = await startLink(initiator);
        expect(start.status).toBe(200);
        const state = new URL(start.body.url).searchParams.get("state")!;
        exchange.mockResolvedValueOnce({ idToken: token });
        const formPost = await request(app)
          .post("/api/auth/callback/apple")
          .set("Origin", "https://appleid.apple.com")
          .type("form")
          .send({ code: "apple-test-code", state });
        expect(formPost.status).toBe(302);
        const redirect = new URL(formPost.headers.location);
        const callback = await request(app)
          .get(redirect.pathname + redirect.search)
          .set(
            "Cookie",
            [activeSession, cookies(start)].filter(Boolean).join("; "),
          );
        expect(callback.status).toBe(302);
        return new URL(callback.headers.location).searchParams;
      }
      try {
        const [sameEmailToken, relayToken] = tokens;
        const created = await signIn(googleToken, "google");
        expect(created.status).toBe(200);
        const member = {
          id: created.body.user.id as string,
          cookie: cookies(created),
        };
        const secondSession = cookies(await signIn(googleToken, "google"));
        expect((await startLink("")).status).toBe(401);
        const implicit = await signIn(sameEmailToken);
        expect(implicit.status).toBe(401);
        expect(implicit.body.message).toBe("account not linked");
        for (const invalidSession of ["", secondSession, otherMember.cookie]) {
          expect(
            (await completeLink(member.cookie, invalidSession, relayToken)).get(
              "error",
            ),
          ).toBe("link_session_changed");
        }
        expect(
          (await completeLink(member.cookie, member.cookie, relayToken)).get(
            "linked",
          ),
        ).toBe("1");
        const signedIn = await signIn(relayToken);
        expect(signedIn.status).toBe(200);
        expect(signedIn.body.user.id).toBe(member.id);
        expect(signedIn.body.user.email).toBe(address);
        expect(
          (
            await completeLink(
              otherMember.cookie,
              otherMember.cookie,
              relayToken,
            )
          ).get("error"),
        ).toBe("account_already_linked_to_different_user");
        await admin.pool.query(
          "UPDATE app_auth.sessions SET created_at = now() - interval '2 days' WHERE user_id = $1",
          [otherMember.id],
        );
        const stale = await startLink(otherMember.cookie);
        expect(stale.status).toBe(403);
        expect(stale.body.code).toBe("SESSION_NOT_FRESH");

        const listAccounts = async (): Promise<
          { id: string; providerId: string }[]
        > => {
          const response = await request(app)
            .get("/api/auth/list-accounts")
            .set("Cookie", member.cookie);
          expect(response.status).toBe(200);
          return response.body;
        };
        const unlink = (accountId: string) =>
          post("/api/auth/unlink-account", { accountId }, member.cookie);
        const relay = (await listAccounts()).find(
          (item) => item.providerId === "apple",
        )!;
        expect((await unlink(relay.id)).status).toBe(200);
        expect(
          (
            await completeLink(member.cookie, member.cookie, sameEmailToken)
          ).get("linked"),
        ).toBe("1");
        expect((await signIn(sameEmailToken)).body.user.id).toBe(member.id);

        const linked = await listAccounts();
        const apple = linked.find((item) => item.providerId === "apple")!;
        const google = linked.find((item) => item.providerId === "google")!;
        expect((await unlink(apple.id)).status).toBe(200);
        expect((await signIn(sameEmailToken)).body.message).toBe(
          "account not linked",
        );
        expect((await signIn(googleToken, "google")).body.user.id).toBe(
          member.id,
        );
        expect(
          (
            await completeLink(member.cookie, member.cookie, sameEmailToken)
          ).get("linked"),
        ).toBe("1");
        const relinkedApple = (await listAccounts()).find(
          (item) => item.providerId === "apple",
        )!;
        const results = await Promise.all([
          unlink(relinkedApple.id),
          unlink(google.id),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([
          200, 400,
        ]);
        expect(results.find((result) => result.status === 400)?.body.code).toBe(
          "FAILED_TO_UNLINK_LAST_ACCOUNT",
        );
        expect(await listAccounts()).toHaveLength(1);

        expect(
          (await post("/api/auth/delete-user", {}, member.cookie)).status,
        ).toBe(200);
        const deletion = emailActionToken("deletion", address);
        const deleted = await post(
          "/api/auth/delete-user",
          { token: deletion },
          member.cookie,
        );
        expect(deleted.status).toBe(200);
        const restarted = await signIn(sameEmailToken);
        expect(restarted.status).toBe(200);
        expect(restarted.body.user.email).toBe(address);
        expect(restarted.body.user.id).not.toBe(member.id);
      } finally {
        vi.restoreAllMocks();
      }
    });
    it("upgrades a legacy native Apple account and revokes its token on deletion", async () => {
      const apple = authOptions.socialProviders!.apple!;
      const bundleId = "com.example.kartiseret";
      const nativeAuth = createApplicationAuth(runtime.pool, {
        ...authOptions,
        socialProviders: { apple: { ...apple, appBundleIdentifier: bundleId } },
      });
      const context = await nativeAuth.$context;
      const provider = context.socialProviders.find(
        (value) => value.id === "apple",
      );
      if (!provider?.idToken || !("jwks" in provider.idToken)) {
        throw new Error("Expected Apple JWKS verification.");
      }
      const jwks = vi
        .spyOn(provider.idToken, "jwks")
        .mockResolvedValue(appleKey.publicKey);
      const email = "native-apple-deletion@example.test";
      const issueToken = (subject: string) =>
        new SignJWT({ email, email_verified: true })
          .setProtectedHeader({ alg: "ES256", kid: "TESTKEY" })
          .setSubject(subject)
          .setIssuer("https://appleid.apple.com")
          .setAudience(bundleId)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(appleKey.privateKey);
      const identityToken = await issueToken("native-apple-subject");
      const differentIdentityToken = await issueToken("different-subject");
      const send = (path: string, body: object, session?: string) =>
        nativeAuth.handler(
          new Request(origin + "/api/auth/" + path, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: origin,
              "X-Forwarded-For": `192.0.2.${requestIp++}`,
              ...(session ? { Authorization: `Bearer ${session}` } : {}),
            },
            body: JSON.stringify(body),
          }),
        );
      const signIn = (code?: string) =>
        send("sign-in/social", {
          provider: "apple",
          idToken: { token: identityToken },
          ...(code ? { additionalData: { appleAuthorizationCode: code } } : {}),
        });
      const confirmation = () => emailActionToken("deletion", email);
      const appleRequests: Array<{ url: string; body: URLSearchParams }> = [];
      let revokeStatus = 200;
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (url, options) => {
          const body = options?.body as URLSearchParams;
          appleRequests.push({ url: String(url), body });
          if (String(url).endsWith("/auth/token")) {
            return Response.json({
              id_token:
                body.get("code") === "wrong-code"
                  ? differentIdentityToken
                  : identityToken,
              refresh_token: "apple-native-refresh-token",
            });
          }
          expect(String(url)).toBe("https://appleid.apple.com/auth/revoke");
          return new Response(null, { status: revokeStatus });
        });
      try {
        const legacy = await signIn();
        expect(legacy.status).toBe(200);
        const legacyUser = (await legacy.json()).user.id;
        const session = legacy.headers.get("set-auth-token")!;
        expect(session).toBeTruthy();
        expect((await send("delete-user", {}, session)).status).toBe(200);
        const legacyDeletion = await send(
          "delete-user",
          { token: confirmation() },
          session,
        );
        expect(legacyDeletion.status).toBe(200);
        expect(
          legacyDeletion.headers.get("x-kartiseret-apple-revocation"),
        ).toBe("manual");
        expect(appleRequests).toHaveLength(0);

        const recreated = await signIn();
        expect(recreated.status).toBe(200);
        const { user } = await recreated.json();
        expect(user.id).not.toBe(legacyUser);
        const preservedSession = recreated.headers.get("set-auth-token")!;
        expect((await signIn("wrong-code")).status).toBe(400);
        const upgraded = await signIn("valid-code");
        expect(upgraded.status).toBe(200);
        expect((await upgraded.json()).user.id).toBe(user.id);
        expect(appleRequests.at(-1)?.body.get("client_id")).toBe(bundleId);
        expect(appleRequests.at(-1)?.body.has("redirect_uri")).toBe(false);
        const stored = await admin.pool.query(
          "SELECT apple_native_refresh_token FROM app_auth.accounts WHERE user_id = $1",
          [user.id],
        );
        expect(stored.rows[0].apple_native_refresh_token).toEqual(
          expect.any(String),
        );
        expect(stored.rows[0].apple_native_refresh_token).not.toContain(
          "apple-native-refresh-token",
        );
        expect((await send("delete-user", {}, preservedSession)).status).toBe(
          200,
        );
        revokeStatus = 503;
        expect(
          (
            await send(
              "delete-user",
              { token: confirmation() },
              preservedSession,
            )
          ).status,
        ).toBe(503);
        expect((await send("delete-user", {}, preservedSession)).status).toBe(
          200,
        );
        revokeStatus = 200;
        const deletion = await send(
          "delete-user",
          { token: confirmation() },
          preservedSession,
        );
        expect(deletion.status).toBe(200);
        expect(
          deletion.headers.get("x-kartiseret-apple-revocation"),
        ).toBeNull();
        expect(appleRequests.at(-1)?.body.get("token")).toBe(
          "apple-native-refresh-token",
        );
        expect(appleRequests.at(-1)?.body.get("client_id")).toBe(bundleId);
        expect(appleRequests.at(-1)?.body.get("token_type_hint")).toBe(
          "refresh_token",
        );
        expect((await send("delete-user", {}, preservedSession)).status).toBe(
          401,
        );
      } finally {
        fetchMock.mockRestore();
        jwks.mockRestore();
      }
    });

    it("lets a social-only user create a password and delete with an email confirmation", async () => {
      const socialEmail = "pr5-social@example.test";
      const socialUserId = "00000000-0000-4000-8000-0000000000c2";
      await admin.pool.query(
        `INSERT INTO app_auth.users (id, name, email, email_verified)
         VALUES ($1, 'Social member', $2, true)`,
        [socialUserId, socialEmail],
      );
      await admin.pool.query(
        `INSERT INTO app_auth.accounts (user_id, account_id, provider_id)
         VALUES ($1, 'google-subject', 'google')`,
        [socialUserId],
      );

      const reset = await post("/api/auth/request-password-reset", {
        email: socialEmail,
        redirectTo: `${origin}/reset-password`,
      });
      expect(reset.status).toBe(200);
      const resetToken = emailActionToken("reset", socialEmail);
      expect(
        (
          await post("/api/auth/reset-password", {
            token: resetToken,
            newPassword: password,
          })
        ).status,
      ).toBe(200);
      const credentialAccount = (
        await admin.pool.query(
          "SELECT password FROM app_auth.accounts WHERE user_id=$1 AND provider_id='credential'",
          [socialUserId],
        )
      ).rows[0];
      expect(credentialAccount?.password).toBeTruthy();

      const socialCookie = await login(socialEmail, password);
      expect(socialCookie).toContain("integration.session_token=");
      const deletionRequest = await post(
        "/api/auth/delete-user",
        {},
        socialCookie,
      );
      expect(deletionRequest.status).toBe(200);
      const deletionToken = emailActionToken("deletion", socialEmail);

      const confirmed = await request(app)
        .get(
          `/api/auth/delete-user/callback?token=${encodeURIComponent(deletionToken)}&callbackURL=${encodeURIComponent(`${origin}/?accountDeleted=1`)}`,
        )
        .set("Origin", origin)
        .set("Cookie", socialCookie);
      expect(confirmed.status).toBe(302);
      expect(
        (
          await admin.pool.query(
            "SELECT count(*)::int AS count FROM app_auth.users WHERE id=$1",
            [socialUserId],
          )
        ).rows[0].count,
      ).toBe(0);
    });
    it("establishes credentials for a migrated identity through the library reset flow", async () => {
      const to = "legacy@example.test";
      await post("/api/auth/request-password-reset", {
        email: to,
        redirectTo: `${origin}/reset-password`,
      });
      const token = emailActionToken("reset", to);
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
      expect(result.headers.vary).toContain("Authorization");
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
