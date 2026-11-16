ALTER TABLE public."userPreferences"
  ADD COLUMN showtime_preferences jsonb NOT NULL
  DEFAULT '{"screeningFilters":{"version":3,"unchecked":{"showType":[],"screenFormat":[],"screeningTech":[],"dubLanguage":[]}},"excludedCinemaIds":[]}'::jsonb;
