import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../..");
const connectionString = process.env.TEST_DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required. This bootstrap never falls back to DATABASE_URL.",
  );
}

const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
if (
  !["localhost", "127.0.0.1", "::1"].includes(target.hostname) ||
  databaseName !== "kartiseret_test"
) {
  throw new Error(
    "Refusing test bootstrap: TEST_DATABASE_URL must target local database kartiseret_test.",
  );
}

const client = new Client({ connectionString });
await client.connect();

try {
  const [{ current_database: currentDatabase }] = (
    await client.query("SELECT current_database()")
  ).rows;
  if (currentDatabase !== "kartiseret_test") {
    throw new Error(
      "Connected database name does not match the disposable test target.",
    );
  }

  const version = Number(
    (await client.query("SHOW server_version_num")).rows[0]?.server_version_num,
  );
  if (version < 170000 || version >= 180000) {
    throw new Error("The test bootstrap requires PostgreSQL 17.");
  }

  const existing = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
  );
  if (existing.rowCount !== 0) {
    throw new Error(
      "Refusing to bootstrap a non-empty public schema. Start a fresh disposable kartiseret_test database.",
    );
  }

  await client.query(`
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'CREATE ROLE anon NOLOGIN';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'CREATE ROLE authenticated NOLOGIN';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kartiseret_api') THEN
        EXECUTE 'CREATE ROLE kartiseret_api LOGIN PASSWORD ''local-test-only''';
      END IF;
    END;
    $roles$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $function$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $function$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    GRANT SELECT ON auth.users TO anon, authenticated, service_role;
  `);

  const migrationDirectory = resolve(repositoryRoot, "supabase/migrations");
  const migrations = (await readdir(migrationDirectory))
    .filter((filename) => /^\d{14}_[a-z0-9_]+\.sql$/.test(filename))
    .sort();
  if (migrations.length === 0) {
    throw new Error("No timestamped SQL migrations were found.");
  }
  for (const migration of migrations) {
    const sql = await readFile(resolve(migrationDirectory, migration), "utf8");
    await client.query(sql);
  }

  await client.query("GRANT kartiseret_runtime TO kartiseret_api");

  const seed = await readFile(
    resolve(repositoryRoot, "supabase/seed/dev.sql"),
    "utf8",
  );
  await client.query(seed);

  console.log(
    `Bootstrapped disposable PostgreSQL 17 database kartiseret_test with ${migrations.length} timestamped SQL migrations, test-only Supabase compatibility objects, and deterministic development fixtures.`,
  );
} finally {
  await client.end();
}
