-- Private preparation, one category commit, and a read revision shared by all writers.
CREATE SCHEMA IF NOT EXISTS pipeline_internal;
REVOKE ALL ON SCHEMA pipeline_internal FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT USAGE ON SCHEMA pipeline_internal TO service_role;

CREATE TABLE public.pipeline_catalog_revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_transaction xid8
);
INSERT INTO public.pipeline_catalog_revision(singleton) VALUES (true);
ALTER TABLE public.pipeline_catalog_revision ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_catalog_revision FROM PUBLIC, anon, authenticated, kartiseret_runtime, service_role;
GRANT SELECT ON public.pipeline_catalog_revision TO kartiseret_runtime;
GRANT SELECT, UPDATE ON public.pipeline_catalog_revision TO service_role;
CREATE POLICY pipeline_api_revision_read ON public.pipeline_catalog_revision FOR SELECT TO kartiseret_runtime USING (true);

CREATE TABLE public.pipeline_publications (
  publication_id uuid PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('nowplayings','comingsoons','cinematheques')),
  run_id bigint NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  part_count integer NOT NULL CHECK (part_count BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','applied')),
  revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX pipeline_publications_abandoned_idx ON public.pipeline_publications(created_at) WHERE status = 'prepared';
CREATE TABLE public.pipeline_publication_parts (
  publication_id uuid NOT NULL REFERENCES public.pipeline_publications(publication_id) ON DELETE CASCADE,
  part integer NOT NULL CHECK (part BETWEEN 0 AND 1999),
  payload text NOT NULL CHECK (octet_length(payload) <= 1048576 AND jsonb_typeof(payload::jsonb) = 'object'),
  PRIMARY KEY(publication_id, part)
);
ALTER TABLE public.pipeline_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_publication_parts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipeline_publications, public.pipeline_publication_parts FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_publications, public.pipeline_publication_parts TO service_role;

CREATE FUNCTION pipeline_internal.bump_catalog_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.pipeline_catalog_revision SET revision = revision + 1, last_transaction = pg_current_xact_id()
    WHERE singleton AND last_transaction IS DISTINCT FROM pg_current_xact_id();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_internal.bump_catalog_revision() FROM PUBLIC, anon, authenticated, service_role, kartiseret_runtime;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['finalMovies','finalSoons','finalShowtimes','finalThequeMovies','finalTheques','movieCodes'] LOOP
    EXECUTE format('CREATE TRIGGER publication_revision AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION pipeline_internal.bump_catalog_revision()', relation);
  END LOOP;
END;
$$;

-- One canonical ordering for HTTP JSON input guards; only this allowlist is queryable.
CREATE FUNCTION pipeline_internal.publication_rows(p_table text, p_category text, p_rows jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE predicate text := ''; ordering text; result jsonb; source_sql text;
BEGIN
  IF p_table NOT IN ('allShowtimes','allSoons','allTheques','finalMovies','finalSoons','finalShowtimes','finalThequeMovies','finalTheques','movieCodes','tableFixes','tableSkips','pipeline_scrape_snapshots','pipeline_publication_checkpoints') THEN
    RAISE EXCEPTION 'Unsupported publication relation';
  END IF;
  ordering := CASE p_table
    WHEN 'finalMovies' THEN 't.tmdb_id::text COLLATE "C"'
    WHEN 'finalThequeMovies' THEN 't.tmdb_id::text COLLATE "C"'
    WHEN 'movieCodes' THEN 't.tmdb_id::text COLLATE "C"'
    WHEN 'tableSkips' THEN 't.name_or_tmdb_id COLLATE "C"'
    WHEN 'pipeline_scrape_snapshots' THEN 't.snapshot_id::text COLLATE "C"'
    WHEN 'pipeline_publication_checkpoints' THEN 't.category COLLATE "C", t.snapshot_id::text COLLATE "C"'
    ELSE 't.id::text COLLATE "C"' END;
  IF p_table = 'pipeline_scrape_snapshots' THEN
    predicate := format(' WHERE t.table_name = %L', CASE p_category WHEN 'nowplayings' THEN 'allShowtimes' WHEN 'comingsoons' THEN 'allSoons' ELSE 'allTheques' END);
  ELSIF p_table = 'pipeline_publication_checkpoints' THEN
    predicate := format(' WHERE t.category = %L', p_category);
  END IF;
  source_sql := CASE WHEN p_rows IS NULL THEN format('public.%I',p_table) ELSE format('jsonb_populate_recordset(NULL::public.%I,$1)',p_table) END;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY %s), ''[]''::jsonb) FROM %s t%s', ordering,source_sql,predicate) INTO result USING p_rows;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_internal.publication_rows(text,text,jsonb) FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION pipeline_internal.publication_rows(text,text,jsonb) TO service_role;

CREATE FUNCTION public.commit_category_publication(p_publication_id uuid, p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC'
SET lock_timeout = '5s' SET statement_timeout = '90s' AS $$
DECLARE
  publication public.pipeline_publications%rowtype;
  part_record record; part_json jsonb; guards jsonb := '{}'; changes jsonb := '[]'; claims jsonb := '[]';
  guard_record record; change jsonb; before_row jsonb; after_row jsonb; current_row jsonb;
  relation text; source_table text; allowed text[]; keys text[]; key_column text; where_sql text;
  columns_sql text; values_sql text; assignments_sql text; column_name text; expected_digest text;
  affected_id bigint; claim jsonb; manifest public.pipeline_scrape_snapshots%rowtype; actual_count bigint;
  final_revision bigint; actual_part_count integer; min_part integer; max_part integer;
  commit_deadline timestamptz := clock_timestamp() + interval '60 seconds';
BEGIN
  SELECT * INTO STRICT publication FROM public.pipeline_publications WHERE publication_id = p_publication_id FOR UPDATE;
  IF publication.fingerprint <> p_fingerprint THEN RAISE EXCEPTION 'Publication fingerprint mismatch'; END IF;
  IF publication.status = 'applied' THEN
    RETURN jsonb_build_object('status','applied','revision',publication.revision::text);
  END IF;
  SELECT count(*),min(part),max(part),encode(sha256(convert_to(string_agg(part::text || ':' || encode(sha256(convert_to(payload,'UTF8')),'hex'), E'\n' ORDER BY part),'UTF8')),'hex')
    INTO actual_part_count,min_part,max_part,expected_digest FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id;
  IF actual_part_count <> publication.part_count OR expected_digest IS DISTINCT FROM p_fingerprint
     OR min_part <> 0 OR max_part <> publication.part_count - 1 THEN
    RAISE EXCEPTION 'Publication staging is incomplete or changed';
  END IF;
  source_table := CASE publication.category WHEN 'nowplayings' THEN 'allShowtimes' WHEN 'comingsoons' THEN 'allSoons' ELSE 'allTheques' END;
  allowed := ARRAY[source_table,'movieCodes','pipeline_scrape_snapshots','pipeline_publication_checkpoints'];
  allowed := allowed || CASE publication.category WHEN 'nowplayings' THEN ARRAY['finalMovies','finalShowtimes'] WHEN 'comingsoons' THEN ARRAY['finalSoons'] ELSE ARRAY['finalThequeMovies','finalTheques'] END;
  FOR part_record IN SELECT payload FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id ORDER BY part LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    part_json := part_record.payload::jsonb;
    IF jsonb_typeof(part_json->'rows') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid publication part'; END IF;
    CASE part_json->>'kind'
      WHEN 'guard' THEN
        relation := part_json->>'table';
        IF NOT (relation = ANY(allowed || ARRAY['tableFixes','tableSkips'])) THEN RAISE EXCEPTION 'Guard outside category'; END IF;
        guards := jsonb_set(guards,ARRAY[relation],coalesce(guards->relation,'[]') || (part_json->'rows'),true);
      WHEN 'changes' THEN changes := changes || (part_json->'rows');
      WHEN 'claims' THEN claims := claims || (part_json->'rows');
      ELSE RAISE EXCEPTION 'Unsupported publication part';
    END CASE;
  END LOOP;

  -- Same numeric advisory-lock namespace/order as protected admin corrections.
  FOR affected_id IN
    SELECT DISTINCT id FROM (
      SELECT (r->'before'->>'tmdb_id')::bigint id FROM jsonb_array_elements(changes) r
      UNION SELECT (r->'after'->>'tmdb_id')::bigint id FROM jsonb_array_elements(changes) r
    ) affected WHERE id IS NOT NULL ORDER BY id
  LOOP PERFORM pg_advisory_xact_lock(affected_id); END LOOP;
  -- Fence source inserts/deletes while validating the latest attempt and its
  -- count. These short locks are acquired only after all network work finishes.
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', source_table);
  LOCK TABLE public.pipeline_scrape_snapshots IN SHARE ROW EXCLUSIVE MODE;
  -- Keep helpers stable through revalidation and commit, never during HTTP work.
  LOCK TABLE public."tableFixes", public."tableSkips" IN SHARE MODE;
  FOR guard_record IN SELECT * FROM jsonb_each(guards) LOOP
    IF pipeline_internal.publication_rows(guard_record.key,publication.category) IS DISTINCT FROM pipeline_internal.publication_rows(guard_record.key,publication.category,guard_record.value) THEN
      RAISE EXCEPTION 'Publication input changed: %',guard_record.key USING ERRCODE = '40001';
    END IF;
  END LOOP;
  FOR claim IN SELECT * FROM jsonb_array_elements(claims) LOOP
    SELECT * INTO manifest FROM public.pipeline_scrape_snapshots WHERE snapshot_id = (claim->>'snapshot_id')::uuid FOR UPDATE;
    IF NOT FOUND OR manifest.table_name <> source_table OR manifest.cinema <> claim->>'cinema' OR manifest.status <> 'complete'
      OR EXISTS (SELECT 1 FROM public.pipeline_scrape_snapshots newer WHERE newer.table_name = source_table AND newer.cinema = manifest.cinema AND (newer.run_id,newer.attempt,newer.started_at) > (manifest.run_id,manifest.attempt,manifest.started_at)) THEN
      RAISE EXCEPTION 'Publication source is not the latest complete attempt';
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE snapshot_id = $1',source_table) INTO actual_count USING manifest.snapshot_id;
    IF actual_count <> manifest.row_count THEN RAISE EXCEPTION 'Publication source count changed'; END IF;
  END LOOP;

  -- Compare every affected row before any write, including inserts/absence.
  FOR change IN SELECT * FROM jsonb_array_elements(changes) LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    relation := change->>'table';
    IF NOT (relation = ANY(allowed)) THEN RAISE EXCEPTION 'Write outside category'; END IF;
    before_row := nullif(change->'before','null'::jsonb); after_row := nullif(change->'after','null'::jsonb);
    IF before_row IS NOT NULL THEN
      EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::public.%I,$1))',relation) INTO before_row USING before_row;
    END IF;
    IF before_row IS NULL AND after_row IS NULL THEN RAISE EXCEPTION 'Empty publication change'; END IF;
    IF relation = 'pipeline_scrape_snapshots' AND coalesce(after_row,before_row)->>'table_name' <> source_table THEN RAISE EXCEPTION 'Manifest outside category'; END IF;
    IF relation = 'pipeline_publication_checkpoints' AND coalesce(after_row,before_row)->>'category' <> publication.category THEN RAISE EXCEPTION 'Checkpoint outside category'; END IF;
    keys := CASE relation WHEN 'finalMovies' THEN ARRAY['tmdb_id'] WHEN 'finalThequeMovies' THEN ARRAY['tmdb_id'] WHEN 'movieCodes' THEN ARRAY['tmdb_id'] WHEN 'pipeline_scrape_snapshots' THEN ARRAY['snapshot_id'] WHEN 'pipeline_publication_checkpoints' THEN ARRAY['category','snapshot_id'] ELSE ARRAY['id'] END;
    where_sql := '';
    FOREACH key_column IN ARRAY keys LOOP
      IF coalesce(after_row,before_row)->key_column IS NULL THEN RAISE EXCEPTION 'Missing publication key'; END IF;
      where_sql := where_sql || CASE WHEN where_sql = '' THEN '' ELSE ' AND ' END || format('to_jsonb(t)->%L = $1->%L',key_column,key_column);
    END LOOP;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE %s FOR UPDATE',relation,where_sql) INTO current_row USING coalesce(before_row,after_row);
    IF relation = 'movieCodes' AND before_row IS NOT NULL THEN RAISE EXCEPTION 'Permanent movie codes cannot be changed'; END IF;
    IF relation = 'movieCodes' AND before_row IS NULL AND current_row IS NOT NULL THEN CONTINUE; END IF;
    IF current_row IS DISTINCT FROM before_row THEN RAISE EXCEPTION 'Publication target changed: %',relation USING ERRCODE = '40001'; END IF;
  END LOOP;

  FOR change IN SELECT value FROM jsonb_array_elements(changes) ORDER BY
      CASE WHEN value->'after' = 'null'::jsonb THEN 1 ELSE 0 END,
      CASE value->>'table' WHEN 'movieCodes' THEN 0 WHEN 'finalMovies' THEN 1 WHEN 'finalThequeMovies' THEN 1 WHEN 'finalSoons' THEN 1 WHEN 'finalShowtimes' THEN 2 WHEN 'finalTheques' THEN 2 WHEN 'pipeline_publication_checkpoints' THEN 9 ELSE 3 END
  LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    relation := change->>'table'; before_row := nullif(change->'before','null'::jsonb); after_row := nullif(change->'after','null'::jsonb);
    keys := CASE relation WHEN 'finalMovies' THEN ARRAY['tmdb_id'] WHEN 'finalThequeMovies' THEN ARRAY['tmdb_id'] WHEN 'movieCodes' THEN ARRAY['tmdb_id'] WHEN 'pipeline_scrape_snapshots' THEN ARRAY['snapshot_id'] WHEN 'pipeline_publication_checkpoints' THEN ARRAY['category','snapshot_id'] ELSE ARRAY['id'] END;
    where_sql := '';
    FOREACH key_column IN ARRAY keys LOOP
      where_sql := where_sql || CASE WHEN where_sql = '' THEN '' ELSE ' AND ' END || format('to_jsonb(t)->%L = $1->%L',key_column,key_column);
    END LOOP;
    IF after_row IS NULL THEN
      IF relation = 'movieCodes' THEN RAISE EXCEPTION 'Permanent movie codes cannot be deleted'; END IF;
      EXECUTE format('DELETE FROM public.%I t WHERE %s',relation,where_sql) USING before_row;
    ELSE
      IF relation = 'pipeline_publication_checkpoints' THEN
        after_row := after_row || jsonb_build_object('updated_at',now(),'completed_at',CASE WHEN after_row->>'phase' = 'published' THEN now() ELSE NULL END);
      END IF;
      columns_sql := ''; values_sql := ''; assignments_sql := '';
      FOR column_name IN SELECT jsonb_object_keys(after_row) ORDER BY 1 LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = format('public.%I',relation)::regclass AND attname = column_name AND attnum > 0 AND NOT attisdropped AND attgenerated = '') THEN
          RAISE EXCEPTION 'Unsupported publication column';
        END IF;
        columns_sql := columns_sql || CASE WHEN columns_sql = '' THEN '' ELSE ',' END || quote_ident(column_name);
        values_sql := values_sql || CASE WHEN values_sql = '' THEN '' ELSE ',' END || format('r.%I',column_name);
        IF NOT (column_name = ANY(keys)) THEN
          assignments_sql := assignments_sql || CASE WHEN assignments_sql = '' THEN '' ELSE ',' END || format('%I = r.%I',column_name,column_name);
        END IF;
      END LOOP;
      IF before_row IS NULL THEN
        EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r %s',relation,columns_sql,values_sql,relation,CASE WHEN relation = 'movieCodes' THEN 'ON CONFLICT (tmdb_id) DO NOTHING' ELSE '' END) USING after_row;
      ELSIF assignments_sql <> '' THEN
        EXECUTE format('UPDATE public.%I t SET %s FROM jsonb_populate_record(NULL::public.%I,$1) r WHERE %s',relation,assignments_sql,relation,replace(where_sql,'$1','$2')) USING after_row,before_row;
      END IF;
    END IF;
  END LOOP;
  FOR claim IN SELECT * FROM jsonb_array_elements(claims) LOOP
    SELECT * INTO STRICT manifest FROM public.pipeline_scrape_snapshots WHERE snapshot_id = (claim->>'snapshot_id')::uuid;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE snapshot_id = $1',source_table) INTO actual_count USING manifest.snapshot_id;
    IF actual_count <> manifest.row_count OR NOT EXISTS (SELECT 1 FROM public.pipeline_publication_checkpoints WHERE category = publication.category AND snapshot_id = manifest.snapshot_id AND phase = 'published') THEN
      RAISE EXCEPTION 'Publication is not complete';
    END IF;
  END LOOP;
  SELECT revision INTO final_revision FROM public.pipeline_catalog_revision WHERE singleton;
  UPDATE public.pipeline_publications SET status = 'applied', revision = final_revision, completed_at = now() WHERE publication_id = p_publication_id;
  DELETE FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id;
  RETURN jsonb_build_object('status','applied','revision',final_revision::text);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_category_publication(uuid,text) FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.commit_category_publication(uuid,text) TO service_role;

CREATE FUNCTION public.prune_abandoned_publications() RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s' AS $$
DECLARE removed integer;
BEGIN
  DELETE FROM public.pipeline_publications WHERE publication_id IN (
    SELECT p.publication_id FROM public.pipeline_publications p
    WHERE p.status = 'prepared' AND p.created_at < now() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM public."utilRunLogs" r WHERE r.run_id = p.run_id AND r.running_now)
    ORDER BY p.created_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_abandoned_publications() FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.prune_abandoned_publications() TO service_role;
