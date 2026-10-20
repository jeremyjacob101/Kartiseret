import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date", precision: 6 });
const calendarDate = (name: string) => date(name, { mode: "string" });
const localTime = (name: string) => time(name, { precision: 6 });

// These declarations map existing SQL-owned tables. They are not a migration
// source; Supabase SQL remains the only authority for DDL, RLS, grants, and
// provider-owned auth.users foreign keys.
export const cities = pgTable("cities", {
  name: text("name").primaryKey(),
  altSpellings: text("alt_spellings").array().notNull().default([]),
  zoomLayer: real("zoom_layer"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  neighboringCities: text("neighboring_cities").array().notNull().default([]),
});

export const adminUsers = pgTable("admin_users", {
  userId: uuid("user_id").primaryKey(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const allShowtimes = pgTable("allShowtimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at").defaultNow(),
  englishTitle: text("english_title"),
  releaseYear: smallint("release_year"),
  originalLanguage: text("original_language"),
  screeningCity: text("screening_city"),
  dateOfShowing: calendarDate("date_of_showing"),
  showtime: localTime("showtime"),
  cinema: text("cinema"),
  englishHref: text("english_href"),
  screeningType: text("screening_type"),
  hebrewTitle: text("hebrew_title"),
  hebrewHref: text("hebrew_href"),
  dubLanguage: text("dub_language"),
  rating: text("rating"),
  directedBy: text("directed_by"),
  runtime: smallint("runtime"),
  screeningTech: text("screening_tech"),
  tmdbId: integer("tmdb_id"),
  runId: integer("run_id"),
  cleaned: boolean("cleaned").default(false),
  added: boolean("added"),
});

export const allSoons = pgTable("allSoons", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at")
    .notNull()
    .default(sql`(now() AT TIME ZONE 'Asia/Jerusalem'::text)`),
  hebrewTitle: text("hebrew_title"),
  englishTitle: text("english_title"),
  releaseDate: calendarDate("release_date"),
  originalLanguage: text("original_language"),
  releaseYear: smallint("release_year"),
  rating: text("rating"),
  directedBy: text("directed_by"),
  runtime: smallint("runtime"),
  cinema: text("cinema"),
  runId: integer("run_id"),
  cleaned: boolean("cleaned").notNull().default(false),
  added: boolean("added").notNull().default(false),
});

export const allTheques = pgTable("allTheques", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at").notNull().defaultNow(),
  englishTitle: text("english_title"),
  hebrewTitle: text("hebrew_title"),
  englishHref: text("english_href"),
  hebrewHref: text("hebrew_href"),
  screeningType: text("screening_type"),
  screeningTech: text("screening_tech"),
  originalLanguage: text("original_language"),
  dubLanguage: text("dub_language"),
  dateOfShowing: calendarDate("date_of_showing"),
  showtime: localTime("showtime"),
  releaseYear: smallint("release_year"),
  releaseDate: calendarDate("release_date"),
  directedBy: text("directed_by"),
  runtime: smallint("runtime"),
  rating: text("rating"),
  screeningCity: text("screening_city"),
  cinema: text("cinema"),
  tmdbId: integer("tmdb_id"),
  runId: integer("run_id"),
  cleaned: boolean("cleaned").notNull().default(false),
  added: boolean("added").notNull().default(false),
});

export const finalMovies = pgTable("finalMovies", {
  popularity: doublePrecision("popularity"),
  englishTitle: text("english_title").notNull(),
  releaseYear: bigint("release_year", { mode: "bigint" }),
  runtime: real("runtime"),
  tmdbId: integer("tmdb_id").primaryKey(),
  imdbRating: doublePrecision("imdbRating"),
  imdbVotes: text("imdbVotes").default(""),
  rtAudienceRating: text("rtAudienceRating").default(""),
  enPoster: text("en_poster"),
  backdrop: text("backdrop"),
  imdbId: text("imdb_id"),
  createdAt: instant("created_at").defaultNow(),
  runId: integer("run_id"),
  rtAudienceVotes: integer("rtAudienceVotes"),
  rtId: text("rt_id"),
  lbId: text("lb_id"),
  lbRating: real("lbRating"),
  lbVotes: integer("lbVotes"),
  tmdbRating: integer("tmdbRating"),
  tmdbVotes: integer("tmdbVotes"),
  rtCriticRating: integer("rtCriticRating"),
  rtCriticVotes: integer("rtCriticVotes"),
  enTrailer: text("en_trailer"),
  // PostgreSQL permits NULL here. Keep that physical distinction visible.
  genres: text("genres").array(),
  altOptions: jsonb("alt_options").$type<JsonValue>().notNull().default([]),
  soloUpdate: boolean("solo_update").notNull().default(false),
});

export const finalShowtimes = pgTable("finalShowtimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at").default(
    sql`(now() AT TIME ZONE 'Asia/Jerusalem'::text)`,
  ),
  englishTitle: text("english_title"),
  originalLanguage: text("original_language"),
  screeningCity: text("screening_city"),
  dateOfShowing: calendarDate("date_of_showing"),
  showtime: localTime("showtime"),
  cinema: text("cinema"),
  englishHref: text("english_href"),
  screeningType: text("screening_type"),
  hebrewTitle: text("hebrew_title"),
  hebrewHref: text("hebrew_href"),
  dubLanguage: text("dub_language"),
  screeningTech: text("screening_tech"),
  tmdbId: integer("tmdb_id"),
  runId: integer("run_id"),
});

export const finalSoons = pgTable("finalSoons", {
  imdbId: text("imdb_id"),
  englishTitle: text("english_title").notNull(),
  hebrewTitle: text("hebrew_title").notNull(),
  releaseDate: calendarDate("release_date").notNull(),
  enPoster: text("en_poster"),
  backdrop: text("backdrop"),
  tmdbId: integer("tmdb_id").notNull(),
  oldUuid: uuid("old_uuid"),
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at").defaultNow(),
  runId: integer("run_id"),
  releaseYear: smallint("release_year"),
  enTrailer: text("en_trailer"),
  genres: text("genres").array(),
  runtime: integer("runtime"),
  altOptions: jsonb("alt_options").$type<JsonValue>().notNull().default([]),
  soloUpdate: boolean("solo_update").notNull().default(false),
  popularity: doublePrecision("popularity"),
});

export const finalThequeMovies = pgTable("finalThequeMovies", {
  tmdbId: integer("tmdb_id").primaryKey(),
  englishTitle: text("english_title").notNull(),
  hebrewTitle: text("hebrew_title"),
  releaseYear: smallint("release_year"),
  runtime: smallint("runtime"),
  popularity: doublePrecision("popularity"),
  imdbId: text("imdb_id"),
  imdbRating: numeric("imdbRating", { precision: 3, scale: 1 }),
  imdbVotes: bigint("imdbVotes", { mode: "bigint" }),
  rtId: text("rt_id"),
  rtAudienceRating: smallint("rtAudienceRating"),
  rtAudienceVotes: bigint("rtAudienceVotes", { mode: "bigint" }),
  rtCriticRating: smallint("rtCriticRating"),
  rtCriticVotes: bigint("rtCriticVotes", { mode: "bigint" }),
  lbId: text("lb_id"),
  lbRating: numeric("lbRating", { precision: 2, scale: 1 }),
  lbVotes: bigint("lbVotes", { mode: "bigint" }),
  tmdbRating: smallint("tmdbRating"),
  tmdbVotes: bigint("tmdbVotes", { mode: "bigint" }),
  enPoster: text("en_poster"),
  backdrop: text("backdrop"),
  enTrailer: text("en_trailer"),
  genres: text("genres").array().notNull().default([]),
  altOptions: jsonb("alt_options").$type<JsonValue>().notNull().default([]),
  soloUpdate: boolean("solo_update").notNull().default(false),
  runId: integer("run_id"),
  createdAt: instant("created_at").notNull().defaultNow(),
});

export const finalTheques = pgTable("finalTheques", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: instant("created_at").notNull().defaultNow(),
  tmdbId: integer("tmdb_id"),
  englishTitle: text("english_title").notNull(),
  hebrewTitle: text("hebrew_title"),
  englishHref: text("english_href"),
  hebrewHref: text("hebrew_href"),
  screeningType: text("screening_type"),
  screeningTech: text("screening_tech"),
  originalLanguage: text("original_language"),
  dubLanguage: text("dub_language"),
  dateOfShowing: calendarDate("date_of_showing").notNull(),
  showtime: localTime("showtime").notNull(),
  releaseYear: smallint("release_year"),
  releaseDate: calendarDate("release_date"),
  directedBy: text("directed_by"),
  runtime: smallint("runtime"),
  rating: text("rating"),
  screeningCity: text("screening_city").notNull(),
  cinema: text("cinema").notNull(),
  runId: integer("run_id").notNull(),
});

export const movieCodes = pgTable(
  "movieCodes",
  {
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).primaryKey(),
    movieCode: text("movie_code").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
  },
  (table) => [unique("movieCodes_movie_code_key").on(table.movieCode)],
);

export const tableFixes = pgTable("tableFixes", {
  tmdbId: text("tmdb_id").notNull(),
  titleFix: text("title_fix").notNull(),
  id: uuid("id").primaryKey().defaultRandom(),
});

export const tableSkips = pgTable("tableSkips", {
  nameOrTmdbId: text("name_or_tmdb_id").primaryKey(),
});

export const theaters = pgTable("theaters", {
  chain: text("chain"),
  address: text("address"),
  location: text("location").primaryKey(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  theaterName: text("theater_name"),
  cityName: text("city_name")
    .notNull()
    .references(() => cities.name, { onUpdate: "cascade" }),
});

export const ticketAlertSubscriptions = pgTable(
  "ticket_alert_subscriptions",
  {
    // user_id also references provider-owned auth.users in SQL. Do not declare
    // an ORM-owned auth schema here; Better Auth owns identity in a later PR.
    userId: uuid("user_id").notNull(),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    notifiedAt: instant("notified_at"),
    deliveryId: uuid("delivery_id"),
    deliveryTitle: text("delivery_title"),
    deliveryCity: text("delivery_city"),
    deliveryDate: calendarDate("delivery_date"),
    deliveryHref: text("delivery_href"),
    deliveryMovieCode: text("delivery_movie_code"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryAttemptAt: instant("last_delivery_attempt_at"),
    lastDeliveryError: text("last_delivery_error"),
    resendEmailId: text("resend_email_id"),
  },
  (table) => [
    primaryKey({
      name: "ticket_alert_subscriptions_pkey",
      columns: [table.userId, table.tmdbId],
    }),
  ],
);

export const userPreferences = pgTable("userPreferences", {
  signupInitialized: boolean("signup_initialized").notNull().default(false),
  // user_id references provider-owned auth.users in SQL.
  userId: uuid("user_id").primaryKey(),
  ratingSources: text("rating_sources").array().notNull().default([]),
  location: text("location"),
  siteColor: text("site_color"),
});

export const utilAvgTime = pgTable("utilAvgTime", {
  name: text("name").primaryKey(),
  avgTimeIntelMac: doublePrecision("avg_time_intel_mac").default(0),
  numRunsIntelMac: integer("num_runs_intel_mac").default(0),
  type: text("type"),
  numRunsM5Mac: integer("num_runs_m5_mac").default(0),
  avgTimeM5Mac: doublePrecision("avg_time_m5_mac").default(0),
});

export const utilRunLogs = pgTable("utilRunLogs", {
  runId: integer("run_id").primaryKey(),
  selectedRunners: jsonb("selected_runners")
    .$type<JsonValue>()
    .notNull()
    .default([]),
  successful: boolean("successful"),
  totalTime: doublePrecision("total_time"),
  // This is a Jerusalem wall-clock timestamp without a timezone, not an instant.
  dateCreated: timestamp("date_created", { mode: "string", precision: 6 })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem'::text)`),
  runningNow: boolean("running_now").notNull().default(false),
  runFrom: text("run_from"),
});

export const applicationTables = {
  cities,
  adminUsers,
  allShowtimes,
  allSoons,
  allTheques,
  finalMovies,
  finalShowtimes,
  finalSoons,
  finalThequeMovies,
  finalTheques,
  movieCodes,
  tableFixes,
  tableSkips,
  theaters,
  ticketAlertSubscriptions,
  userPreferences,
  utilAvgTime,
  utilRunLogs,
} as const;

export type ApplicationTableName = keyof typeof applicationTables;
