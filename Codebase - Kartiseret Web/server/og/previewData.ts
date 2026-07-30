import { createClient } from "@supabase/supabase-js";

import { buildShowtimeFilterSelections, getCanonicalShowtimeMeta } from "../../src/domain/showtimeFilters.js";
import { getCinemaDayDate, getShowtimeSortValue, shouldIncludeShowtime, SHOWTIME_TIME_ZONE } from "../../src/domain/showtimeDay.js";
import { DEFAULT_LOCATION } from "../../src/prefs/definitions/locations.js";
import { decodeDateCode, isCanonicalShowtimeFilterMatch, parseMovieRouteCode, resolveCityCode, SHOWTIME_FILTER_OPTIONS, uncheckedFromFilterMask } from "../../src/routing/showtimeLinkCodec.js";

const supabaseUrl =
  process.env.SUPABASE_URL?.trim() ||
  process.env.VITE_SUPABASE_URL?.trim() ||
  "";

const supabaseKey =
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  "";

const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
type PreviewDataClient = NonNullable<typeof supabase>;

type DatabaseMovie = {
  english_title: string | null;
  en_poster: string | null;
  backdrop: string | null;
  release_year: number | string | null;
  release_date?: string | null;
  runtime: number | string | null;
  genres: string[] | string | null;
  imdbRating: number | string | null;
  rtCriticRating: number | string | null;
  rtCriticVotes: number | string | null;
  rtAudienceRating: number | string | null;
  rtAudienceVotes: number | string | null;
  lbRating: number | string | null;
};

type DatabaseShowtime = {
  cinema: string | null;
  showtime: string | null;
  screening_tech: string | null;
  screening_type: string | null;
  dub_language: string | null;
};

export type PreviewTheater = {
  theater: string;
  showtimes: string[];
};

export type PreviewData = {
  routeCode: string;
  movieCode: string;
  tmdbId: string;
  title: string;
  city: string;
  date: string;
  dateLabel: string;
  posterUrl: string;
  backdropUrl: string;
  isComingSoon: boolean;
  theaters: PreviewTheater[];
  year: number | null;
  releaseDate: string | null;
  runtime: number | null;
  genres: string[];
  imdbRating: number | null;
  rtCriticRating: number | null;
  rtCriticVotes: number | null;
  rtAudienceRating: number | null;
  rtAudienceVotes: number | null;
  lbRating: number | null;
};

export type PreviewRouteSelection = {
  movieCode: string;
  city: string;
  date: string;
  filterMask: number;
};

function parseNumber(value: number | string | null): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseGenres(value: DatabaseMovie["genres"]): string[] {
  if (Array.isArray(value)) return value.filter(Boolean).slice(0, 3);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter((genre): genre is string => typeof genre === "string")
          .slice(0, 3)
      : value
          .split(",")
          .map((genre) => genre.trim())
          .filter(Boolean)
          .slice(0, 3);
  } catch {
    return value
      .split(",")
      .map((genre) => genre.trim())
      .filter(Boolean)
      .slice(0, 3);
  }
}

function normalizeShowtime(value: string | null): string {
  const normalizedValue = value?.trim() || "";
  return normalizedValue.length >= 5
    ? normalizedValue.slice(0, 5)
    : normalizedValue;
}

function formatPreviewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOWTIME_TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

async function getMovieByTmdbId(
  client: PreviewDataClient,
  tmdbId: string,
): Promise<{ movie: DatabaseMovie | null; isComingSoon: boolean }> {
  const [currentMovieResult, comingSoonResult] = await Promise.all([
    client
      .from("finalMovies")
      .select(
        "english_title,en_poster,backdrop,release_year,runtime,genres,imdbRating,rtCriticRating,rtCriticVotes,rtAudienceRating,rtAudienceVotes,lbRating",
      )
      .eq("tmdb_id", tmdbId)
      .limit(1),
    client
      .from("finalSoons")
      .select(
        "english_title,en_poster,backdrop,release_year,release_date,runtime,genres",
      )
      .eq("tmdb_id", tmdbId)
      .limit(1),
  ]);

  if (currentMovieResult.error) {
    throw new Error(
      `Failed to load finalMovies movie ${tmdbId}: ${currentMovieResult.error.message}`,
    );
  }

  const currentMovie = currentMovieResult.data?.[0] as unknown as
    DatabaseMovie | undefined;
  if (currentMovie) {
    return { movie: currentMovie, isComingSoon: false };
  }

  if (comingSoonResult.error) {
    throw new Error(
      `Failed to load finalSoons movie ${tmdbId}: ${comingSoonResult.error.message}`,
    );
  }

  const comingSoonMovie = comingSoonResult.data?.[0] as unknown as
    DatabaseMovie | undefined;
  return {
    movie: comingSoonMovie || null,
    isComingSoon: Boolean(comingSoonMovie),
  };
}

function filterShowtimeRows(
  rows: DatabaseShowtime[],
  filterMask: number,
): DatabaseShowtime[] {
  const unchecked = uncheckedFromFilterMask(filterMask);

  if (!unchecked) {
    return [];
  }

  const selections = buildShowtimeFilterSelections(SHOWTIME_FILTER_OPTIONS, {
    version: 3,
    unchecked: {
      showType: [...unchecked.showType],
      screenFormat: [...unchecked.screenFormat],
      screeningTech: [...unchecked.screeningTech],
      dubLanguage: [...unchecked.dubLanguage],
    },
  });

  return rows.filter((row) =>
    isCanonicalShowtimeFilterMatch(
      getCanonicalShowtimeMeta({
        time: normalizeShowtime(row.showtime),
        screeningTech: row.screening_tech || "",
        screeningType: row.screening_type || "",
        dubLanguage: row.dub_language,
      }),
      selections,
    ));
}

function groupPreviewShowtimes(rows: DatabaseShowtime[]): PreviewTheater[] {
  const showtimesByTheater = new Map<string, Set<string>>();

  for (const row of rows) {
    const theater = row.cinema?.trim();
    const showtime = normalizeShowtime(row.showtime);

    if (!theater || !showtime) {
      continue;
    }

    const existingShowtimes =
      showtimesByTheater.get(theater) || new Set<string>();
    existingShowtimes.add(showtime);
    showtimesByTheater.set(theater, existingShowtimes);
  }

  return [...showtimesByTheater.entries()]
    .map(([theater, showtimes]) => ({
      theater,
      showtimes: [...showtimes]
        .sort(
          (left, right) =>
            getShowtimeSortValue(left) - getShowtimeSortValue(right),
        )
        .slice(0, 4),
    }))
    .sort((left, right) => {
      const leftFirst = left.showtimes[0] || "";
      const rightFirst = right.showtimes[0] || "";

      return (
        getShowtimeSortValue(leftFirst) - getShowtimeSortValue(rightFirst) ||
        left.theater.localeCompare(right.theater)
      );
    })
    .slice(0, 3);
}

export function resolvePreviewRouteSelection(
  routeCode: string,
  instant: Date = new Date(),
): PreviewRouteSelection | null {
  const parsedRoute = parseMovieRouteCode(routeCode);

  if (!parsedRoute) {
    return null;
  }

  const today = getCinemaDayDate(instant);
  let city = DEFAULT_LOCATION;
  let date = today;
  let filterMask = 0;

  if (parsedRoute.kind === "encoded") {
    const decodedCity = resolveCityCode(parsedRoute.cityCode, DEFAULT_LOCATION);

    const decodedDate = decodeDateCode(parsedRoute.dateCode, today);

    if (!decodedCity || !decodedDate) {
      return null;
    }

    city = decodedCity;
    date = decodedDate;
    filterMask = parsedRoute.filterMask;
  }

  return {
    movieCode: parsedRoute.movieCode,
    city,
    date,
    filterMask,
  };
}

export async function getPreviewData(
  routeCode: string,
  instant: Date = new Date(),
  client: PreviewDataClient | null = supabase,
): Promise<PreviewData | null> {
  const selection = resolvePreviewRouteSelection(routeCode, instant);

  if (!selection) {
    return null;
  }

  if (!client) {
    return null;
  }

  const { data: codeRows, error: codeError } = await client
    .from("movieCodes")
    .select("tmdb_id")
    .eq("movie_code", selection.movieCode)
    .limit(1);

  if (codeError) {
    console.error(`Failed to load movie code: ${codeError.message}`);
    return null;
  }

  const tmdbId = String(codeRows?.[0]?.tmdb_id || "").trim();

  if (!tmdbId) {
    return null;
  }

  const [movieResult, showtimeResult] = await Promise.all([
    getMovieByTmdbId(client, tmdbId),
    client
      .from("finalShowtimes")
      .select("cinema,showtime,screening_tech,screening_type,dub_language")
      .eq("tmdb_id", tmdbId)
      .eq("screening_city", selection.city)
      .eq("date_of_showing", selection.date),
  ]);
  const { movie, isComingSoon } = movieResult;

  if (!movie?.english_title) {
    return null;
  }

  if (isComingSoon) {
    return {
      routeCode,
      movieCode: selection.movieCode,
      tmdbId,
      title: movie.english_title,
      city: selection.city,
      date: selection.date,
      dateLabel: formatPreviewDate(selection.date),
      posterUrl: movie.en_poster?.trim() || "",
      backdropUrl: movie.backdrop?.trim() || "",
      isComingSoon,
      theaters: [],
      year: parseNumber(movie.release_year),
      releaseDate: movie.release_date?.trim() || null,
      runtime: parseNumber(movie.runtime),
      genres: parseGenres(movie.genres),
      imdbRating: parseNumber(movie.imdbRating),
      rtCriticRating: parseNumber(movie.rtCriticRating),
      rtCriticVotes: parseNumber(movie.rtCriticVotes),
      rtAudienceRating: parseNumber(movie.rtAudienceRating),
      rtAudienceVotes: parseNumber(movie.rtAudienceVotes),
      lbRating: parseNumber(movie.lbRating),
    };
  }

  if (showtimeResult.error) {
    console.error(
      `Failed to load movie showtimes: ${showtimeResult.error.message}`,
    );
  }

  const filteredRows = filterShowtimeRows(
    (showtimeResult.data || []) as DatabaseShowtime[],
    selection.filterMask,
  );

  const nonExpiredRows = filterExpiredShowtimes(
    filteredRows,
    selection.date,
    instant,
  );

  return {
    routeCode,
    movieCode: selection.movieCode,
    tmdbId,
    title: movie.english_title,
    city: selection.city,
    date: selection.date,
    dateLabel: formatPreviewDate(selection.date),
    posterUrl: movie.en_poster?.trim() || "",
    backdropUrl: movie.backdrop?.trim() || "",
    isComingSoon,
    theaters: groupPreviewShowtimes(nonExpiredRows),
    year: parseNumber(movie.release_year),
    releaseDate: null,
    runtime: parseNumber(movie.runtime),
    genres: parseGenres(movie.genres),
    imdbRating: parseNumber(movie.imdbRating),
    rtCriticRating: parseNumber(movie.rtCriticRating),
    rtCriticVotes: parseNumber(movie.rtCriticVotes),
    rtAudienceRating: parseNumber(movie.rtAudienceRating),
    rtAudienceVotes: parseNumber(movie.rtAudienceVotes),
    lbRating: parseNumber(movie.lbRating),
  };
}

function filterExpiredShowtimes(
  rows: DatabaseShowtime[],
  date: string,
  instant: Date,
): DatabaseShowtime[] {
  return rows.filter((row) =>
    shouldIncludeShowtime(date, normalizeShowtime(row.showtime), instant));
}
