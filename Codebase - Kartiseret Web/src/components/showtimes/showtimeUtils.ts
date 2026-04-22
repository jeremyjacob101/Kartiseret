import { APP_TIME_ZONE, fixedAppDateString, type Movie, type MovieShowtimeDay } from "../../data/movieCatalog";
import { type RatingSource } from "../../prefs/definitions/ratingSources";

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

export type ShowtimeDateEntry = {
  date: string;
};

export type MetricDisplay = {
  key: RatingSource;
  value: string;
  ariaLabel: string;
  logoSrc: string;
  href?: string;
  linkAriaLabel?: string;
  logoClassName?: string;
};

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

function hasRating(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPercent(value: number | null | undefined): string {
  return hasRating(value) ? `${Math.round(value)}%` : "—";
}

function formatDecimalRating(value: number | null | undefined): string {
  return hasRating(value) ? value.toFixed(1) : "—";
}

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
        value: formatDecimalRating(movie.tmdbRating),
        ariaLabel: hasRating(movie.tmdbRating)
          ? `TMDB rating ${movie.tmdbRating.toFixed(1)}`
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

export function formatRuntime(runtime: number): string {
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

export function getMovieInfoParts(movie: Movie): string[] {
  const parts: string[] = [];

  if (movie.year > 0) {
    parts.push(String(movie.year));
  }

  if (movie.runtime > 0) {
    parts.push(formatRuntime(movie.runtime));
  }

  return parts;
}

export function getShowtimeDateLabel(dateString: string): string {
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

export function formatReleaseDate(dateString: string): string {
  const releaseDate = parseLocalDate(dateString);

  return Number.isNaN(releaseDate.getTime())
    ? dateString
    : releaseDateFormatter.format(releaseDate);
}

export function extractYouTubeVideoKey(
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

export function getTrailerEmbedUrl(
  trailerValue: string | null | undefined,
): string | null {
  const videoKey = extractYouTubeVideoKey(trailerValue);

  if (!videoKey) {
    return null;
  }

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?rel=0&modestbranding=1&playsinline=1`;
}

export function getMetricDisplays(
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

export function getShowtimeTargetDate(
  showtimeDays: readonly ShowtimeDateEntry[],
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

export function getFirstShowtimeDate(
  showtimeDays: readonly MovieShowtimeDay[],
): string | null {
  return showtimeDays.find((day) => day.theaters.length > 0)?.date ?? null;
}

export function getScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "auto";
  }

  return "smooth";
}

export function findShowtimePanel(
  rail: HTMLDivElement,
  date: string,
): HTMLElement | null {
  for (const child of Array.from(rail.children)) {
    if (child instanceof HTMLElement && child.dataset.showtimeDate === date) {
      return child;
    }
  }

  return null;
}

export function getNearestShowtimeDate(
  rail: HTMLDivElement,
  showtimeDays: readonly ShowtimeDateEntry[],
): string | null {
  let nearestDate = showtimeDays[0]?.date ?? null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const child of Array.from(rail.children)) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }

    const panelDate = child.dataset.showtimeDate;

    if (!panelDate) {
      continue;
    }

    const distance = Math.abs(child.offsetLeft - rail.scrollLeft);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestDate = panelDate;
    }
  }

  return nearestDate;
}

export function cloneShowtimeDays(
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
