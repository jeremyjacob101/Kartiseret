-- Run against development after the migration. Every fixture change rolls back.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  relation text; date_col text; source boolean; sid uuid;
  cutoff date := '1900-01-01'; day date; result jsonb; i integer; remaining integer; before_revision bigint; after_revision bigint;
BEGIN
  IF has_function_privilege('anon','public.retire_expired_rows(text,date,boolean,integer)','EXECUTE')
     OR has_function_privilege('authenticated','public.retire_expired_rows(text,date,boolean,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Retention RPC exposed to public roles';
  END IF;
  SELECT revision INTO before_revision FROM public.pipeline_catalog_revision WHERE singleton;
  PERFORM public.retire_expired_rows('finalShowtimes',cutoff,true,1);
  SELECT revision INTO after_revision FROM public.pipeline_catalog_revision WHERE singleton;
  IF before_revision<>after_revision THEN RAISE EXCEPTION 'Empty cleanup changed revision'; END IF;
  FOREACH relation IN ARRAY ARRAY['allShowtimes','allSoons','allTheques','finalShowtimes','finalSoons','finalTheques'] LOOP
    result := public.retire_expired_rows(relation,cutoff,false,1);
    IF (result->>'eligible')::integer <> 0 THEN RAISE EXCEPTION 'Test date has existing rows'; END IF;
    date_col := CASE WHEN relation IN ('allSoons','finalSoons') THEN 'release_date' ELSE 'date_of_showing' END;
    source := relation LIKE 'all%'; sid := gen_random_uuid();
    IF source THEN
      INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count)
        VALUES(sid,0,relation,'retention-fixture','retention-fixture','complete',4);
    END IF;
    FOR i IN 1..4 LOOP
      day := CASE i WHEN 1 THEN cutoff-1 WHEN 2 THEN cutoff WHEN 3 THEN cutoff+1 ELSE NULL END;
      IF source THEN
        EXECUTE format('INSERT INTO public.%I(%I,snapshot_id) VALUES($1,$2)',relation,date_col) USING day,sid;
      ELSIF relation='finalSoons' THEN
        IF day IS NOT NULL THEN
          INSERT INTO public."finalSoons"(english_title,hebrew_title,release_date,tmdb_id)
            VALUES('retention-fixture','retention-fixture',day,2147000000+i);
        END IF;
      ELSIF relation='finalTheques' THEN
        IF day IS NOT NULL THEN
          INSERT INTO public."finalTheques"(english_title,date_of_showing,showtime,screening_city,cinema,run_id)
            VALUES('retention-fixture',day,'12:00','retention-fixture','retention-fixture',0);
        END IF;
      ELSE
        EXECUTE format('INSERT INTO public.%I(%I) VALUES($1)',relation,date_col) USING day;
      END IF;
    END LOOP;
    result := public.retire_expired_rows(relation,cutoff,false,1);
    IF (result->>'eligible')::integer <> 2 OR (result->>'deleted')::integer <> 0 THEN RAISE EXCEPTION 'Dry run mismatch: %',result; END IF;
    result := public.retire_expired_rows(relation,cutoff,true,1);
    IF (result->>'deleted')::integer <> 1 OR NOT (result->>'has_more')::boolean THEN RAISE EXCEPTION 'Bounded batch mismatch'; END IF;
    result := public.retire_expired_rows(relation,cutoff,true,10);
    IF (result->>'deleted')::integer <> 1 OR (result->>'has_more')::boolean THEN RAISE EXCEPTION 'Second batch mismatch'; END IF;
    result := public.retire_expired_rows(relation,cutoff,true,10);
    IF (result->>'deleted')::integer <> 0 THEN RAISE EXCEPTION 'Retry not idempotent'; END IF;
    IF source THEN
      SELECT row_count INTO remaining FROM public.pipeline_scrape_snapshots WHERE snapshot_id=sid;
      IF remaining<>2 THEN RAISE EXCEPTION 'Manifest did not preserve future/null rows'; END IF;
    END IF;
  END LOOP;
  sid := gen_random_uuid();
  INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count)
    VALUES(sid,0,'allShowtimes','retention-zero-fixture','retention-fixture','complete',1);
  INSERT INTO public."allShowtimes"(date_of_showing,snapshot_id) VALUES(cutoff,sid);
  PERFORM public.retire_expired_rows('allShowtimes',cutoff,true,10);
  IF (SELECT row_count FROM public.pipeline_scrape_snapshots WHERE snapshot_id=sid)<>0 THEN
    RAISE EXCEPTION 'Empty snapshot count was not repaired';
  END IF;
  BEGIN
    PERFORM public.retire_expired_rows('utilRunLogs',cutoff,true,1);
    RAISE EXCEPTION 'Unknown table accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.retire_expired_rows('allShowtimes',current_date+2,true,1);
    RAISE EXCEPTION 'Future cutoff accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.retire_expired_rows('allShowtimes',cutoff,true,1001);
    RAISE EXCEPTION 'Unbounded batch accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END;
$$;
RESET ROLE;
-- Force manifest repair to fail after DELETE. The function's batch must roll back.
CREATE FUNCTION pg_temp.retention_fixture_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'retention fixture forced failure'; END; $$;
CREATE TRIGGER retention_fixture_failure BEFORE UPDATE ON public.pipeline_scrape_snapshots
FOR EACH ROW EXECUTE FUNCTION pg_temp.retention_fixture_failure();
SET LOCAL ROLE service_role;
DO $$
DECLARE sid uuid; row_id uuid; failed boolean := false;
BEGIN
  SELECT snapshot_id INTO sid FROM public.pipeline_scrape_snapshots
    WHERE source_name='retention-fixture' AND table_name='allShowtimes';
  INSERT INTO public."allShowtimes"(date_of_showing,snapshot_id) VALUES('1900-01-01',sid) RETURNING id INTO row_id;
  BEGIN
    PERFORM public.retire_expired_rows('allShowtimes','1900-01-01',true,10);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'retention fixture forced failure' THEN RAISE; END IF;
    failed := true;
  END;
  IF NOT failed OR NOT EXISTS(SELECT 1 FROM public."allShowtimes" WHERE id=row_id) THEN
    RAISE EXCEPTION 'Manifest failure did not roll deletion back';
  END IF;
END; $$;
ROLLBACK;
