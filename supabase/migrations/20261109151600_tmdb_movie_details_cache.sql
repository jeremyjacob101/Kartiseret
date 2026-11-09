BEGIN;

CREATE TABLE public.tmdb_movie_details_cache (
  tmdb_id integer PRIMARY KEY CHECK (tmdb_id > 0),
  response_profile text NOT NULL CHECK (
    response_profile = 'en-US:external_ids,credits,videos:v1'
  ),
  payload jsonb NOT NULL CHECK (
    COALESCE(jsonb_typeof(payload) = 'object', false)
    AND COALESCE(jsonb_typeof(payload -> 'title') = 'string', false)
    AND COALESCE(jsonb_typeof(payload -> 'original_title') = 'string', false)
    AND COALESCE(length(btrim(payload ->> 'original_title')) > 0, false)
    AND COALESCE(payload ->> 'id' = tmdb_id::text, false)
    AND COALESCE(jsonb_typeof(payload -> 'external_ids') = 'object', false)
    AND COALESCE(jsonb_typeof(payload -> 'credits' -> 'crew') = 'array', false)
    AND COALESCE(jsonb_typeof(payload -> 'videos' -> 'results') = 'array', false)
  ),
  original_release_date date,
  fetched_at timestamptz NOT NULL,
  cache_format_version smallint NOT NULL CHECK (cache_format_version = 1),
  CONSTRAINT tmdb_movie_details_cache_release_date_matches_payload
    CHECK (
      original_release_date IS NOT DISTINCT FROM
      NULLIF(payload ->> 'release_date', '')::date
    )
);

COMMENT ON TABLE public.tmdb_movie_details_cache IS
  'Backend-only validated TMDb movie detail responses; archived titles are reused by release year.';
COMMENT ON COLUMN public.tmdb_movie_details_cache.original_release_date IS
  'TMDb movie release_date used for archive eligibility, never a local rerelease date.';

ALTER TABLE public.tmdb_movie_details_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.tmdb_movie_details_cache
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.tmdb_movie_details_cache
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
