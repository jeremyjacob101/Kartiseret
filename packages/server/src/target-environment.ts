export type RuntimeTarget = "development" | "production";

const projectRefs: Record<RuntimeTarget, string> = {
  development: "jbydpmjjptwevyijarzl",
  production: "gsdrcyrduxbrxgsvhxvr",
};

const buckets: Record<RuntimeTarget, string> = {
  development: "kartiseret-artwork-dev",
  production: "kartiseret-artwork-prod",
};

const profileKeys = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "DATABASE_URL",
  "DATABASE_SSL_CA_CERT",
  "DATABASE_POOL_MAX",
  "PUBLICATION_DATABASE_URL",
  "PUBLICATION_DATABASE_SSL_CA_CERT",
  "RESEND_API_KEY",
  "TICKET_ALERT_RECIPIENT_API_URL",
  "TICKET_ALERT_INTERNAL_API_SECRET",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_IMAGE_ORIGIN",
  "R2_READ_ACCESS_KEY_ID",
  "R2_READ_SECRET_ACCESS_KEY",
] as const;

const writerOnlyKeys = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;
const dataflowOnlyKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "PUBLICATION_DATABASE_URL",
  "PUBLICATION_DATABASE_SSL_CA_CERT",
  "MIGRATION_DATABASE_URL",
  "MIGRATION_DATABASE_SSL_CA_CERT",
] as const;

function stripServerUnusedCredentials(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  for (const key of [...writerOnlyKeys, ...dataflowOnlyKeys]) {
    delete environment[key];
  }
  return environment;
}

const hasValue = (value: string | undefined) => Boolean(value?.trim());

function selectedTarget(value: string | undefined): RuntimeTarget {
  if (value === "development" || value === "production") return value;
  throw new Error("KARTISERET_TARGET must be development or production.");
}

function validateProfile(
  target: RuntimeTarget,
  environment: Record<string, string | undefined>,
): void {
  const projectRef = projectRefs[target];
  if (environment.SUPABASE_URL) {
    let host: string;
    try {
      host = new URL(environment.SUPABASE_URL).hostname;
    } catch {
      throw new Error("SUPABASE_URL is invalid for the selected target.");
    }
    if (host !== `${projectRef}.supabase.co`) {
      throw new Error("SUPABASE_URL does not match KARTISERET_TARGET.");
    }
  }
  if (environment.DATABASE_URL) {
    let database: URL;
    try {
      database = new URL(environment.DATABASE_URL);
    } catch {
      throw new Error("DATABASE_URL is invalid for the selected target.");
    }
    let username: string;
    try {
      username = decodeURIComponent(database.username);
    } catch {
      throw new Error("DATABASE_URL is invalid for the selected target.");
    }
    const identity = `${database.hostname} ${username}`;
    if (!identity.includes(projectRef)) {
      throw new Error("DATABASE_URL does not match KARTISERET_TARGET.");
    }
  }
  for (const key of ["PUBLICATION_DATABASE_URL"] as const) {
    const value = environment[key];
    if (!hasValue(value)) continue;
    let database: URL;
    try {
      database = new URL(value!);
    } catch {
      throw new Error(`${key} is invalid for the selected target.`);
    }
    let username: string;
    try {
      username = decodeURIComponent(database.username);
    } catch {
      throw new Error(`${key} is invalid for the selected target.`);
    }
    if (
      (database.protocol !== "postgres:" &&
        database.protocol !== "postgresql:") ||
      !`${database.hostname} ${username}`.includes(projectRef)
    ) {
      throw new Error(`${key} does not match KARTISERET_TARGET.`);
    }
  }
  if (
    hasValue(environment.PUBLICATION_DATABASE_SSL_CA_CERT) &&
    !hasValue(environment.PUBLICATION_DATABASE_URL)
  ) {
    throw new Error(
      "PUBLICATION_DATABASE_SSL_CA_CERT requires PUBLICATION_DATABASE_URL.",
    );
  }
  const readCredentials = [
    environment.R2_READ_ACCESS_KEY_ID,
    environment.R2_READ_SECRET_ACCESS_KEY,
  ].map(hasValue);
  if (readCredentials.some(Boolean) && !readCredentials.every(Boolean)) {
    throw new Error("Both R2 read-only credentials are required.");
  }
  if (
    readCredentials.every(Boolean) &&
    (environment.R2_BUCKET !== buckets[target] ||
      !hasValue(environment.R2_ACCOUNT_ID))
  ) {
    throw new Error(
      `R2 image reads require R2_ACCOUNT_ID and R2_BUCKET=${buckets[target]}.`,
    );
  }
}

/**
 * Resolve local prefixed profiles before creating the API/database runtime.
 * Hosted deployments retain their existing environment-scoped generic names.
 */
export function resolveRuntimeTargetEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const hasProfiles = profileKeys.some(
    (key) => `DEV_${key}` in environment || `PROD_${key}` in environment,
  );
  if (!hasProfiles) {
    return stripServerUnusedCredentials({ ...environment });
  }

  const defaultTarget =
    environment.KARTISERET_TARGET ??
    (environment.NODE_ENV !== "production" ? "development" : undefined);
  const target = selectedTarget(defaultTarget);
  const prefix = target === "development" ? "DEV_" : "PROD_";
  const resolved = { ...environment };
  for (const key of profileKeys) {
    delete resolved[key];
    const value = environment[`${prefix}${key}`];
    if (value !== undefined) resolved[key] = value;
  }
  for (const key of Object.keys(resolved)) {
    if (key.startsWith("DEV_") || key.startsWith("PROD_")) delete resolved[key];
  }
  // The API process only needs read access. Do not expose the dataflow writer
  // credentials to its runtime, even if the root .env contains both profiles.
  stripServerUnusedCredentials(resolved);
  for (const prefix of ["DEV_", "PROD_"]) {
    for (const key of writerOnlyKeys) delete resolved[`${prefix}${key}`];
  }
  validateProfile(target, resolved);
  resolved.KARTISERET_TARGET = target;
  return resolved;
}
