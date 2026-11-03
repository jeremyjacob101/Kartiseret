BEGIN;

ALTER TABLE public."finalMovies"
  ADD COLUMN social_preview_fingerprint text,
  ADD CONSTRAINT finalmovies_social_preview_fingerprint_format
    CHECK (
      social_preview_fingerprint IS NULL
      OR social_preview_fingerprint ~ '^[a-f0-9]{64}$'
    );

ALTER TABLE public."finalSoons"
  ADD COLUMN social_preview_fingerprint text,
  ADD CONSTRAINT finalsoons_social_preview_fingerprint_format
    CHECK (
      social_preview_fingerprint IS NULL
      OR social_preview_fingerprint ~ '^[a-f0-9]{64}$'
    );

ALTER TABLE public."finalThequeMovies"
  ADD COLUMN social_preview_fingerprint text,
  ADD CONSTRAINT finalthequemovies_social_preview_fingerprint_format
    CHECK (
      social_preview_fingerprint IS NULL
      OR social_preview_fingerprint ~ '^[a-f0-9]{64}$'
    );

COMMENT ON COLUMN public."finalMovies".social_preview_fingerprint IS
  'Fingerprint of the complete, immutable social preview card currently published for this catalog row.';
COMMENT ON COLUMN public."finalSoons".social_preview_fingerprint IS
  'Fingerprint of the complete, immutable social preview card currently published for this catalog row.';
COMMENT ON COLUMN public."finalThequeMovies".social_preview_fingerprint IS
  'Fingerprint of the complete, immutable social preview card currently published for this catalog row.';

COMMIT;
