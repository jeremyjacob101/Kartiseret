import { getSupabaseBrowserClient } from "../lib/supabase";
import { ALL_LOCATIONS, DEFAULT_LOCATION, type AppLocation } from "../prefs/definitions/locations";

const SUPABASE_PAGE_SIZE = 1000;
export const APP_TIME_ZONE = "Asia/Jerusalem";
export const SHOWTIME_DAY_CUTOFF_MINUTES = 65;
const SHOWTIME_GRACE_PERIOD_MINUTES = 15;
export const INITIAL_SHOWTIME_WINDOW_DAY_COUNT = 5;
export const SHOWTIME_WINDOW_DAY_COUNT = 180;
export const SHOWTIME_PREFETCH_CHUNK_DAY_COUNT = 15;

const MOVIES_TABLE_NAME = "finalMovies";
const COMING_SOON_TABLE_NAME = "finalSoons";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
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
const OPTIONAL_COMING_SOON_SELECT_COLUMNS = ["runtime"] as const;
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
export const fixedAppDateString = getCurrentAppDateString(APP_TIME_ZONE);
const fixedCurrentDateTimeParts =
  getCurrentDateTimePartsInTimeZone(APP_TIME_ZONE);
const fixedCurrentIsraelDateString = fixedCurrentDateTimeParts
  ? `${fixedCurrentDateTimeParts.year}-${fixedCurrentDateTimeParts.month}-${fixedCurrentDateTimeParts.day}`
  : fixedAppDateString;
const fixedCurrentIsraelMinutesSinceMidnight = fixedCurrentDateTimeParts
  ? fixedCurrentDateTimeParts.hour * 60 + fixedCurrentDateTimeParts.minute
  : Number.NEGATIVE_INFINITY;

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

type ShowtimeRow = SupabaseRow & {
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

type CatalogMode = "nowPlaying" | "comingSoon";

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

export type MovieCatalogStatusSnapshot = {
  nowPlayingReady: boolean;
  comingSoonReady: boolean;
  showtimesReady: boolean;
  catalogReady: boolean;
  showtimesVersion: number;
};

export let movies: Movie[] = [];
export let allNowPlayingMovies: Movie[] = [];
export let comingSoonMovies: Movie[] = [];
export let allComingSoonMovies: Movie[] = [];

type MovieShowtimesByCity = Record<AppLocation, MovieShowtimeDay[]>;

let movieShowtimesByTmdbId: Record<string, MovieShowtimesByCity> = {};
let nowPlayingLoaded = false;
let comingSoonLoaded = false;
let showtimesLoaded = false;
let showtimesVersion = 0;
let loadNowPlayingMoviesPromise: Promise<void> | null = null;
let loadComingSoonMoviesPromise: Promise<void> | null = null;
let loadShowtimesPromise: Promise<void> | null = null;
let loadMovieCatalogPromise: Promise<void> | null = null;
let loadedShowtimeWindowDayCount = 0;
const cachedShowtimeRowsByKey = new Map<string, ShowtimeRow>();
const movieCatalogListeners = new Set<() => void>();
const EMPTY_SHOWTIME_CITIES: readonly AppLocation[] = Object.freeze([]);
let movieCatalogStatusSnapshot: MovieCatalogStatusSnapshot = {
  nowPlayingReady: false,
  comingSoonReady: false,
  showtimesReady: false,
  catalogReady: false,
  showtimesVersion: 0,
};

function refreshMovieCatalogStatus(): void {
  const nextStatus: MovieCatalogStatusSnapshot = {
    nowPlayingReady: nowPlayingLoaded && movies.length > 0,
    comingSoonReady: comingSoonLoaded && comingSoonMovies.length > 0,
    showtimesReady: showtimesLoaded,
    catalogReady:
      nowPlayingLoaded &&
      movies.length > 0 &&
      comingSoonLoaded &&
      comingSoonMovies.length > 0,
    showtimesVersion,
  };

  if (
    nextStatus.nowPlayingReady === movieCatalogStatusSnapshot.nowPlayingReady &&
    nextStatus.comingSoonReady === movieCatalogStatusSnapshot.comingSoonReady &&
    nextStatus.showtimesReady === movieCatalogStatusSnapshot.showtimesReady &&
    nextStatus.catalogReady === movieCatalogStatusSnapshot.catalogReady &&
    nextStatus.showtimesVersion === movieCatalogStatusSnapshot.showtimesVersion
  ) {
    return;
  }

  movieCatalogStatusSnapshot = nextStatus;
  movieCatalogListeners.forEach((listener) => {
    listener();
  });
}

export function subscribeToMovieCatalog(onStoreChange: () => void): () => void {
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

type TimeZoneDateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
};

function getCurrentDateTimePartsInTimeZone(
  timeZone: string,
): TimeZoneDateTimeParts | null {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "",
    10,
  );

  if (
    !year ||
    !month ||
    !day ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
  };
}

function getCurrentAppDateString(timeZone: string): string {
  const parts = getCurrentDateTimePartsInTimeZone(timeZone);

  if (!parts) {
    return formatIsoDate(new Date());
  }

  const currentDateString = `${parts.year}-${parts.month}-${parts.day}`;
  const minutesSinceMidnight = parts.hour * 60 + parts.minute;

  if (minutesSinceMidnight < SHOWTIME_DAY_CUTOFF_MINUTES) {
    return addDaysToIsoDate(currentDateString, -1);
  }

  return currentDateString;
}

function parseShowtimeMinutes(value: string): number {
  const [hoursText, minutesText] = value.split(":");
  const hours = Number.parseInt(hoursText ?? "", 10);
  const minutes = Number.parseInt(minutesText ?? "", 10);

  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return hours * 60 + minutes;
}

function isPostMidnightCarryoverShowtime(value: string): boolean {
  return parseShowtimeMinutes(value) < SHOWTIME_DAY_CUTOFF_MINUTES;
}

function compareShowtimeEntries(
  leftShowtime: ShowtimeEntry,
  rightShowtime: ShowtimeEntry,
): number {
  const leftIsCarryover = isPostMidnightCarryoverShowtime(leftShowtime.time);
  const rightIsCarryover = isPostMidnightCarryoverShowtime(rightShowtime.time);

  if (leftIsCarryover !== rightIsCarryover) {
    return leftIsCarryover ? 1 : -1;
  }

  const leftMinutes = parseShowtimeMinutes(leftShowtime.time);
  const rightMinutes = parseShowtimeMinutes(rightShowtime.time);

  return (
    leftMinutes - rightMinutes ||
    leftShowtime.time.localeCompare(rightShowtime.time) ||
    leftShowtime.screeningTech.localeCompare(rightShowtime.screeningTech) ||
    leftShowtime.screeningType.localeCompare(rightShowtime.screeningType) ||
    (leftShowtime.dubLanguage ?? "").localeCompare(
      rightShowtime.dubLanguage ?? "",
    )
  );
}

function shouldIncludeShowtime(dateString: string, showtime: string): boolean {
  const showtimeMinutes = parseShowtimeMinutes(showtime);

  if (!Number.isFinite(showtimeMinutes)) {
    return false;
  }

  const effectiveDateString = isPostMidnightCarryoverShowtime(showtime)
    ? addDaysToIsoDate(dateString, 1)
    : dateString;

  if (effectiveDateString > fixedCurrentIsraelDateString) {
    return true;
  }

  if (effectiveDateString < fixedCurrentIsraelDateString) {
    return false;
  }

  return (
    showtimeMinutes + SHOWTIME_GRACE_PERIOD_MINUTES >=
    fixedCurrentIsraelMinutesSinceMidnight
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
  sortMode?: "popularity" | "releaseDate";
};

function buildMovies(
  rows: MovieRow[],
  { sortMode = "popularity" }: BuildMoviesOptions = {},
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

function buildMovieShowtimes(
  rows: ShowtimeRow[],
  selectedMovies: readonly Movie[],
  windowEndDateString: string,
): Record<string, MovieShowtimesByCity> {
  const showtimeWindowDates = buildDateRange(
    fixedAppDateString,
    windowEndDateString,
  );
  const supportedCities = new Set<string>(ALL_LOCATIONS);
  const selectedMovieIds = new Set(selectedMovies.map((movie) => movie.tmdbId));
  const groupedShowtimes = new Map<
    string,
    Map<AppLocation, Map<string, Map<string, Map<string, ShowtimeEntry>>>>
  >();

  for (const row of rows) {
    const tmdbId = normalizeText(stringifySupabaseValue(row.tmdb_id));

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    const city = normalizeText(row.screening_city);

    if (!supportedCities.has(city)) {
      continue;
    }

    const normalizedCity = city as AppLocation;
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

  const orderedCities = ALL_LOCATIONS;

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
                    .map(([theater, theaterShowtimes]) => ({
                      theater,
                      showtimes: [...theaterShowtimes.values()].sort(
                        compareShowtimeEntries,
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

async function fetchAllTableRows<Row extends SupabaseRow>(
  tableName: string,
  selectColumns: readonly string[],
  orderColumns: readonly string[],
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

async function fetchMovieRows(): Promise<MovieRow[]> {
  const selectColumns = [
    ...MOVIE_SELECT_COLUMNS,
    ...OPTIONAL_MOVIE_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows<MovieRow>(MOVIES_TABLE_NAME, selectColumns, [
      "tmdb_id",
    ]);
  } catch (error) {
    if (!isMissingOptionalColumnError(error, OPTIONAL_MOVIE_SELECT_COLUMNS)) {
      throw error;
    }

    return fetchAllTableRows<MovieRow>(
      MOVIES_TABLE_NAME,
      MOVIE_SELECT_COLUMNS,
      ["tmdb_id"],
    );
  }
}

async function fetchComingSoonMovieRows(): Promise<ComingSoonMovieRow[]> {
  const selectColumns = [
    ...COMING_SOON_SELECT_COLUMNS,
    ...OPTIONAL_COMING_SOON_SELECT_COLUMNS,
  ];

  try {
    return await fetchAllTableRows<ComingSoonMovieRow>(
      COMING_SOON_TABLE_NAME,
      selectColumns,
      ["tmdb_id"],
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
    );
  }
}

async function fetchShowtimeRowsForDateRange(
  startDateString: string,
  endDateString: string,
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
        .gte("date_of_showing", startDateString)
        .lte("date_of_showing", endDateString)
        .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1);

      query = query
        .order("tmdb_id", { ascending: true })
        .order("date_of_showing", { ascending: true })
        .order("cinema", { ascending: true })
        .order("showtime", { ascending: true });

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

export async function loadNowPlayingMovies(): Promise<void> {
  if (nowPlayingLoaded) {
    return;
  }

  if (loadNowPlayingMoviesPromise) {
    return loadNowPlayingMoviesPromise;
  }

  loadNowPlayingMoviesPromise = (async () => {
    const movieRows = await fetchMovieRows();
    const nextMovies = buildMovies(movieRows);

    if (nextMovies.length === 0) {
      throw new Error(
        `Supabase table ${MOVIES_TABLE_NAME} returned no movie rows.`,
      );
    }

    movies = nextMovies;
    allNowPlayingMovies = nextMovies;
    nowPlayingLoaded = true;
    refreshMovieCatalogStatus();
  })()
    .catch((error) => {
      if (!nowPlayingLoaded) {
        movies = [];
        allNowPlayingMovies = [];
      }

      refreshMovieCatalogStatus();
      throw error instanceof Error ? error : new Error(String(error));
    })
    .finally(() => {
      loadNowPlayingMoviesPromise = null;
    });

  return loadNowPlayingMoviesPromise;
}

export async function loadComingSoonMovies(): Promise<void> {
  if (comingSoonLoaded) {
    return;
  }

  if (loadComingSoonMoviesPromise) {
    return loadComingSoonMoviesPromise;
  }

  loadComingSoonMoviesPromise = (async () => {
    const comingSoonRows = await fetchComingSoonMovieRows();
    const nextMovies = buildMovies(comingSoonRows, {
      sortMode: "releaseDate",
    });

    if (nextMovies.length === 0) {
      throw new Error(
        `Supabase table ${COMING_SOON_TABLE_NAME} returned no movie rows.`,
      );
    }

    comingSoonMovies = nextMovies;
    allComingSoonMovies = nextMovies;
    comingSoonLoaded = true;
    refreshMovieCatalogStatus();
  })()
    .catch((error) => {
      if (!comingSoonLoaded) {
        comingSoonMovies = [];
        allComingSoonMovies = [];
      }

      refreshMovieCatalogStatus();
      throw error instanceof Error ? error : new Error(String(error));
    })
    .finally(() => {
      loadComingSoonMoviesPromise = null;
    });

  return loadComingSoonMoviesPromise;
}

export async function loadShowtimes(): Promise<void> {
  return ensureShowtimeWindowLoaded(INITIAL_SHOWTIME_WINDOW_DAY_COUNT);
}

async function ensureShowtimeWindowLoaded(dayCount: number): Promise<void> {
  const targetDayCount = clampShowtimeWindowDayCount(dayCount);

  if (loadedShowtimeWindowDayCount >= targetDayCount) {
    return;
  }

  if (loadShowtimesPromise) {
    await loadShowtimesPromise;

    if (loadedShowtimeWindowDayCount >= targetDayCount) {
      return;
    }
  }

  loadShowtimesPromise = (async () => {
    await loadNowPlayingMovies();
    const nextStartDateString =
      loadedShowtimeWindowDayCount > 0
        ? addDaysToIsoDate(fixedAppDateString, loadedShowtimeWindowDayCount)
        : fixedAppDateString;
    const nextEndDateString = getShowtimeWindowEndDateString(targetDayCount);
    const showtimeRows = await fetchShowtimeRowsForDateRange(
      nextStartDateString,
      nextEndDateString,
    );

    for (const row of showtimeRows) {
      cachedShowtimeRowsByKey.set(getCachedShowtimeRowKey(row), row);
    }

    movieShowtimesByTmdbId = buildMovieShowtimes(
      [...cachedShowtimeRowsByKey.values()],
      allNowPlayingMovies,
      nextEndDateString,
    );
    loadedShowtimeWindowDayCount = targetDayCount;
    showtimesLoaded = true;
    showtimesVersion += 1;
    refreshMovieCatalogStatus();
  })()
    .catch((error) => {
      if (!showtimesLoaded) {
        movieShowtimesByTmdbId = {};
        loadedShowtimeWindowDayCount = 0;
        cachedShowtimeRowsByKey.clear();
      }

      refreshMovieCatalogStatus();
      throw error instanceof Error ? error : new Error(String(error));
    })
    .finally(() => {
      loadShowtimesPromise = null;
    });

  return loadShowtimesPromise;
}

export async function loadAdditionalShowtimeDays(
  dayCount: number,
): Promise<void> {
  return ensureShowtimeWindowLoaded(dayCount);
}

export async function loadMovieCatalog(): Promise<void> {
  if (nowPlayingLoaded && comingSoonLoaded && showtimesLoaded) {
    return;
  }

  if (loadMovieCatalogPromise) {
    return loadMovieCatalogPromise;
  }

  loadMovieCatalogPromise = (async () => {
    await loadNowPlayingMovies();
    await loadComingSoonMovies();
    await loadShowtimes();
  })().finally(() => {
    loadMovieCatalogPromise = null;
  });

  return loadMovieCatalogPromise;
}

export async function reloadNowPlayingMovies(): Promise<void> {
  nowPlayingLoaded = false;
  movies = [];
  allNowPlayingMovies = [];
  refreshMovieCatalogStatus();
  await loadNowPlayingMovies();
}

export async function reloadComingSoonMovies(): Promise<void> {
  comingSoonLoaded = false;
  comingSoonMovies = [];
  allComingSoonMovies = [];
  refreshMovieCatalogStatus();
  await loadComingSoonMovies();
}

type AdminMovieEditPayload = {
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
    .select("tmdb_id")
    .eq("tmdb_id", normalizedSelectedTmdbId)
    .maybeSingle();

  if (existingTargetError) {
    throw new Error(existingTargetError.message);
  }

  if (existingTarget) {
    if (payload.mode === "nowPlaying") {
      const { error: showtimesUpdateError } = await supabase
        .from(SHOWTIMES_TABLE_NAME)
        .update({ tmdb_id: normalizedSelectedTmdbId })
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
      .update({ tmdb_id: normalizedSelectedTmdbId })
      .eq("tmdb_id", normalizedCurrentTmdbId);

    if (showtimesUpdateError) {
      throw new Error(showtimesUpdateError.message);
    }
  }
}

export function getMovieShowtimeDays(
  tmdbId: string,
  city: AppLocation = defaultCity,
): readonly MovieShowtimeDay[] {
  return movieShowtimesByTmdbId[tmdbId]?.[city] ?? [];
}

export function getMovieShowtimeCities(tmdbId: string): readonly AppLocation[] {
  const cityShowtimes = movieShowtimesByTmdbId[tmdbId];

  if (!cityShowtimes) {
    return EMPTY_SHOWTIME_CITIES;
  }

  const cities = ALL_LOCATIONS.filter((city) =>
    cityShowtimes[city]?.some((day) => day.theaters.length > 0));

  return cities.length > 0 ? cities : EMPTY_SHOWTIME_CITIES;
}
