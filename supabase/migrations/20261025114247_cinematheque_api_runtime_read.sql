-- Allow the restricted public API runtime to read the published
-- cinematheque catalog. Browser roles remain unable to read these tables.
BEGIN;

GRANT SELECT ON TABLE
  public."finalThequeMovies",
  public."finalTheques"
TO kartiseret_runtime;

DROP POLICY IF EXISTS "kartiseret_api_cinematheque_movies_read"
  ON public."finalThequeMovies";
CREATE POLICY "kartiseret_api_cinematheque_movies_read"
  ON public."finalThequeMovies"
  FOR SELECT TO kartiseret_runtime
  USING (true);

DROP POLICY IF EXISTS "kartiseret_api_cinematheque_showtimes_read"
  ON public."finalTheques";
CREATE POLICY "kartiseret_api_cinematheque_showtimes_read"
  ON public."finalTheques"
  FOR SELECT TO kartiseret_runtime
  USING (true);

COMMIT;
