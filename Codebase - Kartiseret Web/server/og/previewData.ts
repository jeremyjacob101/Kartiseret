import { decodeDateCode, isCanonicalShowtimeFilterMatch, parseMovieRouteCode, resolveCityCode, SHOWTIME_FILTER_OPTIONS, uncheckedFromFilterMask } from "@kartiseret/contracts/showtime-links";
import { getCinemaDayDate, getShowtimeSortValue, shouldIncludeShowtime, SHOWTIME_TIME_ZONE } from "@kartiseret/contracts/showtime-day";
import { previewDataSchema, type PreviewData, type PreviewRouteSelection, type PreviewTheater } from "./schemas.js";
import { buildShowtimeFilterSelections, getCanonicalShowtimeMeta } from "@kartiseret/contracts/showtime-filters";
import { getMovieByPermanentCode, getShowtimeRange } from "@kartiseret/server/public-data";
import { getProductionPublicDataRepository } from "@kartiseret/server/production";
import type { PublicDataRepository } from "@kartiseret/server/public-data";
import type { PublicShowtime } from "@kartiseret/contracts/public-data";
import { DEFAULT_LOCATION } from "@kartiseret/contracts/preferences";
import { parseBoundary } from "@kartiseret/contracts/runtime";

export type {
  PreviewData,
  PreviewRouteSelection,
  PreviewTheater,
} from "./schemas.js";

function parsePreviewData(value: unknown): PreviewData {
  return parseBoundary(previewDataSchema, value, "Open Graph preview");
}

function parseNumber(value: number | null | undefined): number | null {
  return value !== undefined &&
    value !== null &&
    Number.isFinite(value) &&
    value > 0
    ? value
    : null;
}

function formatPreviewDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOWTIME_TIME_ZONE,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function normalizeShowtime(value: string): string {
  const normalizedValue = value.trim();
  return normalizedValue.length >= 5
    ? normalizedValue.slice(0, 5)
    : normalizedValue;
}

export function resolvePreviewRouteSelection(
  routeCode: string,
  instant: Date = new Date(),
): PreviewRouteSelection | null {
  if (Number.isNaN(instant.getTime())) {
    return null;
  }

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

function filterShowtimeRows<
  T extends {
    showtime: string;
    screeningTech: string;
    screeningType: string;
    dubLanguage: string | null;
  },
>(rows: readonly T[], filterMask: number): T[] {
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
        screeningTech: row.screeningTech,
        screeningType: row.screeningType,
        dubLanguage: row.dubLanguage,
      }),
      selections,
    ));
}

function groupPreviewShowtimes<T extends { cinema: string; showtime: string }>(
  rows: readonly T[],
): PreviewTheater[] {
  const showtimesByTheater = new Map<string, Set<string>>();

  for (const row of rows) {
    const theater = row.cinema.trim();
    const showtime = normalizeShowtime(row.showtime);
    if (!theater || !showtime) {
      continue;
    }
    const existingShowtimes =
      showtimesByTheater.get(theater) ?? new Set<string>();
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
      const leftFirst = left.showtimes[0] ?? "";
      const rightFirst = right.showtimes[0] ?? "";
      return (
        getShowtimeSortValue(leftFirst) - getShowtimeSortValue(rightFirst) ||
        left.theater.localeCompare(right.theater)
      );
    })
    .slice(0, 3);
}

export async function getPreviewData(
  routeCode: string,
  instant: Date = new Date(),
  repository?: PublicDataRepository | null,
): Promise<PreviewData | null> {
  const selection = resolvePreviewRouteSelection(routeCode, instant);
  if (!selection) {
    return null;
  }

  const dataRepository = repository ?? getProductionPublicDataRepository();
  const movieResult = await getMovieByPermanentCode(
    dataRepository,
    selection.movieCode,
  );
  if (!movieResult?.movie.title) {
    return null;
  }

  const movie = movieResult.movie;
  let theaters: PreviewTheater[] = [];

  if (!movieResult.isComingSoon) {
    try {
      const showtimes = await getShowtimeRange(dataRepository, {
        city: selection.city,
        startDate: selection.date,
        endDate: selection.date,
        tmdbId: movie.tmdbId,
      });
      const filteredRows = filterShowtimeRows<PublicShowtime>(
        showtimes,
        selection.filterMask,
      ).filter((row) =>
        shouldIncludeShowtime(
          selection.date,
          normalizeShowtime(row.showtime),
          instant,
        ));
      theaters = groupPreviewShowtimes(filteredRows);
    } catch (error) {
      console.error("Failed to load public showtimes for movie preview.", {
        name:
          typeof error === "object" && error !== null && "name" in error
            ? String(error.name)
            : "Error",
      });
    }
  }

  return parsePreviewData({
    routeCode,
    movieCode: selection.movieCode,
    tmdbId: movie.tmdbId,
    title: movie.title,
    city: selection.city,
    date: selection.date,
    dateLabel: formatPreviewDate(selection.date),
    posterUrl: movie.imageSrc.trim(),
    backdropUrl: movie.backdropSrc?.trim() ?? "",
    isComingSoon: movieResult.isComingSoon,
    theaters,
    year: parseNumber(movie.year),
    releaseDate: movieResult.isComingSoon ? (movie.releaseDate ?? null) : null,
    runtime: parseNumber(movie.runtime),
    genres: movie.genres,
    imdbRating: parseNumber(movie.imdbRating),
    rtCriticRating: parseNumber(movie.rtCriticRating),
    rtCriticVotes: parseNumber(movie.rtCriticVotes),
    rtAudienceRating: parseNumber(movie.rtAudienceRating),
    rtAudienceVotes: parseNumber(movie.rtAudienceVotes),
    lbRating: parseNumber(movie.lbRating),
  });
}
