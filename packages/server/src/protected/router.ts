import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import {
  EXPECTED_ACCOUNT_HEADER,
  correctionSchema,
  initializePreferencesSchema,
  preferencePatchSchema,
  subscriptionMovieIdSchema,
  subscriptionCreateSchema,
  subscriptionListQuerySchema,
} from "@kartiseret/contracts/private-data";
import { HttpError } from "../http-errors.js";
import type { IdentityVerifier, VerifiedIdentity } from "./identity.js";
import type { ProtectedWorkflowService } from "./service.js";

export function createProtectedRouter(
  verifier: IdentityVerifier,
  workflows: ProtectedWorkflowService,
  trustedOrigins: readonly string[],
) {
  const router = Router();
  router.use(
    ["/account", "/preferences", "/ticket-alerts", "/admin"],
    async (request, response, next) => {
      response.setHeader("Cache-Control", "no-store");
      response.vary("Cookie");
      const cookie = request.headers.cookie;
      if (!cookie) {
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
        const verified = await verifier.verify(cookie);
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
