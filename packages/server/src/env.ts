import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "Expected a PostgreSQL connection URL.",
  );

export const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: databaseUrlSchema,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(1),
  SITE_ORIGIN: z.string().trim().url().optional(),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigurationError";
  }
}

export function parseServerEnvironment(
  environment: Record<string, string | undefined>,
): ServerEnvironment {
  const result = serverEnvironmentSchema.safeParse(environment);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const key = issue.path.join(".") || "environment";
        return `${key}: ${issue.message}`;
      })
      .join("; ");
    throw new ServerConfigurationError(
      `Invalid server configuration: ${details}`,
    );
  }

  return result.data;
}
