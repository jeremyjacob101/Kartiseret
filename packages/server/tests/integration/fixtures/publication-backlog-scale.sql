-- Production-shaped, synthetic backlog. The enclosing test rolls everything back.
-- Keep all pending legacy work and existing retention deletes. Only updates of
-- explicitly failed attempts with complete replacements are absent from the diff.
-- step
SET LOCAL work_mem = '2184kB';
CREATE TEMP TABLE backlog_measurement(seconds numeric,changes bigint,parts bigint,bytes bigint,retained_failed bigint,pending_legacy bigint,screenings bigint);
CREATE TEMP TABLE backlog_raw AS SELECT g AS n,md5('backlog raw '||g)::uuid AS id FROM generate_series(1,59416) g;
CREATE TEMP TABLE backlog_screen AS SELECT g AS n,md5('backlog screen '||g)::uuid AS id FROM generate_series(1,10413) g;
INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,table_name,source_name,cinema,status,row_count)
SELECT md5('backlog current '||g)::uuid,990004,'allShowtimes','BacklogSource'||g,'Backlog scale '||g,'complete',
 (SELECT count(*) FROM backlog_raw WHERE n>48897 AND (n-48898)%6=g) FROM generate_series(0,5) g;
INSERT INTO public.pipeline_scrape_snapshots(snapshot_id,run_id,attempt,table_name,source_name,cinema,status,row_count)
SELECT md5('backlog failed '||g)::uuid,990003,1+g/6,'allShowtimes','BacklogSource'||(g%6),'Backlog scale '||(g%6),'failed',0 FROM generate_series(0,17) g;
INSERT INTO public."allShowtimes"(id,created_at,english_title,release_year,original_language,screening_city,date_of_showing,showtime,cinema,english_href,screening_type,hebrew_title,hebrew_href,dub_language,rating,directed_by,runtime,screening_tech,tmdb_id,run_id,cleaned,added,snapshot_id)
SELECT id,'2026-10-23T08:43:00Z','Synthetic Film Number '||n,2026,'English','Synthetic City '||(n%30),DATE '2030-10-25'+(n%14),'18:30',
 'Backlog scale '||CASE WHEN n>48897 THEN (n-48898)%6 ELSE n%6 END,
 'https://cinema.invalid/events/'||md5(n::text),'Regular','סרט לדוגמה '||n,'https://cinema.invalid/he/events/'||md5(n::text),'','PG-13','Synthetic Director',110,'2D',NULL,
 CASE WHEN n>48897 THEN 990004 WHEN n<=29057 OR n BETWEEN 31731 AND 34537 THEN 990003 WHEN n BETWEEN 29058 AND 34969 THEN 990002 ELSE 990001 END,
 n BETWEEN 34970 AND 48897,CASE WHEN n BETWEEN 34970 AND 48897 THEN true ELSE NULL END,
 CASE WHEN n>48897 THEN md5('backlog current '||((n-48898)%6))::uuid WHEN n<=29057 OR n BETWEEN 31731 AND 34537 THEN md5('backlog failed '||(n%18))::uuid ELSE NULL END
FROM backlog_raw;
INSERT INTO public."finalMovies"(tmdb_id,english_title,release_year,runtime,popularity,run_id,en_poster,backdrop,imdb_id,genres,provider_freshness)
SELECT 1100000+g*2,'Synthetic movie '||g,2026,110,10,990001,'https://images.invalid/'||md5(g::text),'https://backdrops.invalid/'||md5(g::text),'tt'||g,ARRAY['Drama'],
 (SELECT jsonb_object_agg('field'||k,jsonb_build_object('source',md5((g*100+k)::text),'checked','2026-10-23T08:00:00Z','reason','usable_fields')) FROM generate_series(1,40) k)
FROM generate_series(1,155) g;
INSERT INTO public."movieCodes"(tmdb_id,movie_code) SELECT tmdb_id,'Q'||chr(65+(tmdb_id-1100002)/2/26)||chr(65+((tmdb_id-1100002)/2)%26) FROM public."finalMovies" WHERE tmdb_id BETWEEN 1100002 AND 1100310;
INSERT INTO public."movieCodes"(tmdb_id,movie_code) SELECT 1100000+g*2-1,'P'||lpad(to_hex(g),2,'0') FROM generate_series(6,17) g;
INSERT INTO public."finalShowtimes"(id,created_at,english_title,original_language,screening_city,date_of_showing,showtime,cinema,english_href,screening_type,hebrew_title,hebrew_href,dub_language,screening_tech,tmdb_id,run_id)
SELECT id,'2026-10-21T08:00:00Z','Synthetic Film Number '||n,'English','Synthetic City '||(n%30),DATE '2030-10-25'+(n%14),'18:30','Backlog scale '||(n%6),'https://cinema.invalid/events/'||md5(n::text),'Regular','סרט לדוגמה '||n,'https://cinema.invalid/he/events/'||md5(n::text),'','2D',1100000+(1+n%139)*2,990001 FROM backlog_screen;
ANALYZE public."allShowtimes";
ANALYZE public."finalShowtimes";
ANALYZE public."finalMovies";
-- step
CREATE TEMP TABLE backlog_changes(seq bigint GENERATED ALWAYS AS IDENTITY,relation text,body jsonb);
-- 2,673 still-pending legacy rows and 9,593 retained current-snapshot rows.
-- The 29,057 retained failed-attempt rows remain uncleaned and unadded.
INSERT INTO backlog_changes(relation,body)
SELECT 'allShowtimes',jsonb_build_object('table','allShowtimes','before',to_jsonb(t),'after',to_jsonb(t)||jsonb_build_object('cleaned',true,'english_title',lower(t.english_title),'run_id',990004,'added',CASE WHEN x.n>48897 THEN true ELSE NULL END))
FROM public."allShowtimes" t JOIN backlog_raw x USING(id) WHERE x.n BETWEEN 29058 AND 31730 OR x.n BETWEEN 48898 AND 58490 ORDER BY id;
-- Existing retention/dedupe output: 14,492 deletes, including 926 current rows.
INSERT INTO backlog_changes(relation,body)
SELECT 'allShowtimes',jsonb_build_object('table','allShowtimes','before',to_jsonb(t),'after',NULL) FROM public."allShowtimes" t JOIN backlog_raw x USING(id) WHERE x.n BETWEEN 31731 AND 45296 OR x.n BETWEEN 58491 AND 59416 ORDER BY id;
INSERT INTO backlog_changes(relation,body)
SELECT 'finalMovies',jsonb_build_object('table','finalMovies','before',to_jsonb(t),'after',CASE WHEN tmdb_id>1100278 THEN NULL ELSE to_jsonb(t)||jsonb_build_object('popularity',12,'run_id',990004) END) FROM public."finalMovies" t WHERE tmdb_id BETWEEN 1100002 AND 1100310 ORDER BY tmdb_id;
INSERT INTO backlog_changes(relation,body)
SELECT 'finalMovies',jsonb_build_object('table','finalMovies','before',NULL,'after',to_jsonb(t)||jsonb_build_object('tmdb_id',1100000+g*2-1,'english_title','New synthetic movie '||g,'run_id',990004)) FROM generate_series(1,17) g CROSS JOIN LATERAL (SELECT * FROM public."finalMovies" WHERE tmdb_id=1100002) t;
INSERT INTO backlog_changes(relation,body)
SELECT 'finalShowtimes',jsonb_build_object('table','finalShowtimes','before',to_jsonb(t),'after',NULL) FROM public."finalShowtimes" t JOIN backlog_screen x USING(id) WHERE x.n<=10333 ORDER BY id;
INSERT INTO backlog_changes(relation,body)
SELECT 'finalShowtimes',jsonb_build_object('table','finalShowtimes','before',NULL,'after',to_jsonb(t)||jsonb_build_object('id',md5('backlog new screen '||g)::uuid,'run_id',990004)) FROM generate_series(1,8964) g CROSS JOIN LATERAL (SELECT * FROM public."finalShowtimes" WHERE id=md5('backlog screen 1')::uuid) t;
INSERT INTO backlog_changes(relation,body)
SELECT 'movieCodes',jsonb_build_object('table','movieCodes','before',NULL,'after',jsonb_build_object('tmdb_id',1100000+g*2-1,'movie_code','N'||lpad(g::text,2,'0'))) FROM generate_series(1,5) g;
INSERT INTO backlog_changes(relation,body)
SELECT 'pipeline_scrape_snapshots',jsonb_build_object('table','pipeline_scrape_snapshots','before',to_jsonb(s),'after',to_jsonb(s)||jsonb_build_object('row_count',(SELECT count(*) FROM backlog_raw WHERE n BETWEEN 48898 AND 58490 AND md5('backlog current '||((n-48898)%6))::uuid=s.snapshot_id))) FROM public.pipeline_scrape_snapshots s WHERE s.run_id=990004;
INSERT INTO backlog_changes(relation,body)
SELECT 'pipeline_publication_checkpoints',jsonb_build_object('table','pipeline_publication_checkpoints','before',NULL,'after',jsonb_build_object('category','nowplayings','snapshot_id',snapshot_id,'input_fingerprint','backlog','phase','published')) FROM public.pipeline_scrape_snapshots WHERE run_id=990004;
-- step
CREATE TEMP TABLE backlog_parts(part bigint GENERATED ALWAYS AS IDENTITY(MINVALUE 0 START WITH 0),payload text);
INSERT INTO backlog_parts(payload)
SELECT jsonb_build_object('kind','guard','table','allShowtimes','rows',jsonb_agg(body ORDER BY id))::text FROM (SELECT t.id,to_jsonb(t) body,(row_number() OVER(ORDER BY id)-1)/200 bucket FROM public."allShowtimes" t) x GROUP BY bucket ORDER BY bucket;
INSERT INTO backlog_parts(payload)
SELECT jsonb_build_object('kind','guard','table','finalMovies','rows',jsonb_agg(body ORDER BY tmdb_id))::text FROM (SELECT t.tmdb_id,to_jsonb(t) body,(row_number() OVER(ORDER BY tmdb_id)-1)/50 bucket FROM public."finalMovies" t) x GROUP BY bucket ORDER BY bucket;
INSERT INTO backlog_parts(payload)
SELECT jsonb_build_object('kind','guard','table','finalShowtimes','rows',jsonb_agg(body ORDER BY id))::text FROM (SELECT t.id,to_jsonb(t) body,(row_number() OVER(ORDER BY id)-1)/200 bucket FROM public."finalShowtimes" t) x GROUP BY bucket ORDER BY bucket;
INSERT INTO backlog_parts(payload) SELECT jsonb_build_object('kind','guard','table','pipeline_scrape_snapshots','rows',coalesce(jsonb_agg(to_jsonb(t)),'[]'))::text FROM public.pipeline_scrape_snapshots t WHERE table_name='allShowtimes';
INSERT INTO backlog_parts(payload) SELECT jsonb_build_object('kind','guard','table','pipeline_publication_checkpoints','rows',coalesce(jsonb_agg(to_jsonb(t)),'[]'))::text FROM public.pipeline_publication_checkpoints t WHERE category='nowplayings';
INSERT INTO backlog_parts(payload) SELECT jsonb_build_object('kind','guard','table','tableFixes','rows',coalesce(jsonb_agg(to_jsonb(t)),'[]'))::text FROM public."tableFixes" t;
INSERT INTO backlog_parts(payload) SELECT jsonb_build_object('kind','guard','table','tableSkips','rows',coalesce(jsonb_agg(to_jsonb(t)),'[]'))::text FROM public."tableSkips" t;
INSERT INTO backlog_parts(payload)
SELECT jsonb_build_object('kind','changes','rows',jsonb_agg(body ORDER BY seq))::text FROM (SELECT *, (row_number() OVER(PARTITION BY relation ORDER BY seq)-1)/CASE WHEN relation='finalMovies' THEN 40 ELSE 200 END bucket FROM backlog_changes) x GROUP BY relation,bucket ORDER BY relation,bucket;
INSERT INTO backlog_parts(payload) SELECT jsonb_build_object('kind','claims','rows',jsonb_agg(jsonb_build_object('snapshot_id',snapshot_id,'cinema',cinema)))::text FROM public.pipeline_scrape_snapshots WHERE run_id=990004;
INSERT INTO public.pipeline_publications(publication_id,category,run_id,fingerprint,part_count)
SELECT '00000000-0000-4000-8000-000000000124','nowplayings',990004,encode(sha256(convert_to(string_agg(part::text||':'||encode(sha256(convert_to(payload,'UTF8')),'hex'),E'\n' ORDER BY part),'UTF8')),'hex'),count(*) FROM backlog_parts;
INSERT INTO public.pipeline_publication_parts SELECT '00000000-0000-4000-8000-000000000124',part,payload FROM backlog_parts;
GRANT ALL ON backlog_measurement TO service_role;
-- step
SET LOCAL ROLE service_role;
-- step
DO $measure$
DECLARE started timestamptz := clock_timestamp(); receipt jsonb;
BEGIN
 SELECT public.commit_category_publication(publication_id,fingerprint) INTO receipt FROM public.pipeline_publications WHERE publication_id='00000000-0000-4000-8000-000000000124';
 IF receipt->>'status'<>'applied' THEN RAISE EXCEPTION 'Backlog publication failed'; END IF;
 INSERT INTO backlog_measurement(seconds,retained_failed,pending_legacy,screenings)
 SELECT extract(epoch FROM clock_timestamp()-started),
  (SELECT count(*) FROM public."allShowtimes" WHERE run_id=990003 AND cleaned=false AND added IS NULL),
  (SELECT count(*) FROM public."allShowtimes" WHERE run_id=990004 AND snapshot_id IS NULL AND cleaned=true AND added IS NULL),
  (SELECT count(*) FROM public."finalShowtimes" WHERE cinema LIKE 'Backlog scale %');
END;
$measure$;
-- step
RESET ROLE;
DO $verify$
BEGIN
 IF EXISTS (SELECT 1 FROM public."finalShowtimes" s LEFT JOIN public."finalMovies" m USING(tmdb_id) WHERE s.cinema LIKE 'Backlog scale %' AND m.tmdb_id IS NULL) THEN RAISE EXCEPTION 'Orphan screening'; END IF;
 IF EXISTS (SELECT 1 FROM public."finalMovies" m LEFT JOIN public."movieCodes" c USING(tmdb_id) WHERE m.tmdb_id BETWEEN 1100001 AND 1100310 AND c.tmdb_id IS NULL) THEN RAISE EXCEPTION 'Missing permanent code'; END IF;
 IF (SELECT count(*) FROM public.pipeline_publication_checkpoints c JOIN public.pipeline_scrape_snapshots s USING(snapshot_id) WHERE s.run_id=990004 AND c.phase='published')<>6 THEN RAISE EXCEPTION 'Checkpoint count mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM public.pipeline_scrape_snapshots s WHERE s.run_id=990004 AND s.row_count<>(SELECT count(*) FROM public."allShowtimes" t WHERE t.snapshot_id=s.snapshot_id)) THEN RAISE EXCEPTION 'Snapshot count mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM public.pipeline_publication_parts WHERE publication_id='00000000-0000-4000-8000-000000000124') THEN RAISE EXCEPTION 'Staging did not finalize'; END IF;
 IF (SELECT max(octet_length(payload)) FROM backlog_parts)>750000 THEN RAISE EXCEPTION 'Unbounded staging part'; END IF;
END;
$verify$;
UPDATE backlog_measurement SET changes=(SELECT count(*) FROM backlog_changes),parts=(SELECT count(*) FROM backlog_parts),bytes=(SELECT sum(octet_length(payload)) FROM backlog_parts);
SELECT * FROM backlog_measurement;
