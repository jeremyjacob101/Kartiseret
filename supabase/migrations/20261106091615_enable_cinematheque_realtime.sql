-- The watcher subscribes to this catalog alongside finalMovies and finalSoons.
-- Do not create or replace Supabase's provider-owned publication.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
         AND tablename = 'finalThequeMovies'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."finalThequeMovies";
  END IF;
END;
$migration$;
