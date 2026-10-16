-- Extend the existing restricted TypeScript runtime role for the PR 3 public
-- read endpoints. Keep private application data and mutations inaccessible.
GRANT SELECT ON TABLE
  public."finalSoons",
  public."finalShowtimes",
  public.cities,
  public.theaters
TO kartiseret_runtime;

CREATE POLICY "kartiseret_api_coming_soon_read"
  ON public."finalSoons"
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_showtimes_read"
  ON public."finalShowtimes"
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_cities_read"
  ON public.cities
  FOR SELECT TO kartiseret_runtime
  USING (true);

CREATE POLICY "kartiseret_api_theaters_read"
  ON public.theaters
  FOR SELECT TO kartiseret_runtime
  USING (true);
