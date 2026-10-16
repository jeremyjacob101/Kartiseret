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

  return {
    config,
    repository,
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
