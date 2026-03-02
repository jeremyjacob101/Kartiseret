import { Calendar, Clock3 } from "lucide-react";
import type { Ref } from "react";
import type { Movie } from "../data/movies";
import { fakeShowtimes } from "../data/showtimes";

type DayKey = keyof typeof fakeShowtimes;
type CityKey = keyof (typeof fakeShowtimes)["dayA"];
type TheaterKey = keyof (typeof fakeShowtimes)["dayA"]["Jerusalem"];

const dayKeys = Object.keys(fakeShowtimes) as DayKey[];
const defaultCity: CityKey = "Jerusalem";
const theaterColors: Record<
  TheaterKey,
  { label: string; accent: string; surface: string; glow: string }
> = {
  YesPlanet: {
    label: "Yes Planet",
    accent: "#ff9a3d",
    surface: "rgba(255, 154, 61, 0.12)",
    glow: "rgba(255, 154, 61, 0.28)",
  },
  CinemaCity: {
    label: "Cinema City",
    accent: "#5ea8ff",
    surface: "rgba(94, 168, 255, 0.12)",
    glow: "rgba(94, 168, 255, 0.3)",
  },
  LevCinema: {
    label: "Lev Cinema",
    accent: "#ff6b6b",
    surface: "rgba(255, 107, 107, 0.12)",
    glow: "rgba(255, 107, 107, 0.28)",
  },
};
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

function getShowtimes(
  day: DayKey,
  city: CityKey,
  theater: TheaterKey,
  title: string,
): readonly string[] {
  const theaterSchedule = fakeShowtimes[day][city][theater] as Record<
    string,
    readonly string[]
  >;

  return theaterSchedule[title] ?? [];
}

function getShowtimeDateLabel(dayOffset: number): string {
  if (dayOffset === 0) {
    return "Today";
  }

  if (dayOffset === 1) {
    return "Tomorrow";
  }

  const today = new Date();
  const date = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + dayOffset,
  );

  return showtimeDateFormatter.format(date);
}

export function MovieDetailsContent({
  movie,
  titleId,
  posterRef,
  posterClassName = "details-poster",
  eyebrow = "Revival spotlight",
}: MovieDetailsContentProps) {
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
            {movie.year} • {formatRuntime(movie.runtime)} • {defaultCity}
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
            <div
              className="details-metric"
              aria-label={`Runtime ${movie.runtime} minutes`}
            >
              <span className="details-metric-marker" aria-hidden="true">
                <Clock3
                  className="details-metric-icon"
                  size={16}
                  strokeWidth={2}
                />
              </span>
              <strong>{movie.runtime} min</strong>
            </div>
            <div
              className="details-metric"
              aria-label={`Release year ${movie.year}`}
            >
              <span className="details-metric-marker" aria-hidden="true">
                <Calendar
                  className="details-metric-icon"
                  size={16}
                  strokeWidth={2}
                />
              </span>
              <strong>{movie.year}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="details-showtimes">
        <div className="details-rail" aria-label={`${movie.title} showtimes`}>
          {dayKeys.map((day, dayIndex) => {
            const theaters = Object.keys(
              fakeShowtimes[day][defaultCity],
            ) as TheaterKey[];

            return (
              <article className="details-day-panel" key={day}>
                <div className="details-day-header">
                  <div>
                    <p className="details-day-kicker">
                      {getShowtimeDateLabel(dayIndex)}
                    </p>
                    <h3 className="details-day-title">{defaultCity}</h3>
                  </div>
                </div>

                <div className="details-theaters">
                  {theaters.map((theater) => {
                    const colors = theaterColors[theater];
                    const showtimes = getShowtimes(
                      day,
                      defaultCity,
                      theater,
                      movie.title,
                    );

                    return (
                      <section className="details-theater" key={theater}>
                        <div className="details-theater-name">
                          <span
                            className="details-theater-dot"
                            style={{
                              backgroundColor: colors.accent,
                              boxShadow: `0 0 18px ${colors.glow}`,
                            }}
                          />
                          <span>{colors.label}</span>
                        </div>

                        <div className="details-time-grid">
                          {showtimes.map((time) => (
                            <span
                              key={`${theater}-${day}-${time}`}
                              className="details-time-pill"
                              style={{
                                color: colors.accent,
                                borderColor: colors.accent,
                                background: colors.surface,
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
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}
