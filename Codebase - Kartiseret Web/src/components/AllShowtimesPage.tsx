import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { allNowPlayingMovies, fixedAppDateString, getMovieCatalogStatusSnapshot, getMovieShowtimeDays, INITIAL_SHOWTIME_WINDOW_DAY_COUNT, loadAdditionalShowtimeDays, loadShowtimesAroundDate, SHOWTIME_PREFETCH_CHUNK_DAY_COUNT, SHOWTIME_WINDOW_DAY_COUNT, subscribeToMovieCatalog, type Movie, type TheaterShowtimes } from "../data/movieCatalog";
import { loadCities, type City } from "../data/theaters";
import { MoviePosterArtwork } from "./MoviePosterArtwork";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { ShowtimeDayPicker } from "./showtimes/ShowtimeDayPicker";
import { MovieMetricsRow, MovieTrailerModal, ShowtimeTheaters } from "./showtimes/ShowtimeShared";
import { ShowtimeFilterMenu } from "./showtimes/ShowtimeFilterMenu";
import { getMetricDisplays, getMovieInfoParts, getShowtimeDateLabel, getShowtimeTargetDate, getTrailerEmbedUrl } from "./showtimes/showtimeUtils";
import { buildShowtimeFilterSelections, filterTheatersBySelections, getShowtimeFilterOptions, getShowtimeFiltersSnapshot, saveShowtimeFilters, subscribeToShowtimeFilters, updateShowtimeFilterState, type ShowtimeFilterOptions, type ShowtimeFilterSelections } from "./showtimes/showtimeFilters";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import "./AllShowtimesPage.css";
import { MapPin } from "lucide-react";

type ShowtimesMovieRowProps = {
  movie: Movie;
  theaters: readonly TheaterShowtimes[];
  sources: readonly RatingSource[];
  onOpenTrailer: (movieId: string) => void;
};

type ShowtimesDayPanel = {
  date: string;
  movies: Array<{
    movie: Movie;
    theaters: readonly TheaterShowtimes[];
  }>;
};

type NearbyCityChoice = {
  name: string;
};

function cityHasAnyShowtimesOnDate(cityName: string, date: string): boolean {
  return allNowPlayingMovies.some((movie) =>
    getMovieShowtimeDays(movie.tmdbId, cityName).some(
      (day) => day.date === date && day.theaters.length > 0,
    ));
}

function ShowtimesMovieRow({
  movie,
  theaters,
  sources,
  onOpenTrailer,
}: ShowtimesMovieRowProps) {
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

export function AllShowtimesPage() {
  const { location, sources, setLocationPreference } =
    useUserPreferencesContext();
  const showtimesVersion = useSyncExternalStore(
    subscribeToMovieCatalog,
    () => getMovieCatalogStatusSnapshot().showtimesVersion,
  );
  const [cities, setCities] = useState<readonly City[]>([]);
  const [selectedShowtimeDate, setSelectedShowtimeDate] = useState<
    string | null
  >(fixedAppDateString);
  const [openTrailerMovieId, setOpenTrailerMovieId] = useState<string | null>(
    null,
  );
  const [pendingNearbyCity, setPendingNearbyCity] = useState<string | null>(
    null,
  );
  const previousShowtimeLocationRef = useRef(location);
  const dayPanels = useMemo<ShowtimesDayPanel[]>(() => {
    if (allNowPlayingMovies.length === 0) {
      return [];
    }

    // Incremental showtime loading updates the shared store in place, so this
    // version token is the signal that the derived day panels should refresh.
    void showtimesVersion;
    const showtimeDaysByMovieId = new Map(
      allNowPlayingMovies.map((movie) => [
        movie.tmdbId,
        getMovieShowtimeDays(movie.tmdbId, location),
      ]),
    );
    const referenceDays =
      showtimeDaysByMovieId.get(allNowPlayingMovies[0].tmdbId) ?? [];

    return referenceDays.map((day, index) => ({
      date: day.date,
      movies: allNowPlayingMovies.flatMap((movie) => {
        const movieDay = showtimeDaysByMovieId.get(movie.tmdbId)?.[index];

        return movieDay && movieDay.theaters.length > 0
          ? [{ movie, theaters: movieDay.theaters }]
          : [];
      }),
    }));
  }, [location, showtimesVersion]);
  const resolvedShowtimeDate = getShowtimeTargetDate(
    dayPanels,
    selectedShowtimeDate ?? fixedAppDateString,
  );
  const selectedDayPanel = useMemo(
    () =>
      dayPanels.find((day) => day.date === resolvedShowtimeDate) ??
      dayPanels[0] ??
      null,
    [dayPanels, resolvedShowtimeDate],
  );
  const showtimeFilterState = useSyncExternalStore(
    subscribeToShowtimeFilters,
    getShowtimeFiltersSnapshot,
    getShowtimeFiltersSnapshot,
  );
  const allLoadedTheaters = useMemo(
    () =>
      dayPanels.flatMap((day) =>
        day.movies.flatMap(({ theaters }) => theaters)),
    [dayPanels],
  );
  const showtimeFilterOptions = useMemo<ShowtimeFilterOptions>(() => {
    if (allLoadedTheaters.length === 0) {
      return {
        showType: [],
        screenFormat: [],
        screeningTech: [],
        dubLanguage: ["Hebrew", "French"],
      };
    }

    return getShowtimeFilterOptions(allLoadedTheaters);
  }, [allLoadedTheaters]);
  const showtimeFilterSelections = useMemo<ShowtimeFilterSelections>(
    () =>
      buildShowtimeFilterSelections(showtimeFilterOptions, showtimeFilterState),
    [showtimeFilterOptions, showtimeFilterState],
  );
  const filteredSelectedDayPanel = useMemo(
    () =>
      selectedDayPanel
        ? {
            ...selectedDayPanel,
            movies: selectedDayPanel.movies.flatMap(({ movie, theaters }) => {
              const filteredTheaters = filterTheatersBySelections(
                theaters,
                showtimeFilterSelections,
              );

              return filteredTheaters.length > 0
                ? [{ movie, theaters: filteredTheaters }]
                : [];
            }),
          }
        : null,
    [selectedDayPanel, showtimeFilterSelections],
  );
  const hasFilteredOutAllSelectedDayMovies =
    selectedDayPanel !== null &&
    selectedDayPanel.movies.length > 0 &&
    filteredSelectedDayPanel !== null &&
    filteredSelectedDayPanel.movies.length === 0;
  const handleShowtimeFilterToggle = useCallback(
    (group: keyof ShowtimeFilterOptions, value: string) => {
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };
      const groupSet = nextSelections[group];
      const checked = groupSet.has(value);

      if (checked) {
        groupSet.delete(value);
      } else {
        groupSet.add(value);
      }

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      saveShowtimeFilters(nextState);
    },
    [showtimeFilterOptions, showtimeFilterSelections, showtimeFilterState],
  );
  const handleShowtimeFilterGroupToggle = useCallback(
    (group: keyof ShowtimeFilterOptions) => {
      const groupOptions = showtimeFilterOptions[group];
      const currentSelected = showtimeFilterSelections[group];
      const areAllSelected =
        groupOptions.length > 0 &&
        groupOptions.every((value) => currentSelected.has(value));
      const nextSelections: Record<keyof ShowtimeFilterOptions, Set<string>> = {
        showType: new Set(showtimeFilterSelections.showType),
        screenFormat: new Set(showtimeFilterSelections.screenFormat),
        screeningTech: new Set(showtimeFilterSelections.screeningTech),
        dubLanguage: new Set(showtimeFilterSelections.dubLanguage),
      };

      nextSelections[group] = areAllSelected
        ? new Set()
        : new Set(groupOptions);

      const nextState = updateShowtimeFilterState(
        showtimeFilterState,
        showtimeFilterOptions,
        nextSelections,
      );
      saveShowtimeFilters(nextState);
    },
    [showtimeFilterOptions, showtimeFilterSelections, showtimeFilterState],
  );
  const effectiveSelectedDayPanel =
    filteredSelectedDayPanel ?? selectedDayPanel;
  const openTrailerMovie = useMemo(
    () =>
      openTrailerMovieId
        ? allNowPlayingMovies.find(
            (movie) => movie.tmdbId === openTrailerMovieId,
          )
        : null,
    [openTrailerMovieId],
  );
  const openTrailerEmbedUrl = getTrailerEmbedUrl(openTrailerMovie?.trailerKey);
  const cityByName = useMemo(
    () => new Map(cities.map((city) => [city.name, city] as const)),
    [cities],
  );
  const nearbyCityChoices = useMemo<NearbyCityChoice[]>(() => {
    if (!selectedDayPanel || cities.length === 0) {
      return [];
    }

    const neighboringCityNames =
      cityByName
        .get(location)
        ?.neighboringCities.filter((cityName) =>
          cityHasAnyShowtimesOnDate(cityName, selectedDayPanel.date)) ?? [];
    const fallbackCityNames = cities
      .map((city) => city.name)
      .filter(
        (cityName) =>
          cityName !== location &&
          cityHasAnyShowtimesOnDate(cityName, selectedDayPanel.date),
      );
    const cityNamesToShow =
      neighboringCityNames.length > 0
        ? neighboringCityNames
        : fallbackCityNames;

    return [...new Set(cityNamesToShow)].map((name) => ({
      name,
    }));
  }, [cities, cityByName, location, selectedDayPanel]);

  const handleNearbyCityClick = useCallback(
    async (cityName: string) => {
      setPendingNearbyCity(cityName);

      try {
        await setLocationPreference(cityName);
      } finally {
        setPendingNearbyCity((current) =>
          current === cityName ? null : current);
      }
    },
    [setLocationPreference],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    if (previousShowtimeLocationRef.current === location) {
      return;
    }

    previousShowtimeLocationRef.current = location;
    void loadShowtimesAroundDate(
      location,
      selectedShowtimeDate ?? fixedAppDateString,
    ).catch((error: unknown) => {
      console.error("Could not load showtimes for the selected city.", error);
    });
  }, [location, selectedShowtimeDate]);

  useEffect(() => {
    let isActive = true;

    void loadCities()
      .then((nextCities) => {
        if (isActive) {
          setCities(nextCities);
        }
      })
      .catch((error: unknown) => {
        console.error("Could not load city metadata for all showtimes.", error);
      });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (
      dayPanels.length === 0 ||
      dayPanels.length > INITIAL_SHOWTIME_WINDOW_DAY_COUNT
    ) {
      return;
    }

    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const nextDayCount = Math.min(
      INITIAL_SHOWTIME_WINDOW_DAY_COUNT + SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
      SHOWTIME_WINDOW_DAY_COUNT,
    );
    const requestMoreDays = () => {
      void loadAdditionalShowtimeDays(location, nextDayCount).catch(() => {});
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          requestMoreDays();
        },
        { timeout: 1800 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        requestMoreDays();
      }, 700);
    }

    return () => {
      if (
        idleId !== null &&
        typeof windowWithIdleCallbacks.cancelIdleCallback === "function"
      ) {
        windowWithIdleCallbacks.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [dayPanels.length, location]);

  useEffect(() => {
    const selectedDayIndex = dayPanels.findIndex(
      (day) => day.date === resolvedShowtimeDate,
    );

    if (
      selectedDayIndex < 0 ||
      dayPanels.length >= SHOWTIME_WINDOW_DAY_COUNT ||
      selectedDayIndex < dayPanels.length - 3
    ) {
      return;
    }

    const nextDayCount = Math.min(
      dayPanels.length + SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
      SHOWTIME_WINDOW_DAY_COUNT,
    );

    void loadAdditionalShowtimeDays(location, nextDayCount).catch(() => {});
  }, [dayPanels, location, resolvedShowtimeDate]);

  return (
    <section className="all-showtimes-page" aria-label="All Showtimes">
      <div
        className="details-showtimes all-showtimes-day-picker-shell"
        aria-label="Showtime day picker"
      >
        <TheaterMapDialog
          className="all-showtimes-page-city city-map-trigger"
          triggerLabel={location}
        />
        <ShowtimeDayPicker
          className="all-showtimes-day-picker-scroll"
          ariaLabel="Choose showtime day"
          dates={dayPanels.map((day) => day.date)}
          selectedDate={resolvedShowtimeDate}
          disabledBeforeDate={fixedAppDateString}
          onSelect={(date) => {
            setSelectedShowtimeDate(date);
          }}
        />
        <ShowtimeFilterMenu
          className="all-showtimes-day-picker-filter"
          options={showtimeFilterOptions}
          selections={showtimeFilterSelections}
          onToggleOption={handleShowtimeFilterToggle}
          onToggleGroup={handleShowtimeFilterGroupToggle}
        />
      </div>

      <section
        className="details-showtimes all-showtimes-browser"
        aria-label={`All showtimes in ${location}`}
      >
        {effectiveSelectedDayPanel ? (
          <article
            className="details-day-panel all-showtimes-day-panel"
            data-showtime-date={effectiveSelectedDayPanel.date}
          >
            {effectiveSelectedDayPanel.movies.length === 0 ? (
              <div
                className="details-empty-state all-showtimes-empty-state"
                aria-label={
                  hasFilteredOutAllSelectedDayMovies
                    ? `No ${location} showtimes match current filters on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date)}`
                    : `No showtimes on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date)} in ${location}`
                }
              >
                <div className="details-empty-state-panel">
                  <p className="details-empty-state-title">
                    {hasFilteredOutAllSelectedDayMovies
                      ? `No ${location} showtimes match the active filters`
                      : `No showtimes on this day in ${location}`}
                  </p>

                  <div className="details-empty-actions all-showtimes-empty-actions">
                    <div
                      className="details-empty-nearby all-showtimes-empty-nearby"
                      aria-busy={pendingNearbyCity ? "true" : undefined}
                    >
                      <p className="details-empty-link-heading">
                        {hasFilteredOutAllSelectedDayMovies
                          ? "Try nearby city showtimes"
                          : "See showtimes in a nearby city"}
                      </p>

                      {nearbyCityChoices.length > 0 ? (
                        <div
                          className="details-empty-city-list"
                          aria-label={`Nearby cities with showtimes on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date)}`}
                        >
                          {nearbyCityChoices.map((city) => (
                            <button
                              key={city.name}
                              type="button"
                              className="details-empty-city-button"
                              disabled={pendingNearbyCity !== null}
                              onClick={() => {
                                void handleNearbyCityClick(city.name);
                              }}
                            >
                              <MapPin
                                size={14}
                                strokeWidth={2.2}
                                className="details-empty-city-icon"
                                aria-hidden="true"
                              />
                              <span>
                                {pendingNearbyCity === city.name
                                  ? `Switching to ${city.name}...`
                                  : city.name}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="details-empty-note">
                          No nearby cities have showtimes on this day.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="all-showtimes-movie-list">
                {effectiveSelectedDayPanel.movies.map(({ movie, theaters }) => (
                  <ShowtimesMovieRow
                    key={`${effectiveSelectedDayPanel.date}-${movie.tmdbId}`}
                    movie={movie}
                    theaters={theaters}
                    sources={sources}
                    onOpenTrailer={setOpenTrailerMovieId}
                  />
                ))}
              </div>
            )}
          </article>
        ) : (
          <article
            className="details-day-panel all-showtimes-day-panel"
            data-showtime-date={fixedAppDateString}
          >
            <p className="details-day-empty">No showtimes listed.</p>
          </article>
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
