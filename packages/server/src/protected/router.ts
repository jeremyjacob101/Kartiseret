import { Router, type ErrorRequestHandler, type Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import {
  EXPECTED_ACCOUNT_HEADER,
  correctionSchema,
  initializePreferencesSchema,
  preferencePatchSchema,
  movieDisplayPreferenceCreateSchema,
  movieDisplayPreferenceListQuerySchema,
  movieDisplayPreferencePatchSchema,
  subscriptionMovieIdSchema,
  subscriptionCreateSchema,
  subscriptionListQuerySchema,
  ticketAlertCriteriaUpdateSchema,
  ticketAlertPreferencesUpdateSchema,
  comingSoonDateWatchCreateSchema,
  subscriptionMovieIdSchema as watchMovieIdSchema,
  letterboxdSourceCreateSchema,
  letterboxdSourceIdSchema,
  pushDeviceRegistrationSchema,
  pushDeviceStatusQuerySchema,
  pushDeviceUnregisterSchema,
  walletTicketCreateSchema,
  walletTicketIdSchema,
  walletTicketPatchSchema,
  walletTicketRecentClickRequestSchema,
} from "@kartiseret/contracts/private-data";
import {
  homepageMovieHighlightUpsertSchema,
  homepageMovieIdSchema,
  homepagePromotionUpsertSchema,
} from "@kartiseret/contracts/homepage-featured";
import { HttpError } from "../http-errors.js";
import type { IdentityVerifier, VerifiedIdentity } from "./identity.js";
import type { ProtectedWorkflowService } from "./service.js";
import { generateWalletPass } from "../wallet/pass.js";

export const PROTECTED_RATE_LIMIT = 600;
export const PROTECTED_RATE_LIMIT_WINDOW_MS = 60_000;

export interface ProtectedRateLimitOptions {
  store?: Store;
  limit?: number;
  windowMs?: number;
  clientIp?: (request: Request) => string | undefined;
  onDiagnostic?: (
    kind:
      | "client_ip_unavailable"
      | "rate_limit_store_error"
      | "rate_limit_cleanup_error",
  ) => void;
}

function trustedClientIp(request: Request): string | undefined {
  const candidate = process.env.VERCEL
    ? request.get("x-real-ip")
    : request.socket.remoteAddress;
  return candidate && isIP(candidate) ? candidate : undefined;
}

export function createProtectedRouter(
  verifier: IdentityVerifier,
  workflows: ProtectedWorkflowService,
  trustedOrigins: readonly string[],
  rateLimitOptions: ProtectedRateLimitOptions = {},
) {
  const router = Router();
  const clientIp = rateLimitOptions.clientIp ?? trustedClientIp;
  const windowMs = rateLimitOptions.windowMs ?? PROTECTED_RATE_LIMIT_WINDOW_MS;
  const limiter = rateLimit({
    windowMs,
    limit: rateLimitOptions.limit ?? PROTECTED_RATE_LIMIT,
    ...(rateLimitOptions.store ? { store: rateLimitOptions.store } : {}),
    standardHeaders: "draft-6",
    legacyHeaders: false,
    passOnStoreError: true,
    validate: { xForwardedForHeader: false },
    skip: (request) => {
      if (clientIp(request)) return false;
      rateLimitOptions.onDiagnostic?.("client_ip_unavailable");
      return true;
    },
    keyGenerator: (request) => {
      const address = clientIp(request);
      // `skip` runs first. This fallback also keeps malformed infrastructure
      // state from accidentally sharing one blocking bucket across visitors.
      return address
        ? ipKeyGenerator(address, 64)
        : `unidentified:${randomUUID()}`;
    },
    logger: {
      error: () => rateLimitOptions.onDiagnostic?.("rate_limit_store_error"),
      warn: () => undefined,
    },
    handler: (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const resetTime = (
        request as Request & { rateLimit?: { resetTime?: Date } }
      ).rateLimit?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(windowMs / 1000);
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({
        data: null,
        error: {
          code: "rate_limited",
          message: "Please wait briefly and try again.",
        },
      });
    },
  });
  router.use(
    [
      "/account",
      "/preferences",
      "/ticket-alerts",
      "/coming-soon-watches",
      "/letterboxd-sources",
      "/push/devices",
      "/ticket-passes",
      "/admin",
    ],
    limiter,
    async (request, response, next) => {
      response.setHeader("Cache-Control", "no-store");
      response.vary("Cookie");
      response.vary("Authorization");
      const cookie = request.headers.cookie;
      const authorization = request.get("authorization");
      const hasBearer = Boolean(
        authorization?.toLowerCase().startsWith("bearer "),
      );
      if (cookie && hasBearer) {
        next(
          new HttpError(
            400,
            "ambiguous_credentials",
            "Send either a session cookie or a bearer token.",
          ),
        );
        return;
      }
      if (!cookie && !hasBearer) {
        next(
          new HttpError(
            401,
            "unauthorized",
            "Please log in to access your account.",
          ),
        );
        return;
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        !hasBearer &&
        !trustedOrigins.includes(request.headers.origin ?? "")
      ) {
        next(
          new HttpError(
            403,
            "invalid_origin",
            "The request origin is not allowed.",
          ),
        );
        return;
      }
      try {
        const verified = await verifier.verify({
          ...(cookie ? { cookie } : {}),
          ...(hasBearer && authorization ? { authorization } : {}),
        });
        const expectedAccount = request.get(EXPECTED_ACCOUNT_HEADER);
        if (expectedAccount && expectedAccount !== verified.id) {
          throw new HttpError(
            409,
            "account_changed",
            "Your account changed. Reload and try again.",
          );
        }
        response.locals.identity = verified;
        next();
      } catch (error) {
        next(error);
      }
    },
  );
  const empty = z.object({}).strict();
  function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new HttpError(400, "invalid_request", "The request is invalid.");
    return result.data;
  }
  function identity(value: unknown): VerifiedIdentity {
    return value as VerifiedIdentity;
  }
  router.get("/account", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: await workflows.account(identity(response.locals.identity)),
      error: null,
    });
  });
  router.get("/preferences", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: await workflows.preferences(identity(response.locals.identity)),
      error: null,
    });
  });
  router.post("/preferences/initialize", async (request, response) => {
    parse(empty, request.query);
    const body = parse(initializePreferencesSchema, request.body);
    response.json({
      data: await workflows.preferences(
        identity(response.locals.identity),
        body.fallbackLocation,
      ),
      error: null,
    });
  });
  router.patch("/preferences", async (request, response) => {
    parse(empty, request.query);
    const patch = parse(preferencePatchSchema, request.body);
    response.json({
      data: await workflows.patchPreferences(
        identity(response.locals.identity),
        patch,
      ),
      error: null,
    });
  });
  router.get("/push/devices/status", async (request, response) => {
    const query = parse(pushDeviceStatusQuerySchema, request.query);
    response.json({
      data: await workflows.pushDeviceStatus(
        identity(response.locals.identity),
        query.token,
      ),
      error: null,
    });
  });
  router.post("/push/devices/register", async (request, response) => {
    parse(empty, request.query);
    const registration = parse(pushDeviceRegistrationSchema, request.body);
    response.json({
      data: await workflows.registerPushDevice(
        identity(response.locals.identity),
        registration,
      ),
      error: null,
    });
  });
  router.delete("/push/devices/current", async (request, response) => {
    parse(empty, request.query);
    const body = parse(pushDeviceUnregisterSchema, request.body);
    response.json({
      data: await workflows.unregisterPushDevice(
        identity(response.locals.identity),
        body.token,
      ),
      error: null,
    });
  });
  router.get("/preferences/movie-display", async (request, response) => {
    const query = parse(movieDisplayPreferenceListQuerySchema, request.query);
    response.json({
      data: await workflows.movieDisplayPreferences(
        identity(response.locals.identity),
        query.after,
      ),
      error: null,
    });
  });
  router.post("/preferences/movie-display", async (request, response) => {
    parse(empty, request.query);
    const preference = parse(movieDisplayPreferenceCreateSchema, request.body);
    response.json({
      data: {
        preference: await workflows.upsertMovieDisplayPreference(
          identity(response.locals.identity),
          preference,
        ),
      },
      error: null,
    });
  });
  router.patch(
    "/preferences/movie-display/:tmdbId",
    async (request, response) => {
      parse(empty, request.query);
      const tmdbId = parse(subscriptionMovieIdSchema, request.params.tmdbId);
      const patch = parse(movieDisplayPreferencePatchSchema, request.body);
      response.json({
        data: {
          preference: await workflows.patchMovieDisplayPreference(
            identity(response.locals.identity),
            tmdbId,
            patch,
          ),
        },
        error: null,
      });
    },
  );
  router.delete(
    "/preferences/movie-display/:tmdbId",
    async (request, response) => {
      parse(empty, request.query);
      const tmdbId = parse(subscriptionMovieIdSchema, request.params.tmdbId);
      response.json({
        data: await workflows.removeMovieDisplayPreference(
          identity(response.locals.identity),
          tmdbId,
        ),
        error: null,
      });
    },
  );
  router.get("/ticket-alerts", async (request, response) => {
    const query = parse(subscriptionListQuerySchema, request.query);
    response.json({
      data: await workflows.subscriptions(
        identity(response.locals.identity),
        query.offset,
      ),
      error: null,
    });
  });
  router.get("/ticket-alerts/preferences", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        preferences: await workflows.ticketAlertPreferences(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.patch("/ticket-alerts/preferences", async (request, response) => {
    parse(empty, request.query);
    const criteria = parse(ticketAlertPreferencesUpdateSchema, request.body);
    response.json({
      data: {
        preferences: await workflows.patchTicketAlertPreferences(
          identity(response.locals.identity),
          criteria,
        ),
      },
      error: null,
    });
  });
  router.post("/ticket-alerts", async (request, response) => {
    parse(empty, request.query);
    const body = parse(subscriptionCreateSchema, request.body);
    response.json({
      data: await workflows.subscribe(
        identity(response.locals.identity),
        body.tmdbId,
      ),
      error: null,
    });
  });
  router.delete("/ticket-alerts/:tmdbId", async (request, response) => {
    parse(empty, request.query);
    const tmdbId = parse(subscriptionMovieIdSchema, request.params.tmdbId);
    response.json({
      data: await workflows.cancel(identity(response.locals.identity), tmdbId),
      error: null,
    });
  });
  router.patch("/ticket-alerts/:tmdbId/criteria", async (request, response) => {
    parse(empty, request.query);
    const tmdbId = parse(subscriptionMovieIdSchema, request.params.tmdbId);
    const body = parse(ticketAlertCriteriaUpdateSchema, request.body);
    response.json({
      data: await workflows.updateTicketAlertCriteria(
        identity(response.locals.identity),
        tmdbId,
        body.criteriaOverrides,
      ),
      error: null,
    });
  });
  router.get("/coming-soon-watches", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        watches: await workflows.comingSoonDateWatches(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.post("/coming-soon-watches", async (request, response) => {
    parse(empty, request.query);
    const body = parse(comingSoonDateWatchCreateSchema, request.body);
    response.json({
      data: await workflows.watchComingSoonDate(
        identity(response.locals.identity),
        body,
      ),
      error: null,
    });
  });
  router.delete("/coming-soon-watches/:tmdbId", async (request, response) => {
    parse(empty, request.query);
    const tmdbId = parse(watchMovieIdSchema, request.params.tmdbId);
    response.json({
      data: await workflows.unwatchComingSoonDate(
        identity(response.locals.identity),
        tmdbId,
      ),
      error: null,
    });
  });
  router.get("/letterboxd-sources", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        sources: await workflows.listLetterboxdSources(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.post("/letterboxd-sources", async (request, response) => {
    parse(empty, request.query);
    const body = parse(letterboxdSourceCreateSchema, request.body);
    response.json({
      data: {
        source: await workflows.addLetterboxdSource(
          identity(response.locals.identity),
          body,
        ),
      },
      error: null,
    });
  });
  router.delete("/letterboxd-sources/:sourceId", async (request, response) => {
    parse(empty, request.query);
    const sourceId = parse(letterboxdSourceIdSchema, request.params.sourceId);
    response.json({
      data: await workflows.removeLetterboxdSource(
        identity(response.locals.identity),
        sourceId,
      ),
      error: null,
    });
  });
  router.get("/ticket-passes", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        tickets: await workflows.walletTickets(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.get("/ticket-passes/offline-cache", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        tickets: await workflows.walletTicketDetails(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.get("/ticket-passes/recent-screening", async (request, response) => {
    parse(empty, request.query);
    response.json({
      data: {
        screening: await workflows.recentWalletShowtimeClick(
          identity(response.locals.identity),
        ),
      },
      error: null,
    });
  });
  router.post("/ticket-passes/recent-click", async (request, response) => {
    parse(empty, request.query);
    const body = parse(walletTicketRecentClickRequestSchema, request.body);
    const { expectedAccountId, ...click } = body;
    const verified = identity(response.locals.identity);
    if (expectedAccountId && expectedAccountId !== verified.id) {
      throw new HttpError(
        409,
        "account_changed",
        "Your account changed. Reload and try again.",
      );
    }
    response.json({
      data: {
        screening: await workflows.recordWalletShowtimeClick(verified, click),
      },
      error: null,
    });
  });
  router.post("/ticket-passes", async (request, response) => {
    parse(empty, request.query);
    const body = parse(walletTicketCreateSchema, request.body);
    response.status(201).json({
      data: {
        ticket: await workflows.createWalletTicket(
          identity(response.locals.identity),
          body,
        ),
      },
      error: null,
    });
  });
  router.get("/ticket-passes/:ticketId/qr.svg", async (request, response) => {
    parse(empty, request.query);
    const ticketId = parse(walletTicketIdSchema, request.params.ticketId);
    const ticket = await workflows.walletTicket(
      identity(response.locals.identity),
      ticketId,
    );
    const svg = await QRCode.toString(ticket.qrMessage, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 512,
    });
    response.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    response.send(svg);
  });
  router.get(
    "/ticket-passes/:ticketId/pass.pkpass",
    async (request, response) => {
      parse(empty, request.query);
      const ticketId = parse(walletTicketIdSchema, request.params.ticketId);
      const ticket = await workflows.walletTicket(
        identity(response.locals.identity),
        ticketId,
      );
      const pass = await generateWalletPass(ticket);
      response.setHeader("Content-Type", "application/vnd.apple.pkpass");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="Kartiseret-Ticket-${ticket.id}.pkpass"`,
      );
      response.setHeader("Content-Length", String(pass.byteLength));
      response.send(pass);
    },
  );
  router.get("/ticket-passes/:ticketId", async (request, response) => {
    parse(empty, request.query);
    const ticketId = parse(walletTicketIdSchema, request.params.ticketId);
    response.json({
      data: {
        ticket: await workflows.walletTicket(
          identity(response.locals.identity),
          ticketId,
        ),
      },
      error: null,
    });
  });
  router.patch("/ticket-passes/:ticketId", async (request, response) => {
    parse(empty, request.query);
    const ticketId = parse(walletTicketIdSchema, request.params.ticketId);
    const body = parse(walletTicketPatchSchema, request.body);
    response.json({
      data: {
        ticket: await workflows.updateWalletTicket(
          identity(response.locals.identity),
          ticketId,
          body,
        ),
      },
      error: null,
    });
  });
  router.delete("/ticket-passes/:ticketId", async (request, response) => {
    parse(empty, request.query);
    const ticketId = parse(walletTicketIdSchema, request.params.ticketId);
    response.json({
      data: await workflows.deleteWalletTicket(
        identity(response.locals.identity),
        ticketId,
      ),
      error: null,
    });
  });
  router.post("/admin/movie-corrections", async (request, response) => {
    parse(empty, request.query);
    const command = parse(correctionSchema, request.body);
    response.json({
      data: await workflows.correct(
        identity(response.locals.identity),
        command,
      ),
      error: null,
    });
  });
  router.get("/admin/homepage-featured", async (request, response) => {
    parse(empty, request.query);
    response.json(
      await workflows.homepageAdminData(identity(response.locals.identity)),
    );
  });
  router.post("/admin/homepage-highlights", async (request, response) => {
    parse(empty, request.query);
    const command = parse(homepageMovieHighlightUpsertSchema, request.body);
    response.json(
      await workflows.upsertHomepageHighlight(
        identity(response.locals.identity),
        command,
      ),
    );
  });
  router.delete(
    "/admin/homepage-highlights/:tmdbId",
    async (request, response) => {
      parse(empty, request.query);
      const tmdbId = parse(homepageMovieIdSchema, request.params.tmdbId);
      response.json(
        await workflows.removeHomepageHighlight(
          identity(response.locals.identity),
          tmdbId,
        ),
      );
    },
  );
  router.post("/admin/homepage-promotions", async (request, response) => {
    parse(empty, request.query);
    const command = parse(homepagePromotionUpsertSchema, request.body);
    response.json(
      await workflows.upsertHomepagePromotion(
        identity(response.locals.identity),
        command,
      ),
    );
  });
  const handleFailure: ErrorRequestHandler = (
    error,
    _request,
    _response,
    next,
  ) => {
    next(
      error instanceof HttpError
        ? error
        : new HttpError(
            503,
            "account_unavailable",
            "Account data is temporarily unavailable.",
            { cause: error },
          ),
    );
  };
  router.use(handleFailure);
  return router;
}
