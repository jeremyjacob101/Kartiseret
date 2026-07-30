import { createClient } from "@supabase/supabase-js";

import { decodeDateCode, getJerusalemCalendarDate, isCanonicalShowtimeFilterMatch, parseMovieRouteCode, resolveCityCode, SHOWTIME_FILTER_OPTIONS, uncheckedFromFilterMask } from "../../src/routing/showtimeLinkCodec.js";

import { buildShowtimeFilterSelections, getCanonicalShowtimeMeta } from "../../src/components/showtimes/showtimeFilters.js";

import { DEFAULT_LOCATION } from "../../src/prefs/definitions/locations.js";

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

type DatabaseMovie = {
  english_title: string | null;
  en_poster: string | null;
  backdrop: string | null;
  release_year: number | string | null;
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
  runtime: number | null;
  genres: string[];
  imdbRating: number | null;
  rtCriticRating: number | null;
  rtCriticVotes: number | null;
  rtAudienceRating: number | null;
  rtAudienceVotes: number | null;
  lbRating: number | null;
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
      ? parsed.filter((genre): genre is string => typeof genre === "string").slice(0, 3)
      : value.split(",").map((genre) => genre.trim()).filter(Boolean).slice(0, 3);
  } catch {
    return value.split(",").map((genre) => genre.trim()).filter(Boolean).slice(0, 3);
  }
}

function normalizeShowtime(value: string | null): string {
  const normalizedValue = value?.trim() || "";
  return normalizedValue.length >= 5
    ? normalizedValue.slice(0, 5)
    : normalizedValue;
}

function getShowtimeSortValue(showtime: string): number {
  const [hoursText, minutesText] = showtime.split(":");
  const hours = Number.parseInt(hoursText || "", 10);
  const minutes = Number.parseInt(minutesText || "", 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.POSITIVE_INFINITY;
  }

  const totalMinutes = hours * 60 + minutes;

  return totalMinutes < 65 ? totalMinutes + 24 * 60 : totalMinutes;
}

function formatPreviewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

async function getMovieByTmdbId(
  tmdbId: string,
): Promise<{ movie: DatabaseMovie | null; isComingSoon: boolean }> {
  if (!supabase) {
    return { movie: null, isComingSoon: false };
  }

  for (const tableName of ["finalMovies", "finalSoons"]) {
    const movieColumns = tableName === "finalMovies"
      ? "english_title,en_poster,backdrop,release_year,runtime,genres,imdbRating,rtCriticRating,rtCriticVotes,rtAudienceRating,rtAudienceVotes,lbRating"
      : "english_title,en_poster,backdrop,release_year,runtime,genres";
    const { data, error } = await supabase
      .from(tableName)
      .select(movieColumns)
      .eq("tmdb_id", tmdbId)
      .limit(1);

    if (error) {
      throw new Error(
        `Failed to load ${tableName} movie ${tmdbId}: ${error.message}`,
      );
    }

    const movie = data?.[0] as unknown as DatabaseMovie | undefined;
    if (movie) {
      return { movie, isComingSoon: tableName === "finalSoons" };
    }
  }

  return { movie: null, isComingSoon: false };
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
        href: null,
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

export async function getPreviewData(
  routeCode: string,
): Promise<PreviewData | null> {
  const parsedRoute = parseMovieRouteCode(routeCode);

  if (!parsedRoute) {
    return null;
  }

  const today = getJerusalemCalendarDate();
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

  if (!supabase) {
    return null;
  }

  const { data: codeRows, error: codeError } = await supabase
    .from("movieCodes")
    .select("tmdb_id")
    .eq("movie_code", parsedRoute.movieCode)
    .limit(1);

  if (codeError) {
    console.error(`Failed to load movie code: ${codeError.message}`);
    return null;
  }

  const tmdbId = String(codeRows?.[0]?.tmdb_id || "").trim();

  if (!tmdbId) {
    return null;
  }

  const { movie, isComingSoon } = await getMovieByTmdbId(tmdbId);

  if (!movie?.english_title) {
    return null;
  }

  if (isComingSoon) {
    return {
      routeCode,
      movieCode: parsedRoute.movieCode,
      tmdbId,
      title: movie.english_title,
      city,
      date,
      dateLabel: formatPreviewDate(date),
      posterUrl: movie.en_poster?.trim() || "",
      backdropUrl: movie.backdrop?.trim() || "",
      isComingSoon,
      theaters: [],
      year: parseNumber(movie.release_year),
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

  const { data: showtimeRows, error: showtimeError } = await supabase
    .from("finalShowtimes")
    .select("cinema,showtime,screening_tech,screening_type,dub_language")
    .eq("tmdb_id", tmdbId)
    .eq("screening_city", city)
    .eq("date_of_showing", date);

  if (showtimeError) {
    console.error(`Failed to load movie showtimes: ${showtimeError.message}`);
  }

  const filteredRows = filterShowtimeRows(
    (showtimeRows || []) as DatabaseShowtime[],
    filterMask,
  );

  const nonExpiredRows = filterExpiredShowtimes(filteredRows, date);

  return {
    routeCode,
    movieCode: parsedRoute.movieCode,
    tmdbId,
    title: movie.english_title,
    city,
    date,
    dateLabel: formatPreviewDate(date),
    posterUrl: movie.en_poster?.trim() || "",
    backdropUrl: movie.backdrop?.trim() || "",
    isComingSoon,
    theaters: groupPreviewShowtimes(nonExpiredRows),
    year: parseNumber(movie.release_year),
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
): DatabaseShowtime[] {
  const today = getJerusalemCalendarDate();

  if (date !== today) {
    return rows;
  }

  const now = new Date();
  const jerusalemTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);

  const [currentHours, currentMinutes] = jerusalemTime.split(":").map(Number);
  const currentTotalMinutes = currentHours * 60 + currentMinutes;

  return rows.filter((row) => {
    const showtime = normalizeShowtime(row.showtime);
    if (!showtime) return false;

    const [hours, minutes] = showtime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;

    const totalMinutes = hours * 60 + minutes;

    if (totalMinutes < 65) {
      return false;
    }

    if (totalMinutes + 15 <= currentTotalMinutes) {
      return false;
    }

    return true;
  });
}
