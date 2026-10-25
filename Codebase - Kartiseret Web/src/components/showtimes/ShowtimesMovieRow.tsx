import { getMetricDisplays, getMovieInfoParts, getTrailerEmbedUrl } from "./showtimeUtils";
import { type RatingSource } from "../../prefs/definitions/ratingSources";
import type { Movie, TheaterShowtimes } from "../../data/movieCatalog";
import { MovieMetricsRow, ShowtimeTheaters } from "./ShowtimeShared";
import { MoviePosterArtwork } from "../MoviePosterArtwork";

export function ShowtimesMovieRow({
  movie,
  theaters,
  sources,
  onOpenTrailer,
}: {
  movie: Movie;
  theaters: readonly TheaterShowtimes[];
  sources: readonly RatingSource[];
  onOpenTrailer: (movieId: string) => void;
}) {
  const infoParts = getMovieInfoParts(movie);
  const metaParts =
    movie.genres.length > 0
      ? [...infoParts, movie.genres.join(", ")]
      : infoParts;
  const metrics = getMetricDisplays(movie, sources);
  const trailerEmbedUrl = getTrailerEmbedUrl(movie.trailerKey);

  return (
    <article className="all-showtimes-movie-row">
      <div className="all-showtimes-movie-summary">
        <div className="all-showtimes-poster-shell">
          <MoviePosterArtwork
            title={movie.title}
            tmdbId={movie.tmdbId}
            imageSrc={movie.imageSrc}
            alt={movie.title}
            className="all-showtimes-poster"
            fallbackClassName="all-showtimes-poster"
            draggable={false}
          />
        </div>

        <div className="details-copy all-showtimes-copy">
          <h3 className="details-title all-showtimes-title">{movie.title}</h3>

          {metaParts.length > 0 ? (
            <div className="details-subtitle details-subtitle--meta-row">
              {metaParts.map((part) => (
                <span
                  key={`${movie.tmdbId}-showtimes-meta-${part}`}
                  className="details-subtitle-item"
                >
                  {part}
                </span>
              ))}
            </div>
          ) : null}

          <MovieMetricsRow
            movie={movie}
            metrics={metrics}
            trailerEmbedUrl={trailerEmbedUrl}
            onTrailerClick={
              trailerEmbedUrl
                ? () => {
                    onOpenTrailer(movie.tmdbId);
                  }
                : undefined
            }
            className="all-showtimes-metrics-row"
          />
        </div>
      </div>

      <div className="all-showtimes-theaters">
        <ShowtimeTheaters movie={movie} theaters={theaters} />
      </div>
    </article>
  );
}
