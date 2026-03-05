import { getSupabaseBrowserClient } from "../lib/supabase";
import { ALL_LOCATIONS, DEFAULT_LOCATION, type AppLocation } from "../prefs/locations";

const TOP_NOW_PLAYING_MOVIE_COUNT = 10;
const SUPABASE_PAGE_SIZE = 1000;
const MOVIES_TABLE_NAME = "testNPmovies";
const COMING_SOON_TABLE_NAME = "testSOONmovies";
const SHOWTIMES_TABLE_NAME = "testNPshowtimes";
const MOVIE_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_year",
  "en_poster",
  "en_trailer",
  "backdrop",
  "imdbRating",
  "rtCriticRating",
  "rtAudienceRating",
  "runtime",
  "popularity",
] as const;
const OPTIONAL_MOVIE_SELECT_COLUMNS = [
  "rtCriticVotes",
  "rtAudienceVotes",
  "lb_id",
  "lbRating",
  "lbVotes",
  "tmdbRating",
  "tmdbVotes",
] as const;
const COMING_SOON_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_year",
  "release_date",
  "en_poster",
  "backdrop",
  "en_trailer",
] as const;
const OPTIONAL_COMING_SOON_SELECT_COLUMNS = ["runtime"] as const;
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

export const defaultCity: AppLocation = DEFAULT_LOCATION;
export const fixedAppDateString = "2026-03-02";
export const fixedShowtimeWindowEndDateString = "2026-03-11";

type CsvRow = Record<string, string>;
type SupabaseRow = Record<string, string | number | boolean | null>;

export type Movie = {
  tmdbId: string;
  title: string;
  year: number;
  releaseDate?: string;
  imageSrc: string;
  backdropSrc?: string;
  trailerKey?: string;
  imdbRating: number;
  lbId?: string;
  lbRating: number | null;
  lbVotes: number | null;
  tmdbRating: number | null;
  tmdbVotes: number | null;
  rtCriticRating: number | null;
  rtCriticVotes: number | null;
  rtAudienceRating: number | null;
  rtAudienceVotes: number | null;
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
export let comingSoonMovies: Movie[] = [];

type MovieShowtimesByCity = Record<AppLocation, MovieShowtimeDay[]>;

let movieShowtimesByTmdbId: Record<string, MovieShowtimesByCity> = {};
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

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getFirstNormalizedText(
  row: CsvRow,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const value = row[key];

    if (!value) {
      continue;
    }

    const normalizedValue = normalizeText(value);

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return "";
}

function normalizeTitle(value: string): string {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function getReleaseYearFromDate(releaseDate: string | undefined): number {
  if (!releaseDate) {
    return 0;
  }

  const [year] = releaseDate.split("-");
  return Number.parseInt(year, 10) || 0;
}

function compareByReleaseDate(left: CsvRow, right: CsvRow): number {
  const leftReleaseDate = getFirstNormalizedText(left, ["release_date"]);
  const rightReleaseDate = getFirstNormalizedText(right, ["release_date"]);

  if (leftReleaseDate && rightReleaseDate && leftReleaseDate !== rightReleaseDate) {
    return leftReleaseDate.localeCompare(rightReleaseDate);
  }

  if (leftReleaseDate) {
    return -1;
  }

  if (rightReleaseDate) {
    return 1;
  }

  return normalizeTitle(left.english_title).localeCompare(
    normalizeTitle(right.english_title),
  );
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

type BuildMoviesOptions = {
  limit?: number;
  sortMode?: "popularity" | "releaseDate";
};

function buildMovies(
  rows: CsvRow[],
  { limit, sortMode = "popularity" }: BuildMoviesOptions = {},
): Movie[] {
  const normalizedMovies = [...rows]
    .sort((left, right) => {
      if (sortMode === "releaseDate") {
        return compareByReleaseDate(left, right);
      }

      return parseNumber(right.popularity) - parseNumber(left.popularity);
    })
    .map((row) => {
      const imageSrc = getFirstNormalizedText(row, [
        "en_poster",
        "poster",
        "backdrop",
      ]);
      const backdropSrc =
        getFirstNormalizedText(row, ["backdrop", "en_poster", "poster"]) ||
        imageSrc;
      const trailerKey = getFirstNormalizedText(row, ["en_trailer"]);
      const releaseDate = getFirstNormalizedText(row, ["release_date"]) || undefined;
      const parsedReleaseYear = Number.parseInt(row.release_year, 10) || 0;

      return {
        tmdbId: normalizeText(row.tmdb_id),
        title: normalizeTitle(row.english_title),
        year: parsedReleaseYear || getReleaseYearFromDate(releaseDate),
        releaseDate,
        imageSrc,
        backdropSrc,
        trailerKey: trailerKey || undefined,
        imdbRating: parseNumber(row.imdbRating),
        lbId: getFirstNormalizedText(row, ["lb_id"]) || undefined,
        lbRating: parseOptionalNumber(row.lbRating),
        lbVotes: parseOptionalNumber(row.lbVotes),
        tmdbRating: parseOptionalNumber(row.tmdbRating),
        tmdbVotes: parseOptionalNumber(row.tmdbVotes),
        rtCriticRating: parseOptionalNumber(row.rtCriticRating),
        rtCriticVotes: parseOptionalNumber(row.rtCriticVotes),
        rtAudienceRating: parseOptionalNumber(row.rtAudienceRating),
        rtAudienceVotes: parseOptionalNumber(row.rtAudienceVotes),
        runtime: Number.parseInt(row.runtime, 10) || 0,
        popularity: parseNumber(row.popularity),
      };
    })
    .filter(
      (movie) => Boolean(movie.tmdbId && movie.title && movie.imageSrc),
    );

  return typeof limit === "number"
    ? normalizedMovies.slice(0, limit)
    : normalizedMovies;
}

function buildMovieShowtimes(
  rows: CsvRow[],
  selectedMovies: readonly Movie[],
): Record<string, MovieShowtimesByCity> {
  const showtimeWindowDates = buildDateRange(
    fixedAppDateString,
    fixedShowtimeWindowEndDateString,
  );
  const supportedCities = new Set<string>(ALL_LOCATIONS);
  const selectedMovieIds = new Set(selectedMovies.map((movie) => movie.tmdbId));
  const groupedShowtimes = new Map<
    string,
    Map<AppLocation, Map<string, Map<string, Set<string>>>>
  >();

  for (const row of rows) {
    const tmdbId = normalizeText(row.tmdb_id);

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    const city = normalizeText(row.screening_city);

    if (!supportedCities.has(city)) {
      continue;
    }

    const normalizedCity = city as AppLocation;
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

    let cityDates = movieDates.get(normalizedCity);
    if (!cityDates) {
      cityDates = new Map();
      movieDates.set(normalizedCity, cityDates);
    }

    let theaterMap = cityDates.get(date);
    if (!theaterMap) {
      theaterMap = new Map();
      cityDates.set(date, theaterMap);
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
      const cityShowtimes = Object.fromEntries(
        ALL_LOCATIONS.map((city) => {
          const cityDates = movieDates?.get(city);
          const days = showtimeWindowDates.map((date) => {
            const theaterMap = cityDates?.get(date);

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

          return [city, days];
        }),
      ) as MovieShowtimesByCity;

      return [movie.tmdbId, cityShowtimes];
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

function isMissingOptionalColumnError(
  error: unknown,
  optionalColumns: readonly string[],
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return optionalColumns.some(
    (column) =>
      message.includes(column.toLowerCase()) &&
      (message.includes("column") || message.includes("schema cache")),
  );
}

async function fetchMovieRows(): Promise<SupabaseRow[]> {
  const selectColumns = [...MOVIE_SELECT_COLUMNS, ...OPTIONAL_MOVIE_SELECT_COLUMNS];

  try {
    return await fetchAllTableRows(MOVIES_TABLE_NAME, selectColumns, ["tmdb_id"]);
  } catch (error) {
    if (!isMissingOptionalColumnError(error, OPTIONAL_MOVIE_SELECT_COLUMNS)) {
      throw error;
    }

    return fetchAllTableRows(MOVIES_TABLE_NAME, MOVIE_SELECT_COLUMNS, ["tmdb_id"]);
  }
}

async function fetchComingSoonMovieRows(): Promise<SupabaseRow[]> {
  const selectColumns = [
    ...COMING_SOON_SELECT_COLUMNS,
    ...OPTIONAL_COMING_SOON_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows(COMING_SOON_TABLE_NAME, selectColumns, [
      "tmdb_id",
    ]);
  } catch (error) {
    if (!isMissingOptionalColumnError(error, OPTIONAL_COMING_SOON_SELECT_COLUMNS)) {
      throw error;
    }

    return fetchAllTableRows(COMING_SOON_TABLE_NAME, COMING_SOON_SELECT_COLUMNS, [
      "tmdb_id",
    ]);
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
    const [movieRows, showtimeRows, comingSoonRows] = await Promise.all([
      fetchMovieRows(),
      fetchAllTableRows(SHOWTIMES_TABLE_NAME, SHOWTIME_SELECT_COLUMNS, [
        "tmdb_id",
        "date_of_showing",
        "cinema",
        "showtime",
      ]),
      fetchComingSoonMovieRows(),
    ]);
    const nextMovieRows = rowsToCsvRows(movieRows);
    const nextShowtimeRows = rowsToCsvRows(showtimeRows);
    const nextComingSoonRows = rowsToCsvRows(comingSoonRows);

    const nextMovies = buildMovies(nextMovieRows, {
      limit: TOP_NOW_PLAYING_MOVIE_COUNT,
    });
    const nextComingSoonMovies = buildMovies(nextComingSoonRows, {
      sortMode: "releaseDate",
    });

    if (nextMovies.length === 0) {
      throw new Error(
        `Supabase table ${MOVIES_TABLE_NAME} returned no movie rows.`,
      );
    }

    if (nextComingSoonMovies.length === 0) {
      throw new Error(
        `Supabase table ${COMING_SOON_TABLE_NAME} returned no movie rows.`,
      );
    }

    movies = nextMovies;
    comingSoonMovies = nextComingSoonMovies;
    movieShowtimesByTmdbId = buildMovieShowtimes(nextShowtimeRows, nextMovies);
    isMovieCatalogLoaded = true;
  })()
    .catch((error) => {
      movies = [];
      comingSoonMovies = [];
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
  city: AppLocation = defaultCity,
): readonly MovieShowtimeDay[] {
  return movieShowtimesByTmdbId[tmdbId]?.[city] ?? [];
}
