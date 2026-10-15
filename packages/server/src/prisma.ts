import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(
  connectionString: string,
  maxPoolSize = 5,
): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: maxPoolSize,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  });
  return new PrismaClient({ adapter });
}
