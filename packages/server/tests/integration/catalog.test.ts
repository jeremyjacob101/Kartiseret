import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq, getTableColumns, getTableName, inArray } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { CatalogDatabaseError } from "../../src/catalog/errors.js";
import { DrizzleCatalogRepository } from "../../src/catalog/drizzle-repository.js";
import { createDatabase } from "../../src/db/client.js";
import * as schema from "../../src/db/schema.js";

const connectionString = process.env.TEST_DATABASE_URL;
const runtimeConnectionString = process.env.DATABASE_URL;
if (!connectionString || !runtimeConnectionString) {
  throw new Error(
    "TEST_DATABASE_URL is required; integration tests never skip.",
  );
}

const testTarget = new URL(connectionString);
const runtimeTarget = new URL(runtimeConnectionString);
if (
  !["localhost", "127.0.0.1", "::1"].includes(testTarget.hostname) ||
  decodeURIComponent(testTarget.pathname.replace(/^\/+/, "")) !==
    "kartiseret_test" ||
  testTarget.port !== runtimeTarget.port ||
  !["localhost", "127.0.0.1", "::1"].includes(runtimeTarget.hostname) ||
  decodeURIComponent(runtimeTarget.pathname.replace(/^\/+/, "")) !==
    "kartiseret_test"
) {
  throw new Error(
    "Integration tests only run against local disposable kartiseret_test.",
  );
}

const runtimeDatabase = createDatabase(runtimeConnectionString, { poolMax: 2 });
const adminDatabase = createDatabase(connectionString, { poolMax: 2 });
const runtimeRepository = new DrizzleCatalogRepository(runtimeDatabase.db);
const app = createApp({
  catalogRepository: runtimeRepository,
  publicDataRepository: runtimeRepository,
});

const expectedTableNames = [
  "movie_notification_events",
  "movie_notification_deliveries",
  "cities",
  "coming_soon_date_watches",
  "letterboxd_sources",
  "admin_users",
  "allShowtimes",
  "allSoons",
  "allTheques",
  "finalMovies",
  "finalShowtimes",
  "finalSoons",
  "finalThequeMovies",
  "finalTheques",
  "movieCodes",
  "movie_release_dates",
  "tableFixes",
  "tableSkips",
  "theaters",
  "ticket_alert_preferences",
  "ticket_alert_subscriptions",
  "user_movie_display_preferences",
  "userPreferences",
  "utilAvgTime",
  "utilRunLogs",
];

// These Python-only pipeline tables deliberately stay out of Drizzle's
// applicationTables, which is the schema granted to the public API runtime.
const expectedPipelineTableColumns = {
  letterboxd_event_alerts: [
    "id",
    "user_id",
    "tmdb_id",
    "event_key",
    "event_type",
    "event_payload",
    "status",
    "created_at",
    "delivery_id",
    "delivery_attempts",
    "last_delivery_attempt_at",
    "last_delivery_error",
    "notified_at",
    "resend_email_id",
  ],
  letterboxd_source_films: [
    "source_id",
    "user_id",
    "letterboxd_slug",
    "title",
    "release_year",
    "tmdb_id",
    "first_seen_at",
    "last_seen_at",
    "removed_at",
    "needs_baseline",
  ],
  pipeline_publications: [
    "publication_id",
    "category",
    "run_id",
    "fingerprint",
    "part_count",
    "status",
    "revision",
    "created_at",
    "completed_at",
  ],
  pipeline_publication_parts: ["publication_id", "part", "payload"],
  pipeline_scrape_snapshots: [
    "snapshot_id",
    "run_id",
    "attempt",
    "table_name",
    "source_name",
    "cinema",
    "status",
    "row_count",
    "failure_reason",
    "started_at",
    "completed_at",
  ],
  pipeline_publication_checkpoints: [
    "category",
    "snapshot_id",
    "input_fingerprint",
    "phase",
    "has_unresolved",
    "started_at",
    "updated_at",
    "completed_at",
  ],
} as const;

interface PhysicalColumn {
  table_name: string;
  column_name: string;
  formatted_type: string;
  is_nullable: boolean;
  has_default: boolean;
}

function normalizeSqlType(type: string): string {
  return type
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(time|timestamp)\(6\)/g, "$1")
    .replace(/(time|timestamp) \(6\)/g, "$1")
    .replaceAll("time without time zone", "time")
    .replaceAll("timestamp without time zone", "timestamp")
    .replaceAll(", ", ",");
}

describe("PostgreSQL 17 integration", () => {
  beforeAll(async () => {
    await Promise.all([
      runtimeDatabase.pool.query("SELECT 1"),
      adminDatabase.pool.query("SELECT 1"),
    ]);
  });

  afterAll(async () => {
    await Promise.all([runtimeDatabase.close(), adminDatabase.close()]);
  });

  it("maps application tables and accounts for private pipeline tables", async () => {
    const mappedTables = Object.values(schema.applicationTables);
    expect(mappedTables.map((table) => getTableName(table)).sort()).toEqual(
      [...expectedTableNames].sort(),
    );

    const { rows } = await adminDatabase.pool.query<PhysicalColumn>(`
      SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
        NOT a.attnotnull AS is_nullable,
        d.adbin IS NOT NULL AS has_default
      FROM pg_catalog.pg_attribute AS a
      JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef AS d
        ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `);

    const physicalTables = new Map<string, PhysicalColumn[]>();
    for (const column of rows) {
      const tableColumns = physicalTables.get(column.table_name) ?? [];
      tableColumns.push(column);
      physicalTables.set(column.table_name, tableColumns);
    }

    expect([...physicalTables.keys()].sort()).toEqual(
      [
        ...expectedTableNames,
        "pipeline_catalog_revision",
        ...Object.keys(expectedPipelineTableColumns),
      ].sort(),
    );

    for (const [tableName, expectedColumns] of Object.entries(
      expectedPipelineTableColumns,
    )) {
      expect(
        physicalTables
          .get(tableName)
          ?.map((column) => column.column_name)
          .sort(),
        `${tableName} columns`,
      ).toEqual([...expectedColumns].sort());
    }

    for (const table of mappedTables) {
      const tableName = getTableName(table);
      const mappedColumns = Object.values(getTableColumns(table));
      const actualColumns = physicalTables.get(tableName) ?? [];
      expect(
        mappedColumns.map((column) => column.name).sort(),
        `${tableName} column names`,
      ).toEqual(actualColumns.map((column) => column.column_name).sort());

      const actualByName = new Map(
        actualColumns.map((column) => [column.column_name, column]),
      );
      for (const mapped of mappedColumns) {
        const actual = actualByName.get(mapped.name);
        expect(
          actual,
          `${tableName}.${mapped.name} exists in SQL`,
        ).toBeDefined();
        expect(
          normalizeSqlType(mapped.getSQLType()),
          `${tableName}.${mapped.name} SQL type`,
        ).toBe(normalizeSqlType(actual?.formatted_type ?? ""));
        expect(mapped.notNull, `${tableName}.${mapped.name} nullability`).toBe(
          !actual?.is_nullable,
        );
        expect(mapped.hasDefault, `${tableName}.${mapped.name} default`).toBe(
          actual?.has_default,
        );
      }

      const tableConfig = getTableConfig(table);
      const mappedPrimaryKeys = [
        ...mappedColumns
          .filter((column) => column.primary)
          .map((column) => column.name),
        ...tableConfig.primaryKeys.flatMap((key) =>
          key.columns.map((column) => column.name),
        ),
      ];
      const { rows: primaryKeys } = await adminDatabase.pool.query<{
        column_name: string;
      }>(
        `
          SELECT a.attname AS column_name
          FROM pg_catalog.pg_constraint AS constraint_row
          JOIN pg_catalog.pg_class AS c ON c.oid = constraint_row.conrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL unnest(constraint_row.conkey)
            WITH ORDINALITY AS key_column(attnum, position)
          JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = c.oid AND a.attnum = key_column.attnum
          WHERE n.nspname = 'public'
            AND c.relname = $1
            AND constraint_row.contype = 'p'
          ORDER BY key_column.position
        `,
        [tableName],
      );
      expect(mappedPrimaryKeys.sort(), `${tableName} primary key`).toEqual(
        primaryKeys.map((key) => key.column_name).sort(),
      );
    }

    const movieCodeConfig = getTableConfig(schema.movieCodes);
    expect(
      movieCodeConfig.uniqueConstraints.flatMap((constraint) =>
        constraint.columns.map((column) => column.name),
      ),
    ).toContain("movie_code");
    expect(
      getTableColumns(schema.finalSoons).tmdbId.isUnique,
      "finalSoons.tmdb_id is deliberately not unique",
    ).toBe(false);

    const theaterForeignKeys = getTableConfig(schema.theaters).foreignKeys;
    expect(theaterForeignKeys).toHaveLength(1);
    const cityReference = theaterForeignKeys[0]?.reference();
    expect(cityReference?.columns.map((column) => column.name)).toEqual([
      "city_name",
    ]);
    expect(cityReference?.foreignColumns.map((column) => column.name)).toEqual([
      "name",
    ]);
    const { rows: theaterForeignKeyRows } = await adminDatabase.pool.query<{
      definition: string;
    }>(`
      SELECT pg_catalog.pg_get_constraintdef(f.oid) AS definition
      FROM pg_catalog.pg_constraint AS f
      JOIN pg_catalog.pg_class AS c ON c.oid = f.conrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'theaters'
        AND f.contype = 'f'
    `);
    expect(theaterForeignKeyRows).toHaveLength(1);
    expect(theaterForeignKeyRows[0]?.definition).toContain(
      "FOREIGN KEY (city_name) REFERENCES cities(name) ON UPDATE CASCADE",
    );

    const { rows: providerForeignKeys } = await adminDatabase.pool.query<{
      table_name: string;
      definition: string;
    }>(`
      SELECT c.relname AS table_name, pg_catalog.pg_get_constraintdef(f.oid) AS definition
      FROM pg_catalog.pg_constraint AS f
      JOIN pg_catalog.pg_class AS c ON c.oid = f.conrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND f.contype = 'f'
        AND f.confrelid = 'app_auth.users'::regclass
      ORDER BY c.relname
    `);
    expect(providerForeignKeys.map((key) => key.table_name).sort()).toEqual(
      [
        "admin_users",
        "coming_soon_date_watches",
        "letterboxd_event_alerts",
        "letterboxd_source_films",
        "letterboxd_sources",
        "movie_notification_deliveries",
        "movie_notification_events",
        "ticket_alert_preferences",
        "ticket_alert_subscriptions",
        "user_movie_display_preferences",
        "userPreferences",
      ].sort(),
    );
    expect(
      providerForeignKeys.every((key) =>
        key.definition.includes(
          "REFERENCES app_auth.users(id) ON DELETE CASCADE",
        ),
      ),
    ).toBe(true);
    const { rows: sourceOwnershipKeys } = await adminDatabase.pool.query<{
      definition: string;
    }>(`
      SELECT pg_catalog.pg_get_constraintdef(f.oid) AS definition
      FROM pg_catalog.pg_constraint AS f
      JOIN pg_catalog.pg_class AS c ON c.oid = f.conrelid
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'letterboxd_source_films'
        AND f.conname = 'letterboxd_source_films_source_user_fkey'
    `);
    expect(sourceOwnershipKeys).toEqual([
      {
        definition:
          "FOREIGN KEY (source_id, user_id) REFERENCES letterboxd_sources(id, user_id) ON DELETE CASCADE",
      },
    ]);
  });

  it("keeps pipeline tables and checkpoint RPCs service-role only", async () => {
    const { rows: tablePrivileges } = await adminDatabase.pool.query<{
      table_name: string;
      row_security: boolean;
      service_select: boolean;
      api_select: boolean;
      anon_select: boolean;
      authenticated_select: boolean;
    }>(
      `
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS row_security,
        has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
        has_table_privilege('kartiseret_api', c.oid, 'SELECT') AS api_select,
        has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
        has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `,
      [Object.keys(expectedPipelineTableColumns)],
    );

    expect(tablePrivileges).toEqual(
      Object.keys(expectedPipelineTableColumns)
        .sort()
        .map((tableName) => ({
          table_name: tableName,
          row_security: true,
          service_select: true,
          api_select: false,
          anon_select: false,
          authenticated_select: false,
        })),
    );

    const { rows: functionPrivileges } = await adminDatabase.pool.query<{
      function_name: string;
      service_execute: boolean;
      api_execute: boolean;
      anon_execute: boolean;
      authenticated_execute: boolean;
    }>(
      `
      SELECT
        p.proname AS function_name,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute,
        has_function_privilege('kartiseret_api', p.oid, 'EXECUTE') AS api_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname
    `,
      [
        [
          "claim_pipeline_publication_checkpoint",
          "advance_pipeline_publication_checkpoint",
        ],
      ],
    );

    expect(functionPrivileges).toEqual([
      {
        function_name: "advance_pipeline_publication_checkpoint",
        service_execute: true,
        api_execute: false,
        anon_execute: false,
        authenticated_execute: false,
      },
      {
        function_name: "claim_pipeline_publication_checkpoint",
        service_execute: true,
        api_execute: false,
        anon_execute: false,
        authenticated_execute: false,
      },
    ]);
  });

  it("keeps Coming Soon date watch data owner-scoped and delivery fields worker-only", async () => {
    const { rows } = await adminDatabase.pool.query<{
      row_security: boolean;
      runtime_select: boolean;
      runtime_insert: boolean;
      runtime_delete: boolean;
      runtime_delivery_select: boolean;
      runtime_delivery_update: boolean;
      service_select: boolean;
      service_update: boolean;
    }>(`
      SELECT
        c.relrowsecurity AS row_security,
        has_column_privilege('kartiseret_runtime', c.oid, 'title', 'SELECT') AS runtime_select,
        has_column_privilege('kartiseret_runtime', c.oid, 'title', 'INSERT') AS runtime_insert,
        has_table_privilege('kartiseret_runtime', c.oid, 'DELETE') AS runtime_delete,
        has_column_privilege('kartiseret_runtime', c.oid, 'delivery_id', 'SELECT') AS runtime_delivery_select,
        has_column_privilege('kartiseret_runtime', c.oid, 'delivery_attempts', 'UPDATE') AS runtime_delivery_update,
        has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
        has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'coming_soon_date_watches'
    `);
    expect(rows).toEqual([
      {
        row_security: true,
        runtime_select: true,
        runtime_insert: true,
        runtime_delete: true,
        runtime_delivery_select: false,
        runtime_delivery_update: false,
        service_select: true,
        service_update: true,
      },
    ]);
    const { rows: policies } = await adminDatabase.pool.query<{
      policyname: string;
      cmd: string;
    }>(`
      SELECT policyname, cmd
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'coming_soon_date_watches'
      ORDER BY policyname
    `);
    expect(policies).toEqual([
      { policyname: "api_own_delete", cmd: "DELETE" },
      { policyname: "api_own_insert", cmd: "INSERT" },
      { policyname: "api_own_select", cmd: "SELECT" },
    ]);
  });

  it("keeps Letterboxd source configuration owner-scoped and source delivery worker-only", async () => {
    const { rows: sourceRows } = await adminDatabase.pool.query<{
      row_security: boolean;
      runtime_select: boolean;
      runtime_insert: boolean;
      runtime_delete: boolean;
      runtime_update: boolean;
      service_select: boolean;
      service_update: boolean;
    }>(`
      SELECT
        c.relrowsecurity AS row_security,
        has_column_privilege('kartiseret_runtime', c.oid, 'source_url', 'SELECT') AS runtime_select,
        has_column_privilege('kartiseret_runtime', c.oid, 'source_url', 'INSERT') AS runtime_insert,
        has_table_privilege('kartiseret_runtime', c.oid, 'DELETE') AS runtime_delete,
        has_table_privilege('kartiseret_runtime', c.oid, 'UPDATE') AS runtime_update,
        has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
        has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'letterboxd_sources'
    `);
    expect(sourceRows).toEqual([
      {
        row_security: true,
        runtime_select: true,
        runtime_insert: true,
        runtime_delete: true,
        runtime_update: false,
        service_select: true,
        service_update: true,
      },
    ]);
    const { rows: internalRows } = await adminDatabase.pool.query<{
      table_name: string;
      row_security: boolean;
      runtime_select: boolean;
      service_select: boolean;
      service_update: boolean;
    }>(`
      SELECT
        c.relname AS table_name,
        c.relrowsecurity AS row_security,
        has_table_privilege('kartiseret_runtime', c.oid, 'SELECT') AS runtime_select,
        has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
        has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY(ARRAY['letterboxd_source_films', 'letterboxd_event_alerts'])
      ORDER BY c.relname
    `);
    expect(internalRows).toEqual([
      {
        table_name: "letterboxd_event_alerts",
        row_security: true,
        runtime_select: false,
        service_select: true,
        service_update: true,
      },
      {
        table_name: "letterboxd_source_films",
        row_security: true,
        runtime_select: false,
        service_select: true,
        service_update: true,
      },
    ]);
    const { rows: policies } = await adminDatabase.pool.query<{
      policyname: string;
      cmd: string;
    }>(`
      SELECT policyname, cmd
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'letterboxd_sources'
      ORDER BY policyname
    `);
    expect(policies).toEqual([
      { policyname: "api_own_delete", cmd: "DELETE" },
      { policyname: "api_own_insert", cmd: "INSERT" },
      { policyname: "api_own_select", cmd: "SELECT" },
    ]);
  });

  it("queries the same public catalog DTO and ordering from real Postgres", async () => {
    const response = await request(app).get("/api/v1/catalog/now-playing");
    expect(response.status).toBe(200);
    expect(response.body.error).toBeNull();

    const movies = response.body.data.movies as Array<Record<string, unknown>>;
    const fixture = movies.find((movie) => movie.tmdbId === "9100001");
    expect(fixture).toMatchObject({
      movieCode: "D01",
      title: "Dev Catalog Film",
      year: 2024,
      genres: ["Drama", "Mystery"],
      imdbRating: 7.6,
      rtAudienceRating: 92,
      runtime: 118,
      altOptions: [
        {
          tmdbId: "9100002",
          title: "Alternate Dev Film",
          year: 2023,
          posterUrl: null,
        },
      ],
    });
    expect(movies.some((movie) => movie.tmdbId === "9100002")).toBe(false);
    expect(movies.find((movie) => movie.tmdbId === "9100003")).toMatchObject({
      genres: [],
    });
    expect(JSON.stringify(response.body)).not.toContain("BigInt");
  });

  it("retains coming-soon release dates and updates them from later valid rows", async () => {
    const tmdbId = 9199988;
    const inserted = await adminDatabase.db
      .insert(schema.finalSoons)
      .values({
        tmdbId,
        englishTitle: "Release Date Archive Fixture",
        hebrewTitle: "Fixture",
        releaseDate: "2026-12-01",
      })
      .returning({ id: schema.finalSoons.id });

    try {
      const firstArchive = await runtimeDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      expect(firstArchive).toEqual([{ localReleaseDate: "2026-12-01" }]);

      await adminDatabase.db
        .update(schema.finalSoons)
        .set({ releaseDate: "2026-12-18" })
        .where(eq(schema.finalSoons.id, inserted[0]!.id));
      const updatedArchive = await runtimeDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      expect(updatedArchive).toEqual([{ localReleaseDate: "2026-12-18" }]);

      await expect(
        adminDatabase.pool.query(
          'UPDATE public."finalSoons" SET release_date = NULL WHERE id = $1',
          [inserted[0]!.id],
        ),
      ).rejects.toThrow();
      const afterMissingDate = await runtimeDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      expect(afterMissingDate).toEqual([{ localReleaseDate: "2026-12-18" }]);

      await adminDatabase.db
        .delete(schema.finalSoons)
        .where(eq(schema.finalSoons.id, inserted[0]!.id));
      const afterSoonCleanup = await runtimeDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      expect(afterSoonCleanup).toEqual([{ localReleaseDate: "2026-12-18" }]);
    } finally {
      await adminDatabase.db
        .delete(schema.finalSoons)
        .where(eq(schema.finalSoons.id, inserted[0]!.id));
      await adminDatabase.db
        .delete(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
    }
  });

  it("backfills release dates from coming-soon rows present before the migration", async () => {
    const tmdbId = 9499999;
    try {
      const archived = await runtimeDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));

      expect(archived).toEqual([{ localReleaseDate: "2026-12-09" }]);
    } finally {
      await adminDatabase.db
        .delete(schema.finalSoons)
        .where(eq(schema.finalSoons.tmdbId, tmdbId));
      await adminDatabase.db
        .delete(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
    }
  });

  it("can reapply the release-date migration without overwriting archived dates", async () => {
    const tmdbId = 9199967;
    const inserted = await adminDatabase.db
      .insert(schema.finalSoons)
      .values({
        tmdbId,
        englishTitle: "Idempotent Release Date Fixture",
        hebrewTitle: "מבחן אידמפוטנטי",
        releaseDate: "2026-12-09",
      })
      .returning({ id: schema.finalSoons.id });

    try {
      await adminDatabase.db
        .update(schema.movieReleaseDates)
        .set({ localReleaseDate: "2027-01-01" })
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));

      const repositoryRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../..",
      );
      const migration = await readFile(
        resolve(
          repositoryRoot,
          "supabase/migrations/20261026081601_movie_release_date_history.sql",
        ),
        "utf8",
      );
      await adminDatabase.pool.query(migration);

      const archived = await adminDatabase.db
        .select({ localReleaseDate: schema.movieReleaseDates.localReleaseDate })
        .from(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      expect(archived).toEqual([{ localReleaseDate: "2027-01-01" }]);
    } finally {
      await adminDatabase.db
        .delete(schema.finalSoons)
        .where(eq(schema.finalSoons.id, inserted[0]!.id));
      await adminDatabase.db
        .delete(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
    }
  });

  it("advances the catalog revision once per transaction when archived dates change", async () => {
    const tmdbId = 9199968;
    const client = await adminDatabase.pool.connect();
    try {
      await client.query(
        "DELETE FROM public.movie_release_dates WHERE tmdb_id = $1",
        [tmdbId],
      );
      const initial = BigInt(
        (
          await client.query(
            "SELECT revision::text FROM public.pipeline_catalog_revision WHERE singleton",
          )
        ).rows[0]!.revision,
      );

      await client.query("BEGIN");
      await client.query(
        "INSERT INTO public.movie_release_dates (tmdb_id, local_release_date) VALUES ($1, '2026-12-01')",
        [tmdbId],
      );
      await client.query(
        "UPDATE public.movie_release_dates SET local_release_date = '2026-12-18' WHERE tmdb_id = $1",
        [tmdbId],
      );
      const inTransaction = BigInt(
        (
          await client.query(
            "SELECT revision::text FROM public.pipeline_catalog_revision WHERE singleton",
          )
        ).rows[0]!.revision,
      );
      expect(inTransaction).toBe(initial + 1n);
      await client.query("COMMIT");

      const afterCommit = BigInt(
        (
          await client.query(
            "SELECT revision::text FROM public.pipeline_catalog_revision WHERE singleton",
          )
        ).rows[0]!.revision,
      );
      expect(afterCommit).toBe(initial + 1n);

      await client.query("BEGIN");
      await client.query(
        "INSERT INTO public.movie_release_dates (tmdb_id, local_release_date) VALUES ($1, '2026-12-18') ON CONFLICT (tmdb_id) DO NOTHING",
        [tmdbId],
      );
      await client.query("COMMIT");
      const afterNoop = BigInt(
        (
          await client.query(
            "SELECT revision::text FROM public.pipeline_catalog_revision WHERE singleton",
          )
        ).rows[0]!.revision,
      );
      expect(afterNoop).toBe(afterCommit);
    } finally {
      await client.query(
        "DELETE FROM public.movie_release_dates WHERE tmdb_id = $1",
        [tmdbId],
      );
      client.release();
    }
  });

  it("applies generated historical backfill SQL once and rejects a stale report", async () => {
    const tmdbId = 2120999998;
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "release-date-backfill-"),
    );
    const repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../..",
    );
    const backfillScript = resolve(
      repositoryRoot,
      "backend/utils/supabase/backfill_movie_release_dates.py",
    );
    const snapshotPath = join(temporaryDirectory, "snapshot.json");
    const outputDirectory = join(temporaryDirectory, "report");
    const artifactsRoot = join(temporaryDirectory, "artifacts");
    const runId = 991201;

    await mkdir(join(artifactsRoot, String(runId), "successful"), {
      recursive: true,
    });
    await writeFile(
      join(artifactsRoot, String(runId), "successful", "CCsoon-1.csv"),
      "english_title,hebrew_title,release_date,run_id\nBackfill SQL Fixture,Fixture,2031-06-20,991201\n",
    );

    try {
      await adminDatabase.db.insert(schema.finalMovies).values({
        tmdbId,
        englishTitle: "Backfill SQL Fixture",
      });
      const { rows } = await adminDatabase.pool.query<{ revision: string }>(`
        SELECT revision::text AS revision
        FROM public.pipeline_catalog_revision
        WHERE singleton
      `);
      const snapshot = {
        format_version: 1,
        project_ref: "kartiseret_test",
        catalog_revision: Number(rows[0]!.revision),
        visible_movies: [
          { tmdb_id: tmdbId, english_title: "Backfill SQL Fixture" },
        ],
        movie_titles: [
          {
            tmdb_id: tmdbId,
            title: "Backfill SQL Fixture",
            language: "en",
            source: "finalMovies",
          },
        ],
        title_fixes: [],
        release_dates: [],
        final_soon_dates: [],
        run_logs: [
          {
            run_id: runId,
            date_created: "2026-10-01 12:00:00",
            successful: false,
          },
        ],
      };
      await writeFile(snapshotPath, JSON.stringify(snapshot));

      const generated = spawnSync(
        "python3",
        [
          backfillScript,
          "--snapshot",
          snapshotPath,
          "--artifacts-root",
          artifactsRoot,
          "--output-dir",
          outputDirectory,
          "--as-of",
          "2026-10-26T00:00:00Z",
        ],
        { encoding: "utf8" },
      );
      expect(generated.status, generated.stderr || generated.stdout).toBe(0);
      const applySql = await readFile(
        join(outputDirectory, "apply.sql"),
        "utf8",
      );
      await adminDatabase.pool.query(applySql);

      const stored = await adminDatabase.pool.query<{
        local_release_date: string;
      }>(
        "SELECT local_release_date::text FROM public.movie_release_dates WHERE tmdb_id = $1",
        [tmdbId],
      );
      expect(stored.rows).toEqual([{ local_release_date: "2031-06-20" }]);

      await expect(adminDatabase.pool.query(applySql)).rejects.toThrow(
        "Backfill snapshot is stale",
      );
      const afterRetry = await adminDatabase.pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM public.movie_release_dates WHERE tmdb_id = $1",
        [tmdbId],
      );
      expect(afterRetry.rows[0]!.count).toBe(1);
    } finally {
      await adminDatabase.db
        .delete(schema.movieReleaseDates)
        .where(eq(schema.movieReleaseDates.tmdbId, tmdbId));
      await adminDatabase.db
        .delete(schema.finalMovies)
        .where(eq(schema.finalMovies.tmdbId, tmdbId));
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("loads local dates and counts only today-or-later showtimes across cities", async () => {
    const movieIds = [9199978, 9199979];
    const { rows } = await adminDatabase.pool.query<{
      today: string;
      yesterday: string;
      future: string;
    }>(`
      SELECT
        (now() AT TIME ZONE 'Asia/Jerusalem')::date::text AS today,
        ((now() AT TIME ZONE 'Asia/Jerusalem')::date - 1)::text AS yesterday,
        ((now() AT TIME ZONE 'Asia/Jerusalem')::date + 2)::text AS future
    `);
    const { today, yesterday, future } = rows[0]!;

    await adminDatabase.db.insert(schema.finalMovies).values([
      {
        tmdbId: movieIds[0]!,
        englishTitle: "Two Future Shows",
        popularity: 20,
      },
      { tmdbId: movieIds[1]!, englishTitle: "One Future Show", popularity: 10 },
    ]);
    await adminDatabase.db.insert(schema.movieReleaseDates).values([
      { tmdbId: movieIds[0]!, localReleaseDate: "2026-01-05" },
      { tmdbId: movieIds[1]!, localReleaseDate: "2026-02-05" },
    ]);
    const insertedShowtimes = await adminDatabase.db
      .insert(schema.finalShowtimes)
      .values([
        {
          tmdbId: movieIds[0]!,
          screeningCity: "Jerusalem",
          dateOfShowing: today,
          cinema: "Ranking Fixture A",
          showtime: "18:00:00",
        },
        {
          tmdbId: movieIds[0]!,
          screeningCity: "Tel Aviv",
          dateOfShowing: future,
          cinema: "Ranking Fixture B",
          showtime: "20:00:00",
        },
        {
          tmdbId: movieIds[0]!,
          screeningCity: "Haifa",
          dateOfShowing: yesterday,
          cinema: "Ranking Fixture C",
          showtime: "21:00:00",
        },
        {
          tmdbId: movieIds[1]!,
          screeningCity: "Beer Sheva",
          dateOfShowing: future,
          cinema: "Ranking Fixture D",
          showtime: "19:00:00",
        },
        {
          tmdbId: movieIds[1]!,
          screeningCity: "Eilat",
          dateOfShowing: yesterday,
          cinema: "Ranking Fixture E",
          showtime: "21:00:00",
        },
      ])
      .returning({ id: schema.finalShowtimes.id });

    try {
      const rows = await runtimeRepository.findNowPlayingRows();
      const byId = new Map(
        (rows as Array<Record<string, unknown>>)
          .filter((row) => movieIds.includes(Number(row.tmdbId)))
          .map((row) => [Number(row.tmdbId), row]),
      );

      expect(byId.get(movieIds[0]!)).toMatchObject({
        showtimeCount: 2,
        localReleaseDate: "2026-01-05",
      });
      expect(byId.get(movieIds[1]!)).toMatchObject({
        showtimeCount: 1,
        localReleaseDate: "2026-02-05",
      });
    } finally {
      await adminDatabase.db.delete(schema.finalShowtimes).where(
        inArray(
          schema.finalShowtimes.id,
          insertedShowtimes.map((row) => row.id),
        ),
      );
      await adminDatabase.db
        .delete(schema.movieReleaseDates)
        .where(inArray(schema.movieReleaseDates.tmdbId, movieIds));
      await adminDatabase.db
        .delete(schema.finalMovies)
        .where(inArray(schema.finalMovies.tmdbId, movieIds));
    }
  });

  it("reads coming-soon rows and permanent codes using the runtime role", async () => {
    const response = await request(app).get("/api/v1/catalog/coming-soon");
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      mode: "comingSoon",
      movieCodesStatus: "ready",
    });
    expect(response.body.data.movies).toContainEqual(
      expect.objectContaining({
        tmdbId: "9100011",
        movieCode: "D11",
        title: "Dev Coming Soon",
        releaseDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    expect(
      response.body.data.movies.some(
        (movie: { tmdbId: string }) => movie.tmdbId === "9100002",
      ),
    ).toBe(false);
  });

  it("uses full date bounds, optional movie filtering, and preserves local showtime strings", async () => {
    const { rows } = await adminDatabase.pool.query<{ date: string }>(
      "SELECT (CURRENT_DATE + 14)::text AS date",
    );
    const date = rows[0]!.date;
    const response = await request(app).get(
      `/api/v1/showtimes?city=Tel%20Aviv&startDate=${date}&endDate=${date}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.data.showtimes).toEqual([
      expect.objectContaining({
        tmdbId: "9100001",
        screeningCity: "Tel Aviv",
        dateOfShowing: date,
        cinema: "Development Cinema Tel Aviv",
        showtime: "19:30",
      }),
    ]);

    const unmatchedMovieResponse = await request(app).get(
      `/api/v1/showtimes?city=Tel%20Aviv&startDate=${date}&endDate=${date}&tmdbId=9100003`,
    );
    expect(unmatchedMovieResponse.status).toBe(200);
    expect(unmatchedMovieResponse.body.data.showtimes).toEqual([]);
  });

  it("returns every city's ticket availability and actual theater-city joins", async () => {
    const { rows } = await adminDatabase.pool.query<{ date: string }>(
      "SELECT (CURRENT_DATE + 14)::text AS date",
    );
    const date = rows[0]!.date;
    const availability = await request(app).get(
      `/api/v1/ticket-availability?tmdbId=9100001&fromDate=${date}`,
    );
    expect(availability.status).toBe(200);
    expect(
      new Set(
        availability.body.data.showtimes.map(
          (row: { screeningCity: string }) => row.screeningCity,
        ),
      ),
    ).toEqual(new Set(["Jerusalem", "Tel Aviv"]));
    expect(availability.body.data.showtimes).toContainEqual(
      expect.objectContaining({
        screeningCity: "Jerusalem",
        englishHref: "https://example.invalid/dev-screening-en",
        hebrewHref: "https://example.invalid/dev-screening-he",
      }),
    );

    const theaterResponse = await request(app).get("/api/v1/theaters");
    expect(theaterResponse.status).toBe(200);
    const jerusalem = theaterResponse.body.data.cities.find(
      (city: { name: string }) => city.name === "Jerusalem",
    );
    expect(jerusalem).toMatchObject({
      altSpellings: expect.arrayContaining(["Yerushalayim"]),
      latitude: 31.7683,
      neighboringCities: ["Mevaseret Zion"],
    });
    expect(theaterResponse.body.data.theaters).toContainEqual(
      expect.objectContaining({
        city: expect.objectContaining({ name: "Jerusalem" }),
        chain: "Development Cinema",
        location: "dev-fixture:jerusalem:cinema",
      }),
    );
  });

  it("returns more than one thousand same-day showtimes without truncation", async () => {
    const { rows } = await adminDatabase.pool.query<{ date: string }>(
      "SELECT (CURRENT_DATE + 14)::text AS date",
    );
    const date = rows[0]!.date;
    const fixtureRows = Array.from({ length: 1_001 }, (_, index) => ({
      englishTitle: "Pagination Fixture",
      screeningCity: "Tel Aviv",
      dateOfShowing: date,
      showtime: "21:00:00",
      cinema: `PR3 Pagination ${String(index).padStart(4, "0")}`,
      tmdbId: 9100001,
    }));
    const insertedRows = await adminDatabase.db
      .insert(schema.finalShowtimes)
      .values(fixtureRows)
      .returning({ id: schema.finalShowtimes.id });

    try {
      const response = await request(app).get(
        `/api/v1/showtimes?city=Tel%20Aviv&startDate=${date}&endDate=${date}&tmdbId=9100001`,
      );
      expect(response.status).toBe(200);
      expect(response.body.data.showtimes).toHaveLength(1_002);
      expect(
        response.body.data.showtimes.filter((row: { cinema: string }) =>
          row.cinema.startsWith("PR3 Pagination "),
        ),
      ).toHaveLength(1_001);
    } finally {
      await adminDatabase.db.delete(schema.finalShowtimes).where(
        inArray(
          schema.finalShowtimes.id,
          insertedRows.map((row) => row.id),
        ),
      );
    }
  });

  it("keeps SQL NULLS LAST behavior after DTO popularity normalization", async () => {
    const insertedIds = [9199991, 9199992];
    await adminDatabase.db.insert(schema.finalMovies).values([
      {
        tmdbId: 9199991,
        englishTitle: "Zero Popularity Dev Film",
        popularity: 0,
      },
      {
        tmdbId: 9199992,
        englishTitle: "Null Popularity Dev Film",
        popularity: null,
      },
    ]);
    try {
      const response = await request(app).get("/api/v1/catalog/now-playing");
      expect(response.status).toBe(200);
      expect(
        (response.body.data.movies as Array<{ tmdbId: string }>).map(
          (movie) => movie.tmdbId,
        ),
      ).toEqual(["9100001", "9199991", "9100003", "9199992"]);
    } finally {
      await adminDatabase.db
        .delete(schema.finalMovies)
        .where(inArray(schema.finalMovies.tmdbId, insertedIds));
    }
  });

  it("confirms public reads and identity-free private isolation", async () => {
    const visible = await runtimeDatabase.db
      .select({
        tmdbId: schema.finalMovies.tmdbId,
        soloUpdate: schema.finalMovies.soloUpdate,
      })
      .from(schema.finalMovies)
      .where(inArray(schema.finalMovies.tmdbId, [9100001, 9100002, 9100003]))
      .orderBy(asc(schema.finalMovies.tmdbId));

    expect(visible).toEqual([
      { tmdbId: 9100001, soloUpdate: false },
      { tmdbId: 9100002, soloUpdate: true },
      { tmdbId: 9100003, soloUpdate: false },
    ]);
    await expect(
      runtimeDatabase.db
        .select({ id: schema.finalSoons.id })
        .from(schema.finalSoons)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db
        .select({ id: schema.finalShowtimes.id })
        .from(schema.finalShowtimes)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db
        .select({ tmdbId: schema.finalThequeMovies.tmdbId })
        .from(schema.finalThequeMovies)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db
        .select({ id: schema.finalTheques.id })
        .from(schema.finalTheques)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db
        .select({ name: schema.cities.name })
        .from(schema.cities)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db
        .select({ location: schema.theaters.location })
        .from(schema.theaters)
        .limit(1),
    ).resolves.toBeDefined();
    await expect(
      runtimeDatabase.db.select().from(schema.userPreferences).limit(1),
    ).resolves.toEqual([]);
    await expect(
      runtimeDatabase.db
        .select()
        .from(schema.ticketAlertSubscriptions)
        .limit(1),
    ).rejects.toThrow();
    await expect(
      runtimeDatabase.db.select().from(schema.adminUsers).limit(1),
    ).rejects.toThrow();
  });

  it("serves seeded cinematheque screenings through the restricted API runtime", async () => {
    const dateResult = await adminDatabase.pool.query<{ date: string }>(
      "SELECT to_char(CURRENT_DATE + 21, 'YYYY-MM-DD') AS date",
    );
    const date = dateResult.rows[0]?.date;
    expect(date).toBeDefined();

    const response = await request(app).get(
      `/api/v1/cinematheques?city=Jerusalem&startDate=${date}&endDate=${date}`,
    );

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.data.movies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tmdbId: "9100012",
          title: "Dev Cinematheque Film",
        }),
      ]),
    );
    expect(response.body.data.showtimes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tmdbId: "9100012",
          screeningCity: "Jerusalem",
          cinema: "Development Cinematheque",
          dateOfShowing: date,
        }),
      ]),
    );
  });

  it("uses a metadata read for an empty code lookup and never builds invalid SQL", async () => {
    await expect(
      new DrizzleCatalogRepository(runtimeDatabase.db).findMovieCodes([]),
    ).resolves.toEqual(new Map());
  });

  it("preserves PostgreSQL bigint, exact numeric, calendar date, and local-time values", async () => {
    const largeMovieId = 9_007_199_254_740_993n;
    await adminDatabase.db
      .insert(schema.movieCodes)
      .values({ tmdbId: largeMovieId, movieCode: "L01" });
    const largeMovieCode = await adminDatabase.db
      .select({ tmdbId: schema.movieCodes.tmdbId })
      .from(schema.movieCodes)
      .where(eq(schema.movieCodes.tmdbId, largeMovieId));
    expect(largeMovieCode[0]?.tmdbId).toBe(largeMovieId);

    const cinemathequeMovie = await adminDatabase.db
      .select({
        imdbRating: schema.finalThequeMovies.imdbRating,
        imdbVotes: schema.finalThequeMovies.imdbVotes,
      })
      .from(schema.finalThequeMovies)
      .where(eq(schema.finalThequeMovies.tmdbId, 9100012));
    expect(cinemathequeMovie[0]?.imdbRating).toBe("7.1");
    expect(cinemathequeMovie[0]?.imdbVotes).toBe(400n);

    const screening = await adminDatabase.db
      .select({
        dateOfShowing: schema.finalShowtimes.dateOfShowing,
        showtime: schema.finalShowtimes.showtime,
      })
      .from(schema.finalShowtimes)
      .where(
        eq(schema.finalShowtimes.id, "00000000-0000-4000-8000-000000009001"),
      );
    expect(screening[0]?.dateOfShowing).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screening[0]?.showtime).toBe("19:30:00");

    const runLog = await adminDatabase.db
      .select({ dateCreated: schema.utilRunLogs.dateCreated })
      .from(schema.utilRunLogs)
      .where(eq(schema.utilRunLogs.runId, 9100000));
    const rawRunLog = await adminDatabase.pool.query<{
      date_created: string;
    }>(
      'SELECT date_created FROM public."utilRunLogs" WHERE run_id = $1',
      [9100000],
    );
    expect(runLog[0]?.dateCreated).toBe(rawRunLog.rows[0]?.date_created);
    expect(runLog[0]?.dateCreated).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/,
    );
    expect(runLog[0]?.dateCreated).not.toMatch(/[+-]\d{2}(?::?\d{2})?$/);

    const instant = await adminDatabase.db
      .select({ createdAt: schema.finalThequeMovies.createdAt })
      .from(schema.finalThequeMovies)
      .where(eq(schema.finalThequeMovies.tmdbId, 9100012));
    expect(instant[0]?.createdAt).toBeInstanceOf(Date);
    expect(Number.isNaN(instant[0]?.createdAt.getTime())).toBe(false);
  });

  it("uses an actual Drizzle transaction and rolls back after a later failure", async () => {
    await expect(
      adminDatabase.db.transaction(async (transaction) => {
        await transaction.insert(schema.utilRunLogs).values({ runId: 9199999 });
        throw new Error("rollback fixture transaction");
      }),
    ).rejects.toThrow("rollback fixture transaction");

    const afterRollback = await adminDatabase.db
      .select({ runId: schema.utilRunLogs.runId })
      .from(schema.utilRunLogs)
      .where(eq(schema.utilRunLogs.runId, 9199999));
    expect(afterRollback).toHaveLength(0);
  });

  it("keeps SQL CHECK failures enforced by PostgreSQL", async () => {
    await expect(
      adminDatabase.pool.query(
        "INSERT INTO public.\"movieCodes\" (tmdb_id, movie_code) VALUES (9199999, 'bad!')",
      ),
    ).rejects.toThrow();
    const absent = await adminDatabase.pool.query(
      'SELECT tmdb_id FROM public."movieCodes" WHERE tmdb_id = 9199999',
    );
    expect(absent.rows).toHaveLength(0);
  });

  it("translates an actual Drizzle/PostgreSQL repository error to a safe API response", async () => {
    const missingSchemaDatabase = createDatabase(runtimeConnectionString, {
      poolMax: 1,
      connectionOptions: "-c search_path=missing_catalog_schema",
      onPoolError: () => undefined,
    });
    try {
      const failingApp = createApp({
        catalogRepository: new DrizzleCatalogRepository(
          missingSchemaDatabase.db,
        ),
      });
      const response = await request(failingApp).get(
        "/api/v1/catalog/now-playing",
      );

      expect(response.status).toBe(503);
      expect(response.body.error).toEqual({
        code: "catalog_unavailable",
        message: "The catalog is temporarily unavailable.",
      });
      expect(JSON.stringify(response.body)).not.toContain(
        "missing_catalog_schema",
      );
    } finally {
      await missingSchemaDatabase.close();
    }
  });

  it("reports a missing movieCodes table instead of a healthy empty catalog", async () => {
    const schemaName = "catalog_readiness_test";
    await adminDatabase.pool.query(`CREATE SCHEMA ${schemaName}`);
    try {
      await adminDatabase.pool.query(`
        CREATE VIEW ${schemaName}."finalMovies" AS
        SELECT * FROM public."finalMovies"
        WHERE false
      `);
      await adminDatabase.pool.query(`
        CREATE VIEW ${schemaName}."finalShowtimes" AS
        SELECT * FROM public."finalShowtimes"
        WHERE false
      `);
      await adminDatabase.pool.query(`
        CREATE VIEW ${schemaName}."movie_release_dates" AS
        SELECT * FROM public."movie_release_dates"
        WHERE false
      `);
      await adminDatabase.pool.query(
        `GRANT USAGE ON SCHEMA ${schemaName} TO kartiseret_api`,
      );
      await adminDatabase.pool.query(
        `GRANT SELECT ON ${schemaName}."finalMovies", ${schemaName}."finalShowtimes", ${schemaName}."movie_release_dates" TO kartiseret_api`,
      );

      const readinessDatabase = createDatabase(runtimeConnectionString, {
        poolMax: 1,
        connectionOptions: `-c search_path=${schemaName}`,
        onPoolError: () => undefined,
      });
      try {
        const repository = new DrizzleCatalogRepository(readinessDatabase.db);
        expect(await repository.findNowPlayingRows()).toHaveLength(0);
        await expect(repository.findMovieCodes([])).rejects.toBeInstanceOf(
          CatalogDatabaseError,
        );
      } finally {
        await readinessDatabase.close();
      }
    } finally {
      await adminDatabase.pool.query(`DROP SCHEMA ${schemaName} CASCADE`);
    }
  });
});
