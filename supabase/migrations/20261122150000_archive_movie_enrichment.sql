BEGIN;

CREATE TABLE public.archived_movie_ratings_cache (
  tmdb_id integer NOT NULL CHECK (tmdb_id > 0),
  provider text NOT NULL CHECK (provider IN ('letterboxd', 'rotten_tomatoes', 'imdb')),
  provider_identity text,
  rating_values jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(rating_values) = 'object'),
  outcome text NOT NULL CHECK (outcome IN (
    'success', 'no_score', 'no_listing', 'no_data', 'failed',
    'rate_limited', 'blocked', 'parse_error'
  )),
  reason text,
  source jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(source) = 'object'),
  attempts smallint NOT NULL CHECK (attempts BETWEEN 0 AND 3),
  attempted_at timestamptz,
  CHECK (attempts = 0 OR attempted_at IS NOT NULL),
  checked_at timestamptz,
  PRIMARY KEY (tmdb_id, provider)
);

COMMENT ON TABLE public.archived_movie_ratings_cache IS
  'Provider rating outcomes for archived movies, retained across catalog row deletion and rerelease.';

ALTER TABLE public.archived_movie_ratings_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.archived_movie_ratings_cache
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.archived_movie_ratings_cache
  TO service_role;

CREATE TABLE public.archived_movie_social_cards (
  tmdb_id integer PRIMARY KEY CHECK (tmdb_id > 0),
  social_preview_fingerprint text NOT NULL CHECK (social_preview_fingerprint ~ '^[a-f0-9]{64}$')
);

COMMENT ON TABLE public.archived_movie_social_cards IS
  'Verified social preview cards retained across catalog row deletion and rerelease.';

ALTER TABLE public.archived_movie_social_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.archived_movie_social_cards
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.archived_movie_social_cards TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
