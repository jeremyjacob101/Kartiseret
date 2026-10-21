-- Provenance follows the movie row through PR4's existing atomic publication.
-- No legacy success times are invented, and no browser/API DTO is expanded.
ALTER TABLE public."finalMovies" ADD COLUMN provider_freshness jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(provider_freshness) = 'object' AND octet_length(provider_freshness::text) <= 65536);
ALTER TABLE public."finalSoons" ADD COLUMN provider_freshness jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(provider_freshness) = 'object' AND octet_length(provider_freshness::text) <= 65536);
ALTER TABLE public."finalThequeMovies" ADD COLUMN provider_freshness jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(provider_freshness) = 'object' AND octet_length(provider_freshness::text) <= 65536);

COMMENT ON COLUMN public."finalMovies".provider_freshness IS 'Latest provider checks and per-field value provenance; UTC; empty means unknown legacy provenance. Same transaction as movie values; no attempt history.';
COMMENT ON COLUMN public."finalSoons".provider_freshness IS 'TMDb check and per-field value provenance; local release dates remain source-owned.';
COMMENT ON COLUMN public."finalThequeMovies".provider_freshness IS 'Latest provider checks and per-field provenance, with the same semantics as finalMovies.';

-- Existing table-level worker grants include added columns. State the intended
-- write capability explicitly; retain existing RLS and API-only read boundary.
GRANT SELECT(provider_freshness), UPDATE(provider_freshness) ON public."finalMovies", public."finalSoons", public."finalThequeMovies" TO service_role;
