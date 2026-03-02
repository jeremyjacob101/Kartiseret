import type { Ref } from "react";
import {
  defaultCity,
  fixedAppDateString,
  getMovieShowtimeDays,
  type Movie,
} from "../data/movieCatalog";

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

type MovieDetailsContentProps = {
  movie: Movie;
  titleId: string;
  posterRef?: Ref<HTMLImageElement>;
  posterClassName?: string;
  eyebrow?: string;
};

function formatRuntime(runtime: number): string {
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
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

function getTheaterTheme(theater: string, index: number): TheaterTheme {
  return theaterThemes[theater] ?? fallbackTheaterThemes[index % fallbackTheaterThemes.length];
}

export function MovieDetailsContent({
  movie,
  titleId,
  posterRef,
  posterClassName = "details-poster",
  eyebrow = "Now playing",
}: MovieDetailsContentProps) {
  const showtimeDays = getMovieShowtimeDays(movie.tmdbId);

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
          <p className="details-subtitle">
            {movie.year} • {formatRuntime(movie.runtime)}
          </p>

          <div className="details-metrics">
            <div
              className="details-metric"
              aria-label={`IMDb rating ${movie.imdbRating.toFixed(1)}`}
            >
              <span className="details-metric-marker" aria-hidden="true">
                <img
                  src="/logos/imdblogo.svg"
                  alt=""
                  className="details-metric-logo details-metric-logo--imdb"
                  width="36"
                  height="18"
                  decoding="async"
                />
              </span>
              <strong>{movie.imdbRating.toFixed(1)}</strong>
            </div>
            <div
              className="details-metric"
              aria-label={`Rotten Tomatoes rating ${movie.rtRating} percent`}
            >
              <span className="details-metric-marker" aria-hidden="true">
                <img
                  src="/logos/rtlogo.svg"
                  alt=""
                  className="details-metric-logo details-metric-logo--rt"
                  width="20"
                  height="20"
                  decoding="async"
                />
              </span>
              <strong>{movie.rtRating}%</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="details-showtimes">
        <div
          className="details-rail"
          aria-label={`${movie.title} showtimes in ${defaultCity}`}
        >
          {showtimeDays.map((day) => (
            <article className="details-day-panel" key={day.date}>
              <div className="details-day-header">
                <div className="details-day-heading">
                  <h3 className="details-day-title">{defaultCity}</h3>
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
    </>
  );
}
