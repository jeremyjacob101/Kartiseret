import { getSupabaseBrowserClient } from "../lib/supabase";

const TOP_MOVIE_COUNT = 10;
const SUPABASE_PAGE_SIZE = 1000;
const MOVIES_TABLE_NAME = "testNPmovies";
const SHOWTIMES_TABLE_NAME = "testNPshowtimes";
const MOVIE_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_year",
  "poster",
  "backdrop",
  "imdbRating",
  "rtCriticRating",
  "rtAudienceRating",
  "runtime",
  "popularity",
] as const;
const SHOWTIME_SELECT_COLUMNS = [
  "tmdb_id",
  "screening_city",
  "date_of_showing",
  "cinema",
  "showtime",
] as const;
const THEATER_SORT_ORDER = [
  "Movieland",
  "Yes Planet",
  "Cinema City",
  "Lev Cinema",
  "Rav Hen",
] as const;
const THEATER_SORT_INDEX = new Map(
  THEATER_SORT_ORDER.map((theater, index) => [theater, index] as const),
);

export const defaultCity = "Haifa";
export const fixedAppDateString = "2026-03-02";
export const fixedShowtimeWindowEndDateString = "2026-03-11";

type CsvRow = Record<string, string>;
type SupabaseRow = Record<string, string | number | boolean | null>;

export type Movie = {
  tmdbId: string;
  title: string;
  year: number;
  imageSrc: string;
  backdropSrc?: string;
  imdbRating: number;
  rtRating: number;
  runtime: number;
  popularity: number;
};

export type TheaterShowtimes = {
  theater: string;
  showtimes: string[];
};

export type MovieShowtimeDay = {
  date: string;
  theaters: TheaterShowtimes[];
};

export let movies: Movie[] = [];

let movieShowtimesByTmdbId: Record<string, MovieShowtimeDay[]> = {};
let isMovieCatalogLoaded = false;
let loadMovieCatalogPromise: Promise<void> | null = null;

function rowsToCsvRows(rows: readonly SupabaseRow[]): CsvRow[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value == null ? "" : String(value),
      ]),
    ),
  );
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTitle(value: string): string {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function formatShowtime(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 5 ? trimmed.slice(0, 5) : trimmed;
}

function parseIsoDate(dateString: string): Date {
  const [year, month, day] = dateString
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  return new Date(year, (month || 1) - 1, day || 1);
}

function formatIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function buildDateRange(startDateString: string, endDateString: string): string[] {
  const dates: string[] = [];
  const currentDate = parseIsoDate(startDateString);
  const endDate = parseIsoDate(endDateString);

  while (currentDate <= endDate) {
    dates.push(formatIsoDate(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

function compareTheaters(left: string, right: string): number {
  const safeLeftOrder =
    THEATER_SORT_INDEX.get(left as (typeof THEATER_SORT_ORDER)[number]) ??
    Number.POSITIVE_INFINITY;
  const safeRightOrder =
    THEATER_SORT_INDEX.get(right as (typeof THEATER_SORT_ORDER)[number]) ??
    Number.POSITIVE_INFINITY;

  if (safeLeftOrder !== safeRightOrder) {
    return safeLeftOrder - safeRightOrder;
  }

  return left.localeCompare(right);
}

function buildMovies(rows: CsvRow[]): Movie[] {
  return [...rows]
    .sort(
      (left, right) => parseNumber(right.popularity) - parseNumber(left.popularity),
    )
    .slice(0, TOP_MOVIE_COUNT)
    .map((row) => ({
      tmdbId: normalizeText(row.tmdb_id),
      title: normalizeTitle(row.english_title),
      year: Number.parseInt(row.release_year, 10) || 0,
      imageSrc: normalizeText(row.poster),
      backdropSrc: normalizeText(row.backdrop) || normalizeText(row.poster),
      imdbRating: parseNumber(row.imdbRating),
      rtRating: Math.round(
        parseNumber(row.rtCriticRating || row.rtAudienceRating),
      ),
      runtime: Number.parseInt(row.runtime, 10) || 0,
      popularity: parseNumber(row.popularity),
    }));
}

function buildMovieShowtimes(
  rows: CsvRow[],
  selectedMovies: readonly Movie[],
): Record<string, MovieShowtimeDay[]> {
  const showtimeWindowDates = buildDateRange(
    fixedAppDateString,
    fixedShowtimeWindowEndDateString,
  );
  const selectedMovieIds = new Set(selectedMovies.map((movie) => movie.tmdbId));
  const groupedShowtimes = new Map<string, Map<string, Map<string, Set<string>>>>();

  for (const row of rows) {
    const tmdbId = normalizeText(row.tmdb_id);

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    if (normalizeText(row.screening_city) !== defaultCity) {
      continue;
    }

    const date = normalizeText(row.date_of_showing);

    if (date < fixedAppDateString || date > fixedShowtimeWindowEndDateString) {
      continue;
    }

    const theater = normalizeText(row.cinema);
    const showtime = formatShowtime(row.showtime);

    if (!date || !theater || !showtime) {
      continue;
    }

    let movieDates = groupedShowtimes.get(tmdbId);
    if (!movieDates) {
      movieDates = new Map();
      groupedShowtimes.set(tmdbId, movieDates);
    }

    let theaterMap = movieDates.get(date);
    if (!theaterMap) {
      theaterMap = new Map();
      movieDates.set(date, theaterMap);
    }

    let showtimeSet = theaterMap.get(theater);
    if (!showtimeSet) {
      showtimeSet = new Set();
      theaterMap.set(theater, showtimeSet);
    }

    showtimeSet.add(showtime);
  }

  return Object.fromEntries(
    selectedMovies.map((movie) => {
      const movieDates = groupedShowtimes.get(movie.tmdbId);

      if (!movieDates) {
        return [
          movie.tmdbId,
          showtimeWindowDates.map((date) => ({
            date,
            theaters: [],
          })),
        ];
      }

      const days = showtimeWindowDates.map((date) => {
        const theaterMap = movieDates.get(date);

        return {
          date,
          theaters: theaterMap
            ? [...theaterMap.entries()]
                .sort(([leftTheater], [rightTheater]) =>
                  compareTheaters(leftTheater, rightTheater),
                )
                .map(([theater, showtimeSet]) => ({
                  theater,
                  showtimes: [...showtimeSet].sort((leftTime, rightTime) =>
                    leftTime.localeCompare(rightTime),
                  ),
                }))
            : [],
        };
      });

      return [movie.tmdbId, days];
    }),
  );
}

async function fetchAllTableRows(
  tableName: string,
  selectColumns: readonly string[],
  orderColumns: readonly string[],
): Promise<SupabaseRow[]> {
  const supabase = getSupabaseBrowserClient();
  const allRows: SupabaseRow[] = [];
  let fromIndex = 0;

  while (true) {
    let query = supabase
      .from(tableName)
      .select(selectColumns.join(","))
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1);

    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(
        `Failed to load ${tableName} from Supabase: ${error.message}`,
      );
    }

    const batchRows = ((data ?? []) as unknown) as SupabaseRow[];
    allRows.push(...batchRows);

    if (batchRows.length < SUPABASE_PAGE_SIZE) {
      return allRows;
    }

    fromIndex += SUPABASE_PAGE_SIZE;
  }
}

export async function loadMovieCatalog(): Promise<void> {
  if (isMovieCatalogLoaded) {
    return;
  }

  if (loadMovieCatalogPromise) {
    return loadMovieCatalogPromise;
  }

  loadMovieCatalogPromise = (async () => {
    const [movieRows, showtimeRows] = await Promise.all([
      fetchAllTableRows(MOVIES_TABLE_NAME, MOVIE_SELECT_COLUMNS, ["tmdb_id"]),
      fetchAllTableRows(SHOWTIMES_TABLE_NAME, SHOWTIME_SELECT_COLUMNS, [
        "tmdb_id",
        "date_of_showing",
        "cinema",
        "showtime",
      ]),
    ]);
    const nextMovieRows = rowsToCsvRows(movieRows);
    const nextShowtimeRows = rowsToCsvRows(showtimeRows);

    const nextMovies = buildMovies(nextMovieRows);

    if (nextMovies.length === 0) {
      throw new Error(
        `Supabase table ${MOVIES_TABLE_NAME} returned no movie rows.`,
      );
    }

    movies = nextMovies;
    movieShowtimesByTmdbId = buildMovieShowtimes(nextShowtimeRows, nextMovies);
    isMovieCatalogLoaded = true;
  })()
    .catch((error) => {
      movies = [];
      movieShowtimesByTmdbId = {};
      isMovieCatalogLoaded = false;
      throw error instanceof Error ? error : new Error(String(error));
    })
    .finally(() => {
      loadMovieCatalogPromise = null;
    });

  return loadMovieCatalogPromise;
}

export function getMovieShowtimeDays(
  tmdbId: string,
): readonly MovieShowtimeDay[] {
  return movieShowtimesByTmdbId[tmdbId] ?? [];
}
