import { user as authUser } from "../auth/schema.js";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  foreignKey,
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
import type {
  TicketAlertCriteria,
  TicketAlertCriteriaOverride,
} from "@kartiseret/contracts/private-data";

type JsonValue =
  string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date", precision: 6 });
const calendarDate = (name: string) => date(name, { mode: "string" });
const localTime = (name: string) => time(name, { precision: 6 });

// These declarations map existing SQL-owned tables. They are not a migration
// source; Supabase SQL remains the only authority for DDL, RLS, grants, and
// application identity foreign keys.
export const cities = pgTable("cities", {
  name: text("name").primaryKey(),
  altSpellings: text("alt_spellings").array().notNull().default([]),
  zoomLayer: real("zoom_layer"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  neighboringCities: text("neighboring_cities").array().notNull().default([]),
});

export const adminUsers = pgTable("admin_users", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
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
  snapshotId: uuid("snapshot_id"),
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
  snapshotId: uuid("snapshot_id"),
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
  snapshotId: uuid("snapshot_id"),
  cleaned: boolean("cleaned").notNull().default(false),
  added: boolean("added").notNull().default(false),
});

export const finalMovies = pgTable("finalMovies", {
  providerFreshness: jsonb("provider_freshness")
    .$type<JsonValue>()
    .notNull()
    .default({}),
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
  providerFreshness: jsonb("provider_freshness")
    .$type<JsonValue>()
    .notNull()
    .default({}),
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
  providerFreshness: jsonb("provider_freshness")
    .$type<JsonValue>()
    .notNull()
    .default({}),
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

export const movieReleaseDates = pgTable("movie_release_dates", {
  tmdbId: integer("tmdb_id").primaryKey(),
  localReleaseDate: calendarDate("local_release_date").notNull(),
});

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
    // Identity references point to the app-owned auth schema.
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
    baselineCities: text("baseline_cities").array().notNull().default([]),
    criteriaOverrides: jsonb("criteria_overrides")
      .$type<TicketAlertCriteriaOverride>()
      .notNull()
      .default({}),
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

export const ticketAlertPreferences = pgTable("ticket_alert_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
  cities: text("cities").array(),
  notificationMode: text("notification_mode")
    .notNull()
    .default("first_any_city"),
  filterExclusions: jsonb("filter_exclusions")
    .$type<TicketAlertCriteria["filters"]>()
    .notNull()
    .default({
      showType: [],
      screenFormat: [],
      screeningTech: [],
      dubLanguage: [],
    }),
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

export const comingSoonDateWatches = pgTable(
  "coming_soon_date_watches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
    title: text("title").notNull(),
    releaseYear: smallint("release_year"),
    posterPath: text("poster_path"),
    createdAt: instant("created_at").notNull().defaultNow(),
    notifiedAt: instant("notified_at"),
    deliveryId: uuid("delivery_id"),
    deliveryTitle: text("delivery_title"),
    deliveryDate: calendarDate("delivery_date"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryAttemptAt: instant("last_delivery_attempt_at"),
    lastDeliveryError: text("last_delivery_error"),
    resendEmailId: text("resend_email_id"),
  },
  (table) => [
    primaryKey({
      name: "coming_soon_date_watches_pkey",
      columns: [table.userId, table.tmdbId],
    }),
  ],
);

export const userMovieDisplayPreferences = pgTable(
  "user_movie_display_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
    title: text("title").notNull(),
    releaseYear: smallint("release_year"),
    treatment: text("treatment").notNull(),
    hideBackdrop: boolean("hide_backdrop").notNull().default(true),
  },
  (table) => [
    primaryKey({
      name: "user_movie_display_preferences_pkey",
      columns: [table.userId, table.tmdbId],
    }),
  ],
);

export const letterboxdSources = pgTable(
  "letterboxd_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url").notNull(),
    sourceType: text("source_type").notNull(),
    createdAt: instant("created_at").notNull().defaultNow(),
    lastSyncAttemptAt: instant("last_sync_attempt_at"),
    lastSuccessfulSyncAt: instant("last_successful_sync_at"),
    lastSyncError: text("last_sync_error"),
    filmCount: integer("film_count").notNull().default(0),
    matchedFilmCount: integer("matched_film_count").notNull().default(0),
  },
  (table) => [
    unique("letterboxd_sources_id_user_id_key").on(table.id, table.userId),
    unique("letterboxd_sources_user_source_url_key").on(
      table.userId,
      table.sourceUrl,
    ),
  ],
);

export const letterboxdSourceFilms = pgTable(
  "letterboxd_source_films",
  {
    sourceId: uuid("source_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    letterboxdSlug: text("letterboxd_slug").notNull(),
    title: text("title").notNull(),
    releaseYear: smallint("release_year"),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }),
    firstSeenAt: instant("first_seen_at").notNull().defaultNow(),
    lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
    removedAt: instant("removed_at"),
    needsBaseline: boolean("needs_baseline").notNull().default(true),
  },
  (table) => [
    primaryKey({
      name: "letterboxd_source_films_pkey",
      columns: [table.sourceId, table.letterboxdSlug],
    }),
    foreignKey({
      name: "letterboxd_source_films_source_user_fkey",
      columns: [table.sourceId, table.userId],
      foreignColumns: [letterboxdSources.id, letterboxdSources.userId],
    }).onDelete("cascade"),
  ],
);

export const letterboxdEventAlerts = pgTable(
  "letterboxd_event_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
    eventKey: text("event_key").notNull(),
    eventType: text("event_type").notNull(),
    eventPayload: jsonb("event_payload")
      .$type<Record<string, JsonValue>>()
      .notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: instant("created_at").notNull().defaultNow(),
    deliveryId: uuid("delivery_id"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryAttemptAt: instant("last_delivery_attempt_at"),
    lastDeliveryError: text("last_delivery_error"),
    notifiedAt: instant("notified_at"),
    resendEmailId: text("resend_email_id"),
  },
  (table) => [
    unique("letterboxd_event_alerts_user_event_key").on(
      table.userId,
      table.eventKey,
    ),
  ],
);

export const movieNotificationEvents = pgTable("movie_notification_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" }),
  tmdbId: bigint("tmdb_id", { mode: "bigint" }).notNull(),
  eventType: text("event_type").notNull(),
  scopeCity: text("scope_city").notNull(),
  status: text("status").notNull(),
  eventPayload: jsonb("event_payload")
    .$type<Record<string, JsonValue>>()
    .notNull(),
  notifiedAt: instant("notified_at"),
  createdAt: instant("created_at").notNull().defaultNow(),
  deliveryId: uuid("delivery_id"),
});

export const movieNotificationDeliveries = pgTable(
  "movie_notification_deliveries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    events: jsonb("events").$type<JsonValue[]>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    firstAttemptAt: instant("first_attempt_at"),
    emailSnapshot: jsonb("email_snapshot").$type<JsonValue>(),
    createdAt: instant("created_at").notNull().defaultNow(),
    notifiedAt: instant("notified_at"),
    resendEmailId: text("resend_email_id"),
    lastError: text("last_error"),
  },
);

export const userPreferences = pgTable("userPreferences", {
  signupInitialized: boolean("signup_initialized").notNull().default(false),
  // Identity references point to the app-owned auth schema.
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUser.id, { onDelete: "cascade" }),
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
  movieNotificationEvents,
  movieNotificationDeliveries,
  cities,
  comingSoonDateWatches,
  letterboxdSources,
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
  movieReleaseDates,
  tableFixes,
  tableSkips,
  theaters,
  ticketAlertPreferences,
  ticketAlertSubscriptions,
  userMovieDisplayPreferences,
  userPreferences,
  utilAvgTime,
  utilRunLogs,
} as const;

export type ApplicationTableName = keyof typeof applicationTables;
