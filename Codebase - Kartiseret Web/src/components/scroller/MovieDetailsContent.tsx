import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import { Clock8, MapPin, MoveRight, Star, X } from "lucide-react";
import { Link } from "react-router";
import { MoviePosterArtwork } from "../MoviePosterArtwork";
import { TheaterMapDialog } from "../maps/TheaterMapDialog";
import { APP_TIME_ZONE, fixedAppDateString, getMovieCatalogStatusSnapshot, getMovieShowtimeCities, getMovieShowtimeDays, getNextShowtimePrefetchDayCount, INITIAL_SHOWTIME_WINDOW_DAY_COUNT, loadAdditionalShowtimeDays, loadShowtimesAroundDate, SHOWTIME_PREFETCH_CHUNK_DAY_COUNT, SHOWTIME_WINDOW_DAY_COUNT, subscribeToMovieCatalog, type Movie, type MovieShowtimeDay } from "../../data/movieCatalog";
import { loadCities, type City } from "../../data/theaters";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";
import { type RatingSource } from "../../prefs/definitions/ratingSources";
import { ShowtimeDayPicker } from "../showtimes/ShowtimeDayPicker";
import { ShowtimeFilterMenu } from "../showtimes/ShowtimeFilterMenu";
import { buildShowtimeFilterSelections, filterTheatersBySelections, getShowtimeFilterOptions, getShowtimeFiltersSnapshot, saveShowtimeFilters, subscribeToShowtimeFilters, updateShowtimeFilterState, type ShowtimeFilterOptions, type ShowtimeFilterSelections } from "../showtimes/showtimeFilters";

type TheaterTheme = {
  accent: string;
  surface: string;
  glow: string;
  pillBackground?: string;
  pillClassName?: string;
};

const theaterThemes: Record<string, TheaterTheme> = {
  "Yes Planet": {
    accent: "#d9710f",
    surface: "rgba(255, 154, 61, 0.12)",
    glow: "rgba(217, 113, 15, 0.28)",
    pillClassName: "details-time-pill--yes-planet",
  },
  "Cinema City": {
    accent: "#186bdf",
    surface: "rgba(94, 168, 255, 0.12)",
    glow: "rgba(24, 107, 223, 0.3)",
    pillClassName: "details-time-pill--cinema-city",
  },
  "Lev Cinema": {
    accent: "#b50519",
    surface: "rgba(255, 107, 107, 0.12)",
    glow: "rgba(181, 5, 25, 0.28)",
    pillClassName: "details-time-pill--lev-cinema",
  },
  "Rav Hen": {
    accent: "#ab5306",
    surface: "rgba(255, 177, 74, 0.14)",
    glow: "rgba(13, 6, 218, 0.32)",
    pillBackground:
      "linear-gradient(135deg, rgba(79, 146, 255, 0.22), rgba(255, 177, 74, 0.18))",
    pillClassName: "details-time-pill--rav-hen",
  },
  "Hot Cinema": {
    accent: "#f06a87",
    surface: "rgba(255, 79, 160, 0.14)",
    glow: "rgba(240, 106, 135, 0.32)",
    pillClassName: "details-time-pill--hot-cinema",
  },
  MovieLand: {
    accent: "#a80371",
    surface: "rgba(88, 0, 58, 0.12)",
    glow: "rgba(168, 3, 113, 0.3)",
    pillClassName: "details-time-pill--movieland",
  },
};
const fallbackTheaterThemes: TheaterTheme[] = [
  {
    accent: "#d29bff",
    surface: "rgba(210, 155, 255, 0.12)",
    glow: "rgba(210, 155, 255, 0.28)",
  },
  {
    accent: "#ffd166",
    surface: "rgba(255, 209, 102, 0.12)",
    glow: "rgba(255, 209, 102, 0.28)",
  },
  {
    accent: "#7bdff2",
    surface: "rgba(123, 223, 242, 0.12)",
    glow: "rgba(123, 223, 242, 0.28)",
  },
];
const showtimeDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: APP_TIME_ZONE,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const releaseDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const RT_CRITIC_FRESH_MIN_SCORE = 60;
const RT_CRITIC_CERTIFIED_FRESH_MIN_SCORE = 75;
const RT_CRITIC_CERTIFIED_FRESH_MIN_REVIEWS = 80;
const RT_AUDIENCE_POSITIVE_MIN_SCORE = 60;
const RT_AUDIENCE_HOT_MIN_SCORE = 90;
const RT_AUDIENCE_HOT_MIN_VERIFIED_RATINGS = 500;
const YOUTUBE_KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const EMPTY_SHOWTIME_DAYS: readonly MovieShowtimeDay[] = Object.freeze([]);

type MovieDetailsContentProps = {
  movie: Movie;
  titleId: string;
  posterRef?: Ref<HTMLImageElement>;
  posterClassName?: string;
  eyebrow?: string;
  variant?: MovieDetailsVariant;
  preferredShowtimeDate?: string | null;
  onPreferredShowtimeDateChange?: (date: string) => void;
};

export type MovieDetailsVariant = "nowPlaying" | "comingSoon";

type MetricDisplay = {
  key: RatingSource;
  value: string;
  ariaLabel: string;
  logoSrc: string;
  href?: string;
  linkAriaLabel?: string;
  logoClassName?: string;
};

type NearbyCityChoice = {
  name: string;
  targetDate: string;
};

function formatRuntime(runtime: number): string {
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

function getMovieInfoParts(movie: Movie): string[] {
  const parts: string[] = [];

  if (movie.year > 0) {
    parts.push(String(movie.year));
  }

  if (movie.runtime > 0) {
    parts.push(formatRuntime(movie.runtime));
  }

  return parts;
}

function parseLocalDate(dateString: string): Date {
  const [year, month, day] = dateString
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  if (!year || !month || !day) {
    return new Date(dateString);
  }

  return new Date(year, month - 1, day);
}

function parseShowtimeDate(dateString: string): Date {
  const [year, month, day] = dateString
    .split("-")
    .map((value) => Number.parseInt(value, 10));

  if (!year || !month || !day) {
    return new Date(dateString);
  }

  // Noon UTC keeps the Israel calendar date stable across viewer timezones.
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function getShowtimeDateLabel(dateString: string): string {
  const showDate = parseShowtimeDate(dateString);
  const today = parseShowtimeDate(fixedAppDateString);
  const dayOffset = Math.round(
    (showDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayOffset === 0) {
    return "Today";
  }

  if (dayOffset === 1) {
    return "Tomorrow";
  }

  return showtimeDateFormatter.format(showDate);
}

function formatReleaseDate(dateString: string): string {
  const releaseDate = parseLocalDate(dateString);

  return Number.isNaN(releaseDate.getTime())
    ? dateString
    : releaseDateFormatter.format(releaseDate);
}

function extractYouTubeVideoKey(
  value: string | null | undefined,
): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (YOUTUBE_KEY_PATTERN.test(normalizedValue)) {
    return normalizedValue;
  }

  const matchedKey = normalizedValue.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/,
  )?.[1];

  return matchedKey && YOUTUBE_KEY_PATTERN.test(matchedKey) ? matchedKey : null;
}

function getTrailerEmbedUrl(
  trailerValue: string | null | undefined,
): string | null {
  const videoKey = extractYouTubeVideoKey(trailerValue);

  if (!videoKey) {
    return null;
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?rel=0&modestbranding=1&playsinline=1`;
}

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function toPathUrl(
  baseUrl: string,
  value: string | null | undefined,
): string | null {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (isAbsoluteUrl(normalizedValue)) {
    return normalizedValue;
  }

  return `${baseUrl}/${normalizedValue.replace(/^\/+/, "")}`;
}

function getImdbUrl(movie: Movie): string | null {
  const imdbId = movie.imdbId?.trim();

  if (!imdbId) {
    return null;
  }

  if (isAbsoluteUrl(imdbId)) {
    return imdbId;
  }

  return `https://www.imdb.com/title/${imdbId.replace(/^\/+|\/+$/g, "")}/`;
}

function getRottenTomatoesUrl(movie: Movie): string | null {
  return toPathUrl("https://www.rottentomatoes.com", movie.rtId);
}

function getLetterboxdUrl(movie: Movie): string | null {
  return toPathUrl("https://letterboxd.com", movie.lbId);
}

function getTmdbUrl(movie: Movie): string {
  const tmdbId = movie.tmdbId.trim();

  if (isAbsoluteUrl(tmdbId)) {
    return tmdbId;
  }

  return `https://www.themoviedb.org/movie/${encodeURIComponent(tmdbId)}`;
}

function getTheaterTheme(theater: string, index: number): TheaterTheme {
  return (
    theaterThemes[theater] ??
    fallbackTheaterThemes[index % fallbackTheaterThemes.length]
  );
}

function hasRating(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPercent(value: number | null | undefined): string {
  return hasRating(value) ? `${Math.round(value)}%` : "—";
}

function formatDecimalRating(value: number | null | undefined): string {
  return hasRating(value) ? value.toFixed(1) : "—";
}

function formatTmdbRating(value: number | null | undefined): string {
  return hasRating(value) ? Number(value.toFixed(1)).toString() : "—";
}

// RT's full "hot" badges also depend on fields this app does not store
// (for example Top Critics / verified-release buckets), so we use the
// available score plus conservative theatrical vote thresholds here.
function getCriticBadge(
  score: number | null,
  votes: number | null,
): { src: string; description: string } | null {
  if (!hasRating(score)) {
    return null;
  }

  if (
    score >= RT_CRITIC_CERTIFIED_FRESH_MIN_SCORE &&
    (votes ?? 0) >= RT_CRITIC_CERTIFIED_FRESH_MIN_REVIEWS
  ) {
    return {
      src: "/logos/rtCriticHot.svg",
      description: "Certified Fresh",
    };
  }

  return score >= RT_CRITIC_FRESH_MIN_SCORE
    ? {
        src: "/logos/rtCriticGood.svg",
        description: "Fresh",
      }
    : {
        src: "/logos/rtCriticBad.svg",
        description: "Rotten",
      };
}

function getAudienceBadge(
  score: number | null,
  votes: number | null,
): { src: string; description: string } | null {
  if (!hasRating(score)) {
    return null;
  }

  if (
    score >= RT_AUDIENCE_HOT_MIN_SCORE &&
    (votes ?? 0) >= RT_AUDIENCE_HOT_MIN_VERIFIED_RATINGS
  ) {
    return {
      src: "/logos/rtAudienceHot.svg",
      description: "Verified Hot",
    };
  }

  return score >= RT_AUDIENCE_POSITIVE_MIN_SCORE
    ? {
        src: "/logos/rtAudienceGood.svg",
        description: "Full Popcorn Bucket",
      }
    : {
        src: "/logos/rtAudienceBad.svg",
        description: "Spilled Popcorn Bucket",
      };
}

function getMetricDisplay(
  movie: Movie,
  source: RatingSource,
  criticBadge: { src: string; description: string } | null,
  audienceBadge: { src: string; description: string } | null,
): MetricDisplay {
  switch (source) {
    case "imdbRating":
      return {
        key: "imdbRating",
        value: formatDecimalRating(movie.imdbRating),
        ariaLabel: hasRating(movie.imdbRating)
          ? `IMDb rating ${movie.imdbRating.toFixed(1)}`
          : "IMDb rating unavailable",
        logoSrc: "/logos/imdb.svg",
        href: getImdbUrl(movie) ?? undefined,
        linkAriaLabel: `Open ${movie.title} on IMDb`,
        logoClassName: "details-metric-logo details-metric-logo--imdb",
      };
    case "rtAudienceRating": {
      const logoSrc = audienceBadge?.src ?? "/logos/rtAudienceGood.svg";
      const logoClassName =
        logoSrc === "/logos/rtAudienceBad.svg"
          ? "details-metric-logo details-metric-logo--rt-audience-bad"
          : logoSrc === "/logos/rtAudienceHot.svg"
            ? "details-metric-logo details-metric-logo--rt-audience-hot"
            : "details-metric-logo details-metric-logo--rt-audience-good";

      return {
        key: "rtAudienceRating",
        value: formatPercent(movie.rtAudienceRating),
        ariaLabel: audienceBadge
          ? `Rotten Tomatoes audience score ${formatPercent(movie.rtAudienceRating)}, ${audienceBadge.description}`
          : "Rotten Tomatoes audience score unavailable",
        logoSrc,
        href: getRottenTomatoesUrl(movie) ?? undefined,
        linkAriaLabel: `Open ${movie.title} on Rotten Tomatoes`,
        logoClassName,
      };
    }
    case "rtCriticRating": {
      const logoSrc = criticBadge?.src ?? "/logos/rtCriticGood.svg";
      const logoClassName =
        logoSrc === "/logos/rtCriticBad.svg"
          ? "details-metric-logo details-metric-logo--rt-critic-bad"
          : logoSrc === "/logos/rtCriticHot.svg"
            ? "details-metric-logo details-metric-logo--rt-critic-hot"
            : "details-metric-logo details-metric-logo--rt-critic-good";

      return {
        key: "rtCriticRating",
        value: formatPercent(movie.rtCriticRating),
        ariaLabel: criticBadge
          ? `Rotten Tomatoes critic score ${formatPercent(movie.rtCriticRating)}, ${criticBadge.description}`
          : "Rotten Tomatoes critic score unavailable",
        logoSrc,
        href: getRottenTomatoesUrl(movie) ?? undefined,
        linkAriaLabel: `Open ${movie.title} on Rotten Tomatoes`,
        logoClassName,
      };
    }
    case "lbRating":
      return {
        key: "lbRating",
        value: formatDecimalRating(movie.lbRating),
        ariaLabel: hasRating(movie.lbRating)
          ? `Letterboxd rating ${movie.lbRating.toFixed(1)}`
          : "Letterboxd rating unavailable",
        logoSrc: "/logos/letterboxd.svg",
        href: getLetterboxdUrl(movie) ?? undefined,
        linkAriaLabel: `Open ${movie.title} on Letterboxd`,
        logoClassName: "details-metric-logo details-metric-logo--letterboxd",
      };
    case "tmdbRating":
      return {
        key: "tmdbRating",
        value: formatTmdbRating(movie.tmdbRating),
        ariaLabel: hasRating(movie.tmdbRating)
          ? `TMDB rating ${formatTmdbRating(movie.tmdbRating)}`
          : "TMDB rating unavailable",
        logoSrc: "/logos/tmdb.svg",
        href: getTmdbUrl(movie),
        linkAriaLabel: `Open ${movie.title} on TMDB`,
        logoClassName: "details-metric-logo details-metric-logo--tmdb",
      };
    default: {
      const neverSource: never = source;
      throw new Error(`Unsupported rating source: ${String(neverSource)}`);
    }
  }
}

function getMetricDisplays(
  movie: Movie,
  selectedSources: readonly RatingSource[],
): MetricDisplay[] {
  const criticBadge = getCriticBadge(movie.rtCriticRating, movie.rtCriticVotes);
  const audienceBadge = getAudienceBadge(
    movie.rtAudienceRating,
    movie.rtAudienceVotes,
  );

  return selectedSources.map((source) =>
    getMetricDisplay(movie, source, criticBadge, audienceBadge));
}

function getShowtimeTargetDate(
  showtimeDays: readonly MovieShowtimeDay[],
  preferredShowtimeDate: string | null | undefined,
): string | null {
  if (showtimeDays.length === 0) {
    return null;
  }

  if (
    preferredShowtimeDate &&
    showtimeDays.some((day) => day.date === preferredShowtimeDate)
  ) {
    return preferredShowtimeDate;
  }

  return showtimeDays[0]?.date ?? null;
}

function getFirstShowtimeDate(
  showtimeDays: readonly MovieShowtimeDay[],
): string | null {
  return showtimeDays.find((day) => day.theaters.length > 0)?.date ?? null;
}

function getOrderedNearbyCityNames(
  currentLocation: string,
  cityByName: ReadonlyMap<string, City>,
  availableCityNames: readonly string[],
): string[] {
  const availableCitySet = new Set(
    availableCityNames.filter((cityName) => cityName !== currentLocation),
  );
  const neighboringCityNames =
    cityByName
      .get(currentLocation)
      ?.neighboringCities.filter((cityName) =>
        availableCitySet.has(cityName)) ?? [];
  const fallbackCityNames = availableCityNames.filter(
    (cityName) => cityName !== currentLocation,
  );

  return neighboringCityNames.length > 0
    ? [...new Set(neighboringCityNames)]
    : [...new Set(fallbackCityNames)];
}

function cloneShowtimeDays(
  showtimeDays: readonly MovieShowtimeDay[],
): MovieShowtimeDay[] {
  return showtimeDays.map((day) => ({
    date: day.date,
    theaters: day.theaters.map((theater) => ({
      theater: theater.theater,
      showtimes: theater.showtimes.map((showtime) => ({
        time: showtime.time,
        href: showtime.href,
        screeningTech: showtime.screeningTech,
        screeningType: showtime.screeningType,
        dubLanguage: showtime.dubLanguage,
      })),
    })),
  }));
}

function getShowtimeTechLabel(screeningTech: string): string | null {
  const normalizedValue = screeningTech.trim().replace(/\s+/g, " ");

  if (!normalizedValue) {
    return null;
  }

  const strippedValue = normalizedValue.replace(/^2D\b[\s/-]*/i, "").trim();
  const comparableValue = strippedValue.toUpperCase();

  if (!strippedValue || comparableValue === "REGULAR") {
    return null;
  }

  return strippedValue;
}

function getDubFlagSrc(dubLanguage: string | null | undefined): string | null {
  switch (dubLanguage?.trim()) {
    case "Hebrew":
      return "/flags/israel.svg";
    case "French":
      return "/flags/france.svg";
    default:
      return null;
  }
}

function getDubBadgeLabel(
  dubLanguage: string | null | undefined,
): string | null {
  const normalizedValue = dubLanguage?.trim().replace(/\s+/g, " ") ?? "";

  return normalizedValue ? `${normalizedValue} Dub` : null;
}

function getScreeningTypeBadgeLabel(screeningType: string): string | null {
  const normalizedValue = screeningType.trim().replace(/\s+/g, " ");

  if (!normalizedValue || normalizedValue.toLowerCase() === "regular") {
    return null;
  }

  return normalizedValue;
}

export function MovieDetailsContent({
  movie,
  titleId,
  posterRef,
  posterClassName = "details-poster",
  eyebrow = "Now playing",
  variant = "nowPlaying",
  preferredShowtimeDate = null,
  onPreferredShowtimeDateChange,
}: MovieDetailsContentProps) {
  const { sources, location, setLocationPreference } =
    useUserPreferencesContext();
  const showtimesReady = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesReady,
  );
  const showtimesVersion = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesVersion,
  );
  const [cities, setCities] = useState<readonly City[]>([]);
  const [openTrailerModalId, setOpenTrailerModalId] = useState<string | null>(
    null,
  );
  const [pendingNearbyCity, setPendingNearbyCity] = useState<string | null>(
    null,
  );
  const previousShowtimeLocationRef = useRef(location);
  const requestedShowtimePrefetchRef = useRef<string | null>(null);
  const infoParts = getMovieInfoParts(movie);
  const metaParts =
    movie.genres.length > 0
      ? [...infoParts, movie.genres.join(", ")]
      : infoParts;
  const releaseDateLabel =
    variant === "comingSoon" && movie.releaseDate
      ? formatReleaseDate(movie.releaseDate)
      : null;
  const showtimeDays = useMemo(() => {
    if (variant !== "nowPlaying") {
      return EMPTY_SHOWTIME_DAYS;
    }

    // Incremental showtime loading updates the shared store in place, so this
    // version token is the signal that cached day data should be re-cloned.
    void showtimesVersion;
    return cloneShowtimeDays(getMovieShowtimeDays(movie.tmdbId, location));
  }, [location, movie.tmdbId, showtimesVersion, variant]);
  const metrics =
    variant === "nowPlaying" ? getMetricDisplays(movie, sources) : [];
  const trailerEmbedUrl = getTrailerEmbedUrl(movie.trailerKey);
  const trailerModalId = `${variant}:${movie.tmdbId}`;
  const targetShowtimeDate = getShowtimeTargetDate(
    showtimeDays,
    preferredShowtimeDate,
  );
  const cityByName = useMemo(
    () => new Map(cities.map((city) => [city.name, city] as const)),
    [cities],
  );
  const hasLoadedShowtimeWindow =
    variant === "nowPlaying" && showtimesReady && showtimeDays.length > 0;
  const hasLoadedCompleteShowtimeWindow =
    hasLoadedShowtimeWindow && showtimeDays.length >= SHOWTIME_WINDOW_DAY_COUNT;
  const firstCityShowtimeDate = hasLoadedShowtimeWindow
    ? getFirstShowtimeDate(showtimeDays)
    : null;
  const hasAnyShowtimesInSelectedCity = firstCityShowtimeDate !== null;
  const hasTodayShowtimes =
    hasLoadedShowtimeWindow && showtimeDays[0]?.theaters.length > 0;
  const shouldShowCityUnavailableState =
    hasLoadedCompleteShowtimeWindow && !hasAnyShowtimesInSelectedCity;
  const shouldShowSkipToShowingDayButton =
    hasLoadedShowtimeWindow &&
    !hasTodayShowtimes &&
    firstCityShowtimeDate !== null &&
    firstCityShowtimeDate !== fixedAppDateString;
  const effectiveVisibleShowtimeDate = targetShowtimeDate;
  const selectedShowtimeDay =
    showtimeDays.find((day) => day.date === effectiveVisibleShowtimeDate) ??
    showtimeDays[0] ??
    null;
  const showtimeFilterState = useSyncExternalStore(
    subscribeToShowtimeFilters,
    getShowtimeFiltersSnapshot,
    getShowtimeFiltersSnapshot,
  );
  const allLoadedTheaters = useMemo(
    () => showtimeDays.flatMap((day) => day.theaters),
    [showtimeDays],
  );
  const showtimeFilterOptions = useMemo<ShowtimeFilterOptions>(
    () =>
      allLoadedTheaters.length > 0
        ? getShowtimeFilterOptions(allLoadedTheaters)
        : {
            showType: [],
            screenFormat: [],
            screeningTech: [],
            dubLanguage: ["Hebrew", "French"],
          },
    [allLoadedTheaters],
  );
  const showtimeFilterSelections = useMemo<ShowtimeFilterSelections>(
    () =>
      buildShowtimeFilterSelections(showtimeFilterOptions, showtimeFilterState),
    [showtimeFilterOptions, showtimeFilterState],
  );
  const filteredSelectedShowtimeDay = useMemo(
    () =>
      selectedShowtimeDay
        ? {
            ...selectedShowtimeDay,
            theaters: filterTheatersBySelections(
              selectedShowtimeDay.theaters,
              showtimeFilterSelections,
            ),
          }
        : null,
    [selectedShowtimeDay, showtimeFilterSelections],
  );
  const hasFilteredOutAllSelectedShowtimes =
    selectedShowtimeDay !== null &&
    selectedShowtimeDay.theaters.length > 0 &&
    filteredSelectedShowtimeDay !== null &&
    filteredSelectedShowtimeDay.theaters.length === 0;
  const handleShowtimeFilterToggle = useCallback(
    (group: keyof ShowtimeFilterOptions, value: string) => {
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };
      const groupSet = nextSelections[group];
      const checked = groupSet.has(value);

      if (checked) {
        groupSet.delete(value);
      } else {
        groupSet.add(value);
      }

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      saveShowtimeFilters(nextState);
    },
    [showtimeFilterOptions, showtimeFilterSelections, showtimeFilterState],
  );
  const handleShowtimeFilterGroupToggle = useCallback(
    (group: keyof ShowtimeFilterOptions) => {
      const groupOptions = showtimeFilterOptions[group];
      const currentSelected = showtimeFilterSelections[group];
      const areAllSelected =
        groupOptions.length > 0 &&
        groupOptions.every((value) => currentSelected.has(value));
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };

      nextSelections[group] = areAllSelected
        ? new Set()
        : new Set(groupOptions);

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      saveShowtimeFilters(nextState);
    },
    [showtimeFilterOptions, showtimeFilterSelections, showtimeFilterState],
  );
  const effectiveSelectedShowtimeDay =
    filteredSelectedShowtimeDay ?? selectedShowtimeDay;
  const shouldShowTodayReturnButton =
    shouldShowSkipToShowingDayButton &&
    effectiveVisibleShowtimeDate !== null &&
    effectiveVisibleShowtimeDate !== fixedAppDateString &&
    effectiveVisibleShowtimeDate >= firstCityShowtimeDate;
  const showtimeJumpTargetDate = shouldShowTodayReturnButton
    ? fixedAppDateString
    : firstCityShowtimeDate;
  const showtimeJumpButtonLabel = shouldShowTodayReturnButton
    ? "BACK TO TODAY"
    : "Skip to showing day";
  const shouldShowDayPicker =
    hasLoadedShowtimeWindow &&
    showtimeDays.length > 0 &&
    !shouldShowCityUnavailableState;
  const playingCities = useMemo(
    () =>
      hasLoadedShowtimeWindow ? [...getMovieShowtimeCities(movie.tmdbId)] : [],
    [hasLoadedShowtimeWindow, movie.tmdbId],
  );
  const nearbyCityChoices = useMemo<NearbyCityChoice[]>(() => {
    if (!hasLoadedShowtimeWindow || playingCities.length === 0) {
      return [];
    }

    return getOrderedNearbyCityNames(
      location,
      cityByName,
      playingCities,
    ).flatMap((cityName) => {
      const cityShowtimeDays = getMovieShowtimeDays(movie.tmdbId, cityName);
      const selectedDayShowtimeDate =
        effectiveVisibleShowtimeDate &&
        cityShowtimeDays.some(
          (day) =>
            day.date === effectiveVisibleShowtimeDate &&
            day.theaters.length > 0,
        )
          ? effectiveVisibleShowtimeDate
          : null;
      const firstShowtimeDate = getFirstShowtimeDate(cityShowtimeDays);
      const targetDate = selectedDayShowtimeDate ?? firstShowtimeDate;

      return targetDate ? [{ name: cityName, targetDate }] : [];
    });
  }, [
    cityByName,
    effectiveVisibleShowtimeDate,
    hasLoadedShowtimeWindow,
    location,
    movie.tmdbId,
    playingCities,
  ]);
  const isTrailerModalOpen =
    Boolean(trailerEmbedUrl) && openTrailerModalId === trailerModalId;
  const hasTrailerLaunch = variant === "nowPlaying" && Boolean(trailerEmbedUrl);
  const hasMetrics = metrics.length > 0;
  const renderMetricsRow = (className?: string) => {
    if (variant !== "nowPlaying" || (!hasTrailerLaunch && !hasMetrics)) {
      return null;
    }

    return (
      <div
        className={["details-metrics-row", className].filter(Boolean).join(" ")}
      >
        {hasTrailerLaunch ? (
          <button
            type="button"
            className="details-trailer-launch details-trailer-launch--metrics"
            aria-label={`Watch ${movie.title} trailer`}
            onClick={() => {
              setOpenTrailerModalId(trailerModalId);
            }}
          >
            <img
              src="/logos/youtube.svg"
              alt=""
              className="details-trailer-launch-logo"
              width={28}
              height={20}
              decoding="async"
            />
          </button>
        ) : null}

        {hasTrailerLaunch && hasMetrics ? (
          <span className="details-metrics-divider" aria-hidden="true" />
        ) : null}

        {hasMetrics ? (
          <div className="details-metrics">
            {metrics.map((metric) => (
              <div
                key={metric.key}
                className="details-metric"
                aria-label={metric.ariaLabel}
              >
                <div className="details-metric-marker">
                  {metric.href ? (
                    <a
                      href={metric.href}
                      target="_blank"
                      rel="noreferrer"
                      className="details-metric-link"
                      aria-label={metric.linkAriaLabel}
                    >
                      <img
                        src={metric.logoSrc}
                        alt=""
                        className={metric.logoClassName}
                        decoding="async"
                      />
                    </a>
                  ) : (
                    <img
                      src={metric.logoSrc}
                      alt=""
                      className={metric.logoClassName}
                      decoding="async"
                    />
                  )}
                </div>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  const renderNoShowtimesState = (title: string) => (
    <div className="details-empty-state" aria-label={title}>
      <div className="details-empty-state-panel">
        <p className="details-empty-state-title">{title}</p>

        <div className="details-empty-actions">
          <Link to="/showtimes" className="details-empty-link">
            <span className="details-empty-link-copy">
              <Clock8
                size={16}
                strokeWidth={2.1}
                className="details-empty-link-icon"
                aria-hidden="true"
              />
              <span>See all showtimes in {location}</span>
            </span>
            <MoveRight
              size={16}
              strokeWidth={2.2}
              className="details-empty-link-arrow"
              aria-hidden="true"
            />
          </Link>

          <div
            className="details-empty-nearby"
            aria-busy={pendingNearbyCity ? "true" : undefined}
          >
            <p className="details-empty-link-heading">
              See where {movie.title} is playing near you
            </p>

            {nearbyCityChoices.length > 0 ? (
              <div
                className="details-empty-city-list"
                aria-label={`Cities where ${movie.title} is playing`}
              >
                {nearbyCityChoices.map((city) => (
                  <button
                    key={city.name}
                    type="button"
                    className="details-empty-city-button"
                    disabled={pendingNearbyCity !== null}
                    onClick={() => {
                      void handleNearbyCityClick(city.name, city.targetDate);
                    }}
                  >
                    <MapPin
                      size={14}
                      strokeWidth={2.2}
                      className="details-empty-city-icon"
                      aria-hidden="true"
                    />
                    <span>
                      {pendingNearbyCity === city.name
                        ? `Switching to ${city.name}...`
                        : city.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="details-empty-note">
                No scheduled showtimes in the current window.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const scrollRailToDate = useCallback(
    (date: string) => {
      if (!showtimeDays.some((day) => day.date === date)) {
        return;
      }

      onPreferredShowtimeDateChange?.(date);
    },
    [onPreferredShowtimeDateChange, showtimeDays],
  );

  const handleShowtimePreviewDateChange = useCallback(
    (date: string) => {
      if (variant !== "nowPlaying") {
        return;
      }

      const previewDayIndex = showtimeDays.findIndex(
        (day) => day.date === date,
      );
      const nextDayCount = getNextShowtimePrefetchDayCount(
        showtimeDays.length,
        previewDayIndex,
      );

      if (nextDayCount === null) {
        return;
      }

      const requestKey = `${location}:${nextDayCount}`;

      if (requestedShowtimePrefetchRef.current === requestKey) {
        return;
      }

      requestedShowtimePrefetchRef.current = requestKey;
      void loadAdditionalShowtimeDays(location, nextDayCount).catch(() => {
        if (requestedShowtimePrefetchRef.current === requestKey) {
          requestedShowtimePrefetchRef.current = null;
        }
      });
    },
    [location, showtimeDays, variant],
  );

  const handleShowtimeJumpClick = useCallback(() => {
    if (!showtimeJumpTargetDate) {
      return;
    }

    scrollRailToDate(showtimeJumpTargetDate);
  }, [scrollRailToDate, showtimeJumpTargetDate]);

  const handleNearbyCityClick = useCallback(
    async (cityName: string, nextShowtimeDate: string) => {
      const previousDate =
        effectiveVisibleShowtimeDate ??
        targetShowtimeDate ??
        fixedAppDateString;

      setPendingNearbyCity(cityName);
      onPreferredShowtimeDateChange?.(nextShowtimeDate);

      let didSave: boolean;

      try {
        didSave = await setLocationPreference(cityName);
      } catch {
        didSave = false;
      } finally {
        setPendingNearbyCity((current) =>
          current === cityName ? null : current);
      }

      if (!didSave) {
        onPreferredShowtimeDateChange?.(previousDate);
      }
    },
    [
      effectiveVisibleShowtimeDate,
      onPreferredShowtimeDateChange,
      setLocationPreference,
      targetShowtimeDate,
    ],
  );

  useEffect(() => {
    if (variant !== "nowPlaying") {
      return;
    }

    if (previousShowtimeLocationRef.current === location) {
      return;
    }

    previousShowtimeLocationRef.current = location;
    void loadShowtimesAroundDate(
      location,
      preferredShowtimeDate ?? fixedAppDateString,
    ).catch((error: unknown) => {
      console.error("Could not load showtimes for the selected city.", error);
    });
  }, [location, preferredShowtimeDate, variant]);

  useEffect(() => {
    if (variant !== "nowPlaying") {
      return;
    }

    let isActive = true;

    void loadCities()
      .then((nextCities) => {
        if (isActive) {
          setCities(nextCities);
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load city metadata for detail cards.", error);
      });

    return () => {
      isActive = false;
    };
  }, [variant]);

  useEffect(() => {
    if (
      variant !== "nowPlaying" ||
      !showtimesReady ||
      showtimeDays.length === 0 ||
      showtimeDays.length > INITIAL_SHOWTIME_WINDOW_DAY_COUNT
    ) {
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const nextDayCount = Math.min(
      SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
      SHOWTIME_WINDOW_DAY_COUNT,
    );
    const requestMoreDays = () => {
      void loadAdditionalShowtimeDays(location, nextDayCount).catch(() => {});
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          requestMoreDays();
        },
        { timeout: 1800 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        requestMoreDays();
      }, 700);
    }

    return () => {
      if (
        idleId !== null &&
        typeof windowWithIdleCallbacks.cancelIdleCallback === "function"
      ) {
        windowWithIdleCallbacks.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [location, showtimeDays.length, showtimesReady, variant]);

  useEffect(() => {
    if (!isTrailerModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenTrailerModalId(null);
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isTrailerModalOpen]);

  const trailerModal =
    isTrailerModalOpen && trailerEmbedUrl && typeof document !== "undefined"
      ? createPortal(
          <div
            className="movie-trailer-modal"
            data-movie-scroller-detail-overlay="true"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setOpenTrailerModalId(null);
              }
            }}
          >
            <div
              className="movie-trailer-modal-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={`${movie.title} trailer`}
            >
              <button
                type="button"
                className="movie-trailer-modal-close"
                aria-label="Close trailer"
                onClick={() => {
                  setOpenTrailerModalId(null);
                }}
              >
                <X size={20} strokeWidth={2.6} />
              </button>
              <div className="movie-trailer-modal-frame">
                <iframe
                  src={`${trailerEmbedUrl}&autoplay=1`}
                  title={`${movie.title} trailer`}
                  loading="eager"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div className="details-hero">
        <div className="details-media-column">
          <div className="details-poster-shell">
            <MoviePosterArtwork
              ref={posterRef}
              title={movie.title}
              imageSrc={movie.imageSrc}
              alt={movie.title}
              className={posterClassName}
              draggable={false}
            />
          </div>
        </div>

        <div className="details-copy">
          <p className="details-eyebrow">{eyebrow}</p>
          <h2 id={titleId} className="details-title">
            {movie.title}
          </h2>
          {metaParts.length > 0 ? (
            <div className="details-subtitle details-subtitle--meta-row">
              {metaParts.map((part) => (
                <span
                  key={`${movie.tmdbId}-meta-${part}`}
                  className="details-subtitle-item"
                >
                  {part}
                </span>
              ))}
            </div>
          ) : null}

          {releaseDateLabel ? (
            <p className="details-release-date">
              Release date: {releaseDateLabel}
            </p>
          ) : null}

          {renderMetricsRow("details-metrics-row--copy")}
        </div>

        {renderMetricsRow("details-metrics-row--mobile")}
      </div>

      {variant === "nowPlaying" ? (
        <div
          className="details-showtimes"
          data-movie-scroller-swipe-ignore="true"
        >
          {shouldShowDayPicker ? (
            <div className="details-day-picker-shell">
              <TheaterMapDialog
                className="details-day-picker-city city-map-trigger"
                triggerLabel={location}
              />
              <ShowtimeDayPicker
                ariaLabel={`Choose ${movie.title} showtime day`}
                dates={showtimeDays.map((day) => day.date)}
                selectedDate={effectiveVisibleShowtimeDate}
                disabledBeforeDate={fixedAppDateString}
                onPreviewDateChange={handleShowtimePreviewDateChange}
                onSelect={(date) => {
                  scrollRailToDate(date);
                }}
              />
              <ShowtimeFilterMenu
                className="details-day-picker-filter"
                options={showtimeFilterOptions}
                selections={showtimeFilterSelections}
                onToggleOption={handleShowtimeFilterToggle}
                onToggleGroup={handleShowtimeFilterGroupToggle}
              />
            </div>
          ) : null}

          {shouldShowCityUnavailableState ? (
            renderNoShowtimesState(`Movie not playing in ${location}`)
          ) : (
            <div
              className="details-rail"
              aria-label={`${movie.title} showtimes in ${location}`}
            >
              {effectiveSelectedShowtimeDay ? (
                <article
                  className="details-day-panel"
                  data-showtime-date={effectiveSelectedShowtimeDay.date}
                  key={effectiveSelectedShowtimeDay.date}
                >
                  <>
                    {shouldShowSkipToShowingDayButton ? (
                      <div className="details-day-header">
                        <button
                          type="button"
                          className="details-day-jump-button"
                          onClick={handleShowtimeJumpClick}
                        >
                          {showtimeJumpButtonLabel}
                        </button>
                      </div>
                    ) : null}

                    {effectiveSelectedShowtimeDay.theaters.length === 0 ? (
                      renderNoShowtimesState(
                        hasFilteredOutAllSelectedShowtimes
                          ? `No showtimes match current filters on ${getShowtimeDateLabel(effectiveSelectedShowtimeDay.date)} in ${location}`
                          : `No showtimes on ${getShowtimeDateLabel(effectiveSelectedShowtimeDay.date)} in ${location}`,
                      )
                    ) : (
                      <div className="details-theaters">
                        {effectiveSelectedShowtimeDay.theaters.map((
                          theater,
                          theaterIndex,
                        ) => {
                          const colors = getTheaterTheme(
                            theater.theater,
                            theaterIndex,
                          );

                          return (
                            <section
                              className="details-theater"
                              key={theater.theater}
                            >
                              <div className="details-theater-name">
                                <span
                                  className="details-theater-dot"
                                  style={{
                                    backgroundColor: colors.accent,
                                    boxShadow: `0 0 18px ${colors.glow}`,
                                  }}
                                />
                                <span>{theater.theater}</span>
                              </div>

                              <div className="details-time-grid">
                                {theater.showtimes.map((showtime) => {
                                  const showtimeTech = getShowtimeTechLabel(
                                    showtime.screeningTech,
                                  );
                                  const dubFlagSrc = getDubFlagSrc(
                                    showtime.dubLanguage,
                                  );
                                  const dubBadgeLabel = getDubBadgeLabel(
                                    showtime.dubLanguage,
                                  );
                                  const screeningTypeBadgeLabel =
                                    getScreeningTypeBadgeLabel(
                                      showtime.screeningType,
                                    );
                                  const showtimeSlotClassName = [
                                    "details-showtime-slot",
                                    showtimeTech
                                      ? "details-showtime-slot--with-tech"
                                      : null,
                                    dubFlagSrc
                                      ? "details-showtime-slot--with-flag"
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimeCardClassName = [
                                    "details-showtime-card",
                                    showtime.href
                                      ? "details-showtime-card--link"
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimePillClassName = [
                                    "details-time-pill",
                                    colors.pillClassName,
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  const showtimeCardStyle = colors.pillClassName
                                    ? undefined
                                    : {
                                        background:
                                          colors.pillBackground ??
                                          `linear-gradient(180deg, color-mix(in srgb, ${colors.accent} 88%, white 12%), color-mix(in srgb, ${colors.accent} 72%, black 28%))`,
                                      };
                                  const showtimeLabel = [
                                    `Open ${movie.title} ${showtime.time} showtime at ${theater.theater}`,
                                    showtimeTech,
                                    screeningTypeBadgeLabel,
                                    dubBadgeLabel,
                                  ]
                                    .filter(Boolean)
                                    .join(", ");
                                  const key = [
                                    theater.theater,
                                    effectiveSelectedShowtimeDay.date,
                                    showtime.time,
                                    showtime.screeningTech,
                                    showtime.screeningType,
                                    showtime.dubLanguage ?? "original",
                                  ].join("-");
                                  const showtimeCard = showtime.href ? (
                                    <a
                                      href={showtime.href}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={showtimeCardClassName}
                                      aria-label={showtimeLabel}
                                    >
                                      {showtimeTech ? (
                                        <span
                                          className="details-showtime-tech"
                                          aria-hidden="true"
                                        >
                                          {showtimeTech}
                                        </span>
                                      ) : null}

                                      <div className="details-time-card-shell">
                                        <span
                                          className={showtimePillClassName}
                                          style={showtimeCardStyle}
                                        >
                                          {dubFlagSrc && dubBadgeLabel ? (
                                            <span className="details-time-pill-flag-shell">
                                              <img
                                                src={dubFlagSrc}
                                                alt=""
                                                className="details-time-pill-flag"
                                                width={17}
                                                height={13}
                                                decoding="async"
                                              />
                                              <span className="details-time-pill-flag-tooltip">
                                                {dubBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          {screeningTypeBadgeLabel ? (
                                            <span className="details-time-pill-type-shell">
                                              <Star
                                                size={10}
                                                strokeWidth={2.2}
                                                className="details-time-pill-type-icon"
                                                aria-hidden="true"
                                              />
                                              <span className="details-time-pill-type-tooltip">
                                                {screeningTypeBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          <span className="details-time-pill-label">
                                            {showtime.time}
                                          </span>
                                        </span>
                                      </div>
                                    </a>
                                  ) : (
                                    <span
                                      className={showtimeCardClassName}
                                      aria-label={showtimeLabel}
                                    >
                                      {showtimeTech ? (
                                        <span
                                          className="details-showtime-tech"
                                          aria-hidden="true"
                                        >
                                          {showtimeTech}
                                        </span>
                                      ) : null}

                                      <div className="details-time-card-shell">
                                        <span
                                          className={showtimePillClassName}
                                          style={showtimeCardStyle}
                                        >
                                          {dubFlagSrc && dubBadgeLabel ? (
                                            <span className="details-time-pill-flag-shell">
                                              <img
                                                src={dubFlagSrc}
                                                alt=""
                                                className="details-time-pill-flag"
                                                width={17}
                                                height={13}
                                                decoding="async"
                                              />
                                              <span className="details-time-pill-flag-tooltip">
                                                {dubBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          {screeningTypeBadgeLabel ? (
                                            <span className="details-time-pill-type-shell">
                                              <Star
                                                size={10}
                                                strokeWidth={2.2}
                                                className="details-time-pill-type-icon"
                                                aria-hidden="true"
                                              />
                                              <span className="details-time-pill-type-tooltip">
                                                {screeningTypeBadgeLabel}
                                              </span>
                                            </span>
                                          ) : null}
                                          <span className="details-time-pill-label">
                                            {showtime.time}
                                          </span>
                                        </span>
                                      </div>
                                    </span>
                                  );

                                  return (
                                    <div
                                      key={key}
                                      className={showtimeSlotClassName}
                                    >
                                      {showtimeCard}
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                    )}
                  </>
                </article>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <section
          className="details-showtimes details-showtimes--trailer"
          data-movie-scroller-swipe-ignore="true"
          aria-label={`${movie.title} trailer`}
        >
          {trailerEmbedUrl ? (
            <div className="details-trailer-shell">
              <div className="details-trailer-frame">
                <iframe
                  src={trailerEmbedUrl}
                  title={`${movie.title} official trailer`}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          ) : (
            <p className="details-showtime-empty">Trailer not available yet.</p>
          )}
        </section>
      )}
      {trailerModal}
    </>
  );
}
