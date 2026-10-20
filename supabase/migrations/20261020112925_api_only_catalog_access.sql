-- Route public catalog access through the restricted Kartiseret API role.
-- Python ingestion and maintenance jobs keep using service_role; their grants
-- are deliberately untouched.
BEGIN;

GRANT USAGE ON SCHEMA public TO kartiseret_runtime;
GRANT SELECT ON TABLE
  public."finalMovies",
  public."finalSoons",
  public."finalShowtimes",
  public."movieCodes",
  public.cities,
  public.theaters
TO kartiseret_runtime;

-- PR3 added these policies, but the next migration removed them while the
-- broader PUBLIC policies were still active. Restore the restricted policies
-- before removing those broad paths.
CREATE POLICY "kartiseret_api_coming_soon_read"
  ON public."finalSoons"
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_showtimes_read"
  ON public."finalShowtimes"
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_cities_read"
  ON public.cities
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_theaters_read"
  ON public.theaters
  FOR SELECT TO kartiseret_runtime
  USING (true);

-- Remove legacy read policies from API catalog tables and tables that are
-- internal to the Python worker. Keep the existing runtime/admin policies.
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."allShowtimes";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."allSoons";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."allTheques";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public.cities;
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."finalMovies";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."finalShowtimes";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."finalSoons";
DROP POLICY IF EXISTS "Public can read finalThequeMovies"
  ON public."finalThequeMovies";
DROP POLICY IF EXISTS "Public can read finalTheques"
  ON public."finalTheques";
DROP POLICY IF EXISTS "movie_codes_public_read"
  ON public."movieCodes";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."tableFixes";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."tableSkips";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public.theaters;
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."utilAvgTime";
DROP POLICY IF EXISTS "Enable read access for all users"
  ON public."utilRunLogs";

-- The browser no longer uses Supabase's Data API for application data.
-- Revoke all table privileges, including non-SELECT operations that RLS does
-- not govern (for example TRUNCATE), while keeping API and service roles.
REVOKE ALL PRIVILEGES ON TABLE
  public."allShowtimes",
  public."allSoons",
  public."allTheques",
  public.cities,
  public."finalMovies",
  public."finalShowtimes",
  public."finalSoons",
  public."finalThequeMovies",
  public."finalTheques",
  public."movieCodes",
  public."tableFixes",
  public."tableSkips",
  public.theaters,
  public."utilAvgTime",
  public."utilRunLogs"
FROM anon, authenticated;

-- Future tables created by the migration owner must be explicitly granted to
-- the roles that need them instead of inheriting broad browser access.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

COMMIT;
