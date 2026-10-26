import { buildCinemathequeDateRange, cinemathequeQueryOptions, getCinemathequeDateRange } from "../data/cinemathequeCatalog";
import { getShowtimeDateLabel, getShowtimeTargetDate, getTrailerEmbedUrl } from "./showtimes/showtimeUtils";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { buildCinemathequeShowtimesByDate } from "../data/cinematheques";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import type { CinemathequeShowtimesDay } from "../data/cinematheques";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShowtimeDayPicker } from "./showtimes/ShowtimeDayPicker";
import { ShowtimesMovieRow } from "./showtimes/ShowtimesMovieRow";
import { MovieTrailerModal } from "./showtimes/ShowtimeShared";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { fixedAppDateString } from "../data/movieCatalog";
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
  const [selectedShowtimeDate, setSelectedShowtimeDate] =
    useState(fixedAppDateString);
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
  const range = getCinemathequeDateRange();
  const dates = useMemo(
    () => buildCinemathequeDateRange(range.startDate, range.endDate),
    [range.endDate, range.startDate],
  );
  const dayPanels = useMemo<CinemathequeShowtimesDay[]>(
    () =>
      cinemathequeQuery.data
        ? buildCinemathequeShowtimesByDate(
            nowPlayingMovies,
            cinemathequeQuery.data.showtimes,
            dates,
          )
        : [],
    [cinemathequeQuery.data, dates, nowPlayingMovies],
  );
  const resolvedShowtimeDate = getShowtimeTargetDate(
    dayPanels,
    selectedShowtimeDate,
  );
  const selectedDayPanel = useMemo(
    () => dayPanels.find((day) => day.date === resolvedShowtimeDate) ?? null,
    [dayPanels, resolvedShowtimeDate],
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
    setSelectedShowtimeDate(fixedAppDateString);
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
        aria-label="Cinematheque showtime day picker"
      >
        <TheaterMapDialog
          className="all-showtimes-page-city city-map-trigger"
          locationOverride={location}
          onLocationOverrideChange={handleLocationChange}
          triggerLabel={location}
        />
        <ShowtimeDayPicker
          className="all-showtimes-day-picker-scroll"
          ariaLabel="Choose cinematheque showtime day"
          dates={dayPanels.map((day) => day.date)}
          selectedDate={resolvedShowtimeDate}
          disabledBeforeDate={fixedAppDateString}
          onSelect={setSelectedShowtimeDate}
        />
      </div>

      <section
        className="details-showtimes all-showtimes-browser"
        aria-label={`Cinematheque showtimes in ${location}`}
      >
        <article
          className="details-day-panel all-showtimes-day-panel"
          data-showtime-date={resolvedShowtimeDate ?? fixedAppDateString}
        >
          {isLoading ? (
            <p className="details-day-empty" role="status">
              Loading cinematheque showtimes…
            </p>
          ) : cinemathequeQuery.isError ? (
            <p className="details-day-empty" role="alert">
              Could not load cinematheque showtimes.
            </p>
          ) : selectedDayPanel?.movies.length ? (
            <div className="all-showtimes-movie-list">
              {selectedDayPanel.movies.map(({ movie, theaters }) => (
                <ShowtimesMovieRow
                  key={`${selectedDayPanel.date}-${movie.tmdbId}`}
                  movie={movie}
                  theaters={theaters}
                  sources={sources}
                  onOpenTrailer={setOpenTrailerMovieId}
                />
              ))}
            </div>
          ) : (
            <div className="details-empty-state all-showtimes-empty-state">
              <div className="details-empty-state-panel">
                <p className="details-empty-state-title">
                  {selectedDayPanel
                    ? `No cinematheque showtimes on ${getShowtimeDateLabel(selectedDayPanel.date)} in ${location}`
                    : `No cinematheque showtimes listed in ${location}`}
                </p>
              </div>
            </div>
          )}
        </article>
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
