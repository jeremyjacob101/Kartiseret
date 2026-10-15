-- Deterministic, fictional public/worker development fixtures. Safe for a fresh
-- development project; inserts use stable keys and do not overwrite real city
-- records. This seed intentionally does not create fake Supabase Auth accounts.

INSERT INTO public.cities (name, alt_spellings, zoom_layer, latitude, longitude, neighboring_cities)
VALUES
  ('Tel Aviv', ARRAY['Tel Aviv-Yafo'], 11, 32.0853, 34.7818, ARRAY['Ramat Gan', 'Givatayim']),
  ('Jerusalem', ARRAY['Yerushalayim'], 10, 31.7683, 35.2137, ARRAY['Mevaseret Zion'])
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.theaters (location, chain, address, latitude, longitude, theater_name, city_name)
VALUES
  ('dev-fixture:tel-aviv:cinema', 'Development Cinema', 'Fixture address', 32.0853, 34.7818, 'Development Cinema Tel Aviv', 'Tel Aviv'),
  ('dev-fixture:jerusalem:cinema', 'Development Cinema', 'Fixture address', 31.7683, 35.2137, 'Development Cinema Jerusalem', 'Jerusalem')
ON CONFLICT (location) DO NOTHING;

INSERT INTO public."finalMovies" (
  tmdb_id, english_title, release_year, runtime, popularity, "imdbRating", "imdbVotes",
  "rtAudienceRating", "rtAudienceVotes", "rtCriticRating", "rtCriticVotes",
  "lbRating", "lbVotes", "tmdbRating", "tmdbVotes", en_poster, backdrop, en_trailer,
  genres, alt_options, solo_update, imdb_id
)
VALUES
  (
    9100001, 'Dev Catalog Film', 2024, 118.8, 22.1, 7.6, '120',
    '92%', 35, 88, 18, 4.1, 12, 81, 900,
    'https://image.tmdb.org/t/p/w342/dev-fixture-poster.jpg',
    'https://image.tmdb.org/t/p/w1280/dev-fixture-backdrop.jpg',
    'dev-fixture-trailer',
    ARRAY['Drama', 'Mystery'],
    '[{"tmdb":"9100002","title":"Alternate Dev Film","year":2023,"poster_url":null}]'::jsonb,
    false, 'tt0000001'
  ),
  (
    9100002, 'Pending Dev Update', 2024, 90, 1.2, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, '[]'::jsonb, true, NULL
  ),
  (
    9100003, 'Dev Film Without Optional Metadata', NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, '[]'::jsonb, false, NULL
  )
ON CONFLICT (tmdb_id) DO NOTHING;

INSERT INTO public."movieCodes" (tmdb_id, movie_code)
VALUES (9100001, 'D01')
ON CONFLICT (tmdb_id) DO NOTHING;

INSERT INTO public."finalShowtimes" (
  id, english_title, original_language, screening_city, date_of_showing, showtime,
  cinema, english_href, tmdb_id
)
VALUES (
  '00000000-0000-4000-8000-000000009001',
  'Dev Catalog Film', 'en', 'Tel Aviv', (CURRENT_DATE + 14)::date,
  '19:30'::time, 'Development Cinema Tel Aviv',
  'https://example.invalid/dev-screening', 9100001
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."allShowtimes" (
  id, english_title, release_year, original_language, screening_city, date_of_showing,
  showtime, cinema, tmdb_id, run_id, cleaned, added
)
VALUES (
  '00000000-0000-4000-8000-000000009002',
  'Dev Catalog Film', 2024, 'en', 'Tel Aviv', (CURRENT_DATE + 14)::date,
  '19:30'::time, 'Development Cinema Tel Aviv', 9100001, 9100000, false, true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."finalSoons" (
  id, imdb_id, english_title, hebrew_title, release_date, en_poster, backdrop, tmdb_id,
  release_year, en_trailer, genres, runtime, alt_options, solo_update, popularity
)
VALUES (
  '00000000-0000-4000-8000-000000009003',
  NULL, 'Dev Coming Soon', 'סרט לדוגמה', (CURRENT_DATE + 90)::date,
  NULL, NULL, 9100011, 2027, NULL, ARRAY['Comedy'], 101,
  '[]'::jsonb, false, 1.1
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."finalThequeMovies" (
  tmdb_id, english_title, hebrew_title, release_year, runtime, popularity,
  "imdbRating", "imdbVotes", "rtAudienceRating", "rtAudienceVotes",
  "rtCriticRating", "rtCriticVotes", "lbRating", "lbVotes", "tmdbRating",
  "tmdbVotes", genres, alt_options, solo_update
)
VALUES (
  9100012, 'Dev Cinematheque Film', 'סרט סינמטק לדוגמה', 2020, 105, 3.5,
  7.1, 400, 82, 30, 90, 14, 4.0, 25, 76, 1000,
  ARRAY['Drama'], '[]'::jsonb, false
)
ON CONFLICT (tmdb_id) DO NOTHING;

INSERT INTO public."finalTheques" (
  id, tmdb_id, english_title, hebrew_title, date_of_showing, showtime,
  screening_city, cinema, run_id
)
VALUES (
  '00000000-0000-4000-8000-000000009004',
  9100012, 'Dev Cinematheque Film', 'סרט סינמטק לדוגמה',
  (CURRENT_DATE + 21)::date, '20:00'::time, 'Jerusalem',
  'Development Cinematheque', 9100000
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."allSoons" (
  id, english_title, hebrew_title, release_date, release_year, run_id, cleaned, added
)
VALUES ('00000000-0000-4000-8000-000000009005', 'Dev Coming Soon', 'סרט לדוגמה', (CURRENT_DATE + 90)::date, 2027, 9100000, false, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."allTheques" (
  id, english_title, hebrew_title, date_of_showing, showtime, screening_city, cinema,
  run_id, cleaned, added
)
VALUES (
  '00000000-0000-4000-8000-000000009006',
  'Dev Cinematheque Film', 'סרט סינמטק לדוגמה',
  (CURRENT_DATE + 21)::date, '20:00'::time, 'Jerusalem',
  'Development Cinematheque', 9100000, false, false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public."utilRunLogs" (
  run_id, selected_runners, successful, total_time, running_now, run_from
)
VALUES (
  9100000, '[{"name":"development-fixture"}]'::jsonb, true, 1.0, false, 'development-seed'
)
ON CONFLICT (run_id) DO NOTHING;

INSERT INTO public."utilAvgTime" (name, avg_time_intel_mac, num_runs_intel_mac, type, num_runs_m5_mac, avg_time_m5_mac)
VALUES ('development-fixture', 1.0, 1, 'fixture', 1, 1.0)
ON CONFLICT (name) DO NOTHING;
