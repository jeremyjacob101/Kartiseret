-- Publish the current Planet Cinema label without rewriting raw scrape history.
-- allShowtimes, allSoons, pipeline_scrape_snapshots, and timing history retain
-- their original source labels; application compatibility code reads them.

UPDATE public."finalShowtimes"
SET cinema = 'Planet Cinema' || substring(btrim(cinema) FROM length('Yes Planet') + 1)
WHERE btrim(cinema) ~* '^Yes Planet($|[[:space:]])';

UPDATE public.theaters
SET chain = 'Planet Cinema'
WHERE lower(btrim(chain)) = 'yes planet';

UPDATE public.theaters
SET theater_name = 'Planet Cinema' || substring(btrim(theater_name) FROM length('Yes Planet') + 1)
WHERE btrim(theater_name) ~* '^Yes Planet($|[[:space:]])';
