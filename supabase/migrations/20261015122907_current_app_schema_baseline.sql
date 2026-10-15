-- Authoritative app-schema baseline captured non-destructively from the active Kartiseret
-- Supabase project on 2026-10-15. Provider-owned auth/realtime/extensions objects are
-- deliberately excluded. See docs/backend-overhaul/pr-2-handoff.md for provenance.
-- This is a clean-project bootstrap; never apply it to an already populated database.

BEGIN;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kartiseret_runtime') THEN
    EXECUTE 'CREATE ROLE kartiseret_runtime NOLOGIN';
  END IF;
END;
$roles$;

CREATE TABLE public."cities" (
  "name" text NOT NULL,
  "alt_spellings" text[] NOT NULL DEFAULT '{}'::text[],
  "zoom_layer" real,
  "latitude" double precision,
  "longitude" double precision,
  "neighboring_cities" text[] NOT NULL DEFAULT '{}'::text[],
  CONSTRAINT "cities_pkey" PRIMARY KEY (name)
);

CREATE TABLE public."admin_users" (
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admin_users_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public."allShowtimes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone DEFAULT now(),
  "english_title" text,
  "release_year" smallint,
  "original_language" text,
  "screening_city" text,
  "date_of_showing" date,
  "showtime" time without time zone,
  "cinema" text,
  "english_href" text,
  "screening_type" text,
  "hebrew_title" text,
  "hebrew_href" text,
  "dub_language" text,
  "rating" text,
  "directed_by" text,
  "runtime" smallint,
  "screening_tech" text,
  "tmdb_id" integer,
  "run_id" integer,
  "cleaned" boolean DEFAULT false,
  "added" boolean,
  CONSTRAINT "allShowtimes_pkey" PRIMARY KEY (id)
);

CREATE TABLE public."allSoons" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jerusalem'::text),
  "hebrew_title" text,
  "english_title" text,
  "release_date" date,
  "original_language" text,
  "release_year" smallint,
  "rating" text,
  "directed_by" text,
  "runtime" smallint,
  "cinema" text,
  "run_id" integer,
  "cleaned" boolean NOT NULL DEFAULT false,
  "added" boolean NOT NULL DEFAULT false,
  CONSTRAINT "allsoons_pkey" PRIMARY KEY (id)
);

CREATE TABLE public."allTheques" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "english_title" text,
  "hebrew_title" text,
  "english_href" text,
  "hebrew_href" text,
  "screening_type" text,
  "screening_tech" text,
  "original_language" text,
  "dub_language" text,
  "date_of_showing" date,
  "showtime" time without time zone,
  "release_year" smallint,
  "release_date" date,
  "directed_by" text,
  "runtime" smallint,
  "rating" text,
  "screening_city" text,
  "cinema" text,
  "tmdb_id" integer,
  "run_id" integer,
  "cleaned" boolean NOT NULL DEFAULT false,
  "added" boolean NOT NULL DEFAULT false,
  CONSTRAINT "allTheques_pkey" PRIMARY KEY (id)
);
COMMENT ON TABLE public."allTheques" IS 'Raw cinematheque screening history from every scraper run';
COMMENT ON COLUMN public."allTheques"."cleaned" IS 'True after CinemathequesClean has processed this row';
COMMENT ON COLUMN public."allTheques"."added" IS 'True after CinemathequesTmdb has published this row';

CREATE TABLE public."finalMovies" (
  "popularity" double precision,
  "english_title" text NOT NULL,
  "release_year" bigint,
  "runtime" real,
  "tmdb_id" integer NOT NULL,
  "imdbRating" double precision,
  "imdbVotes" text DEFAULT ''::text,
  "rtAudienceRating" text DEFAULT ''::text,
  "en_poster" text,
  "backdrop" text,
  "imdb_id" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "run_id" integer,
  "rtAudienceVotes" integer,
  "rt_id" text,
  "lb_id" text,
  "lbRating" real,
  "lbVotes" integer,
  "tmdbRating" integer,
  "tmdbVotes" integer,
  "rtCriticRating" integer,
  "rtCriticVotes" integer,
  "en_trailer" text,
  "genres" text[],
  "alt_options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "solo_update" boolean NOT NULL DEFAULT false,
  CONSTRAINT "finalmovies_pkey" PRIMARY KEY (tmdb_id)
);

CREATE TABLE public."finalShowtimes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'Asia/Jerusalem'::text),
  "english_title" text,
  "original_language" text,
  "screening_city" text,
  "date_of_showing" date,
  "showtime" time without time zone,
  "cinema" text,
  "english_href" text,
  "screening_type" text,
  "hebrew_title" text,
  "hebrew_href" text,
  "dub_language" text,
  "screening_tech" text,
  "tmdb_id" integer,
  "run_id" integer,
  CONSTRAINT "finalshowtimes_pkey" PRIMARY KEY (id)
);

CREATE TABLE public."finalSoons" (
  "imdb_id" text,
  "english_title" text NOT NULL,
  "hebrew_title" text NOT NULL,
  "release_date" date NOT NULL,
  "en_poster" text,
  "backdrop" text,
  "tmdb_id" integer NOT NULL,
  "old_uuid" uuid,
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone DEFAULT now(),
  "run_id" integer,
  "release_year" smallint,
  "en_trailer" text,
  "genres" text[],
  "runtime" integer,
  "alt_options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "solo_update" boolean NOT NULL DEFAULT false,
  "popularity" double precision,
  CONSTRAINT "finalsoons_pkey" PRIMARY KEY (id)
);

CREATE TABLE public."finalThequeMovies" (
  "tmdb_id" integer NOT NULL,
  "english_title" text NOT NULL,
  "hebrew_title" text,
  "release_year" smallint,
  "runtime" smallint,
  "popularity" double precision,
  "imdb_id" text,
  "imdbRating" numeric(3,1),
  "imdbVotes" bigint,
  "rt_id" text,
  "rtAudienceRating" smallint,
  "rtAudienceVotes" bigint,
  "rtCriticRating" smallint,
  "rtCriticVotes" bigint,
  "lb_id" text,
  "lbRating" numeric(2,1),
  "lbVotes" bigint,
  "tmdbRating" smallint,
  "tmdbVotes" bigint,
  "en_poster" text,
  "backdrop" text,
  "en_trailer" text,
  "genres" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "alt_options" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "solo_update" boolean NOT NULL DEFAULT false,
  "run_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "finalThequeMovies_alt_options_array" CHECK (jsonb_typeof(alt_options) = 'array'::text),
  CONSTRAINT "finalThequeMovies_imdb_rating_valid" CHECK ("imdbRating" IS NULL OR "imdbRating" >= 0::numeric AND "imdbRating" <= 10::numeric),
  CONSTRAINT "finalThequeMovies_lb_rating_valid" CHECK ("lbRating" IS NULL OR "lbRating" >= 0::numeric AND "lbRating" <= 5::numeric),
  CONSTRAINT "finalThequeMovies_pkey" PRIMARY KEY (tmdb_id),
  CONSTRAINT "finalThequeMovies_release_year_valid" CHECK (release_year IS NULL OR release_year >= 1800 AND release_year <= 2200),
  CONSTRAINT "finalThequeMovies_rt_audience_rating_valid" CHECK ("rtAudienceRating" IS NULL OR "rtAudienceRating" >= 0 AND "rtAudienceRating" <= 100),
  CONSTRAINT "finalThequeMovies_rt_critic_rating_valid" CHECK ("rtCriticRating" IS NULL OR "rtCriticRating" >= 0 AND "rtCriticRating" <= 100),
  CONSTRAINT "finalThequeMovies_runtime_valid" CHECK (runtime IS NULL OR runtime > 0),
  CONSTRAINT "finalThequeMovies_tmdb_id_positive" CHECK (tmdb_id > 0),
  CONSTRAINT "finalThequeMovies_tmdb_rating_valid" CHECK ("tmdbRating" IS NULL OR "tmdbRating" >= 0 AND "tmdbRating" <= 100)
);
COMMENT ON TABLE public."finalThequeMovies" IS 'Enriched movie catalog used exclusively by cinematheque screenings';
COMMENT ON COLUMN public."finalThequeMovies"."tmdbRating" IS 'TMDb vote average converted to a 0-100 integer percentage';
COMMENT ON COLUMN public."finalThequeMovies"."solo_update" IS 'Requests a targeted CinemathequesUpdate refresh for this movie';

CREATE TABLE public."finalTheques" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "tmdb_id" integer,
  "english_title" text NOT NULL,
  "hebrew_title" text,
  "english_href" text,
  "hebrew_href" text,
  "screening_type" text,
  "screening_tech" text,
  "original_language" text,
  "dub_language" text,
  "date_of_showing" date NOT NULL,
  "showtime" time without time zone NOT NULL,
  "release_year" smallint,
  "release_date" date,
  "directed_by" text,
  "runtime" smallint,
  "rating" text,
  "screening_city" text NOT NULL,
  "cinema" text NOT NULL,
  "run_id" integer NOT NULL,
  CONSTRAINT "finalTheques_pkey" PRIMARY KEY (id),
  CONSTRAINT "finalTheques_release_year_valid" CHECK (release_year IS NULL OR release_year >= 1800 AND release_year <= 2200),
  CONSTRAINT "finalTheques_runtime_valid" CHECK (runtime IS NULL OR runtime > 0),
  CONSTRAINT "finalTheques_tmdb_id_positive" CHECK (tmdb_id IS NULL OR tmdb_id > 0)
);
COMMENT ON TABLE public."finalTheques" IS 'Latest published cinematheque screening schedule';
COMMENT ON COLUMN public."finalTheques"."tmdb_id" IS 'Joins to finalThequeMovies.tmdb_id; nullable for non-movie programs';

CREATE TABLE public."movieCodes" (
  "tmdb_id" bigint NOT NULL,
  "movie_code" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "movieCodes_movie_code_key" UNIQUE (movie_code),
  CONSTRAINT "movieCodes_pkey" PRIMARY KEY (tmdb_id),
  CONSTRAINT "movie_codes_movie_code_format" CHECK (movie_code ~ '^[0-9A-Za-z]{3}$'::text),
  CONSTRAINT "movie_codes_tmdb_id_positive" CHECK (tmdb_id > 0)
);

CREATE TABLE public."tableFixes" (
  "tmdb_id" text NOT NULL,
  "title_fix" text NOT NULL,
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  CONSTRAINT "tableFixes_pkey" PRIMARY KEY (id)
);

CREATE TABLE public."tableSkips" (
  "name_or_tmdb_id" text NOT NULL,
  CONSTRAINT "tableskips_pkey" PRIMARY KEY (name_or_tmdb_id)
);

CREATE TABLE public."theaters" (
  "chain" text,
  "address" text,
  "location" text NOT NULL,
  "latitude" double precision,
  "longitude" double precision,
  "theater_name" text,
  "city_name" text NOT NULL,
  CONSTRAINT "theaters_city_name_fkey" FOREIGN KEY (city_name) REFERENCES cities(name) ON UPDATE CASCADE,
  CONSTRAINT "theaters_pkey" PRIMARY KEY (location)
);

CREATE TABLE public."ticket_alert_subscriptions" (
  "user_id" uuid NOT NULL,
  "tmdb_id" bigint NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "notified_at" timestamp with time zone,
  "delivery_id" uuid,
  "delivery_title" text,
  "delivery_city" text,
  "delivery_date" date,
  "delivery_href" text,
  "delivery_movie_code" text,
  "delivery_attempts" integer NOT NULL DEFAULT 0,
  "last_delivery_attempt_at" timestamp with time zone,
  "last_delivery_error" text,
  "resend_email_id" text,
  CONSTRAINT "ticket_alert_subscriptions_delivery_attempts_nonnegative" CHECK (delivery_attempts >= 0),
  CONSTRAINT "ticket_alert_subscriptions_movie_code_format" CHECK (delivery_movie_code IS NULL OR delivery_movie_code ~ '^[0-9A-Za-z]{3}$'::text),
  CONSTRAINT "ticket_alert_subscriptions_pkey" PRIMARY KEY (user_id, tmdb_id),
  CONSTRAINT "ticket_alert_subscriptions_tmdb_id_positive" CHECK (tmdb_id > 0),
  CONSTRAINT "ticket_alert_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
COMMENT ON TABLE public."ticket_alert_subscriptions" IS 'One-shot user requests for an email when a coming-soon movie gains a ticket link.';
COMMENT ON COLUMN public."ticket_alert_subscriptions"."delivery_id" IS 'Stable per-user delivery batch ID, also used as the Resend idempotency key.';
COMMENT ON COLUMN public."ticket_alert_subscriptions"."delivery_href" IS 'Ticket URL selected when the delivery batch was claimed.';

CREATE TABLE public."userPreferences" (
  "user_id" uuid NOT NULL,
  "rating_sources" text[] NOT NULL DEFAULT '{}'::text[],
  "location" text,
  "site_color" text,
  CONSTRAINT "rating_sources_allowed" CHECK (rating_sources <@ ARRAY['imdbRating'::text, 'rtAudienceRating'::text, 'rtCriticRating'::text, 'lbRating'::text, 'tmdbRating'::text]),
  CONSTRAINT "userpreferences_pkey" PRIMARY KEY (user_id),
  CONSTRAINT "userpreferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public."utilAvgTime" (
  "name" text NOT NULL,
  "avg_time_intel_mac" double precision DEFAULT '0'::double precision,
  "num_runs_intel_mac" integer DEFAULT 0,
  "type" text,
  "num_runs_m5_mac" integer DEFAULT 0,
  "avg_time_m5_mac" double precision DEFAULT '0'::double precision,
  CONSTRAINT "utilavgtime_pkey" PRIMARY KEY (name)
);

CREATE TABLE public."utilRunLogs" (
  "run_id" integer NOT NULL,
  "selected_runners" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "successful" boolean,
  "total_time" double precision,
  "date_created" timestamp without time zone NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jerusalem'::text),
  "running_now" boolean NOT NULL DEFAULT false,
  "run_from" text,
  CONSTRAINT "utilrunlogs_pkey" PRIMARY KEY (run_id)
);
COMMENT ON COLUMN public."utilRunLogs"."date_created" IS 'Run creation wall-clock time in Asia/Jerusalem (including DST).';

CREATE INDEX "allTheques_cinema_run_id_idx" ON public."allTheques" USING btree (cinema, run_id DESC);
CREATE INDEX "allTheques_date_of_showing_idx" ON public."allTheques" USING btree (date_of_showing);
CREATE INDEX "allTheques_run_id_idx" ON public."allTheques" USING btree (run_id);
CREATE INDEX "allTheques_unadded_snapshot_idx" ON public."allTheques" USING btree (cinema, run_id DESC) WHERE (added IS FALSE);
CREATE INDEX "allTheques_uncleaned_idx" ON public."allTheques" USING btree (id) WHERE (cleaned IS FALSE);
CREATE INDEX final_showtimes_tmdb_city_date_idx ON public."finalShowtimes" USING btree (tmdb_id, screening_city, date_of_showing);
CREATE INDEX idx_finalshowtimes_city_date_tmdb ON public."finalShowtimes" USING btree (screening_city, date_of_showing, tmdb_id) WHERE ((screening_city IS NOT NULL) AND (date_of_showing IS NOT NULL) AND (tmdb_id IS NOT NULL));
CREATE INDEX "finalThequeMovies_genres_idx" ON public."finalThequeMovies" USING gin (genres);
CREATE UNIQUE INDEX "finalThequeMovies_imdb_id_unique_idx" ON public."finalThequeMovies" USING btree (imdb_id) WHERE ((imdb_id IS NOT NULL) AND (imdb_id <> ''::text));
CREATE INDEX "finalThequeMovies_popularity_idx" ON public."finalThequeMovies" USING btree (popularity DESC NULLS LAST);
CREATE INDEX "finalThequeMovies_release_year_idx" ON public."finalThequeMovies" USING btree (release_year);
CREATE INDEX "finalThequeMovies_solo_update_idx" ON public."finalThequeMovies" USING btree (tmdb_id) WHERE (solo_update IS TRUE);
CREATE INDEX "finalTheques_cinema_date_idx" ON public."finalTheques" USING btree (cinema, date_of_showing);
CREATE INDEX "finalTheques_cinema_run_id_idx" ON public."finalTheques" USING btree (cinema, run_id DESC);
CREATE INDEX "finalTheques_city_date_idx" ON public."finalTheques" USING btree (screening_city, date_of_showing);
CREATE INDEX "finalTheques_date_of_showing_idx" ON public."finalTheques" USING btree (date_of_showing);
CREATE INDEX "finalTheques_tmdb_date_idx" ON public."finalTheques" USING btree (tmdb_id, date_of_showing) WHERE (tmdb_id IS NOT NULL);
CREATE INDEX theaters_city_name_idx ON public.theaters USING btree (city_name);
CREATE INDEX ticket_alert_subscriptions_delivery_retry_idx ON public.ticket_alert_subscriptions USING btree (delivery_id, user_id) WHERE ((notified_at IS NULL) AND (delivery_id IS NOT NULL));
CREATE INDEX ticket_alert_subscriptions_pending_idx ON public.ticket_alert_subscriptions USING btree (created_at, user_id) WHERE (notified_at IS NULL);
CREATE INDEX ticket_alert_subscriptions_pending_movie_idx ON public.ticket_alert_subscriptions USING btree (tmdb_id, user_id) WHERE ((notified_at IS NULL) AND (delivery_id IS NULL));

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, kartiseret_runtime;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."cities" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."cities" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."cities" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."admin_users" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."admin_users" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."admin_users" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allShowtimes" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allShowtimes" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allShowtimes" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allSoons" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allSoons" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allSoons" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."allTheques" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalMovies" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalMovies" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalMovies" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalShowtimes" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalShowtimes" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalShowtimes" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalSoons" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalSoons" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalSoons" TO service_role;
GRANT SELECT ON TABLE public."finalThequeMovies" TO anon;
GRANT SELECT ON TABLE public."finalThequeMovies" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalThequeMovies" TO service_role;
GRANT SELECT ON TABLE public."finalTheques" TO anon;
GRANT SELECT ON TABLE public."finalTheques" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."finalTheques" TO service_role;
GRANT SELECT ON TABLE public."movieCodes" TO anon;
GRANT SELECT ON TABLE public."movieCodes" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."movieCodes" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableFixes" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableFixes" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableFixes" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableSkips" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableSkips" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."tableSkips" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."theaters" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."theaters" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."theaters" TO service_role;
GRANT DELETE ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."ticket_alert_subscriptions" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."userPreferences" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."userPreferences" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."userPreferences" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilAvgTime" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilAvgTime" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilAvgTime" TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilRunLogs" TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilRunLogs" TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public."utilRunLogs" TO service_role;
GRANT SELECT ON TABLE public."finalMovies", public."movieCodes" TO kartiseret_runtime;

GRANT INSERT ("user_id") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("user_id") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT INSERT ("tmdb_id") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("tmdb_id") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("created_at") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("notified_at") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("delivery_title") ON TABLE public."ticket_alert_subscriptions" TO authenticated;
GRANT SELECT ("delivery_date") ON TABLE public."ticket_alert_subscriptions" TO authenticated;

ALTER TABLE public."cities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."allShowtimes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."allSoons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."allTheques" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finalMovies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finalShowtimes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finalSoons" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finalThequeMovies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."finalTheques" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."movieCodes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tableFixes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."tableFixes" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."tableSkips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."theaters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ticket_alert_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."userPreferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."utilAvgTime" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."utilRunLogs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_users_no_delete_from_client" ON public."admin_users" FOR DELETE TO authenticated USING (false);
CREATE POLICY "admin_users_no_insert_from_client" ON public."admin_users" FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "admin_users_no_update_from_client" ON public."admin_users" FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "admin_users_select_own" ON public."admin_users" FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Enable read access for all users" ON public."allShowtimes" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."allSoons" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."allTheques" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."cities" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."finalMovies" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "finalmovies_admin_delete" ON public."finalMovies" FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "finalmovies_admin_update" ON public."finalMovies" FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Enable read access for all users" ON public."finalShowtimes" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "finalshowtimes_admin_update" ON public."finalShowtimes" FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Enable read access for all users" ON public."finalSoons" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "finalsoons_admin_delete" ON public."finalSoons" FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "finalsoons_admin_update" ON public."finalSoons" FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Public can read finalThequeMovies" ON public."finalThequeMovies" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Public can read finalTheques" ON public."finalTheques" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "movie_codes_public_read" ON public."movieCodes" FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Enable read access for all users" ON public."tableFixes" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "tablefixes_admin_delete" ON public."tableFixes" FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "tablefixes_admin_insert" ON public."tableFixes" FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "tablefixes_admin_update" ON public."tableFixes" FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM admin_users au
  WHERE (au.user_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "Enable read access for all users" ON public."tableSkips" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."theaters" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Users can cancel their ticket alerts" ON public."ticket_alert_subscriptions" FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can create their ticket alerts" ON public."ticket_alert_subscriptions" FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Users can read their ticket alerts" ON public."ticket_alert_subscriptions" FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));
CREATE POLICY "Insert own preferences" ON public."userPreferences" FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Read own preferences" ON public."userPreferences" FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Update own preferences" ON public."userPreferences" FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "Enable read access for all users" ON public."utilAvgTime" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "Enable read access for all users" ON public."utilRunLogs" FOR SELECT TO PUBLIC USING (true);
CREATE POLICY "kartiseret_api_catalog_read" ON public."finalMovies" FOR SELECT TO kartiseret_runtime USING (true);
CREATE POLICY "kartiseret_api_codes_read" ON public."movieCodes" FOR SELECT TO kartiseret_runtime USING (true);

-- Supabase owns this publication. Add only the app tables observed on the source project,
-- and leave provider-managed realtime publications/tables untouched.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'finalMovies') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public."finalMovies"';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'finalSoons') THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public."finalSoons"';
    END IF;
  END IF;
END;
$migration$;

COMMIT;
