import { getShowtimeDateLabel, getTrailerEmbedUrl, getMetricDisplays, getMovieInfoParts } from "./showtimes/showtimeUtils";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { MovieMetricsRow, MovieTrailerModal } from "./showtimes/ShowtimeShared";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { buildFocusedCinemathequeSchedule } from "../data/cinematheques";
import { cinemathequeQueryOptions } from "../data/cinemathequeCatalog";
import { usePublicRenderClock } from "../contexts/PublicRenderClock";
import { findMovieByCode, type Movie } from "../data/movieCatalog";
import { buildCinemathequeSchedule } from "../data/cinematheques";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { getTheaterTheme } from "./showtimes/theaterTheme";
import { MoviePosterArtwork } from "./MoviePosterArtwork";
import { setSeoMetadata } from "../routing/seoMetadata";
import { Link, useSearchParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import "./AllShowtimesPage.css";
import "./CinemathequesPage.css";

export function CinemathequesPage() {
  const { cinemaDate } = usePublicRenderClock();
  const publicationRevision = usePublicationRevision();
  const queryClient = useQueryClient();
  const displayPreferences = useMovieDisplayPreferences();
  const { preferenceLocation, sources } = useUserPreferencesStore(
    useShallow((state) => ({
      preferenceLocation: state.preferences.location,
      sources: state.preferences.ratingSources,
    })),
  );
  const [searchParams] = useSearchParams();
  const focusedMovieId = searchParams.get("movie");
  const [location, setLocation] = useState(preferenceLocation);
  const [focusedCityFilter, setFocusedCityFilter] = useState<string | null>(
    null,
  );
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [detailMovie, setDetailMovie] = useState<Movie | null>(null);
  const [openTrailerMovieId, setOpenTrailerMovieId] = useState<string | null>(
    null,
  );
  const cinemathequeQuery = useQuery({
    ...cinemathequeQueryOptions(
      focusedMovieId ? null : location,
      publicationRevision,
      undefined,
      focusedMovieId ?? undefined,
    ),
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
  const focusedSchedule = useMemo(
    () =>
      focusedMovieId && cinemathequeQuery.data
        ? buildFocusedCinemathequeSchedule(
            cinemathequeQuery.data.movies,
            cinemathequeQuery.data.showtimes,
            focusedMovieId,
            focusedCityFilter ?? undefined,
          )
        : [],
    [cinemathequeQuery.data, focusedCityFilter, focusedMovieId],
  );
  const focusedMovie = focusedMovieId
    ? nowPlayingMovies.find((movie) => movie.tmdbId === focusedMovieId)
    : undefined;
  const openTrailerMovie = useMemo(
    () =>
      openTrailerMovieId
        ? nowPlayingMovies.find((movie) => movie.tmdbId === openTrailerMovieId)
        : null,
    [nowPlayingMovies, openTrailerMovieId],
  );
  const openTrailerEmbedUrl = getTrailerEmbedUrl(openTrailerMovie?.trailerKey);

  const handleLocationChange = useCallback(
    async (nextLocation: typeof location) => {
      setLocation(nextLocation);
      if (focusedMovieId) setFocusedCityFilter(nextLocation);
      return true;
    },
    [focusedMovieId, setFocusedCityFilter, setLocation],
  );

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
      title: focusedMovie
        ? `${focusedMovie.title} cinematheque showtimes | Kartiseret`
        : `Cinematheque showtimes in ${location} | Kartiseret`,
      description: focusedMovie
        ? `Browse upcoming cinematheque screenings for ${focusedMovie.title} across Israel.`
        : `Browse upcoming cinematheque movie screenings in ${location}.`,
      canonicalPath: "/cinematheques",
      robots:
        cinemathequeQuery.data.movieCodesStatus === "ready" &&
        hasPublicMovieLinks
          ? "index, follow"
          : "noindex, nofollow",
    });
  }, [cinemathequeQuery.data, focusedMovie, isLoading, location, queryClient]);

  return (
    <section
      className="all-showtimes-page cinematheques-page"
      aria-label="Cinematheque showtimes"
    >
      <h1 className="cinematheques-page-title">
        {focusedMovie
          ? `${focusedMovie.title} · Cinematheque Showtimes`
          : "Cinematheque Showtimes"}
      </h1>

      {focusedMovieId ? (
        <div className="cinematheques-focus-controls">
          <Link to="/cinematheques" className="cinematheques-focus-clear">
            Clear movie filter
          </Link>
          {focusedCityFilter ? (
            <button
              type="button"
              className="cinematheques-focus-clear"
              onClick={() => setFocusedCityFilter(null)}
            >
              Show all cities
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="details-showtimes all-showtimes-day-picker-shell"
        aria-label="Choose city"
      >
        <TheaterMapDialog
          className="all-showtimes-page-city city-map-trigger"
          locationOverride={location}
          onLocationOverrideChange={handleLocationChange}
          triggerLabel={
            focusedMovieId ? (focusedCityFilter ?? "All cities") : location
          }
        />
      </div>

      <section
        className="details-showtimes all-showtimes-browser"
        aria-label={
          focusedMovieId
            ? "Focused cinematheque showtimes"
            : `Cinematheque showtimes in ${location}`
        }
      >
        {isLoading ? (
          <p className="details-day-empty" role="status">
            Loading cinematheque showtimes…
          </p>
        ) : cinemathequeQuery.isError ? (
          <p className="details-day-empty" role="alert">
            Could not load cinematheque showtimes.
          </p>
        ) : focusedMovieId ? (
          focusedMovie ? (
            focusedSchedule.length ? (
              <FocusedCinemathequeSchedule
                days={focusedSchedule}
                movie={focusedMovie}
                cityDate={cinemaDate}
                onOpenMovie={(movie, trigger) => {
                  detailTriggerRef.current = trigger;
                  setDetailMovie(movie);
                }}
              />
            ) : (
              <div className="details-empty-state all-showtimes-empty-state">
                <div className="details-empty-state-panel">
                  <p className="details-empty-state-title">
                    No upcoming cinematheque showtimes for {focusedMovie.title}
                    {focusedCityFilter
                      ? ` in ${focusedCityFilter}`
                      : " across Israel"}
                  </p>
                </div>
              </div>
            )
          ) : (
            <p className="details-day-empty" role="status">
              This cinematheque title could not be found.
            </p>
          )
        ) : dayPanels.length ? (
          dayPanels.map((day) => (
            <section
              className="details-day-panel all-showtimes-day-panel cinematheques-day"
              data-showtime-date={day.date}
              key={day.date}
            >
              <h2 className="cinematheques-date">
                {getShowtimeDateLabel(day.date, cinemaDate)}
              </h2>
              {day.cinemas.map(({ cinema, movies }, cinemaIndex) => {
                const colors = getTheaterTheme(cinema, cinemaIndex, location);
                return (
                  <section
                    className="cinematheques-cinema"
                    key={cinema}
                    aria-label={cinema}
                  >
                    <h3
                      className="cinematheques-cinema-title"
                      style={{ color: colors.accent }}
                    >
                      {cinema}
                    </h3>
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
                                imageSrcSet={movie.imageSrcSet}
                                imageSizes="(max-width: 600px) calc((100vw - 48px) / 3), 160px"
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
                                imageSrcSet={movie.imageSrcSet}
                                imageSizes="(max-width: 600px) calc((100vw - 48px) / 3), 160px"
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
                                  style={{
                                    background:
                                      colors.pillBackground ?? colors.accent,
                                  }}
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
                                  style={{
                                    background:
                                      colors.pillBackground ?? colors.accent,
                                  }}
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
                );
              })}
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

function FocusedCinemathequeSchedule({
  days,
  movie,
  cityDate,
  onOpenMovie,
}: {
  days: ReturnType<typeof buildFocusedCinemathequeSchedule>;
  movie: Movie;
  cityDate: string;
  onOpenMovie: (movie: Movie, trigger: HTMLButtonElement) => void;
}) {
  return (
    <>
      {days.map((day) => (
        <section
          className="details-day-panel all-showtimes-day-panel cinematheques-day"
          data-showtime-date={day.date}
          key={day.date}
        >
          <h2 className="cinematheques-date">
            {getShowtimeDateLabel(day.date, cityDate)}
          </h2>
          {day.venues.map((venue, venueIndex) => {
            const colors = getTheaterTheme(
              venue.cinema,
              venueIndex,
              venue.city,
            );
            return (
              <section
                className="cinematheques-cinema"
                key={`${venue.city}-${venue.cinema}`}
                aria-label={`${venue.city} ${venue.cinema}`}
              >
                <h3
                  className="cinematheques-cinema-title"
                  style={{ color: colors.accent }}
                >
                  {venue.city} · {venue.cinema}
                </h3>
                <div className="cinematheques-focused-movie">
                  <button
                    ref={(element) => {
                      if (element) element.dataset.movieId = movie.tmdbId;
                    }}
                    className="cinematheques-poster-button cinematheques-focused-poster"
                    type="button"
                    aria-label={`View details for ${movie.title}`}
                    onClick={(event) => onOpenMovie(movie, event.currentTarget)}
                  >
                    <MoviePosterArtwork
                      title={movie.title}
                      tmdbId={movie.tmdbId}
                      imageSrc={movie.imageSrc}
                      imageSrcSet={movie.imageSrcSet}
                      imageSizes="160px"
                      alt=""
                      className="cinematheques-poster"
                      fallbackClassName="cinematheques-poster"
                      loading="lazy"
                    />
                  </button>
                  <div
                    className="cinematheques-times"
                    aria-label={`Showtimes for ${movie.title} at ${venue.cinema}`}
                  >
                    {venue.showtimes.map((showtime, index) => {
                      const label = `${movie.title} ${showtime.time} showtime at ${venue.cinema}`;
                      const key = `${showtime.time}-${showtime.screeningTech}-${showtime.screeningType}-${showtime.dubLanguage}-${index}`;
                      return showtime.href ? (
                        <a
                          key={key}
                          className="cinematheques-time"
                          style={{
                            background: colors.pillBackground ?? colors.accent,
                          }}
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
                          style={{
                            background: colors.pillBackground ?? colors.accent,
                          }}
                          aria-label={`${label}, ticket link unavailable`}
                        >
                          {showtime.time}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </section>
      ))}
    </>
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
