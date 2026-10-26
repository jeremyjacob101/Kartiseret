BEGIN;

CREATE TABLE IF NOT EXISTS public.movie_release_dates (
  tmdb_id integer NOT NULL,
  local_release_date date NOT NULL,
  CONSTRAINT movie_release_dates_pkey PRIMARY KEY (tmdb_id),
  CONSTRAINT movie_release_dates_tmdb_id_positive CHECK (tmdb_id > 0)
);

COMMENT ON TABLE public.movie_release_dates IS
  'Last confirmed local release date for each movie, retained after coming-soon rows expire; separate from immutable movieCodes.';
COMMENT ON COLUMN public.movie_release_dates.local_release_date IS
  'Most recently confirmed local cinema release date from the coming-soon catalog.';

ALTER TABLE public.movie_release_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.movie_release_dates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.movie_release_dates TO kartiseret_runtime;

DROP POLICY IF EXISTS kartiseret_api_movie_release_dates_read
  ON public.movie_release_dates;

CREATE POLICY kartiseret_api_movie_release_dates_read
  ON public.movie_release_dates
  FOR SELECT TO kartiseret_runtime
  USING (true);

DROP TRIGGER IF EXISTS movie_release_dates_bump_catalog_revision
  ON public.movie_release_dates;

CREATE TRIGGER movie_release_dates_bump_catalog_revision
  AFTER INSERT OR UPDATE OR DELETE
  ON public.movie_release_dates
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_internal.bump_catalog_revision();

INSERT INTO public.movie_release_dates (tmdb_id, local_release_date)
SELECT tmdb_id, min(release_date)
FROM public."finalSoons"
WHERE tmdb_id IS NOT NULL AND release_date IS NOT NULL
GROUP BY tmdb_id
ON CONFLICT (tmdb_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS final_showtimes_date_tmdb_idx
  ON public."finalShowtimes" (date_of_showing, tmdb_id)
  WHERE tmdb_id IS NOT NULL;

CREATE OR REPLACE FUNCTION pipeline_internal.capture_movie_release_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.tmdb_id IS NULL OR NEW.release_date IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.movie_release_dates (tmdb_id, local_release_date)
  VALUES (NEW.tmdb_id, NEW.release_date)
  ON CONFLICT (tmdb_id) DO UPDATE
    SET local_release_date = EXCLUDED.local_release_date
    WHERE public.movie_release_dates.local_release_date
      IS DISTINCT FROM EXCLUDED.local_release_date;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION pipeline_internal.capture_movie_release_date()
  FROM PUBLIC, anon, authenticated, service_role, kartiseret_runtime;

DROP TRIGGER IF EXISTS finalsoons_capture_movie_release_date
  ON public."finalSoons";

CREATE TRIGGER finalsoons_capture_movie_release_date
  AFTER INSERT OR UPDATE OF tmdb_id, release_date
  ON public."finalSoons"
  FOR EACH ROW
  EXECUTE FUNCTION pipeline_internal.capture_movie_release_date();

COMMIT;
