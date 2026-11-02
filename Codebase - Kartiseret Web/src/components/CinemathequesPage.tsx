import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { getShowtimeDateLabel, getTrailerEmbedUrl } from "./showtimes/showtimeUtils";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { cinemathequeQueryOptions } from "../data/cinemathequeCatalog";
import { buildCinemathequeSchedule } from "../data/cinematheques";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShowtimesMovieRow } from "./showtimes/ShowtimesMovieRow";
import { MovieTrailerModal } from "./showtimes/ShowtimeShared";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import "./AllShowtimesPage.css";
import "./CinemathequesPage.css";

export function CinemathequesPage() {
  const publicationRevision = usePublicationRevision();
  const displayPreferences = useMovieDisplayPreferences();
  const { preferenceLocation, sources } = useUserPreferencesStore(
    useShallow((state) => ({
      preferenceLocation: state.preferences.location,
      sources: state.preferences.ratingSources,
    })),
  );
  const [location, setLocation] = useState(preferenceLocation);
  const [openTrailerMovieId, setOpenTrailerMovieId] = useState<string | null>(
    null,
  );
  const cinemathequeQuery = useQuery({
    ...cinemathequeQueryOptions(location, publicationRevision),
    enabled: displayPreferences.ready,
  });
  const rawMovies = cinemathequeQuery.data?.movies;
  const nowPlayingMovies = useMemo(
    () =>
      displayPreferences.ready
        ? applyMovieDisplayPreferences(
            rawMovies ?? [],
            displayPreferences.preferencesById,
          )
        : [],
    [displayPreferences.preferencesById, displayPreferences.ready, rawMovies],
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
                  <div className="all-showtimes-movie-list">
                    {movies.map(({ movie, theaters }) => (
                      <ShowtimesMovieRow
                        key={movie.tmdbId}
                        movie={movie}
                        theaters={theaters}
                        sources={sources}
                        onOpenTrailer={setOpenTrailerMovieId}
                      />
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
