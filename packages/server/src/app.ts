import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import {
  CatalogDataIntegrityError,
  CatalogDatabaseError,
} from "./catalog/errors.js";
import {
  getNowPlayingMovies,
  type CatalogRepository,
} from "./catalog/service.js";
import { HttpError } from "./http-errors.js";

const emptyQuerySchema = z.object({}).strict();

export interface AppLogger {
  error(message: string, error: unknown): void;
}

export interface AppDependencies {
  catalogRepository: CatalogRepository;
  logger?: AppLogger;
}

const silentLogger: AppLogger = {
  error: () => undefined,
};

function safeErrorSummary(error: unknown): { name: string; code?: string } {
  if (typeof error !== "object" || error === null) {
    return { name: "UnknownError" };
  }

  const source = error as { name?: unknown; code?: unknown };
  return {
    name: typeof source.name === "string" ? source.name : "Error",
    ...(typeof source.code === "string" ? { code: source.code } : {}),
  };
}

export function createApp({
  catalogRepository,
  logger = silentLogger,
}: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (_request, response) => {
    response.json({ data: { status: "ok" }, error: null });
  });

  app.get("/api/v1/catalog/now-playing", async (request, response, next) => {
    const query = emptyQuerySchema.safeParse(request.query);
    if (!query.success) {
      next(
        new HttpError(
          400,
          "invalid_request",
          "The request query is not supported.",
        ),
      );
      return;
    }

    try {
      const movies = await getNowPlayingMovies(catalogRepository);
      response.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      response.json({ data: { mode: "nowPlaying", movies }, error: null });
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, _response, next) => {
    next(
      new HttpError(404, "not_found", "The requested API route was not found."),
    );
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    next,
  ) => {
    void next;
    if (error instanceof HttpError) {
      response.status(error.status).json({
        data: null,
        error: { code: error.code, message: error.message },
      });
      return;
    }

    if (
      error instanceof SyntaxError &&
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.parse.failed"
    ) {
      response.status(400).json({
        data: null,
        error: {
          code: "invalid_request",
          message: "The JSON request body is invalid.",
        },
      });
      return;
    }

    if (error instanceof CatalogDatabaseError) {
      logger.error(
        "Catalog database query failed.",
        safeErrorSummary(error.cause),
      );
      response.status(503).json({
        data: null,
        error: {
          code: "catalog_unavailable",
          message: "The catalog is temporarily unavailable.",
        },
      });
      return;
    }

    if (
      error instanceof CatalogDataIntegrityError ||
      error instanceof z.ZodError
    ) {
      logger.error(
        "Catalog data did not match the public contract.",
        safeErrorSummary(error),
      );
      response.status(500).json({
        data: null,
        error: {
          code: "invalid_catalog_data",
          message: "The catalog data is temporarily unavailable.",
        },
      });
      return;
    }

    logger.error("Unhandled API request error.", safeErrorSummary(error));
    response.status(500).json({
      data: null,
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
    });
  };

  const jsonBodyErrorHandler: ErrorRequestHandler = (
    error,
    request,
    response,
    next,
  ) => {
    if (request.path.startsWith("/api/") && error) {
      errorHandler(error, request, response, next);
      return;
    }
    next(error);
  };

  app.use(jsonBodyErrorHandler);
  app.use(errorHandler);

  return app;
}
