import express, { type ErrorRequestHandler } from "express";
import { z } from "zod";
import {
  CatalogDataIntegrityError,
  CatalogDatabaseError,
} from "./catalog/errors.js";
import {
  getMovieCatalog,
  getPublicTheaterData,
  getShowtimeRange,
  getTicketAvailabilityShowtimes,
} from "./public-data/service.js";
import { PublicDataIntegrityError } from "./public-data/errors.js";
import type { PublicDataRepository } from "./public-data/repository.js";
import {
  publicShowtimeRangeQuerySchema,
  ticketAvailabilityQuerySchema,
} from "@kartiseret/contracts/public-data";
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
  publicDataRepository?: PublicDataRepository;
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
  publicDataRepository,
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
      const data = publicDataRepository
        ? await getMovieCatalog(publicDataRepository, "nowPlaying", (error) =>
            logger.error(
              "Movie-code lookup failed; catalog remains available without code hydration.",
              safeErrorSummary(error),
            ),
          )
        : {
            mode: "nowPlaying" as const,
            movies: await getNowPlayingMovies(catalogRepository),
            movieCodesStatus: "ready" as const,
          };
      response.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      response.json({ data, error: null });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/catalog/coming-soon", async (request, response, next) => {
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
    if (!publicDataRepository) {
      next(new CatalogDatabaseError(new Error("Public data is unavailable.")));
      return;
    }
    try {
      const data = await getMovieCatalog(
        publicDataRepository,
        "comingSoon",
        (error) =>
          logger.error(
            "Movie-code lookup failed; catalog remains available without code hydration.",
            safeErrorSummary(error),
          ),
      );
      response.setHeader(
        "Cache-Control",
        "public, max-age=60, stale-while-revalidate=300",
      );
      response.json({ data, error: null });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/showtimes", async (request, response, next) => {
    if (!publicDataRepository) {
      next(new CatalogDatabaseError(new Error("Public data is unavailable.")));
      return;
    }
    const query = publicShowtimeRangeQuerySchema.safeParse(request.query);
    if (!query.success) {
      next(
        new HttpError(
          400,
          "invalid_request",
          "The showtime range query is invalid or exceeds the supported range.",
        ),
      );
      return;
    }
    try {
      const showtimes = await getShowtimeRange(
        publicDataRepository,
        query.data,
      );
      response.setHeader(
        "Cache-Control",
        "public, max-age=30, stale-while-revalidate=60",
      );
      response.json({ data: { showtimes }, error: null });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/theaters", async (request, response, next) => {
    if (!publicDataRepository) {
      next(new CatalogDatabaseError(new Error("Public data is unavailable.")));
      return;
    }
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
      const data = await getPublicTheaterData(publicDataRepository);
      response.setHeader(
        "Cache-Control",
        "public, max-age=3600, stale-while-revalidate=86400",
      );
      response.json({ data, error: null });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/ticket-availability", async (request, response, next) => {
    if (!publicDataRepository) {
      next(new CatalogDatabaseError(new Error("Public data is unavailable.")));
      return;
    }
    const query = ticketAvailabilityQuerySchema.safeParse(request.query);
    if (!query.success) {
      next(
        new HttpError(
          400,
          "invalid_request",
          "The ticket-availability query is invalid.",
        ),
      );
      return;
    }
    try {
      const showtimes = await getTicketAvailabilityShowtimes(
        publicDataRepository,
        query.data.tmdbId,
        query.data.fromDate,
      );
      response.setHeader(
        "Cache-Control",
        "public, max-age=30, stale-while-revalidate=30",
      );
      response.json({ data: { showtimes }, error: null });
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

    if (error instanceof PublicDataIntegrityError) {
      logger.error(
        "Public theater or city metadata did not match the public contract.",
        { name: error.name, code: error.kind },
      );
      response.status(500).json({
        data: null,
        error: {
          code: error.kind,
          message: "The theater and city data is temporarily unavailable.",
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
