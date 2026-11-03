import { describe, expect, it } from "vitest";
import { resolveRuntimeTargetEnvironment } from "./target-environment.js";

const projectRefs = {
  development: "jbydpmjjptwevyijarzl",
  production: "gsdrcyrduxbrxgsvhxvr",
} as const;

const buckets = {
  development: "kartiseret-artwork-dev",
  production: "kartiseret-artwork-prod",
} as const;

function profiles() {
  return {
    NODE_ENV: "development",
    DEV_SUPABASE_URL: `https://${projectRefs.development}.supabase.co`,
    DEV_SUPABASE_SERVICE_ROLE_KEY: "dev-server-role-key",
    DEV_SUPABASE_PUBLISHABLE_KEY: "dev-publishable-key",
    DEV_DATABASE_URL: `postgresql://kartiseret_api.${projectRefs.development}:secret@pooler.supabase.com:6543/postgres`,
    DEV_DATABASE_SSL_CA_CERT: "dev-ca-certificate",
    DEV_PUBLICATION_DATABASE_URL: `postgresql://publisher.${projectRefs.development}:secret@pooler.supabase.com:5432/postgres`,
    DEV_PUBLICATION_DATABASE_SSL_CA_CERT: "dev-publication-ca",
    DEV_R2_ACCOUNT_ID: "a".repeat(32),
    DEV_R2_BUCKET: buckets.development,
    DEV_R2_READ_ACCESS_KEY_ID: "dev-read-key",
    DEV_R2_READ_SECRET_ACCESS_KEY: "dev-read-secret",
    DEV_R2_ACCESS_KEY_ID: "dev-write-key",
    DEV_R2_SECRET_ACCESS_KEY: "dev-write-secret",
    PROD_SUPABASE_URL: `https://${projectRefs.production}.supabase.co`,
    PROD_SUPABASE_SERVICE_ROLE_KEY: "prod-server-role-key",
    PROD_DATABASE_URL: `postgresql://kartiseret_api.${projectRefs.production}:secret@pooler.supabase.com:6543/postgres`,
    PROD_R2_ACCOUNT_ID: "b".repeat(32),
    PROD_R2_BUCKET: buckets.production,
    PROD_R2_READ_ACCESS_KEY_ID: "prod-read-key",
    PROD_R2_READ_SECRET_ACCESS_KEY: "prod-read-secret",
    PROD_R2_ACCESS_KEY_ID: "prod-write-key",
    PROD_R2_SECRET_ACCESS_KEY: "prod-write-secret",
  };
}

describe("resolveRuntimeTargetEnvironment", () => {
  it("defaults local development server profiles to development", () => {
    const resolved = resolveRuntimeTargetEnvironment(profiles());

    expect(resolved.KARTISERET_TARGET).toBe("development");
    expect(resolved.SUPABASE_URL).toBe(
      `https://${projectRefs.development}.supabase.co`,
    );
    expect(resolved.DATABASE_URL).toContain(projectRefs.development);
    expect(resolved.R2_BUCKET).toBe(buckets.development);
    expect(resolved.R2_READ_ACCESS_KEY_ID).toBe("dev-read-key");
    expect(resolved.PROD_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(resolved.DEV_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(resolved.R2_ACCESS_KEY_ID).toBeUndefined();
    expect(resolved.DEV_R2_ACCESS_KEY_ID).toBeUndefined();
    expect(resolved.PROD_R2_SECRET_ACCESS_KEY).toBeUndefined();
    expect(resolved.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(resolved.PUBLICATION_DATABASE_URL).toBeUndefined();
  });

  it("selects production Supabase and R2 together when explicitly requested", () => {
    const resolved = resolveRuntimeTargetEnvironment({
      ...profiles(),
      KARTISERET_TARGET: "production",
    });

    expect(resolved.KARTISERET_TARGET).toBe("production");
    expect(resolved.SUPABASE_URL).toBe(
      `https://${projectRefs.production}.supabase.co`,
    );
    expect(resolved.DATABASE_URL).toContain(projectRefs.production);
    expect(resolved.R2_BUCKET).toBe(buckets.production);
    expect(resolved.R2_READ_ACCESS_KEY_ID).toBe("prod-read-key");
    expect(resolved.DEV_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it("rejects an incomplete target selector when both profiles are configured", () => {
    expect(() =>
      resolveRuntimeTargetEnvironment({
        ...profiles(),
        NODE_ENV: "production",
      }),
    ).toThrow("KARTISERET_TARGET must be development or production");
  });

  it("rejects a database connection from the other Supabase project", () => {
    expect(() =>
      resolveRuntimeTargetEnvironment({
        ...profiles(),
        PROD_DATABASE_URL: `postgresql://kartiseret_api.${projectRefs.development}:secret@pooler.supabase.com:6543/postgres`,
        KARTISERET_TARGET: "production",
      }),
    ).toThrow("DATABASE_URL does not match KARTISERET_TARGET");
  });

  it("rejects an R2 bucket mismatch and partial reader credentials", () => {
    expect(() =>
      resolveRuntimeTargetEnvironment({
        ...profiles(),
        DEV_R2_BUCKET: buckets.production,
      }),
    ).toThrow(`R2_BUCKET=${buckets.development}`);

    const incomplete = profiles();
    delete (incomplete as Record<string, string | undefined>)
      .DEV_R2_READ_SECRET_ACCESS_KEY;
    expect(() => resolveRuntimeTargetEnvironment(incomplete)).toThrow(
      "Both R2 read-only credentials are required",
    );
  });

  it("keeps hosted generic settings and strips write credentials", () => {
    const hosted = {
      DATABASE_URL: "postgresql://runtime@pooler.supabase.com/postgres",
      R2_ACCOUNT_ID: "a".repeat(32),
      R2_BUCKET: buckets.production,
      R2_READ_ACCESS_KEY_ID: "read-key",
      R2_READ_SECRET_ACCESS_KEY: "read-secret",
      R2_ACCESS_KEY_ID: "should-not-reach-app",
      R2_SECRET_ACCESS_KEY: "should-not-reach-app",
      SUPABASE_SERVICE_ROLE_KEY: "should-not-reach-app",
      MIGRATION_DATABASE_URL: "should-not-reach-app",
    };

    const resolved = resolveRuntimeTargetEnvironment(hosted);

    expect(resolved).toMatchObject({
      DATABASE_URL: hosted.DATABASE_URL,
      R2_BUCKET: buckets.production,
      R2_READ_ACCESS_KEY_ID: "read-key",
    });
    expect(resolved.R2_ACCESS_KEY_ID).toBeUndefined();
    expect(resolved.R2_SECRET_ACCESS_KEY).toBeUndefined();
    expect(resolved.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(resolved.MIGRATION_DATABASE_URL).toBeUndefined();
  });
});
