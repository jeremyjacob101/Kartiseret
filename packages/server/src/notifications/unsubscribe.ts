import { createHash } from "node:crypto";
import { isIP } from "node:net";
import express, { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import type { Pool } from "pg";
import { z } from "zod";

export interface LetterboxdUnsubscribeSource {
  id: string;
  sourceUrl: string;
  sourceType: "watchlist" | "list";
}

export interface MovieNotificationUnsubscribeService {
  sources(tokenHash: Buffer): Promise<LetterboxdUnsubscribeSource[]>;
  removeSources(
    tokenHash: Buffer,
    sourceIds: string[],
  ): Promise<LetterboxdUnsubscribeSource[]>;
  unsubscribeAll(tokenHash: Buffer): Promise<boolean>;
}

export interface MovieNotificationUnsubscribeRateLimitOptions {
  store?: Store;
  clientIp?: (request: Request) => string | undefined;
  limit?: number;
  windowMs?: number;
}

const selectedSourcesSchema = z
  .object({ sourceIds: z.array(z.string().uuid()).min(1).max(50) })
  .strict();
const oneClickBodySchema = z
  .object({ "List-Unsubscribe": z.literal("One-Click") })
  .strict();

function trustedClientIp(request: Request): string | undefined {
  const candidate = process.env.VERCEL
    ? request.get("x-real-ip")
    : request.socket.remoteAddress;
  return candidate && isIP(candidate) ? candidate : undefined;
}

function digestToken(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return createHash("sha256").update(value).digest();
}

function bearerToken(request: Request): Buffer | null {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    request.get("authorization") ?? "",
  );
  return digestToken(match?.[1]);
}

function safeSources(value: unknown): LetterboxdUnsubscribeSource[] {
  const result = z
    .array(
      z.object({
        id: z.string().uuid(),
        sourceUrl: z.string().url(),
        sourceType: z.enum(["watchlist", "list"]),
      }),
    )
    .safeParse(value);
  if (!result.success) throw new Error("Unsubscribe source data is invalid.");
  return result.data;
}

function publicFailure(response: Response, status = 404) {
  const body =
    status === 404
      ? {
          code: "unsubscribe_link_unavailable",
          message:
            "This unsubscribe link is invalid or has expired. Open the latest email and try again.",
        }
      : status === 400
        ? {
            code: "invalid_request",
            message: "Select at least one connected list and try again.",
          }
        : {
            code: "unsubscribe_unavailable",
            message:
              "Your alert preferences are temporarily unavailable. Please try again.",
          };
  response.status(status).json({
    data: null,
    error: body,
  });
}

export function createPostgresMovieNotificationUnsubscribeService(
  pool: Pool,
): MovieNotificationUnsubscribeService {
  return {
    async sources(tokenHash) {
      const result = await pool.query<LetterboxdUnsubscribeSource>(
        `select id, source_url as "sourceUrl", source_type as "sourceType"
         from app_auth.movie_notification_unsubscribe_sources($1)`,
        [tokenHash],
      );
      return result.rows;
    },
    async removeSources(tokenHash, sourceIds) {
      const result = await pool.query<{
        removed: LetterboxdUnsubscribeSource[];
      }>(
        `select app_auth.remove_movie_notification_letterboxd_sources($1, $2::uuid[]) as removed`,
        [tokenHash, sourceIds],
      );
      return safeSources(result.rows[0]?.removed ?? []);
    },
    async unsubscribeAll(tokenHash) {
      const result = await pool.query<{ unsubscribed: boolean }>(
        `select app_auth.unsubscribe_all_movie_notifications($1) as unsubscribed`,
        [tokenHash],
      );
      return result.rows[0]?.unsubscribed === true;
    },
  };
}

export function createMovieNotificationUnsubscribeRouter(
  service: MovieNotificationUnsubscribeService,
  options: MovieNotificationUnsubscribeRateLimitOptions = {},
) {
  const router = Router();
  const clientIp = options.clientIp ?? trustedClientIp;
  const windowMs = options.windowMs ?? 60_000;
  const limiter = rateLimit({
    windowMs,
    limit: options.limit ?? 30,
    ...(options.store ? { store: options.store } : {}),
    standardHeaders: "draft-6",
    legacyHeaders: false,
    passOnStoreError: false,
    validate: { xForwardedForHeader: false },
    keyGenerator: (request) => {
      const address = clientIp(request);
      return address
        ? `movie-unsubscribe:${ipKeyGenerator(address, 64)}`
        : "movie-unsubscribe:unidentified";
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
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  router.use(limiter);

  router.get("/letterboxd", async (request, response) => {
    const tokenHash = bearerToken(request);
    if (!tokenHash) return publicFailure(response);
    try {
      const sources = safeSources(await service.sources(tokenHash));
      response.json({ data: { sources }, error: null });
    } catch (error) {
      publicFailure(
        response,
        (error as { code?: unknown } | null)?.code === "22023" ? 404 : 503,
      );
    }
  });

  router.post("/letterboxd", async (request, response) => {
    const tokenHash = bearerToken(request);
    if (!tokenHash) return publicFailure(response);
    const input = selectedSourcesSchema.safeParse(request.body);
    if (!input.success) return publicFailure(response, 400);
    try {
      const removed = safeSources(
        await service.removeSources(tokenHash, input.data.sourceIds),
      );
      response.json({ data: { removed }, error: null });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      publicFailure(response, code === "22023" ? 404 : 503);
    }
  });

  router.post(
    "/one-click/:token",
    express.urlencoded({ extended: false, limit: "1kb" }),
    async (request, response) => {
      const tokenHash = digestToken(request.params.token);
      const input = oneClickBodySchema.safeParse(request.body);
      if (!tokenHash || !input.success) {
        response.status(400).end();
        return;
      }
      try {
        if (!(await service.unsubscribeAll(tokenHash))) {
          response.status(404).end();
          return;
        }
        response.status(200).end();
      } catch {
        response.status(503).end();
      }
    },
  );
  return router;
}
