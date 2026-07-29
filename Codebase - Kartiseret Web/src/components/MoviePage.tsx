import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { findMovieByCode, isValidMovieCode, loadShowtimes } from "../data/movieCatalog";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { MovieDetailsContent } from "./scroller/MovieDetailsContent";
import "./scroller/MovieScroller.css";
import "./MoviePage.css";

type MoviePageProps = {
  catalogError: string | null;
  catalogReady: boolean;
};

type MoviePageStateProps = {
  message: string;
  title: string;
};

function MoviePageState({ message, title }: MoviePageStateProps) {
  return (
    <section className="movie-page movie-page--state">
      <div className="movie-page-state" role="status">
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="movie-page-state-actions">
          <Link to="/movies">Now playing</Link>
          <Link to="/soons">Coming soon</Link>
        </div>
      </div>
    </section>
  );
}

export function MoviePage({ catalogError, catalogReady }: MoviePageProps) {
  const { movieCode = "" } = useParams();
  const { location } = useUserPreferencesContext();
  const hasValidMovieCode = isValidMovieCode(movieCode);
  const routeMatch = hasValidMovieCode ? findMovieByCode(movieCode) : null;
  const movieTitle = routeMatch?.movie.title;
  const nowPlayingTmdbId =
    routeMatch?.mode === "nowPlaying" ? routeMatch.movie.tmdbId : null;
  const [showtimeSelection, setShowtimeSelection] = useState<{
    date: string;
    tmdbId: string;
  } | null>(null);
  const preferredShowtimeDate =
    showtimeSelection?.tmdbId === nowPlayingTmdbId
      ? showtimeSelection.date
      : null;
  const handlePreferredShowtimeDateChange = useCallback(
    (date: string) => {
      if (!nowPlayingTmdbId) {
        return;
      }

      setShowtimeSelection({ date, tmdbId: nowPlayingTmdbId });
    },
    [nowPlayingTmdbId],
  );

  useEffect(() => {
    const previousTitle = document.title;

    document.title = movieTitle
      ? `${movieTitle} | Kartiseret`
      : catalogReady
        ? "Movie not found | Kartiseret"
        : "Loading movie | Kartiseret";

    return () => {
      document.title = previousTitle;
    };
  }, [catalogReady, movieTitle]);

  useEffect(() => {
    if (!nowPlayingTmdbId) {
      return;
    }

    void loadShowtimes(location, nowPlayingTmdbId).catch((error: unknown) => {
      console.error("Failed to load movie-page showtimes.", error);
    });
  }, [location, nowPlayingTmdbId]);

  if (catalogError) {
    return <MoviePageState title="Movie unavailable" message={catalogError} />;
  }

  if (!catalogReady) {
    return (
      <MoviePageState
        title="Loading movie"
        message="Getting the latest movie details…"
      />
    );
  }

  if (!routeMatch) {
    return (
      <MoviePageState
        title="Movie not found"
        message={
          hasValidMovieCode
            ? "This movie is not currently playing or coming soon."
            : "Movie links use an exact three-letter code."
        }
      />
    );
  }

  const { movie, mode } = routeMatch;
  const titleId = `movie-page-title-${movie.movieCode ?? movie.tmdbId}`;

  return (
    <section className="movie-page" aria-labelledby={titleId}>
      <article className="movie-page-card movie-scroller-detail-card">
        {movie.backdropSrc ? (
          <div
            className="movie-scroller-detail-backdrop-shell"
            aria-hidden="true"
          >
            <img
              src={movie.backdropSrc}
              alt=""
              className="movie-scroller-detail-backdrop"
              decoding="async"
              loading="eager"
            />
          </div>
        ) : null}

        <div className="movie-scroller-detail-sheen" aria-hidden="true" />

        <div className="movie-page-content movie-scroller-detail-content">
          <MovieDetailsContent
            movie={movie}
            titleId={titleId}
            titleAs="h1"
            eyebrow={mode === "nowPlaying" ? "Now playing" : "Coming soon"}
            variant={mode}
            preferredShowtimeDate={preferredShowtimeDate}
            onPreferredShowtimeDateChange={
              mode === "nowPlaying"
                ? handlePreferredShowtimeDateChange
                : undefined
            }
            targetShowtimeQueries
            posterClassName="details-poster is-visible"
          />
        </div>
      </article>
    </section>
  );
}
