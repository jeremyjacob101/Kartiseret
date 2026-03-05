import type { Ref } from "react";
import {
  fixedAppDateString,
  getMovieShowtimeDays,
  type Movie,
} from "../data/movieCatalog";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";
import { type RatingSource } from "../prefs/ratingSources";

type TheaterTheme = {
  accent: string;
  surface: string;
  glow: string;
  pillBackground?: string;
};

const theaterThemes: Record<string, TheaterTheme> = {
  "Yes Planet": {
    accent: "#ff9a3d",
    surface: "rgba(255, 154, 61, 0.12)",
    glow: "rgba(255, 154, 61, 0.28)",
  },
  "Cinema City": {
    accent: "#5ea8ff",
    surface: "rgba(94, 168, 255, 0.12)",
    glow: "rgba(94, 168, 255, 0.3)",
  },
  "Lev Cinema": {
    accent: "#ff6b6b",
    surface: "rgba(255, 107, 107, 0.12)",
    glow: "rgba(255, 107, 107, 0.28)",
  },
  "Rav Hen": {
    accent: "#ffb14a",
    surface: "rgba(255, 177, 74, 0.14)",
    glow: "rgba(79, 146, 255, 0.32)",
    pillBackground:
      "linear-gradient(135deg, rgba(79, 146, 255, 0.22), rgba(255, 177, 74, 0.18))",
  },
  "Hot Cinema": {
    accent: "#ff4fa0",
    surface: "rgba(255, 79, 160, 0.14)",
    glow: "rgba(255, 79, 160, 0.32)",
  },
  Movieland: {
    accent: "#58003a",
    surface: "rgba(88, 0, 58, 0.12)",
    glow: "rgba(88, 0, 58, 0.3)",
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

type MovieDetailsContentProps = {
  movie: Movie;
  titleId: string;
  posterRef?: Ref<HTMLImageElement>;
  posterClassName?: string;
  eyebrow?: string;
  variant?: MovieDetailsVariant;
};

export type MovieDetailsVariant = "nowPlaying" | "comingSoon";

type MetricDisplay = {
  key: RatingSource;
  value: string;
  ariaLabel: string;
  logoSrc: string;
  logoClassName?: string;
  logoWidth?: number;
  logoHeight?: number;
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

function getTheaterTheme(theater: string, index: number): TheaterTheme {
  return theaterThemes[theater] ?? fallbackTheaterThemes[index % fallbackTheaterThemes.length];
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
        logoClassName: "details-metric-logo details-metric-logo--imdb",
        logoWidth: 36,
        logoHeight: 18,
      };
    case "rtAudienceRating":
      return {
        key: "rtAudienceRating",
        value: formatPercent(movie.rtAudienceRating),
        ariaLabel: audienceBadge
          ? `Rotten Tomatoes audience score ${formatPercent(movie.rtAudienceRating)}, ${audienceBadge.description}`
          : "Rotten Tomatoes audience score unavailable",
        logoSrc: audienceBadge?.src ?? "/logos/rtAudienceGood.svg",
        logoClassName: "details-metric-logo details-metric-logo--rt",
        logoWidth: 22,
        logoHeight: 22,
      };
    case "rtCriticRating":
      return {
        key: "rtCriticRating",
        value: formatPercent(movie.rtCriticRating),
        ariaLabel: criticBadge
          ? `Rotten Tomatoes critic score ${formatPercent(movie.rtCriticRating)}, ${criticBadge.description}`
          : "Rotten Tomatoes critic score unavailable",
        logoSrc: criticBadge?.src ?? "/logos/rtCriticGood.svg",
        logoClassName: "details-metric-logo details-metric-logo--rt",
        logoWidth: 22,
        logoHeight: 22,
      };
    case "lbRating":
      return {
        key: "lbRating",
        value: formatDecimalRating(movie.lbRating),
        ariaLabel: hasRating(movie.lbRating)
          ? `Letterboxd rating ${movie.lbRating.toFixed(1)}`
          : "Letterboxd rating unavailable",
        logoSrc: "/logos/letterboxd.svg",
        logoClassName: "details-metric-logo details-metric-logo--letterboxd",
        logoWidth: 24,
        logoHeight: 24,
      };
    case "tmdbRating":
      return {
        key: "tmdbRating",
        value: formatDecimalRating(movie.tmdbRating),
        ariaLabel: hasRating(movie.tmdbRating)
          ? `TMDB rating ${movie.tmdbRating.toFixed(1)}`
          : "TMDB rating unavailable",
        logoSrc: "/logos/tmdb.svg",
        logoClassName: "details-metric-logo details-metric-logo--tmdb",
        logoWidth: 28,
        logoHeight: 20,
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
    getMetricDisplay(movie, source, criticBadge, audienceBadge),
  );
}

export function MovieDetailsContent({
  movie,
  titleId,
  posterRef,
  posterClassName = "details-poster",
  eyebrow = "Now playing",
  variant = "nowPlaying",
}: MovieDetailsContentProps) {
  const { sources, location } = useRatingSourcesContext();
  const subtitle = getMovieInfoParts(movie).join(" • ");
  const releaseDateLabel =
    variant === "comingSoon" && movie.releaseDate
      ? formatReleaseDate(movie.releaseDate)
      : null;
  const showtimeDays =
    variant === "nowPlaying" ? getMovieShowtimeDays(movie.tmdbId, location) : [];
  const metrics =
    variant === "nowPlaying" ? getMetricDisplays(movie, sources) : [];

  return (
    <>
      <div className="details-hero">
        <div className="details-poster-shell">
          <img
            ref={posterRef}
            src={movie.imageSrc}
            alt={movie.title}
            className={posterClassName}
            draggable={false}
          />
        </div>

        <div className="details-copy">
          <p className="details-eyebrow">{eyebrow}</p>
          <h2 id={titleId} className="details-title">
            {movie.title}
          </h2>
          {subtitle ? <p className="details-subtitle">{subtitle}</p> : null}

          {releaseDateLabel ? (
            <p className="details-release-date">Release date: {releaseDateLabel}</p>
          ) : null}

          {variant === "nowPlaying" ? (
            <div className="details-metrics">
              {metrics.map((metric) => (
                <div
                  key={metric.key}
                  className="details-metric"
                  aria-label={metric.ariaLabel}
                >
                  <span className="details-metric-marker" aria-hidden="true">
                    <img
                      src={metric.logoSrc}
                      alt=""
                      className={metric.logoClassName}
                      width={metric.logoWidth}
                      height={metric.logoHeight}
                      decoding="async"
                    />
                  </span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {variant === "nowPlaying" ? (
        <div className="details-showtimes">
          <div
            className="details-rail"
            aria-label={`${movie.title} showtimes in ${location}`}
          >
            {showtimeDays.map((day) => (
              <article className="details-day-panel" key={day.date}>
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
                        <section className="details-theater" key={theater.theater}>
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
                            {theater.showtimes.map((time) => (
                              <span
                                key={`${theater.theater}-${day.date}-${time}`}
                                className="details-time-pill"
                                style={{
                                  color: colors.accent,
                                  borderColor: colors.accent,
                                  background:
                                    colors.pillBackground ?? colors.surface,
                                  boxShadow: `inset 0 0 0 1px ${colors.surface}`,
                                }}
                              >
                                {time}
                              </span>
                            ))}
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
      ) : null}
    </>
  );
}
