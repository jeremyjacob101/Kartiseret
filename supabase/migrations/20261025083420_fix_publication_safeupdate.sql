-- Supabase API sessions load safeupdate. Explicitly qualify the intentional
-- whole-work-table update; row_number() makes seq non-null for every row.
-- Keep safeupdate enabled and preserve the atomic publication protocol.
-- Keep the publication protocol and atomic boundary; do not build a growing
-- catalog-sized JSON array or scan a live table separately for every change.
CREATE OR REPLACE FUNCTION public.commit_category_publication(p_publication_id uuid, p_fingerprint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC'
SET lock_timeout = '5s' SET statement_timeout = '90s' AS $$
DECLARE
  publication public.pipeline_publications%rowtype;
  guard_record record; relation_record record; batch_record record;
  target_relation text; source_table text; allowed text[]; keys text[]; key_column text;
  join_sql text; raw_join_sql text; predicate text; columns_sql text;
  values_sql text; assignments_sql text; column_name text; expected_digest text;
  affected_id bigint; claim jsonb; manifest public.pipeline_scrape_snapshots%rowtype;
  actual_count bigint; final_revision bigint; actual_part_count integer;
  min_part integer; max_part integer; invalid boolean; duplicate_keys boolean;
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

  -- These tables belong to this invocation/transaction, never to the public
  -- catalog. Failure rolls their creation back; success drops them explicitly
  -- so another category can publish in the same transaction/session.
  CREATE TEMP TABLE _pipeline_publication_parts ON COMMIT DROP AS
    SELECT part, payload::jsonb AS body
    FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id;
  IF EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_parts WHERE jsonb_typeof(body->'rows') IS DISTINCT FROM 'array') THEN
    RAISE EXCEPTION 'Invalid publication part';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_parts WHERE body->>'kind' IS NULL OR body->>'kind' NOT IN ('guard','changes','claims')) THEN
    RAISE EXCEPTION 'Unsupported publication part';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_parts WHERE body->>'kind' = 'guard'
      AND (body->>'table' IS NULL OR NOT (body->>'table' = ANY(allowed || ARRAY['tableFixes','tableSkips'])))) THEN
    RAISE EXCEPTION 'Guard outside category';
  END IF;

  CREATE TEMP TABLE _pipeline_publication_changes ON COMMIT DROP AS
    SELECT row_number() OVER (ORDER BY p.part, r.ordinality) AS seq,
      r.value->>'table' AS relation,
      nullif(r.value->'before','null'::jsonb) AS before_row,
      nullif(r.value->'after','null'::jsonb) AS after_row,
      false AS single_row, 0::bigint AS batch
    FROM pg_temp._pipeline_publication_parts p
    CROSS JOIN LATERAL jsonb_array_elements(p.body->'rows') WITH ORDINALITY r(value,ordinality)
    WHERE p.body->>'kind' = 'changes';
  CREATE INDEX ON _pipeline_publication_changes(relation);
  ANALYZE pg_temp._pipeline_publication_changes;

  FOR affected_id IN
    SELECT DISTINCT id FROM (
      SELECT (before_row->>'tmdb_id')::bigint id FROM pg_temp._pipeline_publication_changes
      UNION SELECT (after_row->>'tmdb_id')::bigint id FROM pg_temp._pipeline_publication_changes
    ) affected WHERE id IS NOT NULL ORDER BY id
  LOOP PERFORM pg_advisory_xact_lock(affected_id); END LOOP;
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', source_table);
  LOCK TABLE public.pipeline_scrape_snapshots IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public."tableFixes", public."tableSkips" IN SHARE MODE;

  -- EXCEPT ALL preserves the old full-row/multiplicity comparison (including
  -- empty guards and phantom rows), without aggregating two giant JSON values.
  FOR guard_record IN
    SELECT DISTINCT body->>'table' AS relation FROM pg_temp._pipeline_publication_parts WHERE body->>'kind' = 'guard' ORDER BY 1
  LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    target_relation := guard_record.relation;
    predicate := CASE target_relation
      WHEN 'pipeline_scrape_snapshots' THEN format(' AND t.table_name = %L',source_table)
      WHEN 'pipeline_publication_checkpoints' THEN format(' AND t.category = %L',publication.category)
      ELSE '' END;
    EXECUTE format(
      'WITH expected AS MATERIALIZED (
        SELECT to_jsonb(t) AS row FROM pg_temp._pipeline_publication_parts p
        CROSS JOIN LATERAL jsonb_populate_recordset(NULL::public.%1$I,p.body->''rows'') t
        WHERE p.body->>''kind'' = ''guard'' AND p.body->>''table'' = $1 %2$s
      ), actual AS MATERIALIZED (SELECT to_jsonb(t) AS row FROM public.%1$I t WHERE true %2$s)
      SELECT EXISTS (
        (SELECT row FROM actual EXCEPT ALL SELECT row FROM expected)
        UNION ALL (SELECT row FROM expected EXCEPT ALL SELECT row FROM actual)
      )',target_relation,predicate) INTO invalid USING target_relation;
    IF invalid THEN RAISE EXCEPTION 'Publication input changed: %',target_relation USING ERRCODE = '40001'; END IF;
  END LOOP;
  FOR claim IN
    SELECT r.value FROM pg_temp._pipeline_publication_parts p
    CROSS JOIN LATERAL jsonb_array_elements(p.body->'rows') WITH ORDINALITY r(value,ordinality)
    WHERE p.body->>'kind' = 'claims' ORDER BY p.part,r.ordinality
  LOOP
    SELECT * INTO manifest FROM public.pipeline_scrape_snapshots WHERE snapshot_id = (claim->>'snapshot_id')::uuid FOR UPDATE;
    IF NOT FOUND OR manifest.table_name <> source_table OR manifest.cinema <> claim->>'cinema' OR manifest.status <> 'complete'
      OR EXISTS (SELECT 1 FROM public.pipeline_scrape_snapshots newer WHERE newer.table_name = source_table AND newer.cinema = manifest.cinema AND (newer.run_id,newer.attempt,newer.started_at) > (manifest.run_id,manifest.attempt,manifest.started_at)) THEN
      RAISE EXCEPTION 'Publication source is not the latest complete attempt';
    END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE snapshot_id = $1',source_table) INTO actual_count USING manifest.snapshot_id;
    IF actual_count <> manifest.row_count THEN RAISE EXCEPTION 'Publication source count changed'; END IF;
  END LOOP;

  -- Validate and lock all targets before any catalog write. Typed key equality
  -- enables indexed joins; scalar JSON equality retains the existing identity
  -- semantics (e.g. an inserted numeric string is not a numeric JSON key).
  FOR relation_record IN
    SELECT c.relation,min(c.seq) AS first_seq FROM pg_temp._pipeline_publication_changes c GROUP BY c.relation ORDER BY first_seq
  LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    target_relation := relation_record.relation;
    IF target_relation IS NULL OR NOT (target_relation = ANY(allowed)) THEN RAISE EXCEPTION 'Write outside category'; END IF;
    IF EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_changes c WHERE c.relation = target_relation AND c.before_row IS NULL AND c.after_row IS NULL) THEN
      RAISE EXCEPTION 'Empty publication change';
    END IF;
    IF target_relation = 'pipeline_scrape_snapshots' AND EXISTS (
      SELECT 1 FROM pg_temp._pipeline_publication_changes c WHERE c.relation = target_relation AND coalesce(c.after_row,c.before_row)->>'table_name' <> source_table
    ) THEN RAISE EXCEPTION 'Manifest outside category'; END IF;
    IF target_relation = 'pipeline_publication_checkpoints' AND EXISTS (
      SELECT 1 FROM pg_temp._pipeline_publication_changes c WHERE c.relation = target_relation AND coalesce(c.after_row,c.before_row)->>'category' <> publication.category
    ) THEN RAISE EXCEPTION 'Checkpoint outside category'; END IF;
    keys := CASE target_relation WHEN 'finalMovies' THEN ARRAY['tmdb_id'] WHEN 'finalThequeMovies' THEN ARRAY['tmdb_id'] WHEN 'movieCodes' THEN ARRAY['tmdb_id'] WHEN 'pipeline_scrape_snapshots' THEN ARRAY['snapshot_id'] WHEN 'pipeline_publication_checkpoints' THEN ARRAY['category','snapshot_id'] ELSE ARRAY['id'] END;
    IF EXISTS (
      SELECT 1 FROM pg_temp._pipeline_publication_changes c CROSS JOIN unnest(keys) k(column_name)
      WHERE c.relation = target_relation AND coalesce(c.after_row,c.before_row)->k.column_name IS NULL
    ) THEN RAISE EXCEPTION 'Missing publication key'; END IF;
    join_sql := ''; raw_join_sql := '';
    FOREACH key_column IN ARRAY keys LOOP
      join_sql := join_sql || CASE WHEN join_sql = '' THEN '' ELSE ' AND ' END
        || format('t.%1$I = (r.key_row).%1$I AND to_jsonb(t.%1$I) = r.identity->%2$L',key_column,key_column);
      raw_join_sql := raw_join_sql || CASE WHEN raw_join_sql = '' THEN '' ELSE ',' END || format('k.%I',key_column);
    END LOOP;
    -- Consume the full comparison: EXISTS can favor a startup-cheap nested
    -- loop over the materialized rows, making an unchanged catalog quadratic.
    EXECUTE format(
      'WITH normalized AS MATERIALIZED (
        SELECT c.*, CASE WHEN c.before_row IS NULL THEN NULL ELSE to_jsonb(jsonb_populate_record(NULL::public.%1$I,c.before_row)) END AS expected
        FROM pg_temp._pipeline_publication_changes c WHERE c.relation = $1
      ), requested AS MATERIALIZED (
        SELECT n.*, coalesce(n.expected,n.after_row) AS identity,
          jsonb_populate_record(NULL::public.%1$I,coalesce(n.expected,n.after_row)) AS key_row FROM normalized n
      ), locked AS MATERIALIZED (
        SELECT r.seq,to_jsonb(t) AS actual FROM requested r JOIN public.%1$I t ON %2$s FOR UPDATE OF t
      ) SELECT coalesce(bool_or(
          l.actual IS DISTINCT FROM r.expected
          AND NOT ($1 = ''movieCodes'' AND r.before_row IS NULL AND l.actual IS NOT NULL)
        ),false)
        FROM requested r LEFT JOIN locked l USING(seq)',target_relation,join_sql) INTO invalid USING target_relation;
    IF target_relation = 'movieCodes' AND EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_changes c WHERE c.relation = target_relation AND c.before_row IS NOT NULL) THEN
      RAISE EXCEPTION 'Permanent movie codes cannot be changed';
    END IF;
    IF invalid THEN RAISE EXCEPTION 'Publication target changed: %',target_relation USING ERRCODE = '40001'; END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM pg_temp._pipeline_publication_changes c
       CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,coalesce(c.before_row,c.after_row)) k
       WHERE c.relation = $1 GROUP BY %2$s HAVING count(*) > 1)',target_relation,raw_join_sql)
      INTO duplicate_keys USING target_relation;
    -- Preserve sequential effects for repeated targets and tables whose other
    -- unique indexes can make the order of individual writes observable.
    IF duplicate_keys OR EXISTS (SELECT 1 FROM pg_index WHERE indrelid = format('public.%I',target_relation)::regclass AND indisunique AND NOT indisprimary) THEN
      UPDATE pg_temp._pipeline_publication_changes c SET single_row = true WHERE c.relation = target_relation;
    END IF;
  END LOOP;

  UPDATE pg_temp._pipeline_publication_changes c
    SET after_row = c.after_row || jsonb_build_object('updated_at',now(),'completed_at',CASE WHEN c.after_row->>'phase' = 'published' THEN now() ELSE NULL END)
    WHERE c.relation = 'pipeline_publication_checkpoints' AND c.after_row IS NOT NULL;
  ALTER TABLE pg_temp._pipeline_publication_changes ADD COLUMN columns text[], ADD COLUMN operation text;
  UPDATE pg_temp._pipeline_publication_changes c SET
    columns = ARRAY(SELECT jsonb_object_keys(c.after_row) ORDER BY 1),
    operation = CASE WHEN c.after_row IS NULL THEN 'delete' WHEN c.before_row IS NULL THEN 'insert' ELSE 'update' END
    WHERE c.seq IS NOT NULL;
  -- Only consecutive compatible writes are batched; partial update shapes,
  -- dependency order, and delete-last behavior stay intact.
  WITH ordered AS (
    SELECT c.seq,row_number() OVER (ORDER BY c.after_row IS NULL,
      CASE c.relation WHEN 'movieCodes' THEN 0 WHEN 'finalMovies' THEN 1 WHEN 'finalThequeMovies' THEN 1 WHEN 'finalSoons' THEN 1 WHEN 'finalShowtimes' THEN 2 WHEN 'finalTheques' THEN 2 WHEN 'pipeline_publication_checkpoints' THEN 9 ELSE 3 END,c.seq) AS ordinal,
      CASE WHEN c.single_row THEN jsonb_build_array(c.seq) ELSE jsonb_build_array(c.relation,c.operation,c.columns) END AS signature
    FROM pg_temp._pipeline_publication_changes c
  ), starts AS (
    SELECT *,CASE WHEN signature IS NOT DISTINCT FROM lag(signature) OVER (ORDER BY ordinal) THEN 0 ELSE 1 END AS start FROM ordered
  ), batches AS (
    SELECT seq,sum(start) OVER (ORDER BY ordinal) AS batch FROM starts
  ) UPDATE pg_temp._pipeline_publication_changes c SET batch = b.batch FROM batches b WHERE b.seq = c.seq;
  CREATE INDEX ON _pipeline_publication_changes(batch);
  ANALYZE pg_temp._pipeline_publication_changes;

  FOR batch_record IN
    SELECT c.batch,c.relation,c.operation,c.columns FROM pg_temp._pipeline_publication_changes c
    GROUP BY c.batch,c.relation,c.operation,c.columns ORDER BY c.batch
  LOOP
    IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
    target_relation := batch_record.relation;
    keys := CASE target_relation WHEN 'finalMovies' THEN ARRAY['tmdb_id'] WHEN 'finalThequeMovies' THEN ARRAY['tmdb_id'] WHEN 'movieCodes' THEN ARRAY['tmdb_id'] WHEN 'pipeline_scrape_snapshots' THEN ARRAY['snapshot_id'] WHEN 'pipeline_publication_checkpoints' THEN ARRAY['category','snapshot_id'] ELSE ARRAY['id'] END;
    join_sql := '';
    FOREACH key_column IN ARRAY keys LOOP
      join_sql := join_sql || CASE WHEN join_sql = '' THEN '' ELSE ' AND ' END
        || format('t.%1$I = b.%1$I AND to_jsonb(t.%1$I) = c.before_row->%2$L',key_column,key_column);
    END LOOP;
    IF batch_record.operation = 'delete' THEN
      IF target_relation = 'movieCodes' THEN RAISE EXCEPTION 'Permanent movie codes cannot be deleted'; END IF;
      EXECUTE format('DELETE FROM public.%1$I t USING pg_temp._pipeline_publication_changes c
        CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,c.before_row) b
        WHERE c.batch = $1 AND %2$s',target_relation,join_sql) USING batch_record.batch;
    ELSE
      columns_sql := ''; values_sql := ''; assignments_sql := '';
      FOREACH column_name IN ARRAY batch_record.columns LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = format('public.%I',target_relation)::regclass AND attname = column_name AND attnum > 0 AND NOT attisdropped AND attgenerated = '') THEN
          RAISE EXCEPTION 'Unsupported publication column';
        END IF;
        columns_sql := columns_sql || CASE WHEN columns_sql = '' THEN '' ELSE ',' END || quote_ident(column_name);
        values_sql := values_sql || CASE WHEN values_sql = '' THEN '' ELSE ',' END || format('r.%I',column_name);
        IF NOT (column_name = ANY(keys)) THEN
          assignments_sql := assignments_sql || CASE WHEN assignments_sql = '' THEN '' ELSE ',' END || format('%I = r.%I',column_name,column_name);
        END IF;
      END LOOP;
      IF batch_record.operation = 'insert' THEN
        EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM pg_temp._pipeline_publication_changes c
          CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,c.after_row) r WHERE c.batch = $1 ORDER BY c.seq %4$s',
          target_relation,columns_sql,values_sql,CASE WHEN target_relation = 'movieCodes' THEN 'ON CONFLICT (tmdb_id) DO NOTHING' ELSE '' END) USING batch_record.batch;
      ELSIF assignments_sql <> '' THEN
        EXECUTE format('UPDATE public.%1$I t SET %2$s FROM pg_temp._pipeline_publication_changes c
          CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,c.after_row) r
          CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,c.before_row) b
          WHERE c.batch = $1 AND %3$s',target_relation,assignments_sql,join_sql) USING batch_record.batch;
      END IF;
    END IF;
  END LOOP;
  IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
  FOR claim IN
    SELECT r.value FROM pg_temp._pipeline_publication_parts p
    CROSS JOIN LATERAL jsonb_array_elements(p.body->'rows') WITH ORDINALITY r(value,ordinality)
    WHERE p.body->>'kind' = 'claims' ORDER BY p.part,r.ordinality
  LOOP
    SELECT * INTO STRICT manifest FROM public.pipeline_scrape_snapshots WHERE snapshot_id = (claim->>'snapshot_id')::uuid;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE snapshot_id = $1',source_table) INTO actual_count USING manifest.snapshot_id;
    IF actual_count <> manifest.row_count OR NOT EXISTS (SELECT 1 FROM public.pipeline_publication_checkpoints WHERE category = publication.category AND snapshot_id = manifest.snapshot_id AND phase = 'published') THEN
      RAISE EXCEPTION 'Publication is not complete';
    END IF;
  END LOOP;
  SELECT revision INTO final_revision FROM public.pipeline_catalog_revision WHERE singleton;
  UPDATE public.pipeline_publications SET status = 'applied', revision = final_revision, completed_at = now() WHERE publication_id = p_publication_id;
  DELETE FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id;
  DROP TABLE pg_temp._pipeline_publication_changes, pg_temp._pipeline_publication_parts;
  RETURN jsonb_build_object('status','applied','revision',final_revision::text);
END;
$$;
REVOKE ALL ON FUNCTION public.commit_category_publication(uuid,text) FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.commit_category_publication(uuid,text) TO service_role;
