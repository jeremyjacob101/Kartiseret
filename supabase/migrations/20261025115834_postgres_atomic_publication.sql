-- A verified, long-lived PostgreSQL transport for the existing atomic publication algorithm.
-- The REST RPC remains available with its existing 60-second internal deadline.

-- The connection login can only write immutable staging payloads and call
-- the bounded publisher function. The no-login executor owns a narrowly scoped
-- SECURITY DEFINER implementation and is never granted to a login.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'kartiseret_publisher') THEN
    CREATE ROLE kartiseret_publisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'kartiseret_publication_executor') THEN
    CREATE ROLE kartiseret_publication_executor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
  -- Supabase's postgres administrator has CREATEROLE, not SUPERUSER. It can
  -- create these restricted roles, but cannot ALTER SUPERUSER/BYPASSRLS flags,
  -- even to false. Validate existing roles instead of attempting to reset them.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('kartiseret_publisher', 'kartiseret_publication_executor')
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole
           OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'Publication role already exists with unsafe attributes';
  END IF;
END;
$roles$;

GRANT USAGE ON SCHEMA public, pipeline_internal TO kartiseret_publisher, kartiseret_publication_executor;
DO $database_temp$
BEGIN
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO kartiseret_publisher', current_database());
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO kartiseret_publication_executor', current_database());
END;
$database_temp$;

-- The connection role may prepare a receipt and its parts. It cannot mutate a
-- receipt or touch catalog tables directly. The executor does the live writes.
GRANT SELECT, INSERT ON public.pipeline_publications, public.pipeline_publication_parts TO kartiseret_publisher;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_publications, public.pipeline_publication_parts TO kartiseret_publication_executor;
GRANT SELECT ON public.pipeline_catalog_revision, public."tableFixes", public."tableSkips" TO kartiseret_publication_executor;
-- LOCK TABLE SHARE MODE requires a write privilege. No UPDATE RLS policies are
-- created for these evidence tables, and the executor has no login role.
GRANT UPDATE ON public."tableFixes", public."tableSkips" TO kartiseret_publication_executor;
GRANT SELECT, INSERT ON public."movieCodes" TO kartiseret_publication_executor;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public."allShowtimes", public."allSoons", public."allTheques",
  public."finalMovies", public."finalSoons", public."finalShowtimes",
  public."finalThequeMovies", public."finalTheques",
  public.pipeline_scrape_snapshots, public.pipeline_publication_checkpoints
TO kartiseret_publication_executor;

DROP POLICY IF EXISTS publisher_staging_publications ON public.pipeline_publications;
DROP POLICY IF EXISTS publisher_staging_publications_read ON public.pipeline_publications;
DROP POLICY IF EXISTS publisher_staging_publications_insert ON public.pipeline_publications;
CREATE POLICY publisher_staging_publications_read ON public.pipeline_publications
  FOR SELECT TO kartiseret_publisher USING (true);
CREATE POLICY publisher_staging_publications_insert ON public.pipeline_publications
  FOR INSERT TO kartiseret_publisher WITH CHECK (true);
DROP POLICY IF EXISTS publisher_staging_parts ON public.pipeline_publication_parts;
CREATE POLICY publisher_staging_parts ON public.pipeline_publication_parts
  FOR ALL TO kartiseret_publisher USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS executor_publications ON public.pipeline_publications;
CREATE POLICY executor_publications ON public.pipeline_publications
  FOR ALL TO kartiseret_publication_executor USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS executor_parts ON public.pipeline_publication_parts;
CREATE POLICY executor_parts ON public.pipeline_publication_parts
  FOR ALL TO kartiseret_publication_executor USING (true) WITH CHECK (true);

DO $publisher_policies$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'allShowtimes','allSoons','allTheques','finalMovies','finalSoons',
    'finalShowtimes','finalThequeMovies','finalTheques',
    'pipeline_scrape_snapshots','pipeline_publication_checkpoints'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'publisher_executor_' || relation, relation);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO kartiseret_publication_executor USING (true) WITH CHECK (true)', 'publisher_executor_' || relation, relation);
  END LOOP;
  EXECUTE 'DROP POLICY IF EXISTS publisher_executor_movie_codes_select ON public."movieCodes"';
  EXECUTE 'DROP POLICY IF EXISTS publisher_executor_movie_codes_insert ON public."movieCodes"';
  EXECUTE 'CREATE POLICY publisher_executor_movie_codes_select ON public."movieCodes" FOR SELECT TO kartiseret_publication_executor USING (true)';
  EXECUTE 'CREATE POLICY publisher_executor_movie_codes_insert ON public."movieCodes" FOR INSERT TO kartiseret_publication_executor WITH CHECK (true)';
  EXECUTE 'DROP POLICY IF EXISTS publisher_executor_table_fixes ON public."tableFixes"';
  EXECUTE 'CREATE POLICY publisher_executor_table_fixes ON public."tableFixes" FOR SELECT TO kartiseret_publication_executor USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS publisher_executor_table_skips ON public."tableSkips"';
  EXECUTE 'CREATE POLICY publisher_executor_table_skips ON public."tableSkips" FOR SELECT TO kartiseret_publication_executor USING (true)';
  EXECUTE 'DROP POLICY IF EXISTS publisher_executor_catalog_revision ON public.pipeline_catalog_revision';
  EXECUTE 'CREATE POLICY publisher_executor_catalog_revision ON public.pipeline_catalog_revision FOR SELECT TO kartiseret_publication_executor USING (true)';
END;
$publisher_policies$;

CREATE FUNCTION pipeline_internal.commit_category_publication_impl(p_publication_id uuid, p_fingerprint text, p_deadline_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
  publication public.pipeline_publications%rowtype;
  guard_record record; relation_record record; batch_record record;
  target_relation text; source_table text; allowed text[]; keys text[]; key_column text;
  join_sql text; raw_join_sql text; predicate text; columns_sql text;
  values_sql text; assignments_sql text; column_name text; expected_digest text;
  affected_id bigint; claim jsonb; manifest public.pipeline_scrape_snapshots%rowtype;
  actual_count bigint; final_revision bigint; actual_part_count integer;
  min_part integer; max_part integer; invalid boolean; duplicate_keys boolean;
  commit_deadline timestamptz; phase_started_at timestamptz := clock_timestamp();
  lock_started_at timestamptz;
  phase_name text := 'identity'; mutation_batches bigint := 0;
BEGIN
  IF p_deadline_seconds NOT IN (60, 300) THEN RAISE EXCEPTION 'Unsupported publication deadline'; END IF;
  commit_deadline := clock_timestamp() + make_interval(secs => p_deadline_seconds);
  -- Serialize staging retries and applies for this id without giving the
  -- staging login permission to lock or mutate the receipt row.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_publication_id::text, 0));
  SELECT * INTO STRICT publication FROM public.pipeline_publications WHERE publication_id = p_publication_id;
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
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','input_parse','publication_id',p_publication_id,
    'category',publication.category,'parts',actual_part_count,
    'changes',(SELECT count(*) FROM pg_temp._pipeline_publication_changes),
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;

  phase_name := 'guard_validation';
  phase_started_at := clock_timestamp();
  lock_started_at := clock_timestamp();
  FOR affected_id IN
    SELECT DISTINCT id FROM (
      SELECT (before_row->>'tmdb_id')::bigint id FROM pg_temp._pipeline_publication_changes
      UNION SELECT (after_row->>'tmdb_id')::bigint id FROM pg_temp._pipeline_publication_changes
    ) affected WHERE id IS NOT NULL ORDER BY id
  LOOP PERFORM pg_advisory_xact_lock(affected_id); END LOOP;
  EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE', source_table);
  LOCK TABLE public.pipeline_scrape_snapshots IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public."tableFixes", public."tableSkips" IN SHARE MODE;
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','live_lock_acquisition','publication_id',p_publication_id,
    'category',publication.category,
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-lock_started_at)*1000)::bigint
  )::text;

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

  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','guard_validation','publication_id',p_publication_id,
    'category',publication.category,
    'guard_tables',(SELECT count(DISTINCT body->>'table') FROM pg_temp._pipeline_publication_parts WHERE body->>'kind'='guard'),
    'claims',(SELECT count(*) FROM pg_temp._pipeline_publication_parts p CROSS JOIN LATERAL jsonb_array_elements(p.body->'rows') r(value) WHERE p.body->>'kind'='claims'),
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;

  phase_name := 'target_validation';
  phase_started_at := clock_timestamp();
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
        SELECT r.seq,to_jsonb(t) AS actual FROM requested r JOIN public.%1$I t ON %2$s %3$s
      ) SELECT coalesce(bool_or(
          l.actual IS DISTINCT FROM r.expected
          AND NOT ($1 = ''movieCodes'' AND r.before_row IS NULL AND l.actual IS NOT NULL)
        ),false)
        FROM requested r LEFT JOIN locked l USING(seq)',target_relation,join_sql,CASE WHEN target_relation = 'movieCodes' THEN '' ELSE 'FOR UPDATE OF t' END) INTO invalid USING target_relation;
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

  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','target_validation','publication_id',p_publication_id,
    'category',publication.category,'targets',(SELECT count(DISTINCT relation) FROM pg_temp._pipeline_publication_changes),
    'changes',(SELECT count(*) FROM pg_temp._pipeline_publication_changes),
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;

  phase_name := 'mutation_prepare';
  phase_started_at := clock_timestamp();
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
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','mutation_prepare','publication_id',p_publication_id,
    'category',publication.category,'batches',(SELECT count(DISTINCT batch) FROM pg_temp._pipeline_publication_changes),
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;

  phase_name := 'mutation_batches';
  phase_started_at := clock_timestamp();
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
    mutation_batches := mutation_batches + 1;
  END LOOP;
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','mutation_batches','publication_id',p_publication_id,
    'category',publication.category,'batches',mutation_batches,
    'changes',(SELECT count(*) FROM pg_temp._pipeline_publication_changes),
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;
  IF clock_timestamp() > commit_deadline THEN RAISE EXCEPTION 'Publication commit deadline exceeded' USING ERRCODE = '57014'; END IF;
  phase_name := 'final_validation';
  phase_started_at := clock_timestamp();
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
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','final_validation','publication_id',p_publication_id,
    'category',publication.category,
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;
  phase_name := 'receipt_finalize';
  phase_started_at := clock_timestamp();
  SELECT revision INTO final_revision FROM public.pipeline_catalog_revision WHERE singleton;
  UPDATE public.pipeline_publications SET status = 'applied', revision = final_revision, completed_at = now() WHERE publication_id = p_publication_id;
  DELETE FROM public.pipeline_publication_parts WHERE publication_id = p_publication_id;
  DROP TABLE pg_temp._pipeline_publication_changes, pg_temp._pipeline_publication_parts;
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase','phase','receipt_finalize','publication_id',p_publication_id,
    'category',publication.category,'revision',final_revision::text,
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;
  RETURN jsonb_build_object('status','applied','revision',final_revision::text);
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'publication_metric=%', jsonb_build_object(
    'event','publication_phase_failed','phase',phase_name,'publication_id',p_publication_id,
    'category',publication.category,'sqlstate',SQLSTATE,
    'duration_ms',floor(extract(epoch FROM clock_timestamp()-phase_started_at)*1000)::bigint
  )::text;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_category_publication(p_publication_id uuid, p_fingerprint text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
SET lock_timeout = '5s' SET statement_timeout = '90s' AS $$
  SELECT pipeline_internal.commit_category_publication_impl(p_publication_id, p_fingerprint, 60)
$$;
REVOKE ALL ON FUNCTION public.commit_category_publication(uuid,text) FROM PUBLIC, anon, authenticated, kartiseret_runtime;
GRANT EXECUTE ON FUNCTION public.commit_category_publication(uuid,text) TO service_role;

CREATE FUNCTION pipeline_internal.commit_category_publication_direct(p_publication_id uuid, p_fingerprint text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' SET timezone = 'UTC'
SET lock_timeout = '5s' SET idle_in_transaction_session_timeout = '30s' SET statement_timeout = '300s' AS $$
  SELECT pipeline_internal.commit_category_publication_impl(p_publication_id, p_fingerprint, 300)
$$;

-- The fixed-deadline REST wrapper also runs as the restricted executor. This
-- lets the service API role call only the 60-second wrapper, not the private
-- implementation with a caller-selected deadline.
GRANT CREATE ON SCHEMA public, pipeline_internal TO kartiseret_publication_executor;
-- PostgreSQL 17 CREATEROLE administrators need explicit SET permission to
-- transfer ownership. Permit it only for this migration and revoke it below.
GRANT kartiseret_publication_executor TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
ALTER FUNCTION pipeline_internal.commit_category_publication_impl(uuid,text,integer) OWNER TO kartiseret_publication_executor;
ALTER FUNCTION pipeline_internal.commit_category_publication_direct(uuid,text) OWNER TO kartiseret_publication_executor;
ALTER FUNCTION public.commit_category_publication(uuid,text) OWNER TO kartiseret_publication_executor;
REVOKE CREATE ON SCHEMA public, pipeline_internal FROM kartiseret_publication_executor;

REVOKE ALL ON FUNCTION pipeline_internal.commit_category_publication_impl(uuid,text,integer)
  FROM PUBLIC, anon, authenticated, kartiseret_runtime, service_role;
GRANT EXECUTE ON FUNCTION pipeline_internal.commit_category_publication_impl(uuid,text,integer)
  TO kartiseret_publication_executor;
REVOKE ALL ON FUNCTION pipeline_internal.commit_category_publication_direct(uuid,text)
  FROM PUBLIC, anon, authenticated, kartiseret_runtime, service_role;
GRANT EXECUTE ON FUNCTION pipeline_internal.commit_category_publication_direct(uuid,text)
  TO kartiseret_publisher;
REVOKE kartiseret_publication_executor FROM CURRENT_USER;
