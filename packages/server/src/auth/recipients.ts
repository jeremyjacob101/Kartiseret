import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { user } from "./schema.js";

const requestSchema = z
  .object({ userIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict();
const unsubscribeTokenRequestSchema = z
  .object({ userId: z.string().uuid(), deliveryId: z.string().uuid() })
  .strict();
export function createRecipientRouter(
  pool: Pool,
  secret: string,
  options: { store?: Store; limit?: number; windowMs?: number } = {},
) {
  const router = Router();
  const database = drizzle(pool);
  const windowMs = options.windowMs ?? 60_000;
  const limiter = rateLimit({
    windowMs,
    limit: options.limit ?? 600,
    ...(options.store ? { store: options.store } : {}),
    standardHeaders: "draft-6",
    legacyHeaders: false,
    passOnStoreError: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: (request: Request) => {
      const address = process.env.VERCEL
        ? request.get("x-real-ip")
        : request.socket.remoteAddress;
      return address && isIP(address)
        ? `internal-recipient:${ipKeyGenerator(address, 64)}`
        : "internal-recipient:unidentified";
    },
    handler: (_request, response) => {
      response.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      response.status(429).json({
        data: null,
        error: {
          code: "rate_limited",
          message: "Please wait briefly and try again.",
        },
      });
    },
  });
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  const isAuthorized = (authorization: string | undefined) => {
    const supplied = createHash("sha256")
      .update(authorization ?? "")
      .digest();
    return timingSafeEqual(expected, supplied);
  };
  router.post(
    "/ticket-alert-recipients",
    limiter,
    async (request, response) => {
      if (!isAuthorized(request.headers.authorization)) {
        response.status(401).json({
          data: null,
          error: {
            code: "unauthorized",
            message: "An internal credential is required.",
          },
        });
        return;
      }
      const input = requestSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({
          data: null,
          error: {
            code: "invalid_request",
            message: "Provide between 1 and 100 valid user IDs.",
          },
        });
        return;
      }
      const data = await database
        .select({
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        })
        .from(user)
        .where(inArray(user.id, [...new Set(input.data.userIds)]));
      response.json({ data, error: null });
    },
  );
  router.post(
    "/movie-notification-unsubscribe-tokens",
    limiter,
    async (request, response) => {
      if (!isAuthorized(request.headers.authorization)) {
        response.status(401).json({
          data: null,
          error: {
            code: "unauthorized",
            message: "An internal credential is required.",
          },
        });
        return;
      }
      const input = unsubscribeTokenRequestSchema.safeParse(request.body);
      if (!input.success) {
        response.status(400).json({
          data: null,
          error: {
            code: "invalid_request",
            message: "The request is invalid.",
          },
        });
        return;
      }

      const client = await pool.connect();
      const tokens = {
        manageLetterboxd: randomBytes(32).toString("base64url"),
        oneClickAll: randomBytes(32).toString("base64url"),
      };
      try {
        await client.query("begin");
        await client.query(
          "select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))",
          [`movie-notification-unsubscribe:${input.data.deliveryId}`],
        );
        const eligibility = await client.query<{ eligible: boolean }>(
          "select app_auth.movie_notification_delivery_has_letterboxd_support($1, $2) as eligible",
          [input.data.userId, input.data.deliveryId],
        );
        if (eligibility.rows[0]?.eligible !== true) {
          await client.query("commit");
          response.json({ data: { eligible: false }, error: null });
          return;
        }
        for (const [purpose, token] of [
          ["manage_letterboxd", tokens.manageLetterboxd],
          ["one_click_all", tokens.oneClickAll],
        ] as const) {
          const inserted = await client.query(
            `insert into app_auth.movie_notification_unsubscribe_tokens as stored
             (user_id, delivery_id, purpose, token_hash, expires_at)
           values ($1, $2, $3, $4, statement_timestamp() + interval '180 days')
           on conflict (delivery_id, purpose) do update set
             token_hash = excluded.token_hash,
             created_at = statement_timestamp(),
             expires_at = excluded.expires_at,
             revoked_at = null,
             consumed_at = null
           where stored.user_id = excluded.user_id
           returning id`,
            [
              input.data.userId,
              input.data.deliveryId,
              purpose,
              createHash("sha256").update(token).digest(),
            ],
          );
          if (inserted.rowCount !== 1)
            throw new Error("Could not issue notification unsubscribe tokens.");
        }
        await client.query("commit");
        response.json({ data: { ...tokens, eligible: true }, error: null });
      } catch {
        await client.query("rollback").catch(() => undefined);
        response.status(503).json({
          data: null,
          error: {
            code: "unsubscribe_unavailable",
            message: "Unsubscribe links could not be created.",
          },
        });
      } finally {
        client.release();
      }
    },
  );
  return router;
}
