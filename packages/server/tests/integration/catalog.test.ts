import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    expect(providerForeignKeys.map((key) => key.table_name)).toEqual([
      "admin_users",
      "coming_soon_date_watches",
      "letterboxd_event_alerts",
      "letterboxd_source_films",
      "letterboxd_sources",
      "ticket_alert_preferences",
      "ticket_alert_subscriptions",
      "user_movie_display_preferences",
      "userPreferences",
    ]);
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
      await adminDatabase.pool.query(
        `GRANT USAGE ON SCHEMA ${schemaName} TO kartiseret_api`,
      );
      await adminDatabase.pool.query(
        `GRANT SELECT ON ${schemaName}."finalMovies" TO kartiseret_api`,
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
