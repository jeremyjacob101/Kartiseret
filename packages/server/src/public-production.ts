import { DrizzleCatalogRepository } from "./catalog/drizzle-repository.js";
import { resolveRuntimeTargetEnvironment } from "./target-environment.js";
import { timeCatalogStageSync } from "./catalog-timing.js";
import { createDatabase } from "./db/client.js";
import { parseServerEnvironment } from "./env.js";

function createProductionDataRuntime(environment: NodeJS.ProcessEnv) {
  const selectedEnvironment = resolveRuntimeTargetEnvironment(environment);
  const config = parseServerEnvironment(selectedEnvironment);
  const database = createDatabase(config.DATABASE_URL, {
    poolMax: config.DATABASE_POOL_MAX,
    sslCaCertificate: config.DATABASE_SSL_CA_CERT,
  });
  // Catalog snapshots can hold the only reader connection while allocating links.
  const publicRoutePool = createDatabase(config.DATABASE_URL, {
    poolMax: 1,
    sslCaCertificate: config.DATABASE_SSL_CA_CERT,
  }).pool;
  return {
    publicRoutePool,
    selectedEnvironment,
    config,
    database,
    repository: new DrizzleCatalogRepository(database.db),
  };
}

let runtime: ReturnType<typeof createProductionDataRuntime> | undefined;

export function getProductionDataRuntime(environment = process.env) {
  runtime ??= timeCatalogStageSync("runtime_init", () =>
    createProductionDataRuntime(environment),
  );
  return runtime;
}

export function getProductionPublicDataRepository() {
  return getProductionDataRuntime().repository;
}
