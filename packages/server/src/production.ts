import { getProductionDataRuntime } from "./public-production.js";
import { BetterAuthIdentityVerifier } from "./protected/identity.js";
import { toNodeHandler } from "better-auth/node";
import { waitUntil } from "@vercel/functions";
import { createApplicationAuth } from "./auth/auth.js";
import { parseAuthEnvironment } from "./auth/env.js";
import { createResendAuthMailer } from "./auth/mail.js";
import { createRecipientRouter } from "./auth/recipients.js";
import { ProtectedWorkflows } from "./protected/service.js";
import { createApp } from "./app.js";
import { createTmdbSearchProvider } from "./public-data/tmdb-search.js";
import {
  PROTECTED_RATE_LIMIT_WINDOW_MS,
  type ProtectedRateLimitOptions,
} from "./protected/router.js";
import { PostgresProtectedRateLimitStore } from "./protected/rate-limit-store.js";
import { createR2ImageStore } from "./artwork/s3.js";
import {
  createMovieNotificationUnsubscribeRouter,
  createPostgresMovieNotificationUnsubscribeService,
} from "./notifications/unsubscribe.js";
import { getRequestLogger, logErrorSafely } from "./logging.js";

type ProductionRuntime = ReturnType<typeof createProductionRuntime>;

function createProductionRuntime(
  environment: Record<string, string | undefined>,
) {
  const { selectedEnvironment, config, database, repository } =
    getProductionDataRuntime(environment);
  const authConfig = parseAuthEnvironment(selectedEnvironment);
  const auth = createApplicationAuth(database.pool, {
    ...authConfig,
    mailer: createResendAuthMailer(authConfig.mail),
    ...(environment.VERCEL ? { backgroundTask: waitUntil } : {}),
  });
  let lastRateLimitDiagnosticAt = 0;
  const reportRateLimitDiagnostic = (
    kind:
      | "client_ip_unavailable"
      | "rate_limit_store_error"
      | "rate_limit_cleanup_error",
  ) => {
    const now = Date.now();
    if (now - lastRateLimitDiagnosticAt < 60_000) return;
    lastRateLimitDiagnosticAt = now;
    try {
      getRequestLogger().error(
        { event: "protected_rate_limiter_degraded", kind },
        "Protected API rate limiter degraded.",
      );
    } catch {
      // Diagnostics must not break request handling.
    }
  };
  const protectedRateLimit: ProtectedRateLimitOptions = {
    store: new PostgresProtectedRateLimitStore(
      database.pool,
      authConfig.secret,
      PROTECTED_RATE_LIMIT_WINDOW_MS,
      reportRateLimitDiagnostic,
    ),
    onDiagnostic: reportRateLimitDiagnostic,
  };

  return {
    config,
    artworkStore: createR2ImageStore(selectedEnvironment as NodeJS.ProcessEnv),
    repository,
    tmdbSearch: createTmdbSearchProvider(config.TMDB_API_KEY),
    workflows: new ProtectedWorkflows(database.db, repository),
    identityVerifier: new BetterAuthIdentityVerifier(auth),
    authHandler: toNodeHandler(auth),
    trustedOrigins: authConfig.trustedOrigins,
    socialProviderIds: authConfig.socialProviderIds,
    protectedRateLimit,
    recipientRouter: createRecipientRouter(
      database.pool,
      authConfig.internalSecret,
      {
        store: new PostgresProtectedRateLimitStore(
          database.pool,
          authConfig.secret,
          60_000,
          reportRateLimitDiagnostic,
        ),
      },
    ),
    notificationUnsubscribeRouter: createMovieNotificationUnsubscribeRouter(
      createPostgresMovieNotificationUnsubscribeService(database.pool),
      {
        store: new PostgresProtectedRateLimitStore(
          database.pool,
          authConfig.secret,
          60_000,
          reportRateLimitDiagnostic,
        ),
      },
    ),
    close: database.close,
  };
}

let productionRuntime: ProductionRuntime | null = null;

function getProductionRuntime(
  environment: Record<string, string | undefined>,
): ProductionRuntime {
  if (!productionRuntime) {
    productionRuntime = createProductionRuntime(environment);
  }
  return productionRuntime;
}

export { getProductionPublicDataRepository } from "./public-production.js";

export function createProductionApp(
  environment: Record<string, string | undefined> = process.env,
) {
  const runtime = getProductionRuntime(environment);
  const app = createApp({
    catalogRepository: runtime.repository,
    publicDataRepository: runtime.repository,
    tmdbSearch: runtime.tmdbSearch,
    identityVerifier: runtime.identityVerifier,
    protectedWorkflows: runtime.workflows,
    authHandler: runtime.authHandler,
    trustedOrigins: runtime.trustedOrigins,
    socialProviderIds: runtime.socialProviderIds,
    protectedRateLimit: runtime.protectedRateLimit,
    recipientRouter: runtime.recipientRouter,
    notificationUnsubscribeRouter: runtime.notificationUnsubscribeRouter,
    artworkStore: runtime.artworkStore,
    logger: {
      error: (message, error) => {
        try {
          logErrorSafely("api_error", error, message);
        } catch {
          // Diagnostics must not break request handling.
        }
      },
    },
  });

  return {
    app,
    config: runtime.config,
    close: runtime.close,
  };
}
