import { describe, expect, it } from "vitest";
import {
  parseServerEnvironment as parseEnvironment,
  ServerConfigurationError,
} from "./env.js";

const parseServerEnvironment = (
  environment: Record<string, string | undefined>,
) =>
  parseEnvironment({
    ...environment,
  });

describe("server environment parsing", () => {
  const supabaseCaCertificate =
    "-----BEGIN CERTIFICATE-----\ntrusted root\n-----END CERTIFICATE-----";

  it("validates runtime config and applies conservative defaults", () => {
    expect(
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
      }),
    ).toMatchObject({
      NODE_ENV: "development",
      PORT: 3000,
      DATABASE_POOL_MAX: 1,
    });
  });

  it("rejects missing and non-Postgres runtime URLs without echoing secrets", () => {
    expect(() => parseServerEnvironment({})).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "https://user:password@example.test/private",
      }),
    ).toThrow("Expected a PostgreSQL connection URL.");
    try {
      parseServerEnvironment({ DATABASE_URL: "not-a-url" });
    } catch (error) {
      expect(String(error)).not.toContain("password");
    }
  });

  it("requires a PEM CA certificate for Supabase PostgreSQL URLs", () => {
    const databaseUrl =
      "postgresql://app:secret@aws-0-eu-central-2.pooler.supabase.com:6543/postgres";

    expect(() => parseServerEnvironment({ DATABASE_URL: databaseUrl })).toThrow(
      "DATABASE_SSL_CA_CERT is required for Supabase PostgreSQL connections.",
    );
    expect(
      parseServerEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_SSL_CA_CERT: supabaseCaCertificate,
      }),
    ).toMatchObject({ DATABASE_SSL_CA_CERT: supabaseCaCertificate });
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: databaseUrl,
        DATABASE_SSL_CA_CERT: "not-a-certificate",
      }),
    ).toThrow("Expected a PEM-encoded CA certificate.");
  });

  it("rejects out-of-range ports and pool sizes", () => {
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
        PORT: "70000",
      }),
    ).toThrow(ServerConfigurationError);
    expect(() =>
      parseServerEnvironment({
        DATABASE_URL: "postgresql://app:secret@localhost:5432/kartiseret",
        DATABASE_POOL_MAX: "21",
      }),
    ).toThrow(ServerConfigurationError);
  });
});
