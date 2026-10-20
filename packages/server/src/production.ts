import { BetterAuthIdentityVerifier } from "./protected/identity.js";
import { toNodeHandler } from "better-auth/node";
import { waitUntil } from "@vercel/functions";
import { createApplicationAuth } from "./auth/auth.js";
import { parseAuthEnvironment } from "./auth/env.js";
import { createResendAuthMailer } from "./auth/mail.js";
import { createRecipientRouter } from "./auth/recipients.js";
import { ProtectedWorkflows } from "./protected/service.js";
import { DrizzleCatalogRepository } from "./catalog/drizzle-repository.js";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import { parseServerEnvironment } from "./env.js";

type ProductionRuntime = ReturnType<typeof createProductionRuntime>;

function createProductionRuntime(
  environment: Record<string, string | undefined>,
) {
  const config = parseServerEnvironment(environment);
  const database = createDatabase(config.DATABASE_URL, {
    poolMax: config.DATABASE_POOL_MAX,
    sslCaCertificate: config.DATABASE_SSL_CA_CERT,
  });
  const repository = new DrizzleCatalogRepository(database.db);
  const authConfig = parseAuthEnvironment(environment);
  const auth = createApplicationAuth(database.pool, {
    ...authConfig,
    mailer: createResendAuthMailer(authConfig.mail),
    ...(environment.VERCEL ? { backgroundTask: waitUntil } : {}),
  });

  return {
    config,
    repository,
    workflows: new ProtectedWorkflows(database.db, repository),
    identityVerifier: new BetterAuthIdentityVerifier(auth),
    authHandler: toNodeHandler(auth),
    trustedOrigins: authConfig.trustedOrigins,
    recipientRouter: createRecipientRouter(
      database.pool,
      authConfig.internalSecret,
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

export function getProductionPublicDataRepository() {
  return getProductionRuntime(process.env).repository;
}

export function createProductionApp(
  environment: Record<string, string | undefined> = process.env,
) {
  const runtime = getProductionRuntime(environment);
  const app = createApp({
    catalogRepository: runtime.repository,
    publicDataRepository: runtime.repository,
    identityVerifier: runtime.identityVerifier,
    protectedWorkflows: runtime.workflows,
    authHandler: runtime.authHandler,
    trustedOrigins: runtime.trustedOrigins,
    recipientRouter: runtime.recipientRouter,
    logger: {
      error: (message, error) => console.error(message, error),
    },
  });

  return {
    app,
    config: runtime.config,
    close: runtime.close,
  };
}
