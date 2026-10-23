-- Transaction-only fixture: caller rolls back all changes, including helpers.
CREATE TEMP TABLE publication_parity_results(scenario text, legacy jsonb, optimized jsonb);
DO $test$
#variable_conflict use_variable
DECLARE
  scenario text; implementation text; outcome jsonb; legacy_outcome jsonb;
  change_rows jsonb; before_row jsonb; payload text; fingerprint text;
  pub uuid := '00000000-0000-4000-8000-0000000000e1';
  raw_id uuid := '00000000-0000-4000-8000-0000000000e2';
  started timestamptz;
BEGIN
  FOREACH scenario IN ARRAY ARRAY['insert','update','delete','duplicate updates','partial shapes','stale target','duplicate inserts','invalid column','numeric string key','guard mismatch','guard multiplicity'] LOOP
    FOREACH implementation IN ARRAY ARRAY['legacy','optimized'] LOOP
      BEGIN
        INSERT INTO public."allShowtimes"(id,english_title,added) VALUES(raw_id,'Original',false);
        SELECT to_jsonb(t) INTO before_row FROM public."allShowtimes" t WHERE id=raw_id;
        change_rows := jsonb_build_array(jsonb_build_object('table','allShowtimes','before',before_row,'after',before_row || '{"added":true}'));
        CASE scenario
          WHEN 'insert' THEN change_rows := jsonb_build_array(jsonb_build_object('table','finalMovies','before',NULL,'after',jsonb_build_object('tmdb_id',2101999999,'english_title','Parity')));
          WHEN 'delete' THEN change_rows := jsonb_build_array(jsonb_build_object('table','allShowtimes','before',before_row,'after',NULL));
          WHEN 'duplicate updates' THEN change_rows := change_rows || jsonb_build_array(jsonb_build_object('table','allShowtimes','before',before_row,'after',before_row || '{"english_title":"Last"}'));
          WHEN 'partial shapes' THEN
            INSERT INTO public."allShowtimes"(id,english_title,added) VALUES('00000000-0000-4000-8000-0000000000e3','Other',false);
            change_rows := jsonb_build_array(jsonb_build_object('table','allShowtimes','before',before_row,'after',jsonb_build_object('id',raw_id,'added',true))) ||
              (SELECT jsonb_build_array(jsonb_build_object('table','allShowtimes','before',to_jsonb(t),'after',jsonb_build_object('id',t.id,'english_title',NULL))) FROM public."allShowtimes" t WHERE id='00000000-0000-4000-8000-0000000000e3');
          WHEN 'stale target' THEN UPDATE public."allShowtimes" SET english_title='Changed' WHERE id=raw_id;
          WHEN 'duplicate inserts' THEN change_rows := jsonb_build_array(jsonb_build_object('table','finalMovies','before',NULL,'after',jsonb_build_object('tmdb_id',2101999999,'english_title','Parity'))); change_rows:=change_rows || change_rows;
          WHEN 'invalid column' THEN change_rows := jsonb_set(change_rows,'{0,after,invalid_column}','true');
          WHEN 'numeric string key' THEN change_rows := jsonb_build_array(jsonb_build_object('table','finalMovies','before',NULL,'after','{"tmdb_id":"2101999999","english_title":"Parity"}'::jsonb));
          ELSE NULL;
        END CASE;
        payload := jsonb_build_object('kind','changes','rows',change_rows)::text;
        fingerprint := encode(sha256(convert_to('0:' || encode(sha256(convert_to(payload,'UTF8')),'hex'),'UTF8')),'hex');
        INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count) VALUES(pub,'nowplayings',990001,fingerprint,1);
        INSERT INTO public.pipeline_publication_parts VALUES(pub,0,payload);
        IF scenario IN ('guard mismatch','guard multiplicity') THEN
          payload := jsonb_build_object('kind','guard','table','allShowtimes','rows',CASE WHEN scenario='guard mismatch' THEN '[]'::jsonb ELSE (SELECT jsonb_agg(to_jsonb(t)) FROM public."allShowtimes" t) || jsonb_build_array(before_row) END)::text;
          INSERT INTO public.pipeline_publication_parts VALUES(pub,1,payload);
          SELECT encode(sha256(convert_to(string_agg(part::text || ':' || encode(sha256(convert_to(p.payload,'UTF8')),'hex'),E'\n' ORDER BY part),'UTF8')),'hex') INTO fingerprint FROM public.pipeline_publication_parts p WHERE publication_id=pub;
          UPDATE public.pipeline_publications SET fingerprint=fingerprint,part_count=2 WHERE publication_id=pub;
        END IF;
        started:=clock_timestamp();
        IF implementation='legacy' THEN outcome:=pg_temp.legacy_commit(pub,fingerprint); ELSE outcome:=public.commit_category_publication(pub,fingerprint); END IF;
        outcome := jsonb_build_object('receipt',outcome,'raw',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public."allShowtimes" t WHERE id IN(raw_id,'00000000-0000-4000-8000-0000000000e3')),
          'movie',(SELECT to_jsonb(t) FROM public."finalMovies" t WHERE tmdb_id=2101999999),'staging',(SELECT count(*) FROM public.pipeline_publication_parts WHERE publication_id=pub),
          'publication',(SELECT to_jsonb(t) FROM public.pipeline_publications t WHERE publication_id=pub));
        RAISE EXCEPTION 'fixture rollback' USING ERRCODE='ZX001';
      EXCEPTION
        WHEN SQLSTATE 'ZX001' THEN NULL;
        WHEN OTHERS THEN outcome:=jsonb_build_object('error',SQLSTATE,'message',SQLERRM);
      END;
      IF implementation='legacy' THEN legacy_outcome:=outcome;
      ELSE
        IF scenario IN ('insert','update','delete','duplicate updates','partial shapes','numeric string key') AND outcome ? 'error' THEN RAISE EXCEPTION 'Unexpected failure in %: %',scenario,outcome; END IF;
        IF scenario IN ('stale target','duplicate inserts','invalid column','guard mismatch','guard multiplicity') AND NOT (outcome ? 'error') THEN RAISE EXCEPTION 'Expected rejection in %',scenario; END IF;
        IF outcome IS DISTINCT FROM legacy_outcome THEN RAISE EXCEPTION 'Parity mismatch in %: legacy %, optimized %',scenario,legacy_outcome,outcome; END IF;
        INSERT INTO publication_parity_results VALUES(scenario,legacy_outcome,outcome);
      END IF;
    END LOOP;
  END LOOP;
END;
$test$;
SELECT scenario,legacy->>'error' AS expected_error,legacy IS NOT DISTINCT FROM optimized AS identical FROM publication_parity_results;
