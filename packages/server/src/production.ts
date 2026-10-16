import { DrizzleCatalogRepository } from "./catalog/drizzle-repository.js";
import { createApp } from "./app.js";
import { createDatabase } from "./db/client.js";
import { parseServerEnvironment } from "./env.js";

export function createProductionApp(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseServerEnvironment(environment);
  const database = createDatabase(config.DATABASE_URL, {
    poolMax: config.DATABASE_POOL_MAX,
    sslCaCertificate: config.DATABASE_SSL_CA_CERT,
  });
  const app = createApp({
    catalogRepository: new DrizzleCatalogRepository(database.db),
    logger: {
      error: (message, error) => console.error(message, error),
    },
  });

  return {
    app,
    config,
    close: database.close,
  };
}
