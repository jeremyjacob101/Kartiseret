CREATE OR REPLACE FUNCTION public.retire_expired_rows(
  p_table text, p_cutoff date, p_apply boolean DEFAULT false, p_batch_size integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  source_table text;
  date_column text;
  eligible_filter text := '';
  protect_raw boolean;
  affected uuid[];
  selected uuid[];
  removed bigint := 0;
  eligible bigint;
  snapshot_expression text;
BEGIN
  source_table := CASE p_table
    WHEN 'allShowtimes' THEN 'allShowtimes' WHEN 'finalShowtimes' THEN 'allShowtimes'
    WHEN 'allSoons' THEN 'allSoons' WHEN 'finalSoons' THEN 'allSoons'
    WHEN 'allTheques' THEN 'allTheques' WHEN 'finalTheques' THEN 'allTheques'
    ELSE NULL END;
  -- The runner may already be on the next local date while PostgreSQL is in UTC.
  IF source_table IS NULL OR p_cutoff IS NULL OR p_cutoff > current_date + 1
     OR p_apply IS NULL OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Invalid retention request' USING ERRCODE = '22023';
  END IF;
  date_column := CASE WHEN source_table = 'allSoons' THEN 'release_date' ELSE 'date_of_showing' END;

  -- Normal showtime retention uses the screening date alone. Keep the
  -- publication checks for shorter pressure sweeps and other raw tables.
  protect_raw := p_table = source_table AND (p_table <> 'allShowtimes'
    OR p_cutoff > (pg_catalog.now() AT TIME ZONE 'Asia/Jerusalem')::date - 5);
  IF protect_raw THEN
    eligible_filter := pg_catalog.format(
      ' AND t.cleaned IS TRUE
        AND t.added IS TRUE
        AND (t.run_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public."utilRunLogs" r
          WHERE r.run_id = t.run_id AND r.running_now IS TRUE
        ))
        AND (t.snapshot_id IS NULL OR EXISTS (
          SELECT 1 FROM public.pipeline_scrape_snapshots m
          WHERE m.snapshot_id = t.snapshot_id AND m.table_name = %L AND m.status = ''complete''
        ))
        AND (t.snapshot_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM public.pipeline_publication_checkpoints c
          WHERE c.snapshot_id = t.snapshot_id
            AND (c.has_unresolved IS TRUE OR c.phase <> ''published'')
        ))',
      source_table
    );
  END IF;

  IF NOT p_apply THEN
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM public.%I t WHERE t.%I <= $1 %s',
      p_table, date_column, eligible_filter
    ) INTO eligible USING p_cutoff;
    RETURN pg_catalog.jsonb_build_object(
      'table', p_table, 'eligible', eligible, 'deleted', 0, 'has_more', false
    );
  END IF;

  -- Match publication lock order. Lock checkpoints only when reading their
  -- state to decide which source rows can be deleted.
  EXECUTE pg_catalog.format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', source_table);
  LOCK TABLE public.pipeline_scrape_snapshots IN SHARE ROW EXCLUSIVE MODE;
  IF protect_raw THEN
    LOCK TABLE public.pipeline_publication_checkpoints IN SHARE ROW EXCLUSIVE MODE;
  ELSIF p_table <> source_table THEN
    EXECUTE pg_catalog.format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', p_table);
  END IF;

  snapshot_expression := CASE WHEN p_table = source_table THEN 't.snapshot_id' ELSE 'NULL::uuid' END;
  EXECUTE pg_catalog.format(
    'SELECT array_agg(id) FROM (
       SELECT t.id FROM public.%I t
       WHERE t.%I <= $1 %s
       ORDER BY t.%I,t.id LIMIT $2 FOR UPDATE
     ) candidates',
    p_table, date_column, eligible_filter, date_column
  ) INTO selected USING p_cutoff,p_batch_size;
  IF selected IS NULL THEN
    -- Avoid firing statement-level catalog revision triggers for an empty batch.
    RETURN pg_catalog.jsonb_build_object(
      'table', p_table, 'eligible', 0, 'deleted', 0, 'has_more', false
    );
  END IF;
  EXECUTE pg_catalog.format(
    'WITH removed AS (
       DELETE FROM public.%1$I t
       WHERE t.id = ANY($1) AND t.%2$I <= $2 %4$s
       RETURNING %3$s AS snapshot_id
     ) SELECT count(*),array_agg(DISTINCT snapshot_id) FILTER (WHERE snapshot_id IS NOT NULL) FROM removed',
    p_table, date_column, snapshot_expression, eligible_filter
  ) INTO removed,affected USING selected,p_cutoff;
  IF affected IS NOT NULL THEN
    -- Deletion and manifest repair commit together, including a count of zero.
    EXECUTE pg_catalog.format(
      'UPDATE public.pipeline_scrape_snapshots s SET row_count=(
         SELECT count(*) FROM public.%I t WHERE t.snapshot_id=s.snapshot_id
       ) WHERE s.snapshot_id=ANY($1) AND s.table_name=$2 AND s.status=''complete''', source_table
    ) USING affected,source_table;
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'table',p_table,'eligible',removed,'deleted',removed,'has_more',removed=p_batch_size
  );
END;
$$;
