-- Let the weekly maintenance job inspect all eligible preparations and remove
-- them in bounded batches without waiting for an age threshold.
DROP FUNCTION public.prune_abandoned_publications();

CREATE FUNCTION public.prune_abandoned_publications(p_apply boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE
  eligible integer;
  removed integer := 0;
BEGIN
  SELECT count(*) INTO eligible
  FROM public.pipeline_publications p
  WHERE p.status = 'prepared'
    AND NOT EXISTS (
      SELECT 1 FROM public."utilRunLogs" r
      WHERE r.run_id = p.run_id AND r.running_now
    );

  IF p_apply THEN
    DELETE FROM public.pipeline_publications p
    WHERE p.publication_id IN (
      SELECT candidate.publication_id
      FROM public.pipeline_publications candidate
      WHERE candidate.status = 'prepared'
        AND NOT EXISTS (
          SELECT 1 FROM public."utilRunLogs" r
          WHERE r.run_id = candidate.run_id AND r.running_now
        )
      ORDER BY candidate.created_at, candidate.publication_id
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS removed = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('eligible', eligible, 'deleted', removed);
END;
$$;

REVOKE ALL ON FUNCTION public.prune_abandoned_publications(boolean) FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.prune_abandoned_publications(boolean) TO service_role;
