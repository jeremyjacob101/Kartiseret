import { type Movie, type ShowtimeEntry, type TheaterShowtimes } from "../../data/movieCatalog";
import { getTheaterTheme, type TheaterTheme } from "./theaterTheme";
import { type CSSProperties, useEffect } from "react";
import { type MetricDisplay } from "./showtimeUtils";
import { createPortal } from "react-dom";
import { Star, X } from "lucide-react";
import "./ShowtimeShared.css";

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

function renderShowtimeCard(
  movieTitle: string,
  theater: string,
  showtime: ShowtimeEntry,
  colors: TheaterTheme,
) {
  const showtimeTech = getShowtimeTechLabel(showtime.screeningTech);
  const dubFlagSrc = getDubFlagSrc(showtime.dubLanguage);
  const dubBadgeLabel = getDubBadgeLabel(showtime.dubLanguage);
  const screeningTypeBadgeLabel = getScreeningTypeBadgeLabel(
    showtime.screeningType,
  );
  const showtimeCardClassName = [
    "details-showtime-card",
    showtime.href ? "details-showtime-card--link" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const showtimePillClassName = ["details-time-pill", colors.pillClassName]
    .filter(Boolean)
    .join(" ");
  const showtimeCardStyle = colors.pillClassName
    ? undefined
    : ({
        "--details-showtime-pill-background":
          colors.pillBackground ??
          `linear-gradient(180deg, color-mix(in srgb, ${colors.accent} 88%, white 12%), color-mix(in srgb, ${colors.accent} 72%, black 28%))`,
      } as CSSProperties);
  const showtimeLabel = [
    `Open ${movieTitle} ${showtime.time} showtime at ${theater}`,
    showtimeTech,
    screeningTypeBadgeLabel,
    dubBadgeLabel,
  ]
    .filter(Boolean)
    .join(", ");
  const showtimeBody = (
    <>
      {showtimeTech ? (
        <span className="details-showtime-tech" aria-hidden="true">
          {showtimeTech}
        </span>
      ) : null}

      <div className="details-time-card-shell">
        <span className={showtimePillClassName} style={showtimeCardStyle}>
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
          <span className="details-time-pill-label">{showtime.time}</span>
        </span>
      </div>
    </>
  );

  return showtime.href ? (
    <a
      href={showtime.href}
      target="_blank"
      rel="noreferrer"
      className={showtimeCardClassName}
      aria-label={showtimeLabel}
    >
      {showtimeBody}
    </a>
  ) : (
    <span className={showtimeCardClassName} aria-label={showtimeLabel}>
      {showtimeBody}
    </span>
  );
}

type MovieMetricsRowProps = {
  movie: Movie;
  metrics: readonly MetricDisplay[];
  trailerEmbedUrl: string | null;
  onTrailerClick?: () => void;
  className?: string;
};

export function MovieMetricsRow({
  movie,
  metrics,
  trailerEmbedUrl,
  onTrailerClick,
  className,
}: MovieMetricsRowProps) {
  const hasTrailerLaunch = Boolean(trailerEmbedUrl) && Boolean(onTrailerClick);
  const hasMetrics = metrics.length > 0;

  if (!hasTrailerLaunch && !hasMetrics) {
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
          onClick={onTrailerClick}
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
}

type MovieTrailerModalProps = {
  movieTitle: string;
  embedUrl: string | null;
  isOpen: boolean;
  onClose: () => void;
};

export function MovieTrailerModal({
  movieTitle,
  embedUrl,
  isOpen,
  onClose,
}: MovieTrailerModalProps) {
  useEffect(() => {
    if (!isOpen || !embedUrl) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [embedUrl, isOpen, onClose]);

  if (!(isOpen && embedUrl) || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="movie-trailer-modal"
      data-movie-scroller-detail-overlay="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="movie-trailer-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${movieTitle} trailer`}
      >
        <button
          type="button"
          className="movie-trailer-modal-close"
          aria-label="Close trailer"
          onClick={onClose}
        >
          <X size={20} strokeWidth={2.6} />
        </button>
        <div className="movie-trailer-modal-frame">
          <iframe
            src={`${embedUrl}&autoplay=1`}
            title={`${movieTitle} trailer`}
            loading="eager"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

type ShowtimeTheatersProps = {
  movie: Movie;
  theaters: readonly TheaterShowtimes[];
  city?: string;
};

export function ShowtimeTheaters({
  movie,
  theaters,
  city,
}: ShowtimeTheatersProps) {
  return (
    <div className="details-theaters showtime-theaters">
      {theaters.map((theater, theaterIndex) => {
        const colors = getTheaterTheme(theater.theater, theaterIndex, city);

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
              {theater.showtimes.map((showtime) => {
                const showtimeTech = getShowtimeTechLabel(
                  showtime.screeningTech,
                );
                const dubFlagSrc = getDubFlagSrc(showtime.dubLanguage);
                const showtimeSlotClassName = [
                  "details-showtime-slot",
                  showtimeTech ? "details-showtime-slot--with-tech" : null,
                  dubFlagSrc ? "details-showtime-slot--with-flag" : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                const key = [
                  theater.theater,
                  showtime.time,
                  showtime.screeningTech,
                  showtime.screeningType,
                  showtime.dubLanguage ?? "original",
                ].join("-");

                return (
                  <div key={key} className={showtimeSlotClassName}>
                    {renderShowtimeCard(
                      movie.title,
                      theater.theater,
                      showtime,
                      colors,
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
