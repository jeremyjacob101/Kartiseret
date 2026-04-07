import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Ref } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { MoviePosterArtwork } from "../MoviePosterArtwork";
import { fixedAppDateString, getMovieCatalogStatusSnapshot, getMovieShowtimeDays, subscribeToMovieCatalog, type Movie, type MovieShowtimeDay } from "../../data/movieCatalog";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";
import { type RatingSource } from "../../prefs/definitions/ratingSources";

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

function getShowtimeDateLabel(dateString: string): string {
  const showDate = parseLocalDate(dateString);
  const today = parseLocalDate(fixedAppDateString);
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

function getTmdbUrl(movie: Movie): string | null {
  const tmdbId = movie.tmdbId?.trim();

  if (!tmdbId) {
    return null;
  }

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
        value: movie.imdbRating.toFixed(1),
        ariaLabel: `IMDb rating ${movie.imdbRating.toFixed(1)}`,
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
        href: getTmdbUrl(movie) ?? undefined,
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

function findShowtimePanel(
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

function getNearestShowtimeDate(
  rail: HTMLDivElement,
  showtimeDays: readonly MovieShowtimeDay[],
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
        dubLanguage: showtime.dubLanguage,
      })),
    })),
  }));
}

function getShowtimeTechLabel(
  screeningTech: string | null | undefined,
): string | null {
  const normalizedValue = screeningTech?.trim().replace(/\s+/g, " ") ?? "";

  if (!normalizedValue) {
    return null;
  }

  const strippedValue = normalizedValue
    .replace(/^2D\b[\s/-]*/i, "")
    .trim();
  const comparableValue = strippedValue.toUpperCase();

  if (!strippedValue || comparableValue === "REGULAR") {
    return null;
  }

  return strippedValue;
}

function isHebrewDub(dubLanguage: string | null | undefined): boolean {
  const normalizedValue = dubLanguage?.trim().toLowerCase() ?? "";

  return normalizedValue.includes("hebrew") || normalizedValue.includes("עברית");
}

function getDubBadgeLabel(
  dubLanguage: string | null | undefined,
): string | null {
  const normalizedValue = dubLanguage?.trim().replace(/\s+/g, " ") ?? "";

  return normalizedValue ? `${normalizedValue} Dub` : null;
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
  const { sources, location } = useUserPreferencesContext();
  const showtimesReady = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesReady,
  );
  const railRef = useRef<HTMLDivElement | null>(null);
  const railScrollFrameRef = useRef<number | null>(null);
  const visibleShowtimeDateRef = useRef<string | null>(null);
  const [openTrailerModalId, setOpenTrailerModalId] = useState<string | null>(
    null,
  );
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

    // When showtimes finish loading after the panel opens, this keeps the
    // cloned display data in sync with the catalog store update.
    void showtimesReady;
    return cloneShowtimeDays(getMovieShowtimeDays(movie.tmdbId, location));
  }, [location, movie.tmdbId, showtimesReady, variant]);
  const metrics =
    variant === "nowPlaying" ? getMetricDisplays(movie, sources) : [];
  const trailerEmbedUrl = getTrailerEmbedUrl(movie.trailerKey);
  const trailerModalId = `${variant}:${movie.tmdbId}`;
  const targetShowtimeDate = getShowtimeTargetDate(
    showtimeDays,
    preferredShowtimeDate,
  );
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

  const reportVisibleShowtimeDate = useCallback(
    (nextDate: string | null) => {
      if (!nextDate || visibleShowtimeDateRef.current === nextDate) {
        return;
      }

      visibleShowtimeDateRef.current = nextDate;
      onPreferredShowtimeDateChange?.(nextDate);
    },
    [onPreferredShowtimeDateChange],
  );

  const handleRailScroll = useCallback(() => {
    if (railScrollFrameRef.current !== null) {
      return;
    }

    railScrollFrameRef.current = window.requestAnimationFrame(() => {
      railScrollFrameRef.current = null;

      const rail = railRef.current;
      if (!rail) {
        return;
      }

      reportVisibleShowtimeDate(getNearestShowtimeDate(rail, showtimeDays));
    });
  }, [reportVisibleShowtimeDate, showtimeDays]);

  useLayoutEffect(() => {
    const rail = railRef.current;

    if (!rail || !targetShowtimeDate) {
      visibleShowtimeDateRef.current = targetShowtimeDate;
      return;
    }

    if (visibleShowtimeDateRef.current === targetShowtimeDate) {
      return;
    }

    const targetPanel = findShowtimePanel(rail, targetShowtimeDate);
    if (!targetPanel) {
      visibleShowtimeDateRef.current = targetShowtimeDate;
      return;
    }

    if (Math.abs(rail.scrollLeft - targetPanel.offsetLeft) > 1) {
      rail.scrollLeft = targetPanel.offsetLeft;
    }

    visibleShowtimeDateRef.current = targetShowtimeDate;
  }, [movie.tmdbId, location, targetShowtimeDate]);

  useEffect(() => {
    return () => {
      if (railScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(railScrollFrameRef.current);
        railScrollFrameRef.current = null;
      }
    };
  }, []);

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
          <div
            ref={railRef}
            className="details-rail"
            aria-label={`${movie.title} showtimes in ${location}`}
            onScroll={handleRailScroll}
          >
            {showtimeDays.map((day) => (
              <article
                className="details-day-panel"
                data-showtime-date={day.date}
                key={day.date}
              >
                <div className="details-day-header">
                  <div className="details-day-heading">
                    <h3 className="details-day-title">{location}</h3>
                    <p className="details-day-kicker details-day-kicker--inline">
                      {getShowtimeDateLabel(day.date)}
                    </p>
                  </div>
                </div>

                {day.theaters.length === 0 ? (
                  <p className="details-day-empty">No showtimes listed.</p>
                ) : (
                  <div className="details-theaters">
                    {day.theaters.map((theater, theaterIndex) => {
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
                              const hasHebrewDub = isHebrewDub(
                                showtime.dubLanguage,
                              );
                              const dubBadgeLabel = getDubBadgeLabel(
                                showtime.dubLanguage,
                              );
                              const showtimeSlotClassName = [
                                "details-showtime-slot",
                                showtimeTech
                                  ? "details-showtime-slot--with-tech"
                                  : null,
                                hasHebrewDub
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
                                dubBadgeLabel,
                              ]
                                .filter(Boolean)
                                .join(", ");
                              const key = [
                                theater.theater,
                                day.date,
                                showtime.time,
                                showtime.screeningTech ?? "standard",
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
                                      {hasHebrewDub && dubBadgeLabel ? (
                                        <span className="details-time-pill-flag-shell">
                                          <img
                                            src="/flags/israel.svg"
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
                                      {hasHebrewDub && dubBadgeLabel ? (
                                        <span className="details-time-pill-flag-shell">
                                          <img
                                            src="/flags/israel.svg"
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
              </article>
            ))}
          </div>
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
