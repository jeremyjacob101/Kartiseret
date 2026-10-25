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
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kartiseret_publisher_login') THEN
        EXECUTE 'CREATE ROLE kartiseret_publisher_login LOGIN PASSWORD ''local-test-only'' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
      END IF;
    END;
    $roles$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
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
    if (migration.endsWith("_better_auth_accounts.sql")) {
      await client.query(`
        INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('00000000-0000-4000-8000-0000000000c1','legacy@example.test',now());
        INSERT INTO public.admin_users(user_id) VALUES ('00000000-0000-4000-8000-0000000000c1');
        INSERT INTO public."userPreferences"(user_id,rating_sources,location,site_color,signup_initialized) VALUES ('00000000-0000-4000-8000-0000000000c1',ARRAY[]::text[],'Raanana','#123456',true);
        INSERT INTO public.ticket_alert_subscriptions(user_id,tmdb_id,delivery_id,notified_at) VALUES ('00000000-0000-4000-8000-0000000000c1',9100011,'00000000-0000-4000-8000-0000000000d1','2026-10-19T12:00:00Z');
      `);
    }
    if (migration.endsWith("_shared_first_availability_notifications.sql")) {
      await client.query(`
        INSERT INTO app_auth.users(id,name,email,email_verified) VALUES ('00000000-0000-4000-8000-0000000000e1','Migration fixture','notifications-migration@example.test',true);
        INSERT INTO public."userPreferences"(user_id,location) VALUES ('00000000-0000-4000-8000-0000000000e1','Haifa');
        INSERT INTO public.ticket_alert_preferences(user_id,cities) VALUES ('00000000-0000-4000-8000-0000000000e1',NULL);
        INSERT INTO public.ticket_alert_subscriptions(user_id,tmdb_id,notified_at,delivery_city,criteria_overrides) VALUES
          ('00000000-0000-4000-8000-0000000000e1',9300001,now(),'Jerusalem','{"cities":null,"filters":{"screenFormat":["3D"]}}'),
          ('00000000-0000-4000-8000-0000000000e1',9300004,NULL,NULL,'{}');
        INSERT INTO public.letterboxd_event_alerts(user_id,tmdb_id,event_key,event_type,event_payload,status,notified_at,delivery_attempts) VALUES
          ('00000000-0000-4000-8000-0000000000e1',9300001,repeat('a',64),'showtime','{"screening_city":"Jerusalem","title":"Film"}','sent',now(),1),
          ('00000000-0000-4000-8000-0000000000e1',9300001,repeat('b',64),'showtime','{"screening_city":"Jerusalem","title":"Film"}','sent',now(),1),
          ('00000000-0000-4000-8000-0000000000e1',9300002,repeat('c',64),'showtime','{"screening_city":"Haifa","title":"Film"}','suppressed',NULL,0),
          ('00000000-0000-4000-8000-0000000000e1',9300003,repeat('d',64),'showtime','{"screening_city":"Haifa","title":"Film"}','pending',NULL,1),
          ('00000000-0000-4000-8000-0000000000e1',9300004,repeat('e',64),'showtime','{"screening_city":"Haifa","title":"Film"}','pending',NULL,0);
        INSERT INTO public.coming_soon_date_watches(user_id,tmdb_id,title,notified_at,delivery_date)
          VALUES ('00000000-0000-4000-8000-0000000000e1',9300005,'Date fixture',now(),'2027-01-01');
      `);
    }
    await client.query(sql);
  }

  await client.query("GRANT kartiseret_runtime TO kartiseret_api");
  await client.query(
    "GRANT kartiseret_publisher TO kartiseret_publisher_login WITH INHERIT FALSE, SET TRUE",
  );

  const seed = await readFile(
    resolve(repositoryRoot, "supabase/seed/dev.sql"),
    "utf8",
  );
  await client.query(seed);

  await client.query(
    await readFile(
      resolve(
        repositoryRoot,
        "supabase/operations/pr4-retire-browser-access.sql",
      ),
      "utf8",
    ),
  );

  await client.query(`
    INSERT INTO app_auth.users (id,name,email,email_verified) VALUES ('00000000-0000-4000-8000-000000000081','Browser','browser@example.test',true),('00000000-0000-4000-8000-000000000082','Admin','admin@example.test',true);
    INSERT INTO public.admin_users (user_id) VALUES ('00000000-0000-4000-8000-000000000082');
  `);

  console.log(
    `Bootstrapped disposable PostgreSQL 17 database kartiseret_test with ${migrations.length} timestamped SQL migrations, test-only Supabase compatibility objects, and deterministic development fixtures.`,
  );
} finally {
  await client.end();
}
