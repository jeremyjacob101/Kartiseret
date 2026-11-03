import { getShowtimeDateLabel, getTrailerEmbedUrl, getMetricDisplays, getMovieInfoParts } from "./showtimes/showtimeUtils";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { MovieMetricsRow, MovieTrailerModal } from "./showtimes/ShowtimeShared";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { cinemathequeQueryOptions } from "../data/cinemathequeCatalog";
import { findMovieByCode, type Movie } from "../data/movieCatalog";
import { buildCinemathequeSchedule } from "../data/cinematheques";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { MoviePosterArtwork } from "./MoviePosterArtwork";
import { setSeoMetadata } from "../routing/seoMetadata";
import { useShallow } from "zustand/react/shallow";
import { Link } from "react-router";
import "./AllShowtimesPage.css";
import "./CinemathequesPage.css";

export function CinemathequesPage() {
  const publicationRevision = usePublicationRevision();
  const queryClient = useQueryClient();
  const displayPreferences = useMovieDisplayPreferences();
  const { preferenceLocation, sources } = useUserPreferencesStore(
    useShallow((state) => ({
      preferenceLocation: state.preferences.location,
      sources: state.preferences.ratingSources,
    })),
  );
  const [location, setLocation] = useState(preferenceLocation);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [detailMovie, setDetailMovie] = useState<Movie | null>(null);
  const [openTrailerMovieId, setOpenTrailerMovieId] = useState<string | null>(
    null,
  );
  const cinemathequeQuery = useQuery({
    ...cinemathequeQueryOptions(location, publicationRevision),
  });
  const rawMovies = cinemathequeQuery.data?.movies;
  const nowPlayingMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        rawMovies ?? [],
        displayPreferences.preferencesById,
      ),
    [displayPreferences.preferencesById, rawMovies],
  );
  const dayPanels = useMemo(
    () =>
      cinemathequeQuery.data
        ? buildCinemathequeSchedule(
            nowPlayingMovies,
            cinemathequeQuery.data.showtimes,
          )
        : [],
    [cinemathequeQuery.data, nowPlayingMovies],
  );
  const openTrailerMovie = useMemo(
    () =>
      openTrailerMovieId
        ? nowPlayingMovies.find((movie) => movie.tmdbId === openTrailerMovieId)
        : null,
    [nowPlayingMovies, openTrailerMovieId],
  );
  const openTrailerEmbedUrl = getTrailerEmbedUrl(openTrailerMovie?.trailerKey);

  const handleLocationChange = useCallback(async (
    nextLocation: typeof location,
  ) => {
    setLocation(nextLocation);
    return true;
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const isLoading = cinemathequeQuery.isPending;

  useLayoutEffect(() => {
    if (isLoading || !cinemathequeQuery.data) return;
    const hasPublicMovieLinks = cinemathequeQuery.data.movies.some(
      (movie) =>
        movie.movieCode &&
        findMovieByCode(movie.movieCode, queryClient)?.movie.tmdbId ===
          movie.tmdbId,
    );
    setSeoMetadata({
      title: `Cinematheque showtimes in ${location} | Kartiseret`,
      description: `Browse upcoming cinematheque movie screenings in ${location}.`,
      canonicalPath: "/cinematheques",
      robots:
        cinemathequeQuery.data.movieCodesStatus === "ready" &&
        hasPublicMovieLinks
          ? "index, follow"
          : "noindex, nofollow",
    });
  }, [cinemathequeQuery.data, isLoading, location, queryClient]);

  return (
    <section
      className="all-showtimes-page cinematheques-page"
      aria-label="Cinematheque showtimes"
    >
      <h1 className="cinematheques-page-title">Cinematheque Showtimes</h1>

      <div
        className="details-showtimes all-showtimes-day-picker-shell"
        aria-label="Choose city"
      >
        <TheaterMapDialog
          className="all-showtimes-page-city city-map-trigger"
          locationOverride={location}
          onLocationOverrideChange={handleLocationChange}
          triggerLabel={location}
        />
      </div>

      <section
        className="details-showtimes all-showtimes-browser"
        aria-label={`Cinematheque showtimes in ${location}`}
      >
        {isLoading ? (
          <p className="details-day-empty" role="status">
            Loading cinematheque showtimes…
          </p>
        ) : cinemathequeQuery.isError ? (
          <p className="details-day-empty" role="alert">
            Could not load cinematheque showtimes.
          </p>
        ) : dayPanels.length ? (
          dayPanels.map((day) => (
            <section
              className="details-day-panel all-showtimes-day-panel cinematheques-day"
              data-showtime-date={day.date}
              key={day.date}
            >
              <h2 className="cinematheques-date">
                {getShowtimeDateLabel(day.date)}
              </h2>
              {day.cinemas.map(({ cinema, movies }) => (
                <section
                  className="cinematheques-cinema"
                  key={cinema}
                  aria-label={cinema}
                >
                  <h3 className="cinematheques-cinema-title">{cinema}</h3>
                  <div className="cinematheques-poster-grid">
                    {movies.map(({ movie, theaters }) => (
                      <article
                        className="cinematheques-poster-tile"
                        key={movie.tmdbId}
                      >
                        {movie.movieCode &&
                        findMovieByCode(movie.movieCode, queryClient)?.movie
                          .tmdbId === movie.tmdbId ? (
                          <Link
                            className="cinematheques-poster-button"
                            to={`/${movie.movieCode}`}
                            aria-label={`View details for ${movie.title}`}
                          >
                            <MoviePosterArtwork
                              title={movie.title}
                              tmdbId={movie.tmdbId}
                              imageSrc={movie.imageSrc}
                              alt=""
                              className="cinematheques-poster"
                              fallbackClassName="cinematheques-poster"
                              loading="lazy"
                            />
                          </Link>
                        ) : (
                          <button
                            className="cinematheques-poster-button"
                            type="button"
                            aria-label={`View details for ${movie.title}`}
                            onClick={(event) => {
                              detailTriggerRef.current = event.currentTarget;
                              setDetailMovie(movie);
                            }}
                          >
                            <MoviePosterArtwork
                              title={movie.title}
                              tmdbId={movie.tmdbId}
                              imageSrc={movie.imageSrc}
                              alt=""
                              className="cinematheques-poster"
                              fallbackClassName="cinematheques-poster"
                              loading="lazy"
                            />
                          </button>
                        )}
                        <div
                          className="cinematheques-times"
                          aria-label={`Showtimes for ${movie.title}`}
                        >
                          {theaters[0]?.showtimes.map((showtime, index) => {
                            const label = `${movie.title} ${showtime.time} showtime at ${cinema}`;
                            const key = `${showtime.time}-${showtime.screeningTech}-${showtime.screeningType}-${showtime.dubLanguage}-${index}`;
                            return showtime.href ? (
                              <a
                                key={key}
                                className="cinematheques-time"
                                href={showtime.href}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${label}`}
                              >
                                {showtime.time}
                              </a>
                            ) : (
                              <span
                                key={key}
                                className="cinematheques-time cinematheques-time--unavailable"
                                aria-label={`${label}, ticket link unavailable`}
                              >
                                {showtime.time}
                              </span>
                            );
                          })}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </section>
          ))
        ) : (
          <div className="details-empty-state all-showtimes-empty-state">
            <div className="details-empty-state-panel">
              <p className="details-empty-state-title">
                No cinematheque showtimes listed in {location}
              </p>
            </div>
          </div>
        )}
      </section>

      {detailMovie ? (
        <CinemathequeMovieDialog
          movie={detailMovie}
          returnFocusRef={detailTriggerRef}
          sources={sources}
          onClose={() => setDetailMovie(null)}
          onOpenTrailer={(id) => {
            setDetailMovie(null);
            setOpenTrailerMovieId(id);
          }}
        />
      ) : null}

      <MovieTrailerModal
        movieTitle={openTrailerMovie?.title ?? ""}
        embedUrl={openTrailerEmbedUrl}
        isOpen={Boolean(openTrailerMovie && openTrailerEmbedUrl)}
        onClose={() => {
          setOpenTrailerMovieId(null);
        }}
      />
    </section>
  );
}

function CinemathequeMovieDialog({
  movie,
  sources,
  onClose,
  onOpenTrailer,
  returnFocusRef,
}: {
  movie: Movie;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  sources: Parameters<typeof getMetricDisplays>[1];
  onClose: () => void;
  onOpenTrailer: (id: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
    else dialog?.setAttribute("open", "");
    return () => {
      returnFocus?.focus();
    };
  }, [returnFocusRef]);
  const info = [...getMovieInfoParts(movie), ...movie.genres];
  const trailer = getTrailerEmbedUrl(movie.trailerKey);
  return (
    <dialog
      className="cinematheques-dialog"
      aria-label={`${movie.title} details`}
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cinematheques-dialog-content">
        <button
          className="cinematheques-dialog-close"
          type="button"
          onClick={onClose}
          aria-label="Close movie details"
          autoFocus
        >
          ×
        </button>
        <h2>{movie.title}</h2>
        {info.length ? <p>{info.join(" · ")}</p> : null}
        <MovieMetricsRow
          movie={movie}
          metrics={getMetricDisplays(movie, sources)}
          trailerEmbedUrl={trailer}
          onTrailerClick={
            trailer ? () => onOpenTrailer(movie.tmdbId) : undefined
          }
        />
      </div>
    </dialog>
  );
}
