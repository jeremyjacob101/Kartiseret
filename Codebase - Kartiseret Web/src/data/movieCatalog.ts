import { movieCatalogResponseSchema, publicShowtimeRangeResponseSchema, type MovieCodesStatus as ApiMovieCodesStatus, type MovieCatalogMode, type PublicShowtime } from "@kartiseret/contracts/public-data";
import { getCinemaDayDate, getShowtimeSortValue, shouldIncludeShowtime as shouldIncludeShowtimeAtInstant, SHOWTIME_TIME_ZONE } from "@kartiseret/contracts/showtime-day";
import { addCalendarDays, getJerusalemCinemaDate, getTargetedShowtimePrefetchRange, SHOWTIME_LINK_DATE_COUNT } from "@kartiseret/contracts/showtime-links";
import { assertPublication, currentPublicationRevision, publicationOf, refreshPublicationCollections, tagPublication } from "./publicationRevision.js";
import { ALL_LOCATIONS, DEFAULT_LOCATION, type AppLocation } from "../prefs/definitions/locations.js";
import { mutationOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { movieAltOptionSchema, type Movie } from "@kartiseret/contracts/movies";
import { parseBoundary, movieCodeSchema } from "@kartiseret/contracts/runtime";
import { correctionResponseSchema } from "@kartiseret/contracts/private-data";
import { getPublicationResponse, ApiRequestError } from "./apiClient";
import { adminMovieEditPayloadSchema } from "./externalSchemas";
import { ticketAlertQueryKeys } from "./ticketAlerts";
import { queryClient } from "../lib/queryClient.js";
import { privateApiResponse } from "./privateApi";
import { z } from "zod";

export type { Movie } from "@kartiseret/contracts/movies";

export const APP_TIME_ZONE = SHOWTIME_TIME_ZONE;
export const INITIAL_SHOWTIME_WINDOW_DAY_COUNT = 1;
export const SHOWTIME_WINDOW_DAY_COUNT = 180;
export const SHOWTIME_PREFETCH_CHUNK_DAY_COUNT = 15;
export const SHOWTIME_PREFETCH_TRIGGER_DAY_COUNT = 10;

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

export type ShowtimeRow = PublicShowtime;
export type MovieAltOption = z.infer<typeof movieAltOptionSchema>;

export type CatalogMode = MovieCatalogMode;

export type MovieCodesStatus = "pending" | ApiMovieCodesStatus;

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
  publicationRevision?: string;
  mode: CatalogMode;
  movies: Movie[];
  moviesByCode: Record<string, Movie>;
  movieCodesStatus: MovieCodesStatus;
};

export type ShowtimeRange = {
  publicationRevision?: string;
  city: AppLocation;
  startDate: string;
  endDate: string;
  tmdbId?: string;
};

export type ShowtimeCityData = {
  publicationRevision?: string;
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
  publicationRevision?: string;
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
  showtimeCity: (city: AppLocation) => {
    const revision = currentPublicationRevision();
    return revision === undefined
      ? (["movieCatalog", "showtimes", "cities", city] as const)
      : (["movieCatalog", "showtimes", "cities", city, revision] as const);
  },
  showtimeRanges: () => ["movieCatalog", "showtimes", "ranges"] as const,
  showtimeRange: ({
    city,
    startDate,
    endDate,
    tmdbId,
    publicationRevision = currentPublicationRevision(),
  }: ShowtimeRange) =>
    [
      "movieCatalog",
      "showtimes",
      "ranges",
      {
        city,
        startDate,
        endDate,
        tmdbId: tmdbId?.trim() || null,
        ...(publicationRevision === undefined ? {} : { publicationRevision }),
      },
    ] as const,
  adminEdits: () => ["movieCatalog", "adminEdits"] as const,
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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
    const tmdbId = row.tmdbId;

    if (!selectedMovieIds.has(tmdbId)) {
      continue;
    }

    const city = normalizeText(row.screeningCity);

    if (city !== selectedCity) {
      continue;
    }

    const date = normalizeText(row.dateOfShowing);

    if (date < fixedAppDateString || date > windowEndDateString) {
      continue;
    }

    const theater = normalizeText(row.cinema);
    const showtime = formatShowtime(row.showtime);
    const showtimeHref = normalizeText(row.englishHref ?? "") || null;
    const screeningTech = normalizeText(row.screeningTech);
    const screeningType = normalizeText(row.screeningType);
    const dubLanguage = normalizeText(row.dubLanguage ?? "") || null;

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
    row.tmdbId,
    row.screeningCity,
    row.dateOfShowing,
    row.cinema,
    row.showtime,
    row.screeningTech,
    row.screeningType,
    row.dubLanguage ?? "original",
    row.englishHref ?? "none",
  ].join("::");
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
  const path =
    mode === "nowPlaying"
      ? "/api/v1/catalog/now-playing"
      : "/api/v1/catalog/coming-soon";
  const { response, revision } = await getPublicationResponse(
    path,
    movieCatalogResponseSchema,
    signal,
  );
  if (response.data.mode !== mode) {
    throw new Error("The catalog API returned the wrong catalog mode.");
  }
  if (response.data.movies.length === 0) {
    throw new Error(
      `The ${mode === "nowPlaying" ? "now-playing" : "coming-soon"} catalog is empty.`,
    );
  }

  tagPublication(response.data.movies, revision);
  return {
    ...response.data,
    publicationRevision: revision,
    moviesByCode: indexMoviesByCode(response.data.movies),
  };
}

export function movieCollectionQueryOptions(mode: CatalogMode) {
  return queryOptions({
    queryKey: movieCatalogQueryKeys.collection(mode),
    queryFn: ({ signal }) => fetchMovieCollection(mode, signal),
    structuralSharing: false,
    staleTime: MOVIE_COLLECTION_STALE_TIME,
    gcTime: MOVIE_COLLECTION_GC_TIME,
  });
}

export function selectMovies(data: MovieCollectionData): Movie[] {
  return data.movies;
}

export function isValidMovieCode(movieCode: string): boolean {
  return movieCodeSchema.safeParse(movieCode).success;
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
  publicationRevision?: string,
): Promise<ShowtimeRow[]> {
  if (startDateString > endDateString) {
    return [];
  }

  const params = new URLSearchParams({
    city,
    startDate: startDateString,
    endDate: endDateString,
  });
  const normalizedTmdbId = tmdbId?.trim();
  if (normalizedTmdbId) {
    params.set("tmdbId", normalizedTmdbId);
  }

  try {
    const { response, revision } = await getPublicationResponse(
      `/api/v1/showtimes?${params.toString()}`,
      publicShowtimeRangeResponseSchema,
      signal,
      publicationRevision,
    );
    return tagPublication(response.data.showtimes, revision);
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      error.code === "publication_changed"
    )
      await refreshPublicationCollections();
    throw error;
  }
}

export function showtimeRangeQueryOptions(range: ShowtimeRange) {
  const normalizedRange = {
    ...range,
    publicationRevision:
      range.publicationRevision ?? currentPublicationRevision(),
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
        normalizedRange.publicationRevision,
      ),
    retry: (count, error) =>
      !(
        error instanceof ApiRequestError && error.code === "publication_changed"
      ) && count < 1,
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
  const revision = merge.publicationRevision ?? publicationOf(merge.rows);
  const previous =
    (current?.publicationRevision !== undefined &&
    revision !== undefined &&
    current.publicationRevision !== revision
      ? undefined
      : current) ?? createEmptyShowtimeCityData(merge.city);
  const requestedDates = new Set(merge.dates);
  const rowsByKey = Object.fromEntries(
    Object.entries(previous.rowsByKey).filter(([, row]) => {
      const rowDate = normalizeText(row.dateOfShowing);

      if (!requestedDates.has(rowDate)) {
        return true;
      }

      if (merge.scope === "broad") {
        return false;
      }

      return row.tmdbId !== merge.scope.tmdbId;
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
    ...(revision === undefined ? {} : { publicationRevision: revision }),
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
  assertPublication(merge.rows);
  assertPublication(merge.movies);
  const rowsRevision = publicationOf(merge.rows);
  const movieRevision = publicationOf(merge.movies);
  if (
    rowsRevision !== undefined &&
    movieRevision !== undefined &&
    rowsRevision !== movieRevision
  )
    throw new ApiRequestError(
      409,
      "publication_changed",
      "Published data changed. Reload the catalog.",
    );
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
  const rows = await queryClient.fetchQuery(
    showtimeRangeQueryOptions({
      ...range,
      publicationRevision:
        merge.publicationRevision ??
        publicationOf(merge.movies) ??
        currentPublicationRevision(),
    }),
  );

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
        publicationRevision: collection.publicationRevision,
      } satisfies ShowtimeRange;
      const rows = await queryClient.fetchQuery(
        showtimeRangeQueryOptions(range),
      );
      const current = queryClient.getQueryData<ShowtimeCityData>(
        movieCatalogQueryKeys.showtimeCity(city),
      );

      assertPublication(rows, collection.publicationRevision);
      assertPublication(rows);
      return mergeShowtimeCityData(current, {
        city,
        dates: [fixedAppDateString],
        movies: collection.movies,
        publicationRevision: collection.publicationRevision,
        rows,
        scope: "broad",
        visibleDayCount: INITIAL_SHOWTIME_WINDOW_DAY_COUNT,
      });
    },
    retry: (count, error) =>
      !(
        error instanceof ApiRequestError && error.code === "publication_changed"
      ) && count < 1,
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

export type AdminMovieEditPayload = z.input<typeof adminMovieEditPayloadSchema>;

export async function applyAdminMovieEdit(
  payload: AdminMovieEditPayload,
): Promise<void> {
  const validatedPayload = parseBoundary(
    adminMovieEditPayloadSchema,
    payload,
    "admin movie edit input",
  );
  await privateApiResponse(
    "/api/v1/admin/movie-corrections",
    correctionResponseSchema,
    { method: "POST", body: validatedPayload },
  );
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
        {
          queryKey: ticketAlertQueryKeys.availabilities(),
          exact: false,
          strategy: "invalidate",
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
