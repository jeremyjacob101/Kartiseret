import { getSupabaseBrowserClient } from "../lib/supabase";
import {
  ALL_LOCATIONS,
  DEFAULT_LOCATION,
  type AppLocation,
} from "../prefs/definitions/locations";

const SCROLLER_PREVIEW_MOVIE_COUNT = 5;
const SUPABASE_PAGE_SIZE = 1000;
const MOVIES_TABLE_NAME = "testNPmovies";
const NOW_PLAYING_PREVIEW_TABLE_NAME = "testNPmoviesPreview";
const COMING_SOON_TABLE_NAME = "testSOONmovies";
const COMING_SOON_PREVIEW_TABLE_NAME = "testSOONmoviesPreview";
const SHOWTIMES_TABLE_NAME = "testNPshowtimes";
const NOW_PLAYING_PREVIEW_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "en_poster",
  "popularity",
] as const;
const COMING_SOON_PREVIEW_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_date",
  "en_poster",
] as const;
const MOVIE_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_year",
  "genres",
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
  "imdb_id",
  "rt_id",
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
  "genres",
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

type SupabaseValue = string | number | boolean | null | string[];
type SupabaseRow = Partial<Record<string, SupabaseValue>>;

export type Movie = {
  tmdbId: string;
  imdbId?: string;
  rtId?: string;
  title: string;
  year: number;
  releaseDate?: string;
  genres: string[];
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
export let allNowPlayingMovies: Movie[] = [];
export let comingSoonMovies: Movie[] = [];
export let allComingSoonMovies: Movie[] = [];

type MovieShowtimesByCity = Record<AppLocation, MovieShowtimeDay[]>;
type MovieCatalogStatusSnapshot = {
  nowPlayingPreviewReady: boolean;
  nowPlayingDetailsReady: boolean;
  showtimesReady: boolean;
  comingSoonReady: boolean;
  comingSoonDetailsReady: boolean;
  catalogReady: boolean;
};

let movieShowtimesByTmdbId: Record<string, MovieShowtimesByCity> = {};
let isMovieCatalogLoaded = false;
let loadMovieCatalogPromise: Promise<void> | null = null;
const movieCatalogListeners = new Set<() => void>();
let movieCatalogStatusSnapshot: MovieCatalogStatusSnapshot = {
  nowPlayingPreviewReady: movies.length > 0,
  nowPlayingDetailsReady: allNowPlayingMovies.length > 0,
  showtimesReady: isMovieCatalogLoaded,
  comingSoonReady: comingSoonMovies.length > 0,
  comingSoonDetailsReady: allComingSoonMovies.length > 0,
  catalogReady: isMovieCatalogLoaded,
};

function updateMovieCatalogStatus(
  nextStatus: Partial<MovieCatalogStatusSnapshot>,
): void {
  const candidateStatus = {
    ...movieCatalogStatusSnapshot,
    ...nextStatus,
  };

  if (
    candidateStatus.nowPlayingPreviewReady ===
      movieCatalogStatusSnapshot.nowPlayingPreviewReady &&
    candidateStatus.nowPlayingDetailsReady ===
      movieCatalogStatusSnapshot.nowPlayingDetailsReady &&
    candidateStatus.showtimesReady === movieCatalogStatusSnapshot.showtimesReady &&
    candidateStatus.comingSoonReady ===
      movieCatalogStatusSnapshot.comingSoonReady &&
    candidateStatus.comingSoonDetailsReady ===
      movieCatalogStatusSnapshot.comingSoonDetailsReady &&
    candidateStatus.catalogReady === movieCatalogStatusSnapshot.catalogReady
  ) {
    return;
  }

  movieCatalogStatusSnapshot = candidateStatus;
  movieCatalogListeners.forEach((listener) => {
    listener();
  });
}

export function subscribeToMovieCatalog(
  onStoreChange: () => void,
): () => void {
  movieCatalogListeners.add(onStoreChange);

  return () => {
    movieCatalogListeners.delete(onStoreChange);
  };
}

export function getMovieCatalogStatusSnapshot(): MovieCatalogStatusSnapshot {
  return movieCatalogStatusSnapshot;
}

function stringifySupabaseValue(value: SupabaseValue | undefined): string {
  if (value == null) {
    return "";
  }

  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

function parseNumberValue(
  value: SupabaseValue | undefined,
  fallback = 0,
): number {
  const parsed = Number.parseFloat(stringifySupabaseValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumberValue(value: SupabaseValue | undefined): number | null {
  const normalizedValue = stringifySupabaseValue(value).trim();

  if (!normalizedValue) {
    return null;
  }

  const parsed = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function getFirstNormalizedText(
  row: SupabaseRow,
  keys: readonly string[],
): string {
  for (const key of keys) {
    const normalizedValue = normalizeText(stringifySupabaseValue(row[key]));

    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return "";
}

function normalizeTitle(value: string): string {
  return normalizeText(value).replace(/^"+|"+$/g, "");
}

function parseGenres(value: SupabaseValue | undefined): string[] {
  const normalizedGenres = new Set<string>();
  const addGenre = (genre: string) => {
    const normalizedGenre = normalizeText(genre.replace(/^"+|"+$/g, ""));

    if (normalizedGenre) {
      normalizedGenres.add(normalizedGenre);
    }
  };

  if (Array.isArray(value)) {
    value.forEach(addGenre);
    return [...normalizedGenres];
  }

  const normalizedValue = stringifySupabaseValue(value).trim();

  if (!normalizedValue) {
    return [];
  }

  if (
    (normalizedValue.startsWith("[") && normalizedValue.endsWith("]")) ||
    (normalizedValue.startsWith("{") && normalizedValue.endsWith("}"))
  ) {
    const jsonCandidate = normalizedValue.startsWith("{")
      ? `[${normalizedValue.slice(1, -1)}]`
      : normalizedValue;

    try {
      const parsedValue = JSON.parse(jsonCandidate);

      if (Array.isArray(parsedValue)) {
        for (const item of parsedValue) {
          if (typeof item === "string") {
            addGenre(item);
          }
        }

        return [...normalizedGenres];
      }
    } catch {
      // Fall back to comma-splitting below for non-JSON array strings.
    }
  }

  normalizedValue.split(",").forEach(addGenre);

  return [...normalizedGenres];
}

function getReleaseYearFromDate(releaseDate: string | undefined): number {
  if (!releaseDate) {
    return 0;
  }

  const [year] = releaseDate.split("-");
  return Number.parseInt(year, 10) || 0;
}

function compareByReleaseDate(left: SupabaseRow, right: SupabaseRow): number {
  const leftReleaseDate = getFirstNormalizedText(left, ["release_date"]);
  const rightReleaseDate = getFirstNormalizedText(right, ["release_date"]);

  if (
    leftReleaseDate &&
    rightReleaseDate &&
    leftReleaseDate !== rightReleaseDate
  ) {
    return leftReleaseDate.localeCompare(rightReleaseDate);
  }

  if (leftReleaseDate) {
    return -1;
  }

  if (rightReleaseDate) {
    return 1;
  }

  return normalizeTitle(
    stringifySupabaseValue(left.english_title),
  ).localeCompare(
    normalizeTitle(stringifySupabaseValue(right.english_title)),
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

function buildDateRange(
  startDateString: string,
  endDateString: string,
): string[] {
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
  rows: SupabaseRow[],
  { limit, sortMode = "popularity" }: BuildMoviesOptions = {},
): Movie[] {
  const normalizedMovies = [...rows]
    .sort((left, right) => {
      if (sortMode === "releaseDate") {
        return compareByReleaseDate(left, right);
      }

      return (
        parseNumberValue(right.popularity) - parseNumberValue(left.popularity)
      );
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
      const releaseDate =
        getFirstNormalizedText(row, ["release_date"]) || undefined;
      const parsedReleaseYear =
        Number.parseInt(stringifySupabaseValue(row.release_year), 10) || 0;

      return {
        tmdbId: normalizeText(stringifySupabaseValue(row.tmdb_id)),
        imdbId: getFirstNormalizedText(row, ["imdb_id"]) || undefined,
        rtId: getFirstNormalizedText(row, ["rt_id"]) || undefined,
        title: normalizeTitle(stringifySupabaseValue(row.english_title)),
        year: parsedReleaseYear || getReleaseYearFromDate(releaseDate),
        releaseDate,
        genres: parseGenres(row.genres),
        imageSrc,
        backdropSrc,
        trailerKey: trailerKey || undefined,
        imdbRating: parseNumberValue(row.imdbRating),
        lbId: getFirstNormalizedText(row, ["lb_id"]) || undefined,
        lbRating: parseOptionalNumberValue(row.lbRating),
        lbVotes: parseOptionalNumberValue(row.lbVotes),
        tmdbRating: parseOptionalNumberValue(row.tmdbRating),
        tmdbVotes: parseOptionalNumberValue(row.tmdbVotes),
        rtCriticRating: parseOptionalNumberValue(row.rtCriticRating),
        rtCriticVotes: parseOptionalNumberValue(row.rtCriticVotes),
        rtAudienceRating: parseOptionalNumberValue(row.rtAudienceRating),
        rtAudienceVotes: parseOptionalNumberValue(row.rtAudienceVotes),
        runtime: Number.parseInt(stringifySupabaseValue(row.runtime), 10) || 0,
        popularity: parseNumberValue(row.popularity),
      };
    })
    .filter((movie) => Boolean(movie.tmdbId && movie.title && movie.imageSrc));

  return typeof limit === "number"
    ? normalizedMovies.slice(0, limit)
    : normalizedMovies;
}

function buildNowPlayingPreviewMovies(rows: SupabaseRow[]): Movie[] {
  // Keep the preview data in 1,2,3,4,last order so the scroller's wraparound
  // naturally renders it as last,1,2,3,4 without changing the intro behavior.
  return buildMovies(rows, {
    limit: SCROLLER_PREVIEW_MOVIE_COUNT,
  });
}

function buildComingSoonPreviewMovies(rows: SupabaseRow[]): Movie[] {
  // Keep the preview data in earliest,2nd,3rd,4th,latest-preview order so the
  // scroller's wraparound naturally renders it as latest-preview, earliest...
  return buildMovies(rows, {
    limit: SCROLLER_PREVIEW_MOVIE_COUNT,
    sortMode: "releaseDate",
  });
}

function buildHomePreviewScrollerMovies(
  previewMovies: readonly Movie[],
  detailedMovies: readonly Movie[],
): Movie[] {
  if (previewMovies.length === 0) {
    return [...detailedMovies];
  }

  const detailedMoviesByTmdbId = new Map(
    detailedMovies.map((movie) => [movie.tmdbId, movie] as const),
  );
  const trailingPreviewMovie = previewMovies.at(-1) ?? null;
  const leadingPreviewMovies = trailingPreviewMovie
    ? previewMovies.slice(0, -1)
    : [...previewMovies];
  const mergedLeadingPreviewMovies = leadingPreviewMovies.map(
    (movie) => detailedMoviesByTmdbId.get(movie.tmdbId) ?? movie,
  );
  const previewMovieIds = new Set(previewMovies.map((movie) => movie.tmdbId));
  const restOfDetailedMovies = detailedMovies.filter(
    (movie) => !previewMovieIds.has(movie.tmdbId),
  );
  const mergedTrailingPreviewMovie = trailingPreviewMovie
    ? (detailedMoviesByTmdbId.get(trailingPreviewMovie.tmdbId) ??
        trailingPreviewMovie)
    : null;

  return mergedTrailingPreviewMovie
    ? [
        ...mergedLeadingPreviewMovies,
        ...restOfDetailedMovies,
        mergedTrailingPreviewMovie,
      ]
    : [...mergedLeadingPreviewMovies, ...restOfDetailedMovies];
}

function buildMovieShowtimes(
  rows: SupabaseRow[],
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
    const tmdbId = normalizeText(stringifySupabaseValue(row.tmdb_id));

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    const city = normalizeText(stringifySupabaseValue(row.screening_city));

    if (!supportedCities.has(city)) {
      continue;
    }

    const normalizedCity = city as AppLocation;
    supportedCities.add(normalizedCity);
    const date = normalizeText(stringifySupabaseValue(row.date_of_showing));

    if (date < fixedAppDateString || date > fixedShowtimeWindowEndDateString) {
      continue;
    }

    const theater = normalizeText(stringifySupabaseValue(row.cinema));
    const showtime = formatShowtime(stringifySupabaseValue(row.showtime));

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

  const canonicalCities = new Set<string>(ALL_LOCATIONS);
  const orderedCities = [
    ...ALL_LOCATIONS,
    ...[...supportedCities]
      .filter((city) => !canonicalCities.has(city))
      .sort((left, right) => left.localeCompare(right)),
  ];

  return Object.fromEntries(
    selectedMovies.map((movie) => {
      const movieDates = groupedShowtimes.get(movie.tmdbId);
      const cityShowtimes = Object.fromEntries(
        orderedCities.map((city) => {
          const cityDates = movieDates?.get(city);
          const days = showtimeWindowDates.map((date) => {
            const theaterMap = cityDates?.get(date);

            return {
              date,
              theaters: theaterMap
                ? [...theaterMap.entries()]
                    .sort(([leftTheater], [rightTheater]) =>
                      compareTheaters(leftTheater, rightTheater))
                    .map(([theater, showtimeSet]) => ({
                      theater,
                      showtimes: [...showtimeSet].sort((leftTime, rightTime) =>
                        leftTime.localeCompare(rightTime)),
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

    const batchRows = (data ?? []) as unknown as SupabaseRow[];
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
  const selectColumns = [
    ...MOVIE_SELECT_COLUMNS,
    ...OPTIONAL_MOVIE_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows(MOVIES_TABLE_NAME, selectColumns, [
      "tmdb_id",
    ]);
  } catch (error) {
    if (!isMissingOptionalColumnError(error, OPTIONAL_MOVIE_SELECT_COLUMNS)) {
      throw error;
    }

    return fetchAllTableRows(MOVIES_TABLE_NAME, MOVIE_SELECT_COLUMNS, [
      "tmdb_id",
    ]);
  }
}

async function fetchMoviePreviewRows(): Promise<SupabaseRow[]> {
  return fetchAllTableRows(
    NOW_PLAYING_PREVIEW_TABLE_NAME,
    NOW_PLAYING_PREVIEW_SELECT_COLUMNS,
    ["tmdb_id"],
  );
}

async function fetchComingSoonPreviewRows(): Promise<SupabaseRow[]> {
  return fetchAllTableRows(
    COMING_SOON_PREVIEW_TABLE_NAME,
    COMING_SOON_PREVIEW_SELECT_COLUMNS,
    ["release_date", "tmdb_id"],
  );
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
    if (
      !isMissingOptionalColumnError(error, OPTIONAL_COMING_SOON_SELECT_COLUMNS)
    ) {
      throw error;
    }

    return fetchAllTableRows(
      COMING_SOON_TABLE_NAME,
      COMING_SOON_SELECT_COLUMNS,
      ["tmdb_id"],
    );
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
    const previewRowsPromise = fetchMoviePreviewRows().catch((error) => {
      console.warn(
        `Failed to load ${NOW_PLAYING_PREVIEW_TABLE_NAME} from Supabase.`,
        error,
      );
      return [];
    });
    const comingSoonPreviewRowsPromise = fetchComingSoonPreviewRows().catch((
      error,
    ) => {
      console.warn(
        `Failed to load ${COMING_SOON_PREVIEW_TABLE_NAME} from Supabase.`,
        error,
      );
      return [];
    });

    const previewRows = await previewRowsPromise;
    const previewMovies = buildNowPlayingPreviewMovies(previewRows);

    if (previewMovies.length > 0) {
      movies = previewMovies;
      updateMovieCatalogStatus({
        nowPlayingPreviewReady: true,
      });
    }

    const comingSoonPreviewRows = await comingSoonPreviewRowsPromise;
    const previewComingSoonMovies =
      buildComingSoonPreviewMovies(comingSoonPreviewRows);

    if (previewComingSoonMovies.length > 0) {
      comingSoonMovies = previewComingSoonMovies;
      updateMovieCatalogStatus({
        nowPlayingPreviewReady: movies.length > 0,
        comingSoonReady: true,
      });
    }

    const [movieRows, showtimeRows] = await Promise.all([
      fetchMovieRows(),
      fetchAllTableRows(SHOWTIMES_TABLE_NAME, SHOWTIME_SELECT_COLUMNS, [
        "tmdb_id",
        "date_of_showing",
        "cinema",
        "showtime",
      ]),
    ]);

    const nextAllNowPlayingMovies = buildMovies(movieRows);
    const nextMovies =
      previewMovies.length > 0
        ? buildHomePreviewScrollerMovies(previewMovies, nextAllNowPlayingMovies)
        : nextAllNowPlayingMovies;

    if (nextMovies.length === 0) {
      throw new Error(
        `Supabase table ${MOVIES_TABLE_NAME} returned no movie rows.`,
      );
    }

    movies = nextMovies;
    allNowPlayingMovies = nextAllNowPlayingMovies;
    movieShowtimesByTmdbId = buildMovieShowtimes(
      showtimeRows,
      nextAllNowPlayingMovies,
    );
    updateMovieCatalogStatus({
      nowPlayingPreviewReady: nextMovies.length > 0,
      nowPlayingDetailsReady: nextAllNowPlayingMovies.length > 0,
      showtimesReady: true,
      comingSoonReady: comingSoonMovies.length > 0,
      comingSoonDetailsReady: allComingSoonMovies.length > 0,
      catalogReady: false,
    });

    const comingSoonRows = await fetchComingSoonMovieRows();
    const nextAllComingSoonMovies = buildMovies(comingSoonRows, {
      sortMode: "releaseDate",
    });
    const nextComingSoonMovies =
      previewComingSoonMovies.length > 0
        ? buildHomePreviewScrollerMovies(
            previewComingSoonMovies,
            nextAllComingSoonMovies,
          )
        : nextAllComingSoonMovies;

    if (nextComingSoonMovies.length === 0) {
      throw new Error(
        `Supabase table ${COMING_SOON_TABLE_NAME} returned no movie rows.`,
      );
    }

    comingSoonMovies = nextComingSoonMovies;
    allComingSoonMovies = nextAllComingSoonMovies;
    isMovieCatalogLoaded = true;
    updateMovieCatalogStatus({
      nowPlayingPreviewReady: movies.length > 0,
      nowPlayingDetailsReady: allNowPlayingMovies.length > 0,
      showtimesReady: true,
      comingSoonReady: nextComingSoonMovies.length > 0,
      comingSoonDetailsReady: nextAllComingSoonMovies.length > 0,
      catalogReady: true,
    });
  })()
    .catch((error) => {
      allNowPlayingMovies = [];
      allComingSoonMovies = [];
      movieShowtimesByTmdbId = {};
      isMovieCatalogLoaded = false;
      updateMovieCatalogStatus({
        nowPlayingPreviewReady: movies.length > 0,
        nowPlayingDetailsReady: false,
        showtimesReady: false,
        comingSoonReady: comingSoonMovies.length > 0,
        comingSoonDetailsReady: false,
        catalogReady: false,
      });
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
