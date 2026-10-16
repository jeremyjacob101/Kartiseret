-- The baseline already grants public reads through equivalent TO PUBLIC
-- policies. The runtime-specific duplicates add no protection and make each
-- SELECT evaluate multiple permissive policies. Keep the explicit SELECT
-- grants from 20261015162250_public_api_runtime_select.sql.
DROP POLICY IF EXISTS "kartiseret_api_coming_soon_read"
  ON public."finalSoons";
DROP POLICY IF EXISTS "kartiseret_api_showtimes_read"
  ON public."finalShowtimes";
DROP POLICY IF EXISTS "kartiseret_api_cities_read"
  ON public.cities;
DROP POLICY IF EXISTS "kartiseret_api_theaters_read"
  ON public.theaters;
