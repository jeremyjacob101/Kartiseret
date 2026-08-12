import { APP_TIME_ZONE, fixedAppDateString, type Movie, type MovieShowtimeDay } from "../../data/movieCatalog";
import { type RatingSource } from "../../prefs/definitions/ratingSources";
import type { AppLocale } from "../../i18n/locale";
import { translateMessage } from "../../i18n/messages";

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

function formatTmdbRating(value: number | null | undefined): string {
  return hasRating(value) ? Number(value.toFixed(1)).toString() : "—";
}

function getCriticBadge(
  score: number | null,
  votes: number | null,
  locale: AppLocale,
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
      description: translateMessage(locale, "rating.certifiedFresh"),
    };
  }

  return score >= RT_CRITIC_FRESH_MIN_SCORE
    ? {
        src: "/logos/rtCriticGood.svg",
        description: translateMessage(locale, "rating.fresh"),
      }
    : {
        src: "/logos/rtCriticBad.svg",
        description: translateMessage(locale, "rating.rotten"),
      };
}

function getAudienceBadge(
  score: number | null,
  votes: number | null,
  locale: AppLocale,
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
      description: translateMessage(locale, "rating.verifiedHot"),
    };
  }

  return score >= RT_AUDIENCE_POSITIVE_MIN_SCORE
    ? {
        src: "/logos/rtAudienceGood.svg",
        description: translateMessage(locale, "rating.fullPopcorn"),
      }
    : {
        src: "/logos/rtAudienceBad.svg",
        description: translateMessage(locale, "rating.spilledPopcorn"),
      };
}

function getMetricDisplay(
  movie: Movie,
  source: RatingSource,
  criticBadge: { src: string; description: string } | null,
  audienceBadge: { src: string; description: string } | null,
  locale: AppLocale,
): MetricDisplay {
  switch (source) {
    case "imdbRating":
      return {
        key: "imdbRating",
        value: formatDecimalRating(movie.imdbRating),
        ariaLabel: hasRating(movie.imdbRating)
          ? translateMessage(locale, "rating.imdb", {
              value: movie.imdbRating.toFixed(1),
            })
          : translateMessage(locale, "rating.imdbUnavailable"),
        logoSrc: "/logos/imdb.svg",
        href: getImdbUrl(movie) ?? undefined,
        linkAriaLabel: translateMessage(locale, "movie.openOn", {
          title: movie.title,
          service: "IMDb",
        }),
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
          ? `${translateMessage(locale, "rating.rtAudience", {
              value: formatPercent(movie.rtAudienceRating),
            })}, ${audienceBadge.description}`
          : translateMessage(locale, "rating.rtAudienceUnavailable"),
        logoSrc,
        href: getRottenTomatoesUrl(movie) ?? undefined,
        linkAriaLabel: translateMessage(locale, "movie.openOn", {
          title: movie.title,
          service: "Rotten Tomatoes",
        }),
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
          ? `${translateMessage(locale, "rating.rtCritic", {
              value: formatPercent(movie.rtCriticRating),
            })}, ${criticBadge.description}`
          : translateMessage(locale, "rating.rtCriticUnavailable"),
        logoSrc,
        href: getRottenTomatoesUrl(movie) ?? undefined,
        linkAriaLabel: translateMessage(locale, "movie.openOn", {
          title: movie.title,
          service: "Rotten Tomatoes",
        }),
        logoClassName,
      };
    }
    case "lbRating":
      return {
        key: "lbRating",
        value: formatDecimalRating(movie.lbRating),
        ariaLabel: hasRating(movie.lbRating)
          ? translateMessage(locale, "rating.letterboxd", {
              value: movie.lbRating.toFixed(1),
            })
          : translateMessage(locale, "rating.letterboxdUnavailable"),
        logoSrc: "/logos/letterboxd.svg",
        href: getLetterboxdUrl(movie) ?? undefined,
        linkAriaLabel: translateMessage(locale, "movie.openOn", {
          title: movie.title,
          service: "Letterboxd",
        }),
        logoClassName: "details-metric-logo details-metric-logo--letterboxd",
      };
    case "tmdbRating":
      return {
        key: "tmdbRating",
        value: formatTmdbRating(movie.tmdbRating),
        ariaLabel: hasRating(movie.tmdbRating)
          ? translateMessage(locale, "rating.tmdb", {
              value: formatTmdbRating(movie.tmdbRating),
            })
          : translateMessage(locale, "rating.tmdbUnavailable"),
        logoSrc: "/logos/tmdb.svg",
        href: getTmdbUrl(movie),
        linkAriaLabel: translateMessage(locale, "movie.openOn", {
          title: movie.title,
          service: "TMDB",
        }),
        logoClassName: "details-metric-logo details-metric-logo--tmdb",
      };
    default: {
      const neverSource: never = source;
      throw new Error(`Unsupported rating source: ${String(neverSource)}`);
    }
  }
}

export function formatRuntime(runtime: number, locale: AppLocale): string {
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (hours === 0) {
    return translateMessage(locale, "movie.runtimeMinutes", { minutes });
  }

  return translateMessage(locale, "movie.runtimeHoursMinutes", {
    hours,
    minutes,
  });
}

export function getMovieInfoParts(movie: Movie, locale: AppLocale): string[] {
  const parts: string[] = [];

  if (movie.year > 0) {
    parts.push(String(movie.year));
  }

  if (movie.runtime > 0) {
    parts.push(formatRuntime(movie.runtime, locale));
  }

  return parts;
}

export function getShowtimeDateLabel(
  dateString: string,
  locale: AppLocale,
): string {
  const showDate = parseShowtimeDate(dateString);
  const today = parseShowtimeDate(fixedAppDateString);
  const dayOffset = Math.round(
    (showDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayOffset === 0) {
    return translateMessage(locale, "showtimes.today");
  }

  if (dayOffset === 1) {
    return translateMessage(locale, "showtimes.tomorrow");
  }

  return new Intl.DateTimeFormat(locale, {
    timeZone: APP_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(showDate);
}

export function formatReleaseDate(
  dateString: string,
  locale: AppLocale,
): string {
  const releaseDate = parseLocalDate(dateString);

  return Number.isNaN(releaseDate.getTime())
    ? dateString
    : new Intl.DateTimeFormat(locale, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(releaseDate);
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
  locale: AppLocale,
): MetricDisplay[] {
  const criticBadge = getCriticBadge(
    movie.rtCriticRating,
    movie.rtCriticVotes,
    locale,
  );
  const audienceBadge = getAudienceBadge(
    movie.rtAudienceRating,
    movie.rtAudienceVotes,
    locale,
  );

  return selectedSources.map((source) =>
    getMetricDisplay(movie, source, criticBadge, audienceBadge, locale));
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
        localizedHrefs: showtime.localizedHrefs,
        screeningTech: showtime.screeningTech,
        screeningType: showtime.screeningType,
        dubLanguage: showtime.dubLanguage,
      })),
    })),
  }));
}
