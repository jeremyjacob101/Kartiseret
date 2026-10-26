-- All fixture rows and changes are rolled back by the test's transaction.
-- step
CREATE TEMP TABLE publication_scale_measurement(parts bigint, bytes bigint, seconds numeric, updated bigint, movies bigint, screenings bigint);
-- step
INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count)
VALUES('00000000-0000-4000-8000-0000000000d1',990002,'allShowtimes','Scale','__publication_scale__','complete',10000);
-- step
INSERT INTO public."allShowtimes"(id,snapshot_id,cinema,english_title,added)
SELECT md5('scale raw '||g)::uuid,'00000000-0000-4000-8000-0000000000d1','__publication_scale__','Scale film '||g,false FROM generate_series(1,10000) g;
-- step
CREATE TEMP TABLE scale_parts(part integer PRIMARY KEY,payload text);
-- step
INSERT INTO scale_parts
SELECT bucket-1,jsonb_build_object('kind','guard','table','allShowtimes','rows',jsonb_agg(row ORDER BY id))::text FROM
 (SELECT id,to_jsonb(t) row,ntile(330) OVER(ORDER BY id) bucket FROM public."allShowtimes" t) rows GROUP BY bucket;
-- step
CREATE TEMP TABLE scale_changes(seq bigint GENERATED ALWAYS AS IDENTITY, body jsonb);
-- step
INSERT INTO scale_changes(body)
SELECT jsonb_build_object('table','allShowtimes','before',to_jsonb(t),'after',to_jsonb(t)||'{"added":true}') FROM public."allShowtimes" t WHERE snapshot_id='00000000-0000-4000-8000-0000000000d1' ORDER BY id LIMIT 7500;
-- step
INSERT INTO scale_changes(body)
SELECT jsonb_build_object('table','finalMovies','before',NULL,'after',jsonb_build_object('tmdb_id',2101800000+g,'english_title','Scale movie','run_id',990002)) FROM generate_series(1,24) g;
-- step
INSERT INTO scale_changes(body)
SELECT jsonb_build_object('table','finalShowtimes','before',NULL,'after',jsonb_build_object('id',md5('scale screen '||g)::uuid,'tmdb_id',2101800001+(g%24),'cinema','__publication_scale__','english_title','Scale screening','run_id',990002)) FROM generate_series(1,300) g;
-- step
INSERT INTO scale_changes(body) VALUES(jsonb_build_object('table','pipeline_publication_checkpoints','before',NULL,'after',jsonb_build_object('category','nowplayings','snapshot_id','00000000-0000-4000-8000-0000000000d1','input_fingerprint','scale','phase','published')));
-- step
INSERT INTO scale_parts
SELECT 329+bucket,jsonb_build_object('kind','changes','rows',jsonb_agg(body ORDER BY seq))::text FROM
 (SELECT seq,body,ntile(406) OVER(ORDER BY seq) bucket FROM scale_changes) rows GROUP BY bucket;
-- step
INSERT INTO scale_parts VALUES(736,'{"kind":"claims","rows":[{"snapshot_id":"00000000-0000-4000-8000-0000000000d1","cinema":"__publication_scale__"}]}');
-- step
INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count)
SELECT '00000000-0000-4000-8000-0000000000d2','nowplayings',990002,
 encode(sha256(convert_to(string_agg(part::text||':'||encode(sha256(convert_to(payload,'UTF8')),'hex'),E'\n' ORDER BY part),'UTF8')),'hex'),count(*) FROM scale_parts;
-- step
INSERT INTO public.pipeline_publication_parts SELECT '00000000-0000-4000-8000-0000000000d2',part,payload FROM scale_parts;
-- step
GRANT ALL ON publication_scale_measurement TO service_role;
-- step
SET LOCAL ROLE service_role;
-- step
DO $test$
DECLARE started timestamptz := clock_timestamp(); receipt jsonb;
BEGIN
 SELECT public.commit_category_publication(publication_id,fingerprint) INTO receipt FROM public.pipeline_publications WHERE publication_id='00000000-0000-4000-8000-0000000000d2';
 IF receipt->>'status'<>'applied' THEN RAISE EXCEPTION 'Scale publication failed'; END IF;
 INSERT INTO publication_scale_measurement(seconds,updated,movies,screenings)
 SELECT extract(epoch FROM clock_timestamp()-started),
 (SELECT count(*) FROM public."allShowtimes" WHERE snapshot_id='00000000-0000-4000-8000-0000000000d1' AND added),
 (SELECT count(*) FROM public."finalMovies" WHERE run_id=990002),
 (SELECT count(*) FROM public."finalShowtimes" WHERE run_id=990002);
END;
$test$;
-- step
RESET ROLE;
-- step
DO $verify$
BEGIN
 IF EXISTS (
   WITH expected AS (
     SELECT r.value AS body,row_number() OVER(ORDER BY r.value->>'id') AS ordinal
     FROM scale_parts p CROSS JOIN LATERAL jsonb_array_elements(p.payload::jsonb->'rows') r(value)
     WHERE p.part<330 AND r.value->>'snapshot_id'='00000000-0000-4000-8000-0000000000d1'
   )
   SELECT 1 FROM expected e LEFT JOIN public."allShowtimes" t ON t.id=(e.body->>'id')::uuid
   WHERE to_jsonb(t) IS DISTINCT FROM e.body || jsonb_build_object('added',e.ordinal<=7500)
 ) THEN RAISE EXCEPTION 'Scale publication changed unexpected raw values'; END IF;
 IF EXISTS (SELECT 1 FROM public.pipeline_publication_parts WHERE publication_id='00000000-0000-4000-8000-0000000000d2')
 OR NOT EXISTS (SELECT 1 FROM public.pipeline_publication_checkpoints WHERE snapshot_id='00000000-0000-4000-8000-0000000000d1' AND phase='published') THEN
   RAISE EXCEPTION 'Scale publication did not finalize atomically';
 END IF;
END;
$verify$;
-- step
UPDATE publication_scale_measurement SET parts=(SELECT count(*) FROM scale_parts),bytes=(SELECT sum(octet_length(payload)) FROM scale_parts);
-- step
SELECT * FROM publication_scale_measurement;
