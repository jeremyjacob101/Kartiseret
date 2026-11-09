BEGIN;

-- Preserve every existing sample without guessing its collection transport.
ALTER TABLE public."utilAvgTimeHistory"
  ADD COLUMN transport text NOT NULL DEFAULT 'legacy'
    CHECK (transport IN ('legacy', 'requests', 'selenium', 'requests_selenium_fallback'));
ALTER TABLE public."utilAvgTimeHistory"
  DROP CONSTRAINT util_avg_time_history_pkey,
  ADD CONSTRAINT util_avg_time_history_pkey
    PRIMARY KEY (name, runner_machine, weekday, transport);

CREATE OR REPLACE FUNCTION public.append_util_avg_time_transport_history(
  p_name text,
  p_runner_machine text,
  p_weekday text,
  p_duration double precision,
  p_transport text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'runner name must not be empty';
  END IF;
  IF p_runner_machine IS NULL OR btrim(p_runner_machine) = '' THEN
    RAISE EXCEPTION 'runner machine must not be empty';
  END IF;
  IF p_weekday IS NULL OR p_weekday NOT IN (
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
  ) THEN
    RAISE EXCEPTION 'weekday must be a lowercase weekday name';
  END IF;
  IF p_duration IS NULL OR NOT (p_duration > 0 AND p_duration < 'Infinity'::double precision) THEN
    RAISE EXCEPTION 'duration must be a finite positive number';
  END IF;

  IF p_transport IS NULL OR p_transport NOT IN ('legacy', 'requests', 'selenium', 'requests_selenium_fallback') THEN
    RAISE EXCEPTION 'invalid timing transport';
  END IF;

  INSERT INTO public."utilAvgTimeHistory" AS existing (
    name,
    runner_machine,
    weekday,
    transport,
    recent_times
  )
  VALUES (
    p_name,
    p_runner_machine,
    p_weekday,
    p_transport,
    ARRAY[p_duration]::double precision[]
  )
  ON CONFLICT (name, runner_machine, weekday, transport)
  DO UPDATE SET
    recent_times = (
      CASE
        WHEN pg_catalog.cardinality(existing.recent_times) >= 5
          THEN existing.recent_times[2:5]
        ELSE existing.recent_times
      END
    ) || EXCLUDED.recent_times,
    updated_at = pg_catalog.now();
END;
$$;

-- A distinct RPC name avoids ambiguous PostgREST overload resolution. Keep
-- the old signature usable by deployed workers and unchanged dataflow timing.
CREATE OR REPLACE FUNCTION public.append_util_avg_time_history(
  p_name text,
  p_runner_machine text,
  p_weekday text,
  p_duration double precision
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT public.append_util_avg_time_transport_history(
    p_name, p_runner_machine, p_weekday, p_duration, 'legacy'
  );
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.append_util_avg_time_transport_history(text, text, text, double precision, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_util_avg_time_transport_history(text, text, text, double precision, text)
  TO service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.append_util_avg_time_history(text, text, text, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_util_avg_time_history(text, text, text, double precision)
  TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
