import { PrismaCatalogRepository } from "./catalog/prisma-repository.js";
import { createApp } from "./app.js";
import { parseServerEnvironment } from "./env.js";
import { createPrismaClient } from "./prisma.js";

export function createProductionApp(
  environment: Record<string, string | undefined> = process.env,
) {
  const config = parseServerEnvironment(environment);
  const prisma = createPrismaClient(
    config.DATABASE_URL,
    config.DATABASE_POOL_MAX,
  );
  const app = createApp({
    catalogRepository: new PrismaCatalogRepository(prisma),
    logger: {
      error: (message, error) => console.error(message, error),
    },
  });

  return {
    app,
    config,
    close: () => prisma.$disconnect(),
  };
}
