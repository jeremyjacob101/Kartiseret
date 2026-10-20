import { z } from "zod";

const databaseUrlSchema = z
  .string()
  .trim()
  .url()
  .refine(
    (value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol),
    "Expected a PostgreSQL connection URL.",
  );

const databaseSslCaCertificateSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value.startsWith("-----BEGIN CERTIFICATE-----") &&
      value.endsWith("-----END CERTIFICATE-----"),
    "Expected a PEM-encoded CA certificate.",
  )
  .optional();

export const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: databaseUrlSchema,
  SUPABASE_URL: z.string().trim().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
  DATABASE_SSL_CA_CERT: databaseSslCaCertificateSchema,
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

  const databaseHostname = new URL(result.data.DATABASE_URL).hostname;
  const isSupabaseDatabase =
    databaseHostname.endsWith(".supabase.co") ||
    databaseHostname.endsWith(".supabase.com");
  if (isSupabaseDatabase && !result.data.DATABASE_SSL_CA_CERT) {
    throw new ServerConfigurationError(
      "Invalid server configuration: DATABASE_SSL_CA_CERT is required for Supabase PostgreSQL connections.",
    );
  }

  return result.data;
}
