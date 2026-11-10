BEGIN;

CREATE TABLE public."utilAvgTimeHistory" (
  name text NOT NULL,
  runner_machine text NOT NULL CHECK (btrim(runner_machine) <> ''),
  weekday text NOT NULL CHECK (
    weekday IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
  ),
  recent_times double precision[] NOT NULL DEFAULT ARRAY[]::double precision[],
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT util_avg_time_history_pkey
    PRIMARY KEY (name, runner_machine, weekday),
  CONSTRAINT util_avg_time_history_recent_times_max_five
    CHECK (cardinality(recent_times) <= 5),
  CONSTRAINT util_avg_time_history_recent_times_one_dimensional
    CHECK (array_ndims(recent_times) IS NULL OR array_ndims(recent_times) = 1)
);

ALTER TABLE public."utilAvgTimeHistory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY util_avg_time_history_service_role_access
  ON public."utilAvgTimeHistory"
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public."utilAvgTimeHistory"
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public."utilAvgTimeHistory"
  TO service_role;

CREATE OR REPLACE FUNCTION public.append_util_avg_time_history(
  p_name text,
  p_runner_machine text,
  p_weekday text,
  p_duration double precision
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

  INSERT INTO public."utilAvgTimeHistory" AS existing (
    name,
    runner_machine,
    weekday,
    recent_times
  )
  VALUES (
    p_name,
    p_runner_machine,
    p_weekday,
    ARRAY[p_duration]::double precision[]
  )
  ON CONFLICT (name, runner_machine, weekday)
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

REVOKE ALL PRIVILEGES ON FUNCTION public.append_util_avg_time_history(text, text, text, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_util_avg_time_history(text, text, text, double precision)
  TO service_role;

COMMIT;
