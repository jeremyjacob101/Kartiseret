SELECT jsonb_build_object(
  'format_version', 1,
  'catalog_revision', (
    SELECT revision
    FROM public.pipeline_catalog_revision
    WHERE singleton
  ),
  'visible_movies', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tmdb_id', tmdb_id,
      'english_title', english_title
    ) ORDER BY tmdb_id)
    FROM public."finalMovies"
    WHERE solo_update = false
  ), '[]'::jsonb),
  'movie_titles', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tmdb_id', identities.tmdb_id,
      'title', identities.title,
      'language', identities.language,
      'source', identities.source
    ))
    FROM (
      SELECT tmdb_id, english_title AS title, 'en'::text AS language, 'finalMovies'::text AS source
      FROM public."finalMovies"
      WHERE tmdb_id IS NOT NULL AND english_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, english_title, 'en', 'finalSoons'
      FROM public."finalSoons"
      WHERE tmdb_id IS NOT NULL AND english_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, hebrew_title, 'he', 'finalSoons'
      FROM public."finalSoons"
      WHERE tmdb_id IS NOT NULL AND hebrew_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, english_title, 'en', 'finalShowtimes'
      FROM public."finalShowtimes"
      WHERE tmdb_id IS NOT NULL AND english_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, hebrew_title, 'he', 'finalShowtimes'
      FROM public."finalShowtimes"
      WHERE tmdb_id IS NOT NULL AND hebrew_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, english_title, 'en', 'finalThequeMovies'
      FROM public."finalThequeMovies"
      WHERE tmdb_id IS NOT NULL AND english_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, english_title, 'en', 'finalTheques'
      FROM public."finalTheques"
      WHERE tmdb_id IS NOT NULL AND english_title IS NOT NULL
      UNION ALL
      SELECT tmdb_id, hebrew_title, 'he', 'finalTheques'
      FROM public."finalTheques"
      WHERE tmdb_id IS NOT NULL AND hebrew_title IS NOT NULL
    ) AS identities
  ), '[]'::jsonb),
  'title_fixes', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'title_fix', title_fix))
    FROM public."tableFixes"
    WHERE tmdb_id IS NOT NULL AND title_fix IS NOT NULL
  ), '[]'::jsonb),
  'release_dates', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'local_release_date', local_release_date))
    FROM public.movie_release_dates
  ), '[]'::jsonb),
  'final_soon_dates', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('tmdb_id', tmdb_id, 'release_date', release_date))
    FROM public."finalSoons"
    WHERE tmdb_id IS NOT NULL AND release_date IS NOT NULL
  ), '[]'::jsonb),
  'run_logs', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'run_id', "run_id",
      'date_created', "date_created",
      'successful', successful
    ) ORDER BY "run_id")
    FROM public."utilRunLogs"
  ), '[]'::jsonb)
) AS release_date_backfill_snapshot;
