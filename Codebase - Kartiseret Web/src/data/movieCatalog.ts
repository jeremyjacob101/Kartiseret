import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { getCinemaDayDate, getShowtimeSortValue, shouldIncludeShowtime as shouldIncludeShowtimeAtInstant, SHOWTIME_TIME_ZONE } from "../domain/showtimeDay.js";
import { queryClient } from "../lib/queryClient.js";
import { getSupabaseBrowserClient } from "../lib/supabase.js";
import { ALL_LOCATIONS, DEFAULT_LOCATION, type AppLocation } from "../prefs/definitions/locations.js";
import { addCalendarDays, getJerusalemCinemaDate, getTargetedShowtimePrefetchRange, SHOWTIME_LINK_DATE_COUNT } from "../routing/showtimeLinkCodec.js";

const SUPABASE_PAGE_SIZE = 1000;
export const APP_TIME_ZONE = SHOWTIME_TIME_ZONE;
export const INITIAL_SHOWTIME_WINDOW_DAY_COUNT = 1;
export const SHOWTIME_WINDOW_DAY_COUNT = 180;
export const SHOWTIME_PREFETCH_CHUNK_DAY_COUNT = 15;
export const SHOWTIME_PREFETCH_TRIGGER_DAY_COUNT = 10;

const MOVIES_TABLE_NAME = "finalMovies";
const COMING_SOON_TABLE_NAME = "finalSoons";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
const MOVIE_CODES_TABLE_NAME = "movieCodes";
const MOVIE_CODE_QUERY_CHUNK_SIZE = 200;
const MOVIE_CODE_PATTERN = /^[0-9A-Za-z]{3}$/;
const MOVIE_SELECT_COLUMNS = [
  "tmdb_id",
  "english_title",
  "release_year",
  "solo_update",
  "genres",
  "en_poster",
  "alt_options",
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
  "solo_update",
  "release_date",
  "genres",
  "en_poster",
  "alt_options",
  "backdrop",
  "en_trailer",
] as const;
const OPTIONAL_COMING_SOON_SELECT_COLUMNS = ["runtime", "popularity"] as const;
const SHOWTIME_SELECT_COLUMNS = [
  "tmdb_id",
  "screening_city",
  "date_of_showing",
  "cinema",
  "showtime",
  "english_href",
] as const;
const OPTIONAL_SHOWTIME_SELECT_COLUMNS = [
  "screening_tech",
  "screening_type",
  "dub_language",
] as const;
const THEATER_SORT_ORDER = [
  "MovieLand",
  "Yes Planet",
  "Cinema City",
  "Lev Cinema",
  "Rav Hen",
] as const;
const THEATER_SORT_INDEX = new Map(
  THEATER_SORT_ORDER.map((theater, index) => [theater, index] as const),
);

export const defaultCity: AppLocation = DEFAULT_LOCATION;
const fixedAppInstant = new Date();
export const fixedAppDateString = getCinemaDayDate(
  fixedAppInstant,
  APP_TIME_ZONE,
);

type SupabaseValue = unknown;
type SupabaseRow = Record<string, SupabaseValue | undefined>;

// Production tables always populate these columns, so downstream consumers do
// not need to model them as nullable. Some fields like tmdb_id may still arrive
// as numbers from Supabase, so we normalize them through stringify helpers.
type MovieRow = SupabaseRow & {
  tmdb_id: string | number;
  english_title: string;
  release_date?: string | null;
};

type ComingSoonMovieRow = MovieRow & {
  release_date: string;
};

type MovieCodeRow = SupabaseRow & {
  tmdb_id: string | number;
  movie_code: string;
};

export type ShowtimeRow = SupabaseRow & {
  tmdb_id: string | number;
  screening_city: string;
  date_of_showing: string;
  cinema: string;
  showtime: string;
  screening_tech: string;
  screening_type: string;
};

export type Movie = {
  tmdbId: string;
  movieCode?: string;
  imdbId?: string;
  rtId?: string;
  title: string;
  year: number;
  releaseDate?: string;
  genres: string[];
  imageSrc: string;
  backdropSrc?: string;
  trailerKey?: string;
  imdbRating: number | null;
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
  altOptions: MovieAltOption[];
};

export type MovieAltOption = {
  tmdbId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

export type CatalogMode = "nowPlaying" | "comingSoon";

export type MovieRouteMatch = {
  movie: Movie;
  mode: CatalogMode;
};

export type TheaterShowtimes = {
  theater: string;
  showtimes: ShowtimeEntry[];
};

export type MovieShowtimeDay = {
  date: string;
  theaters: TheaterShowtimes[];
};

export type ShowtimeEntry = {
  time: string;
  href: string | null;
  screeningTech: string;
  screeningType: string;
  dubLanguage: string | null;
};

const EMPTY_SHOWTIME_CITIES: readonly AppLocation[] = Object.freeze([]);

export type MovieCollectionData = {
  mode: CatalogMode;
  movies: Movie[];
  moviesByCode: Record<string, Movie>;
};

export type ShowtimeRange = {
  city: AppLocation;
  startDate: string;
  endDate: string;
  tmdbId?: string;
};

export type ShowtimeCityData = {
  city: AppLocation;
  broadFetchedDates: string[];
  broadLoadedDayCount: number;
  broadReady: boolean;
  broadVisibleDayCount: number;
  movieShowtimesByTmdbId: Record<string, MovieShowtimeDay[]>;
  rowsByKey: Record<string, ShowtimeRow>;
  targetedFetchedDatesByTmdbId: Record<string, string[]>;
  targetedLoadedDayCountByTmdbId: Record<string, number>;
  visibleDayCount: number;
};

export type ShowtimeCacheMerge = {
  city: AppLocation;
  dates: readonly string[];
  movies: readonly Movie[];
  rows: readonly ShowtimeRow[];
  scope: "broad" | { tmdbId: string };
  targetedLoadedDayCount?: number;
  visibleDayCount: number;
};

const MOVIE_COLLECTION_STALE_TIME = 5 * 60 * 1000;
const MOVIE_COLLECTION_GC_TIME = 60 * 60 * 1000;
const SHOWTIME_RANGE_STALE_TIME = 60 * 1000;
const SHOWTIME_RANGE_GC_TIME = 30 * 60 * 1000;
const SHOWTIME_CITY_STALE_TIME = 5 * 60 * 1000;

export const movieCatalogQueryKeys = {
  all: ["movieCatalog"] as const,
  collections: () => ["movieCatalog", "collections"] as const,
  collection: (mode: CatalogMode) =>
    ["movieCatalog", "collections", mode] as const,
  showtimes: () => ["movieCatalog", "showtimes"] as const,
  showtimeCities: () => ["movieCatalog", "showtimes", "cities"] as const,
  showtimeCity: (city: AppLocation) =>
    ["movieCatalog", "showtimes", "cities", city] as const,
  showtimeRanges: () => ["movieCatalog", "showtimes", "ranges"] as const,
  showtimeRange: ({ city, startDate, endDate, tmdbId }: ShowtimeRange) =>
    [
      "movieCatalog",
      "showtimes",
      "ranges",
      { city, startDate, endDate, tmdbId: tmdbId?.trim() || null },
    ] as const,
  adminEdits: () => ["movieCatalog", "adminEdits"] as const,
};

function stringifySupabaseValue(value: SupabaseValue | undefined): string {
  if (value == null) {
    return "";
  }

  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? JSON.stringify(value)
      : String(value);
}

function parseNumberValue(
  value: SupabaseValue | undefined,
  fallback = 0,
): number {
  const parsed = Number.parseFloat(stringifySupabaseValue(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalNumberValue(
  value: SupabaseValue | undefined,
): number | null {
  const normalizedValue = stringifySupabaseValue(value).trim();

  if (!normalizedValue) {
    return null;
  }

  const parsed = Number.parseFloat(normalizedValue);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBooleanValue(
  value: SupabaseValue | undefined,
  fallback = false,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = normalizeText(stringifySupabaseValue(value)).toLowerCase();

  if (!normalized) {
    return fallback;
  }

  if (normalized === "true" || normalized === "t" || normalized === "1") {
    return true;
  }

  if (normalized === "false" || normalized === "f" || normalized === "0") {
    return false;
  }

  return fallback;
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
      // Fall through to comma-splitting for non-JSON array strings.
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

function parseAltOptions(value: SupabaseValue | undefined): MovieAltOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const options: MovieAltOption[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const row = entry as Record<string, unknown>;
    const tmdbId = normalizeText(String(row.tmdb ?? "")).trim();
    const title = normalizeTitle(String(row.title ?? "")).trim();
    const yearNumber = Number.parseInt(String(row.year ?? ""), 10);
    const posterUrl = normalizeText(String(row.poster_url ?? "")).trim();

    if (!tmdbId || !title) {
      continue;
    }

    options.push({
      tmdbId,
      title,
      year: Number.isFinite(yearNumber) ? yearNumber : null,
      posterUrl: posterUrl || null,
    });
  }

  return options.slice(0, 10);
}

function compareByReleaseDate(
  left: ComingSoonMovieRow,
  right: ComingSoonMovieRow,
): number {
  return (
    left.release_date.localeCompare(right.release_date) ||
    parseNumberValue(right.popularity) - parseNumberValue(left.popularity) ||
    normalizeTitle(left.english_title).localeCompare(
      normalizeTitle(right.english_title),
    )
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

function compareShowtimeEntries(
  leftShowtime: ShowtimeEntry,
  rightShowtime: ShowtimeEntry,
): number {
  return (
    getShowtimeSortValue(leftShowtime.time) -
      getShowtimeSortValue(rightShowtime.time) ||
    leftShowtime.time.localeCompare(rightShowtime.time) ||
    leftShowtime.screeningTech.localeCompare(rightShowtime.screeningTech) ||
    leftShowtime.screeningType.localeCompare(rightShowtime.screeningType) ||
    (leftShowtime.dubLanguage ?? "").localeCompare(
      rightShowtime.dubLanguage ?? "",
    )
  );
}

function shouldIncludeShowtime(dateString: string, showtime: string): boolean {
  return shouldIncludeShowtimeAtInstant(
    dateString,
    showtime,
    fixedAppInstant,
    APP_TIME_ZONE,
  );
}

function addDaysToIsoDate(dateString: string, daysToAdd: number): string {
  const date = parseIsoDate(dateString);
  date.setDate(date.getDate() + daysToAdd);
  return formatIsoDate(date);
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
  movieCodesByTmdbId?: ReadonlyMap<string, string>;
  sortMode?: "popularity" | "releaseDate";
};

function buildMovies(
  rows: MovieRow[],
  {
    movieCodesByTmdbId = new Map<string, string>(),
    sortMode = "popularity",
  }: BuildMoviesOptions = {},
): Movie[] {
  return [...rows]
    .filter((row) => !parseBooleanValue(row.solo_update))
    .sort((left, right) => {
      if (sortMode === "releaseDate") {
        return compareByReleaseDate(
          left as ComingSoonMovieRow,
          right as ComingSoonMovieRow,
        );
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
        normalizeText(stringifySupabaseValue(row.release_date)) || undefined;
      const parsedReleaseYear =
        Number.parseInt(stringifySupabaseValue(row.release_year), 10) || 0;
      const tmdbId = normalizeText(stringifySupabaseValue(row.tmdb_id));

      return {
        tmdbId,
        movieCode: movieCodesByTmdbId.get(tmdbId),
        imdbId: getFirstNormalizedText(row, ["imdb_id"]) || undefined,
        rtId: getFirstNormalizedText(row, ["rt_id"]) || undefined,
        title: normalizeTitle(stringifySupabaseValue(row.english_title)),
        year: parsedReleaseYear || getReleaseYearFromDate(releaseDate),
        releaseDate,
        genres: parseGenres(row.genres),
        imageSrc,
        backdropSrc,
        trailerKey: trailerKey || undefined,
        imdbRating: parseOptionalNumberValue(row.imdbRating),
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
        altOptions: parseAltOptions(row.alt_options),
      };
    });
}

function buildMovieShowtimesForCity(
  rows: ShowtimeRow[],
  selectedMovies: readonly Movie[],
  selectedCity: AppLocation,
  windowEndDateString: string,
): Record<string, MovieShowtimeDay[]> {
  const showtimeWindowDates = buildDateRange(
    fixedAppDateString,
    windowEndDateString,
  );
  const selectedMovieIds = new Set(selectedMovies.map((movie) => movie.tmdbId));
  const groupedShowtimes = new Map<
    string,
    Map<string, Map<string, Map<string, ShowtimeEntry>>>
  >();

  for (const row of rows) {
    const tmdbId = normalizeText(stringifySupabaseValue(row.tmdb_id));

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    const city = normalizeText(row.screening_city);

    if (city !== selectedCity) {
      continue;
    }

    const date = normalizeText(row.date_of_showing);

    if (date < fixedAppDateString || date > windowEndDateString) {
      continue;
    }

    const theater = normalizeText(row.cinema);
    const showtime = formatShowtime(row.showtime);
    const showtimeHref =
      normalizeText(stringifySupabaseValue(row.english_href)) || null;
    const screeningTech = normalizeText(row.screening_tech);
    const screeningType = normalizeText(row.screening_type);
    const dubLanguage = getFirstNormalizedText(row, ["dub_language"]) || null;

    if (!shouldIncludeShowtime(date, showtime)) {
      continue;
    }

    let cityDates = groupedShowtimes.get(tmdbId);
    if (!cityDates) {
      cityDates = new Map();
      groupedShowtimes.set(tmdbId, cityDates);
    }

    let theaterMap = cityDates.get(date);
    if (!theaterMap) {
      theaterMap = new Map();
      cityDates.set(date, theaterMap);
    }

    let theaterShowtimes = theaterMap.get(theater);
    if (!theaterShowtimes) {
      theaterShowtimes = new Map();
      theaterMap.set(theater, theaterShowtimes);
    }

    const showtimeKey = [
      showtime,
      screeningTech.toLowerCase(),
      screeningType.toLowerCase(),
      dubLanguage?.toLowerCase() ?? "",
    ].join("::");
    const existingEntry = theaterShowtimes.get(showtimeKey);

    theaterShowtimes.set(showtimeKey, {
      time: showtime,
      href: existingEntry?.href ?? showtimeHref,
      screeningTech: existingEntry?.screeningTech ?? screeningTech,
      screeningType: existingEntry?.screeningType ?? screeningType,
      dubLanguage: existingEntry?.dubLanguage ?? dubLanguage,
    });
  }

  return Object.fromEntries(
    selectedMovies.map((movie) => {
      const cityDates = groupedShowtimes.get(movie.tmdbId);
      const days = showtimeWindowDates.map((date) => {
        const theaterMap = cityDates?.get(date);

        return {
          date,
          theaters: theaterMap
            ? [...theaterMap.entries()]
                .sort(([leftTheater], [rightTheater]) =>
                  compareTheaters(leftTheater, rightTheater))
                .map(([theater, theaterShowtimes]) => ({
                  theater,
                  showtimes: [...theaterShowtimes.values()].sort(
                    compareShowtimeEntries,
                  ),
                }))
            : [],
        };
      });

      return [movie.tmdbId, days];
    }),
  );
}

async function fetchAllTableRows<Row extends SupabaseRow>(
  tableName: string,
  selectColumns: readonly string[],
  orderColumns: readonly string[],
  signal?: AbortSignal,
): Promise<Row[]> {
  const supabase = getSupabaseBrowserClient();
  const allRows: Row[] = [];
  let fromIndex = 0;

  while (true) {
    let query = supabase
      .from(tableName)
      .select(selectColumns.join(","))
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1);

    for (const column of orderColumns) {
      query = query.order(column, { ascending: true });
    }

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(
        `Failed to load ${tableName} from Supabase: ${error.message}`,
      );
    }

    const batchRows = (data ?? []) as unknown as Row[];
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

function getShowtimeWindowEndDateString(dayCount: number): string {
  return addDaysToIsoDate(fixedAppDateString, dayCount - 1);
}

function getShowtimeWindowDayCountForDate(dateString: string): number {
  if (dateString <= fixedAppDateString) {
    return INITIAL_SHOWTIME_WINDOW_DAY_COUNT;
  }

  const windowEndDateString = getShowtimeWindowEndDateString(
    SHOWTIME_WINDOW_DAY_COUNT,
  );

  if (dateString >= windowEndDateString) {
    return SHOWTIME_WINDOW_DAY_COUNT;
  }

  return buildDateRange(fixedAppDateString, dateString).length;
}

function clampShowtimeWindowDayCount(dayCount: number): number {
  const normalizedDayCount = Math.floor(dayCount);

  if (!Number.isFinite(normalizedDayCount)) {
    return INITIAL_SHOWTIME_WINDOW_DAY_COUNT;
  }

  return Math.max(
    INITIAL_SHOWTIME_WINDOW_DAY_COUNT,
    Math.min(SHOWTIME_WINDOW_DAY_COUNT, normalizedDayCount),
  );
}

export function getNextShowtimePrefetchDayCount(
  loadedDayCount: number,
  previewDayIndex: number,
): number | null {
  const normalizedLoadedDayCount = clampShowtimeWindowDayCount(loadedDayCount);
  const normalizedPreviewDayIndex = Math.floor(previewDayIndex);

  if (
    normalizedLoadedDayCount < SHOWTIME_PREFETCH_CHUNK_DAY_COUNT ||
    normalizedLoadedDayCount >= SHOWTIME_WINDOW_DAY_COUNT ||
    !Number.isFinite(normalizedPreviewDayIndex) ||
    normalizedPreviewDayIndex < 0
  ) {
    return null;
  }

  const currentChunkStartIndex =
    normalizedLoadedDayCount - SHOWTIME_PREFETCH_CHUNK_DAY_COUNT;
  const prefetchTriggerIndex =
    currentChunkStartIndex + SHOWTIME_PREFETCH_TRIGGER_DAY_COUNT - 1;

  if (normalizedPreviewDayIndex < prefetchTriggerIndex) {
    return null;
  }

  return Math.min(
    normalizedLoadedDayCount + SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
    SHOWTIME_WINDOW_DAY_COUNT,
  );
}

function getCachedShowtimeRowKey(row: ShowtimeRow): string {
  return [
    normalizeText(stringifySupabaseValue(row.tmdb_id)),
    normalizeText(row.screening_city),
    normalizeText(row.date_of_showing),
    normalizeText(row.cinema),
    normalizeText(row.showtime),
    normalizeText(row.screening_tech),
    normalizeText(row.screening_type),
    getFirstNormalizedText(row, ["dub_language"]) || "original",
    normalizeText(stringifySupabaseValue(row.english_href)) || "none",
  ].join("::");
}

async function fetchMovieRows(signal?: AbortSignal): Promise<MovieRow[]> {
  const selectColumns = [
    ...MOVIE_SELECT_COLUMNS,
    ...OPTIONAL_MOVIE_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows<MovieRow>(
      MOVIES_TABLE_NAME,
      selectColumns,
      ["tmdb_id"],
      signal,
    );
  } catch (error) {
    if (!isMissingOptionalColumnError(error, OPTIONAL_MOVIE_SELECT_COLUMNS)) {
      throw error;
    }

    return fetchAllTableRows<MovieRow>(
      MOVIES_TABLE_NAME,
      MOVIE_SELECT_COLUMNS,
      ["tmdb_id"],
      signal,
    );
  }
}

async function fetchComingSoonMovieRows(
  signal?: AbortSignal,
): Promise<ComingSoonMovieRow[]> {
  const selectColumns = [
    ...COMING_SOON_SELECT_COLUMNS,
    ...OPTIONAL_COMING_SOON_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows<ComingSoonMovieRow>(
      COMING_SOON_TABLE_NAME,
      selectColumns,
      ["tmdb_id"],
      signal,
    );
  } catch (error) {
    if (
      !isMissingOptionalColumnError(error, OPTIONAL_COMING_SOON_SELECT_COLUMNS)
    ) {
      throw error;
    }

    return fetchAllTableRows<ComingSoonMovieRow>(
      COMING_SOON_TABLE_NAME,
      COMING_SOON_SELECT_COLUMNS,
      ["tmdb_id"],
      signal,
    );
  }
}

async function fetchMovieCodesByTmdbId(
  movieRows: readonly MovieRow[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const tmdbIds = [
    ...new Set(
      movieRows
        .map((row) => normalizeText(stringifySupabaseValue(row.tmdb_id)))
        .filter(Boolean),
    ),
  ];

  if (tmdbIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseBrowserClient();
  const chunks = Array.from(
    { length: Math.ceil(tmdbIds.length / MOVIE_CODE_QUERY_CHUNK_SIZE) },
    (_, index) =>
      tmdbIds.slice(
        index * MOVIE_CODE_QUERY_CHUNK_SIZE,
        (index + 1) * MOVIE_CODE_QUERY_CHUNK_SIZE,
      ),
  );
  const chunkRows = await Promise.all(
    chunks.map(async (tmdbIdChunk) => {
      let query = supabase
        .from(MOVIE_CODES_TABLE_NAME)
        .select("tmdb_id,movie_code")
        .in("tmdb_id", tmdbIdChunk);

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(
          `Failed to load ${MOVIE_CODES_TABLE_NAME} from Supabase: ${error.message}`,
        );
      }

      return (data ?? []) as unknown as MovieCodeRow[];
    }),
  );
  const movieCodesByTmdbId = new Map<string, string>();

  for (const row of chunkRows.flat()) {
    const tmdbId = normalizeText(stringifySupabaseValue(row.tmdb_id));
    const movieCode = normalizeText(row.movie_code);

    if (tmdbId && MOVIE_CODE_PATTERN.test(movieCode)) {
      movieCodesByTmdbId.set(tmdbId, movieCode);
    }
  }

  return movieCodesByTmdbId;
}

function indexMoviesByCode(
  movieItems: readonly Movie[],
): Record<string, Movie> {
  return Object.fromEntries(
    movieItems.flatMap((movie) =>
      movie.movieCode ? [[movie.movieCode, movie] as const] : []),
  );
}

async function fetchMovieCollection(
  mode: CatalogMode,
  signal?: AbortSignal,
): Promise<MovieCollectionData> {
  const movieRows =
    mode === "nowPlaying"
      ? await fetchMovieRows(signal)
      : await fetchComingSoonMovieRows(signal);
  const movieCodesByTmdbId = await fetchMovieCodesByTmdbId(movieRows, signal);
  const movies = buildMovies(movieRows, {
    movieCodesByTmdbId,
    sortMode: mode === "comingSoon" ? "releaseDate" : "popularity",
  });

  if (movies.length === 0) {
    const tableName =
      mode === "nowPlaying" ? MOVIES_TABLE_NAME : COMING_SOON_TABLE_NAME;

    throw new Error(`Supabase table ${tableName} returned no movie rows.`);
  }

  return {
    mode,
    movies,
    moviesByCode: indexMoviesByCode(movies),
  };
}

export function movieCollectionQueryOptions(mode: CatalogMode) {
  return queryOptions({
    queryKey: movieCatalogQueryKeys.collection(mode),
    queryFn: ({ signal }) => fetchMovieCollection(mode, signal),
    staleTime: MOVIE_COLLECTION_STALE_TIME,
    gcTime: MOVIE_COLLECTION_GC_TIME,
  });
}

export function selectMovies(data: MovieCollectionData): Movie[] {
  return data.movies;
}

export function isValidMovieCode(movieCode: string): boolean {
  return MOVIE_CODE_PATTERN.test(movieCode);
}

export function findMovieByCode(movieCode: string): MovieRouteMatch | null {
  if (!isValidMovieCode(movieCode)) {
    return null;
  }

  const nowPlayingMovie = queryClient.getQueryData<MovieCollectionData>(
    movieCatalogQueryKeys.collection("nowPlaying"),
  )?.moviesByCode[movieCode];

  if (nowPlayingMovie) {
    return { movie: nowPlayingMovie, mode: "nowPlaying" };
  }

  const comingSoonMovie = queryClient.getQueryData<MovieCollectionData>(
    movieCatalogQueryKeys.collection("comingSoon"),
  )?.moviesByCode[movieCode];

  return comingSoonMovie
    ? { movie: comingSoonMovie, mode: "comingSoon" }
    : null;
}

async function fetchShowtimeRowsForDateRange(
  city: AppLocation,
  startDateString: string,
  endDateString: string,
  tmdbId?: string,
  signal?: AbortSignal,
): Promise<ShowtimeRow[]> {
  if (startDateString > endDateString) {
    return [];
  }

  const selectColumns = [
    ...SHOWTIME_SELECT_COLUMNS,
    ...OPTIONAL_SHOWTIME_SELECT_COLUMNS,
  ];

  const fetchRange = async (
    requestedColumns: readonly string[],
  ): Promise<ShowtimeRow[]> => {
    const supabase = getSupabaseBrowserClient();
    const allRows: ShowtimeRow[] = [];
    let fromIndex = 0;

    while (true) {
      let query = supabase
        .from(SHOWTIMES_TABLE_NAME)
        .select(requestedColumns.join(","))
        .eq("screening_city", city)
        .gte("date_of_showing", startDateString)
        .lte("date_of_showing", endDateString)
        .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1);

      if (tmdbId) {
        query = query.eq("tmdb_id", tmdbId);
      }

      query = query
        .order("tmdb_id", { ascending: true })
        .order("date_of_showing", { ascending: true })
        .order("cinema", { ascending: true })
        .order("showtime", { ascending: true });

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(
          `Failed to load ${SHOWTIMES_TABLE_NAME} from Supabase: ${error.message}`,
        );
      }

      const batchRows = (data ?? []) as unknown as ShowtimeRow[];
      allRows.push(...batchRows);

      if (batchRows.length < SUPABASE_PAGE_SIZE) {
        return allRows;
      }

      fromIndex += SUPABASE_PAGE_SIZE;
    }
  };

  try {
    return await fetchRange(selectColumns);
  } catch (error) {
    if (
      !isMissingOptionalColumnError(error, OPTIONAL_SHOWTIME_SELECT_COLUMNS)
    ) {
      throw error;
    }

    return fetchRange(SHOWTIME_SELECT_COLUMNS);
  }
}

export function showtimeRangeQueryOptions(range: ShowtimeRange) {
  const normalizedRange = {
    ...range,
    tmdbId: range.tmdbId?.trim() || undefined,
  };

  return queryOptions({
    queryKey: movieCatalogQueryKeys.showtimeRange(normalizedRange),
    queryFn: ({ signal }) =>
      fetchShowtimeRowsForDateRange(
        normalizedRange.city,
        normalizedRange.startDate,
        normalizedRange.endDate,
        normalizedRange.tmdbId,
        signal,
      ),
    staleTime: SHOWTIME_RANGE_STALE_TIME,
    gcTime: SHOWTIME_RANGE_GC_TIME,
  });
}

export function createEmptyShowtimeCityData(
  city: AppLocation,
): ShowtimeCityData {
  return {
    city,
    broadFetchedDates: [],
    broadLoadedDayCount: 0,
    broadReady: false,
    broadVisibleDayCount: 0,
    movieShowtimesByTmdbId: {},
    rowsByKey: {},
    targetedFetchedDatesByTmdbId: {},
    targetedLoadedDayCountByTmdbId: {},
    visibleDayCount: 0,
  };
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function getContiguousBroadDayCount(fetchedDates: readonly string[]): number {
  const fetchedDateSet = new Set(fetchedDates);
  let dayCount = 0;

  while (dayCount < SHOWTIME_WINDOW_DAY_COUNT) {
    const date = addDaysToIsoDate(fixedAppDateString, dayCount);

    if (!fetchedDateSet.has(date)) {
      break;
    }

    dayCount += 1;
  }

  return dayCount;
}

export function mergeShowtimeCityData(
  current: ShowtimeCityData | undefined,
  merge: ShowtimeCacheMerge,
): ShowtimeCityData {
  const previous = current ?? createEmptyShowtimeCityData(merge.city);
  const requestedDates = new Set(merge.dates);
  const rowsByKey = Object.fromEntries(
    Object.entries(previous.rowsByKey).filter(([, row]) => {
      const rowDate = normalizeText(row.date_of_showing);

      if (!requestedDates.has(rowDate)) {
        return true;
      }

      if (merge.scope === "broad") {
        return false;
      }

      return (
        normalizeText(stringifySupabaseValue(row.tmdb_id)) !==
        merge.scope.tmdbId
      );
    }),
  );

  for (const row of merge.rows) {
    rowsByKey[getCachedShowtimeRowKey(row)] = row;
  }

  const broadFetchedDates =
    merge.scope === "broad"
      ? sortedUnique([...previous.broadFetchedDates, ...merge.dates])
      : previous.broadFetchedDates;
  const targetedFetchedDatesByTmdbId = {
    ...previous.targetedFetchedDatesByTmdbId,
  };
  const targetedLoadedDayCountByTmdbId = {
    ...previous.targetedLoadedDayCountByTmdbId,
  };

  if (merge.scope !== "broad") {
    const tmdbId = merge.scope.tmdbId;
    targetedFetchedDatesByTmdbId[tmdbId] = sortedUnique([
      ...(targetedFetchedDatesByTmdbId[tmdbId] ?? []),
      ...merge.dates,
    ]);

    if (merge.targetedLoadedDayCount !== undefined) {
      targetedLoadedDayCountByTmdbId[tmdbId] = Math.max(
        targetedLoadedDayCountByTmdbId[tmdbId] ?? 0,
        clampShowtimeWindowDayCount(merge.targetedLoadedDayCount),
      );
    }
  }

  const broadLoadedDayCount = getContiguousBroadDayCount(broadFetchedDates);
  const broadVisibleDayCount =
    merge.scope === "broad"
      ? clampShowtimeWindowDayCount(
          Math.max(
            previous.broadVisibleDayCount,
            broadLoadedDayCount,
            merge.visibleDayCount,
          ),
        )
      : previous.broadVisibleDayCount;
  const visibleDayCount = clampShowtimeWindowDayCount(
    Math.max(
      previous.visibleDayCount,
      broadLoadedDayCount,
      merge.visibleDayCount,
    ),
  );
  const projectedShowtimes = buildMovieShowtimesForCity(
    Object.values(rowsByKey),
    merge.movies,
    merge.city,
    getShowtimeWindowEndDateString(visibleDayCount),
  );

  return {
    city: merge.city,
    broadFetchedDates,
    broadLoadedDayCount,
    broadReady: previous.broadReady || merge.scope === "broad",
    broadVisibleDayCount,
    movieShowtimesByTmdbId: {
      ...previous.movieShowtimesByTmdbId,
      ...projectedShowtimes,
    },
    rowsByKey,
    targetedFetchedDatesByTmdbId,
    targetedLoadedDayCountByTmdbId,
    visibleDayCount,
  };
}

function getCachedMovieCollections(): MovieCollectionData[] {
  return (["nowPlaying", "comingSoon"] as const).flatMap((mode) => {
    const collection = queryClient.getQueryData<MovieCollectionData>(
      movieCatalogQueryKeys.collection(mode),
    );

    return collection ? [collection] : [];
  });
}

function getCachedMovieByTmdbId(tmdbId: string): Movie | null {
  for (const collection of getCachedMovieCollections()) {
    const movie = collection.movies.find(
      (candidate) => candidate.tmdbId === tmdbId,
    );

    if (movie) {
      return movie;
    }
  }

  return null;
}

async function ensureMovieByTmdbId(tmdbId: string): Promise<Movie | null> {
  const cachedMovie = getCachedMovieByTmdbId(tmdbId);

  if (cachedMovie) {
    return cachedMovie;
  }

  const nowPlaying = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("nowPlaying"),
  );
  const nowPlayingMovie = nowPlaying.movies.find(
    (candidate) => candidate.tmdbId === tmdbId,
  );

  if (nowPlayingMovie) {
    return nowPlayingMovie;
  }

  const comingSoon = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("comingSoon"),
  );

  return (
    comingSoon.movies.find((candidate) => candidate.tmdbId === tmdbId) ?? null
  );
}

function mergeShowtimeCache(merge: ShowtimeCacheMerge): ShowtimeCityData {
  let nextData: ShowtimeCityData | undefined;

  queryClient.setQueryData(movieCatalogQueryKeys.showtimeCity(merge.city), (
    current: ShowtimeCityData | undefined,
  ) => {
    nextData = mergeShowtimeCityData(current, merge);
    return nextData;
  });

  return nextData ?? createEmptyShowtimeCityData(merge.city);
}

async function fetchAndMergeShowtimeRange(
  range: ShowtimeRange,
  merge: Omit<ShowtimeCacheMerge, "city" | "dates" | "rows">,
): Promise<ShowtimeCityData> {
  const rows = await queryClient.fetchQuery(showtimeRangeQueryOptions(range));

  return mergeShowtimeCache({
    ...merge,
    city: range.city,
    dates: buildDateRange(range.startDate, range.endDate),
    rows,
  });
}

export function showtimeCityQueryOptions(city: AppLocation) {
  return queryOptions({
    queryKey: movieCatalogQueryKeys.showtimeCity(city),
    queryFn: async () => {
      const collection = await queryClient.ensureQueryData(
        movieCollectionQueryOptions("nowPlaying"),
      );
      const range = {
        city,
        startDate: fixedAppDateString,
        endDate: fixedAppDateString,
      } satisfies ShowtimeRange;
      const rows = await queryClient.fetchQuery(
        showtimeRangeQueryOptions(range),
      );
      const current = queryClient.getQueryData<ShowtimeCityData>(
        movieCatalogQueryKeys.showtimeCity(city),
      );

      return mergeShowtimeCityData(current, {
        city,
        dates: [fixedAppDateString],
        movies: collection.movies,
        rows,
        scope: "broad",
        visibleDayCount: INITIAL_SHOWTIME_WINDOW_DAY_COUNT,
      });
    },
    staleTime: (query) =>
      query.state.data?.broadReady ? SHOWTIME_CITY_STALE_TIME : 0,
    gcTime: MOVIE_COLLECTION_GC_TIME,
  });
}

export function selectMovieShowtimeDays(
  data: ShowtimeCityData | undefined,
  tmdbId: string,
): readonly MovieShowtimeDay[] {
  return data?.movieShowtimesByTmdbId[tmdbId] ?? [];
}

export function selectBroadMovieShowtimeDays(
  data: ShowtimeCityData | undefined,
  tmdbId: string,
): readonly MovieShowtimeDay[] {
  return selectMovieShowtimeDays(data, tmdbId).slice(
    0,
    data?.broadVisibleDayCount ?? 0,
  );
}

export function selectCityHasAnyShowtimesOnDate(
  data: ShowtimeCityData | undefined,
  date: string,
): boolean {
  if (
    !data?.broadReady ||
    data.broadVisibleDayCount === 0 ||
    date > getShowtimeWindowEndDateString(data.broadVisibleDayCount)
  ) {
    return false;
  }

  return Boolean(
    Object.values(data.movieShowtimesByTmdbId).some((days) =>
      days.some((day) => day.date === date && day.theaters.length > 0)),
  );
}

export function isMovieShowtimeDateCovered(
  cityData: ShowtimeCityData | undefined,
  tmdbId: string,
  dateString: string,
): boolean {
  if (!cityData) {
    return false;
  }

  if (cityData.broadFetchedDates.includes(dateString)) {
    return true;
  }

  if (cityData.targetedFetchedDatesByTmdbId[tmdbId]?.includes(dateString)) {
    return true;
  }

  const coveredDayCount = Math.max(
    cityData.broadLoadedDayCount,
    cityData.targetedLoadedDayCountByTmdbId[tmdbId] ?? 0,
  );

  return (
    coveredDayCount > 0 &&
    dateString >= fixedAppDateString &&
    dateString <= getShowtimeWindowEndDateString(coveredDayCount)
  );
}

export function isMovieShowtimeDateLoaded(
  city: AppLocation,
  tmdbId: string,
  dateString: string,
): boolean {
  const cityData = queryClient.getQueryData<ShowtimeCityData>(
    movieCatalogQueryKeys.showtimeCity(city),
  );

  return isMovieShowtimeDateCovered(cityData, tmdbId, dateString);
}

export function mergeMovieShowtimeRangeResult(
  range: ShowtimeRange & { tmdbId: string },
  rows: readonly ShowtimeRow[],
): ShowtimeCityData | null {
  const movie = getCachedMovieByTmdbId(range.tmdbId);

  if (!movie) {
    return null;
  }

  const linkWindowEndDate = addCalendarDays(
    getJerusalemCinemaDate(),
    SHOWTIME_LINK_DATE_COUNT - 1,
  );
  const visibleDayCount = linkWindowEndDate
    ? getShowtimeWindowDayCountForDate(linkWindowEndDate)
    : SHOWTIME_LINK_DATE_COUNT;

  return mergeShowtimeCache({
    city: range.city,
    dates: buildDateRange(range.startDate, range.endDate),
    movies: [movie],
    rows,
    scope: { tmdbId: range.tmdbId },
    visibleDayCount,
  });
}

function getMissingMovieShowtimeDateRanges(
  cityData: ShowtimeCityData,
  tmdbId: string,
  startDateString: string,
  endDateString: string,
): Array<{ startDate: string; endDate: string }> {
  const missingRanges: Array<{ startDate: string; endDate: string }> = [];
  let currentRange: { startDate: string; endDate: string } | null = null;

  for (const dateString of buildDateRange(startDateString, endDateString)) {
    if (isMovieShowtimeDateCovered(cityData, tmdbId, dateString)) {
      if (currentRange) {
        missingRanges.push(currentRange);
        currentRange = null;
      }

      continue;
    }

    if (currentRange) {
      currentRange.endDate = dateString;
    } else {
      currentRange = { startDate: dateString, endDate: dateString };
    }
  }

  if (currentRange) {
    missingRanges.push(currentRange);
  }

  return missingRanges;
}

async function loadTargetedMovieShowtimeDateRange(
  city: AppLocation,
  tmdbId: string,
  startDateString: string,
  endDateString: string,
): Promise<void> {
  const movie = await ensureMovieByTmdbId(tmdbId);

  if (!movie) {
    return;
  }

  const current =
    queryClient.getQueryData<ShowtimeCityData>(
      movieCatalogQueryKeys.showtimeCity(city),
    ) ?? createEmptyShowtimeCityData(city);
  const missingRanges = getMissingMovieShowtimeDateRanges(
    current,
    tmdbId,
    startDateString,
    endDateString,
  );
  const linkWindowEndDate = addCalendarDays(
    getJerusalemCinemaDate(),
    SHOWTIME_LINK_DATE_COUNT - 1,
  );
  const visibleDayCount = linkWindowEndDate
    ? getShowtimeWindowDayCountForDate(linkWindowEndDate)
    : SHOWTIME_LINK_DATE_COUNT;

  await Promise.all(
    missingRanges.map((range) =>
      fetchAndMergeShowtimeRange(
        {
          city,
          startDate: range.startDate,
          endDate: range.endDate,
          tmdbId,
        },
        {
          movies: [movie],
          scope: { tmdbId },
          visibleDayCount,
        },
      )),
  );
}

async function ensureMovieShowtimeWindowLoaded(
  city: AppLocation,
  tmdbId: string,
  dayCount: number,
): Promise<void> {
  const targetDayCount = clampShowtimeWindowDayCount(dayCount);
  const current =
    queryClient.getQueryData<ShowtimeCityData>(
      movieCatalogQueryKeys.showtimeCity(city),
    ) ?? createEmptyShowtimeCityData(city);
  const coveredDayCount = Math.max(
    current.broadLoadedDayCount,
    current.targetedLoadedDayCountByTmdbId[tmdbId] ?? 0,
  );

  if (coveredDayCount >= targetDayCount) {
    return;
  }

  const movie = await ensureMovieByTmdbId(tmdbId);

  if (!movie) {
    return;
  }

  const startDate =
    coveredDayCount > 0
      ? addDaysToIsoDate(fixedAppDateString, coveredDayCount)
      : fixedAppDateString;
  const endDate = getShowtimeWindowEndDateString(targetDayCount);

  await fetchAndMergeShowtimeRange(
    { city, startDate, endDate, tmdbId },
    {
      movies: [movie],
      scope: { tmdbId },
      targetedLoadedDayCount: targetDayCount,
      visibleDayCount: targetDayCount,
    },
  );
}

async function ensureShowtimeWindowLoaded(
  city: AppLocation,
  dayCount: number,
): Promise<void> {
  const targetDayCount = clampShowtimeWindowDayCount(dayCount);
  const current = queryClient.getQueryData<ShowtimeCityData>(
    movieCatalogQueryKeys.showtimeCity(city),
  );

  if (!current && targetDayCount === INITIAL_SHOWTIME_WINDOW_DAY_COUNT) {
    await queryClient.fetchQuery(showtimeCityQueryOptions(city));
    return;
  }

  if ((current?.broadLoadedDayCount ?? 0) >= targetDayCount) {
    return;
  }

  const collection = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("nowPlaying"),
  );
  const loadedDayCount = current?.broadLoadedDayCount ?? 0;
  const startDate =
    loadedDayCount > 0
      ? addDaysToIsoDate(fixedAppDateString, loadedDayCount)
      : fixedAppDateString;
  const endDate = getShowtimeWindowEndDateString(targetDayCount);

  await fetchAndMergeShowtimeRange(
    { city, startDate, endDate },
    {
      movies: collection.movies,
      scope: "broad",
      visibleDayCount: targetDayCount,
    },
  );
}

async function loadFocusedShowtimeDate(
  city: AppLocation,
  dateString: string,
): Promise<void> {
  const focusedDayCount = getShowtimeWindowDayCountForDate(dateString);
  const focusedDate = getShowtimeWindowEndDateString(focusedDayCount);
  const collection = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("nowPlaying"),
  );
  const current = queryClient.getQueryData<ShowtimeCityData>(
    movieCatalogQueryKeys.showtimeCity(city),
  );

  if (current?.broadFetchedDates.includes(focusedDate)) {
    mergeShowtimeCache({
      city,
      dates: [],
      movies: collection.movies,
      rows: [],
      scope: "broad",
      visibleDayCount: focusedDayCount,
    });
    return;
  }

  await fetchAndMergeShowtimeRange(
    { city, startDate: focusedDate, endDate: focusedDate },
    {
      movies: collection.movies,
      scope: "broad",
      visibleDayCount: focusedDayCount,
    },
  );
}

export async function loadNowPlayingMovies(): Promise<Movie[]> {
  const data = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("nowPlaying"),
  );
  return data.movies;
}

export async function loadComingSoonMovies(): Promise<Movie[]> {
  const data = await queryClient.ensureQueryData(
    movieCollectionQueryOptions("comingSoon"),
  );
  return data.movies;
}

export async function loadShowtimes(
  city: AppLocation = defaultCity,
  tmdbId?: string,
): Promise<void> {
  return tmdbId
    ? ensureMovieShowtimeWindowLoaded(
        city,
        tmdbId,
        INITIAL_SHOWTIME_WINDOW_DAY_COUNT,
      )
    : ensureShowtimeWindowLoaded(city, INITIAL_SHOWTIME_WINDOW_DAY_COUNT);
}

export async function loadMovieShowtimesForDate(
  city: AppLocation,
  tmdbId: string,
  dateString: string,
): Promise<void> {
  return loadTargetedMovieShowtimeDateRange(
    city,
    tmdbId,
    dateString,
    dateString,
  );
}

export async function prefetchMovieShowtimesAfterDate(
  city: AppLocation,
  tmdbId: string,
  previewDateString: string,
): Promise<void> {
  const cityData =
    queryClient.getQueryData<ShowtimeCityData>(
      movieCatalogQueryKeys.showtimeCity(city),
    ) ?? createEmptyShowtimeCityData(city);
  const windowStartDate = getJerusalemCinemaDate();
  const windowEndDate = addCalendarDays(
    windowStartDate,
    SHOWTIME_LINK_DATE_COUNT - 1,
  );

  if (!windowEndDate) {
    return;
  }

  const range = getTargetedShowtimePrefetchRange({
    previewDate: previewDateString,
    windowStartDate,
    windowEndDate,
    chunkDayCount: SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
    triggerDayCount: SHOWTIME_PREFETCH_TRIGGER_DAY_COUNT,
    isDateCovered: (dateString) =>
      isMovieShowtimeDateCovered(cityData, tmdbId, dateString),
  });

  if (range) {
    await loadTargetedMovieShowtimeDateRange(
      city,
      tmdbId,
      range.startDate,
      range.endDate,
    );
  }
}

export async function loadShowtimesAroundDate(
  city: AppLocation,
  dateString: string,
  tmdbId?: string,
): Promise<void> {
  const focusedDayCount = getShowtimeWindowDayCountForDate(dateString);

  if (tmdbId) {
    await ensureMovieShowtimeWindowLoaded(
      city,
      tmdbId,
      Math.min(
        focusedDayCount + SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
        SHOWTIME_WINDOW_DAY_COUNT,
      ),
    );
    return;
  }

  await loadFocusedShowtimeDate(city, dateString);

  const backfillDayCount = focusedDayCount - 1;

  if (backfillDayCount > 0) {
    await ensureShowtimeWindowLoaded(city, backfillDayCount);
  }

  await ensureShowtimeWindowLoaded(
    city,
    Math.min(
      focusedDayCount + SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
      SHOWTIME_WINDOW_DAY_COUNT,
    ),
  );
}

export async function loadAdditionalShowtimeDays(
  city: AppLocation,
  dayCount: number,
  tmdbId?: string,
): Promise<void> {
  return tmdbId
    ? ensureMovieShowtimeWindowLoaded(city, tmdbId, dayCount)
    : ensureShowtimeWindowLoaded(city, dayCount);
}

export async function loadMovieCatalog(
  city: AppLocation = defaultCity,
): Promise<void> {
  await Promise.all([loadNowPlayingMovies(), loadComingSoonMovies()]);
  await loadShowtimes(city);
}

async function reloadMovieCollection(mode: CatalogMode): Promise<Movie[]> {
  await queryClient.invalidateQueries({
    queryKey: movieCatalogQueryKeys.collection(mode),
    exact: true,
    refetchType: "none",
  });
  const data = await queryClient.fetchQuery({
    ...movieCollectionQueryOptions(mode),
    staleTime: 0,
  });
  return data.movies;
}

export function reloadNowPlayingMovies(): Promise<Movie[]> {
  return reloadMovieCollection("nowPlaying");
}

export function reloadComingSoonMovies(): Promise<Movie[]> {
  return reloadMovieCollection("comingSoon");
}

export type AdminMovieEditPayload = {
  mode: CatalogMode;
  currentTmdbId: string;
  selectedTmdbId: string;
  selectedTitle?: string | null;
  selectedYear?: number | null;
  selectedPosterUrl?: string | null;
  isManualEntry: boolean;
};

export async function applyAdminMovieEdit(
  payload: AdminMovieEditPayload,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const tableName =
    payload.mode === "nowPlaying" ? MOVIES_TABLE_NAME : COMING_SOON_TABLE_NAME;
  const normalizedCurrentTmdbId = normalizeText(payload.currentTmdbId);
  const normalizedSelectedTmdbId = normalizeText(payload.selectedTmdbId);

  if (!normalizedCurrentTmdbId || !normalizedSelectedTmdbId) {
    throw new Error("Missing TMDB id for admin movie update.");
  }

  if (normalizedCurrentTmdbId === normalizedSelectedTmdbId) {
    return;
  }

  const { error: tableFixInsertError } = await supabase
    .from("tableFixes")
    .insert({
      tmdb_id: normalizedSelectedTmdbId,
      title_fix: normalizedCurrentTmdbId,
    });

  if (tableFixInsertError) {
    throw new Error(tableFixInsertError.message);
  }

  const { data: existingTarget, error: existingTargetError } = await supabase
    .from(tableName)
    .select("tmdb_id, english_title")
    .eq("tmdb_id", normalizedSelectedTmdbId)
    .maybeSingle();

  if (existingTargetError) {
    throw new Error(existingTargetError.message);
  }

  const selectedTitle = normalizeTitle(
    payload.selectedTitle ??
      (existingTarget
        ? stringifySupabaseValue(
            (existingTarget as SupabaseRow).english_title as SupabaseValue,
          )
        : ""),
  );

  if (existingTarget) {
    if (payload.mode === "nowPlaying") {
      const { error: showtimesUpdateError } = await supabase
        .from(SHOWTIMES_TABLE_NAME)
        .update({
          tmdb_id: normalizedSelectedTmdbId,
          english_title: selectedTitle,
        })
        .eq("tmdb_id", normalizedCurrentTmdbId);

      if (showtimesUpdateError) {
        throw new Error(showtimesUpdateError.message);
      }
    }

    const { error: deleteError } = await supabase
      .from(tableName)
      .delete()
      .eq("tmdb_id", normalizedCurrentTmdbId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return;
  }

  const updatePayload: Record<string, unknown> = {
    tmdb_id: normalizedSelectedTmdbId,
    solo_update: true,
    english_title: "",
    release_year: null,
    en_poster: "",
    backdrop: "",
    en_trailer: "",
    genres: [],
  };

  if (payload.mode === "nowPlaying") {
    updatePayload.imdb_id = null;
    updatePayload.imdbRating = null;
    updatePayload.imdbVotes = null;
    updatePayload.rt_id = null;
    updatePayload.rtCriticRating = null;
    updatePayload.rtCriticVotes = null;
    updatePayload.rtAudienceRating = null;
    updatePayload.rtAudienceVotes = null;
    updatePayload.lb_id = null;
    updatePayload.lbRating = null;
    updatePayload.lbVotes = null;
    updatePayload.tmdbRating = null;
    updatePayload.tmdbVotes = null;
    updatePayload.runtime = null;
    updatePayload.popularity = null;
  } else {
    updatePayload.release_date = null;
    updatePayload.runtime = null;
  }

  const { error } = await supabase
    .from(tableName)
    .update(updatePayload)
    .eq("tmdb_id", normalizedCurrentTmdbId);

  if (error) {
    throw new Error(error.message);
  }

  if (payload.mode === "nowPlaying") {
    const { error: showtimesUpdateError } = await supabase
      .from(SHOWTIMES_TABLE_NAME)
      .update({
        tmdb_id: normalizedSelectedTmdbId,
        english_title: selectedTitle,
      })
      .eq("tmdb_id", normalizedCurrentTmdbId);

    if (showtimesUpdateError) {
      throw new Error(showtimesUpdateError.message);
    }
  }
}

export type AdminMovieEditInvalidationRule = {
  exact: boolean;
  queryKey: readonly unknown[];
  strategy: "invalidate" | "reset";
};

export function getAdminMovieEditInvalidationRules(
  mode: CatalogMode,
): AdminMovieEditInvalidationRule[] {
  const collectionRule = {
    queryKey: movieCatalogQueryKeys.collection(mode),
    exact: true,
    strategy: "invalidate" as const,
  };

  return mode === "nowPlaying"
    ? [
        collectionRule,
        {
          queryKey: movieCatalogQueryKeys.showtimes(),
          exact: false,
          strategy: "reset",
        },
      ]
    : [collectionRule];
}

export async function invalidateAdminMovieEditQueries(
  client: QueryClient,
  mode: CatalogMode,
  refetchType: "active" | "none" = "active",
): Promise<void> {
  for (const rule of getAdminMovieEditInvalidationRules(mode)) {
    if (rule.strategy === "reset") {
      await client.resetQueries({
        queryKey: rule.queryKey,
        exact: rule.exact,
      });
      continue;
    }

    await client.invalidateQueries({
      queryKey: rule.queryKey,
      exact: rule.exact,
      refetchType,
    });
  }
}

export function adminMovieEditMutationOptions() {
  return mutationOptions({
    mutationKey: movieCatalogQueryKeys.adminEdits(),
    mutationFn: applyAdminMovieEdit,
    onSuccess: async (_data, variables) => {
      await invalidateAdminMovieEditQueries(queryClient, variables.mode);
    },
  });
}

export function getMovieShowtimeDays(
  tmdbId: string,
  city: AppLocation = defaultCity,
): readonly MovieShowtimeDay[] {
  const cityData = queryClient.getQueryData<ShowtimeCityData>(
    movieCatalogQueryKeys.showtimeCity(city),
  );

  return selectMovieShowtimeDays(cityData, tmdbId);
}

export function getMovieShowtimeCities(tmdbId: string): readonly AppLocation[] {
  const cities = ALL_LOCATIONS.filter((city) => {
    const cityData = queryClient.getQueryData<ShowtimeCityData>(
      movieCatalogQueryKeys.showtimeCity(city),
    );

    return selectMovieShowtimeDays(cityData, tmdbId).some(
      (day) => day.theaters.length > 0,
    );
  });

  return cities.length > 0 ? cities : EMPTY_SHOWTIME_CITIES;
}
