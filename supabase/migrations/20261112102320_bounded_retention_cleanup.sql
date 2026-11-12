-- Retention needs only a cutoff and counts, never a full publication baseline.
CREATE INDEX IF NOT EXISTS all_showtimes_retention_idx
  ON public."allShowtimes" (date_of_showing, id);

CREATE OR REPLACE FUNCTION public.retire_expired_rows(
  p_table text, p_cutoff date, p_apply boolean DEFAULT false, p_batch_size integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  source_table text;
  date_column text;
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
  IF NOT p_apply THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I <= $1',p_table,date_column)
      INTO eligible USING p_cutoff;
    RETURN jsonb_build_object('table',p_table,'eligible',eligible,'deleted',0,'has_more',false);
  END IF;

  -- Same source/manifest lock order as the publication executor. This serializes
  -- retention with category publication and source writes; a lock timeout aborts
  -- this whole batch. Final-table triggers continue to advance catalog revision.
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',source_table);
  LOCK TABLE public.pipeline_scrape_snapshots IN SHARE ROW EXCLUSIVE MODE;
  IF p_table <> source_table THEN
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',p_table);
  END IF;
  snapshot_expression := CASE WHEN p_table = source_table THEN 't.snapshot_id' ELSE 'NULL::uuid' END;
  EXECUTE format(
    'SELECT array_agg(id) FROM (SELECT id FROM public.%I WHERE %I <= $1 ORDER BY %I,id LIMIT $2 FOR UPDATE) candidates',
    p_table,date_column,date_column) INTO selected USING p_cutoff,p_batch_size;
  IF selected IS NULL THEN
    -- Avoid firing statement-level catalog revision triggers for an empty batch.
    RETURN jsonb_build_object('table',p_table,'eligible',0,'deleted',0,'has_more',false);
  END IF;
  EXECUTE format(
    'WITH removed AS (
       DELETE FROM public.%1$I t WHERE t.id=ANY($1) AND t.%2$I <= $2
       RETURNING %3$s AS snapshot_id
     ) SELECT count(*),array_agg(DISTINCT snapshot_id) FILTER (WHERE snapshot_id IS NOT NULL) FROM removed',
    p_table,date_column,snapshot_expression)
    INTO removed,affected USING selected,p_cutoff;
  IF affected IS NOT NULL THEN
    -- Deletion and manifest repair commit together, including a count of zero.
    EXECUTE format(
      'UPDATE public.pipeline_scrape_snapshots s SET row_count=(
         SELECT count(*) FROM public.%I t WHERE t.snapshot_id=s.snapshot_id
       ) WHERE s.snapshot_id=ANY($1) AND s.table_name=$2 AND s.status=''complete''',source_table)
      USING affected,source_table;
  END IF;
  RETURN jsonb_build_object('table',p_table,'eligible',removed,'deleted',removed,
                            'has_more',removed=p_batch_size);
END;
$$;
REVOKE ALL ON FUNCTION public.retire_expired_rows(text,date,boolean,integer)
  FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.retire_expired_rows(text,date,boolean,integer) TO service_role;
