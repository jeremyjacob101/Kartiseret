import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { Router, type Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { user } from "./schema.js";
import type { PublicRouteInput, PublicRouteRegistry } from "../page-routes.js";
import { movieShowtimeShareStateSchema } from "@kartiseret/contracts/showtime-links";
import { movieCodeSchema } from "@kartiseret/contracts/runtime";

const requestSchema = z
  .object({ userIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict();
const unsubscribeTokenRequestSchema = z
  .object({ userId: z.string().uuid(), deliveryId: z.string().uuid() })
  .strict();
const publicRouteLinksRequestSchema = z
  .object({
    movieCodes: z.array(movieCodeSchema).max(100).optional().default([]),
    pagePaths: z
      .array(z.enum(["/movies", "/soons", "/showtimes"]))
      .max(10)
      .optional()
      .default([]),
    shares: z
      .array(movieShowtimeShareStateSchema)
      .max(100)
      .optional()
      .default([]),
  })
  .strict()
  .refine(
    (input) =>
      input.movieCodes.length + input.pagePaths.length + input.shares.length >
        0 &&
      input.movieCodes.length + input.pagePaths.length + input.shares.length <=
        100,
  );

function stableShareState(
  input: z.infer<typeof movieShowtimeShareStateSchema>,
) {
  return {
    ...input,
    excludedCinemaIds: [...new Set(input.excludedCinemaIds ?? [])].sort(),
  };
}

function publicRouteInputs(
  input: z.infer<typeof publicRouteLinksRequestSchema>,
): {
  inputs: PublicRouteInput[];
  movieKeys: string[];
  pageKeys: string[];
  shareKeys: string[];
} {
  const movieInputs = input.movieCodes.map((movieCode) => ({
    destinationKey: `movie-code:${movieCode}`,
    kind: "movie" as const,
    destinationId: movieCode,
  }));
  const pageInputs = input.pagePaths.map((path) => ({
    destinationKey: `page:${path}`,
    kind: "page" as const,
    destinationId: path,
  }));
  const shareInputs = input.shares.map((share) => {
    const payload = stableShareState(share);
    return {
      destinationKey: `movie-share:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      kind: "share" as const,
      destinationId: payload.movieCode,
      payload,
    };
  });
  return {
    inputs: [...movieInputs, ...pageInputs, ...shareInputs],
    movieKeys: movieInputs.map((route) => route.destinationKey),
    pageKeys: pageInputs.map((route) => route.destinationKey),
    shareKeys: shareInputs.map((route) => route.destinationKey),
  };
}

export function createRecipientRouter(
  pool: Pool,
  secret: string,
  options: {
    store?: Store;
    limit?: number;
    windowMs?: number;
    publicRoutes?: PublicRouteRegistry;
  } = {},
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
  router.post("/public-route-links", limiter, async (request, response) => {
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
    const parsed = publicRouteLinksRequestSchema.safeParse(request.body);
    if (!parsed.success || !options.publicRoutes) {
      response.status(parsed.success ? 503 : 400).json({
        data: null,
        error: {
          code: parsed.success ? "route_unavailable" : "invalid_request",
          message: parsed.success
            ? "Public links are temporarily unavailable."
            : "The public link request is invalid.",
        },
      });
      return;
    }
    try {
      const { inputs, movieKeys, pageKeys, shareKeys } = publicRouteInputs(
        parsed.data,
      );
      const routes = options.publicRoutes.getOrCreateMany
        ? await options.publicRoutes.getOrCreateMany(inputs)
        : await Promise.all(
            inputs.map((input) => options.publicRoutes!.getOrCreate(input)),
          );
      const routesByKey = new Map(
        routes.map((route) => [route.destinationKey, route]),
      );
      const pathsFor = (keys: string[]) =>
        keys.map((key) => {
          const route = routesByKey.get(key);
          if (!route)
            throw new Error("A requested public link was not returned.");
          return `/${route.code}`;
        });
      response.json({
        data: {
          moviePaths: pathsFor(movieKeys),
          pagePaths: pathsFor(pageKeys),
          sharePaths: pathsFor(shareKeys),
        },
        error: null,
      });
    } catch {
      response.status(503).json({
        data: null,
        error: {
          code: "route_unavailable",
          message: "Public links are temporarily unavailable.",
        },
      });
    }
  });
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
