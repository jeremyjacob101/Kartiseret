import type { ExtractTablesWithRelations } from "drizzle-orm";
import {
  drizzle,
  type NodePgDatabase,
  type NodePgTransaction,
} from "drizzle-orm/node-postgres";
import { type Pool, TypeOverrides, types } from "pg";
import { TimingClient, TimingPool } from "./timing-pool.js";
import * as schema from "./schema.js";

export type ApplicationDatabase = NodePgDatabase<
  typeof schema.applicationTables
>;
export type ApplicationTransaction = NodePgTransaction<
  typeof schema.applicationTables,
  ExtractTablesWithRelations<typeof schema.applicationTables>
>;

export interface DatabaseConnection {
  db: ApplicationDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export interface DatabaseFactoryOptions {
  poolMax?: number;
  sslCaCertificate?: string;
  /** A test-only PostgreSQL startup option can exercise real driver failures. */
  connectionOptions?: string;
  onPoolError?: (error: unknown) => void;
}

function poolTlsOptions(
  connectionString: string,
  sslCaCertificate?: string,
): false | { ca?: string; rejectUnauthorized: true } {
  const url = new URL(connectionString);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return false;
  }

  // pg-connection-string replaces the supplied `ssl` object when it sees
  // sslmode/sslcert/sslkey/sslrootcert in the URL. Require the strongest
  // verification mode if callers supply those options; otherwise use Node's
  // trusted CA store with hostname verification enabled.
  const sslOptions = ["sslmode", "sslcert", "sslkey", "sslrootcert"];
  const hasUrlSslOptions = sslOptions.some((name) =>
    url.searchParams.has(name),
  );
  if (hasUrlSslOptions && url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error(
      "Remote PostgreSQL URLs must use verified TLS (sslmode=verify-full).",
    );
  }

  return {
    ...(sslCaCertificate ? { ca: sslCaCertificate } : {}),
    rejectUnauthorized: true,
  };
}

/**
 * Creates one bounded node-postgres pool and the Drizzle handle that uses it.
 * Call this from explicit runtime composition, never from createApp or module
 * initialization. A Vercel warm instance keeps this pool across requests.
 */
export function createDatabase(
  connectionString: string,
  {
    poolMax = 1,
    sslCaCertificate,
    connectionOptions,
    onPoolError = (error) => {
      const safeError =
        typeof error === "object" && error !== null
          ? (error as { name?: unknown; code?: unknown })
          : undefined;
      console.error("Unexpected idle PostgreSQL connection error.", {
        name: typeof safeError?.name === "string" ? safeError.name : "Error",
        ...(typeof safeError?.code === "string"
          ? { code: safeError.code }
          : {}),
      });
    },
  }: DatabaseFactoryOptions = {},
): DatabaseConnection {
  const postgresTypes = new TypeOverrides();
  // PostgreSQL timestamp without time zone is a wall-clock value. node-postgres
  // normally parses it to Date, which imposes the process time zone. Keep the
  // raw text for Drizzle's string-mode column so Jerusalem clock text is stable.
  postgresTypes.setTypeParser(types.builtins.TIMESTAMP, (value) => value);

  const pool = new TimingPool({
    Client: TimingClient,
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
    ssl: poolTlsOptions(connectionString, sslCaCertificate),
    types: postgresTypes,
    ...(connectionOptions ? { options: connectionOptions } : {}),
  });
  pool.on("error", onPoolError);

  const db = drizzle(pool, { schema: schema.applicationTables });
  let closePromise: Promise<void> | undefined;

  return {
    db,
    pool,
    close() {
      closePromise ??= pool.end();
      return closePromise;
    },
  };
}
