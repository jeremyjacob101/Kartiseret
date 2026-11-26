import { getNextShowtimePrefetchDayCount, loadAdditionalShowtimeDays, loadShowtimesAroundDate, movieCollectionQueryOptions, selectBroadMovieShowtimeDays, selectMovies, showtimeCityQueryOptions, SHOWTIME_PREFETCH_CHUNK_DAY_COUNT, SHOWTIME_WINDOW_DAY_COUNT, type Movie, type ShowtimeCityData, type ShowtimeEntry, type TheaterShowtimes } from "../data/movieCatalog";
import { buildShowtimeFilterSelections, filterTheatersBySelections, getShowtimeFilterOptions, updateShowtimeFilterState, type ShowtimeFilterOptions, type ShowtimeFilterSelections } from "./showtimes/showtimeFilters";
import { filterMoviesByReleaseCategory, MOVIE_RELEASE_CATEGORY_LABELS, type MovieReleaseCategory } from "../domain/movieRelease";
import { getShowtimeDateLabel, getShowtimeTargetDate, getTrailerEmbedUrl } from "./showtimes/showtimeUtils";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { ALL_LOCATIONS, type AppLocation } from "../prefs/definitions/locations";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { usePublicRenderClock } from "../contexts/PublicRenderClock";
import { ShowtimeFilterMenu } from "./showtimes/ShowtimeFilterMenu";
import { ReleaseCategorySwitcher } from "./ReleaseCategorySwitcher";
import { ShowtimesMovieRow } from "./showtimes/ShowtimesMovieRow";
import { ShowtimeDayPicker } from "./showtimes/ShowtimeDayPicker";
import { MovieTrailerModal } from "./showtimes/ShowtimeShared";
import { useQueries, useQuery } from "@tanstack/react-query";
import { theaterDataQueryOptions } from "../data/theaters";
import { TheaterMapDialog } from "./maps/TheaterMapDialog";
import { useShallow } from "zustand/react/shallow";
import "./AllShowtimesPage.css";
import { getShowtimesCityFromPath, getShowtimesCityPath } from "@kartiseret/contracts/showtime-routes";
import { getCinemaIdentitiesForCity } from "@kartiseret/contracts/cinema-identities";
import { useShowtimeViewPreferences } from "./showtimes/useShowtimeViewPreferences";
import { type PublicCinemaPageData } from "@kartiseret/contracts/public-data";
import { usePublicRoutePaths } from "../routing/PublicRoutePathsContext";
import { usePublicRouteLocation } from "../routing/PublicRouteLocation";
import { addCalendarDays } from "@kartiseret/contracts/showtime-links";
import { normalizeLocation } from "../prefs/definitions/locations";
import { PublicRouteLink } from "../routing/PublicRouteLink";
import { CinemaRouteLink } from "../routing/CinemaRouteLink";
import { getOpaquePublicPath } from "../data/publicRoutes";
import { useNavigate } from "react-router";
import { MapPin } from "lucide-react";

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

export function AllShowtimesPage({
  cinema,
}: {
  cinema?: PublicCinemaPageData;
}) {
  const { cinemaDate } = usePublicRenderClock();
  const routeLocation = usePublicRouteLocation();
  const navigate = useNavigate();
  const publicRoutePaths = usePublicRoutePaths();
  const routeCity = getShowtimesCityFromPath(routeLocation.pathname);
  const publicationRevision = usePublicationRevision();
  const displayPreferences = useMovieDisplayPreferences();
  const { sources, hideReReleases } = useUserPreferencesStore(
    useShallow((state) => ({
      sources: state.preferences.ratingSources,
      hideReReleases: state.preferences.hideReReleases,
    })),
  );
  const viewPreferences = useShowtimeViewPreferences(
    cinema ? `cinema:${cinema.id}` : "all-showtimes",
  );
  const {
    screeningFilters: showtimeFilterState,
    excludedCinemaIds: showtimeExcludedCinemaIds,
    ready: showtimePreferencesReady,
    loadError: showtimePreferencesLoadError,
    retry: retryShowtimePreferences,
    setScreeningFilters,
    setExcludedCinemaIds,
    setLocation,
    showEverything,
    restoreDefaults,
  } = viewPreferences;
  const requestedLocation = cinema
    ? normalizeLocation(cinema.city)
    : (routeCity ?? viewPreferences.location);
  const { data: rawNowPlayingMovies = [] } = useQuery({
    ...movieCollectionQueryOptions("nowPlaying"),
    select: selectMovies,
  });
  const cinemaMovies = useMemo(
    () =>
      cinema
        ? [
            ...new Map(
              cinema.screenings.map(({ movie }) => [movie.tmdbId, movie]),
            ).values(),
          ]
        : [],
    [cinema],
  );
  const displayFilteredNowPlayingMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        cinema ? cinemaMovies : rawNowPlayingMovies,
        displayPreferences.preferencesById,
      ),
    [
      cinema,
      cinemaMovies,
      displayPreferences.preferencesById,
      rawNowPlayingMovies,
    ],
  );
  const [releaseCategory, setReleaseCategory] =
    useState<MovieReleaseCategory>("newReleases");
  const displayReleaseCategory = hideReReleases
    ? "newReleases"
    : releaseCategory;
  const nowPlayingMovies = useMemo(
    () =>
      filterMoviesByReleaseCategory(
        displayFilteredNowPlayingMovies,
        displayReleaseCategory,
      ),
    [displayFilteredNowPlayingMovies, displayReleaseCategory],
  );
  const showtimeCities = useMemo(
    () =>
      cinema ? [] : [...new Set<string>([...ALL_LOCATIONS, requestedLocation])],
    [cinema, requestedLocation],
  );
  const showtimeCityQueries = useQueries({
    queries: showtimeCities.map((city) => ({
      ...showtimeCityQueryOptions(city, publicationRevision),
      enabled: city === requestedLocation,
    })),
  });
  const showtimeDataByCity = useMemo(
    () =>
      new Map<string, ShowtimeCityData>(
        showtimeCities.flatMap((city, index) => {
          const data = showtimeCityQueries[index]?.data as
            ShowtimeCityData | undefined;

          return data ? [[city, data] as const] : [];
        }),
      ),
    [showtimeCities, showtimeCityQueries],
  );
  const [lastReadyLocation, setLastReadyLocation] = useState(requestedLocation);
  const requestedCityReady =
    showtimeDataByCity.get(requestedLocation)?.broadReady;
  if (requestedCityReady && requestedLocation !== lastReadyLocation) {
    setLastReadyLocation(requestedLocation);
  }
  const location =
    !cinema &&
    !routeCity &&
    !requestedCityReady &&
    showtimeDataByCity.get(lastReadyLocation)?.broadReady
      ? lastReadyLocation
      : requestedLocation;
  const selectedCityShowtimeData = showtimeDataByCity.get(location);
  const { data: theaterData } = useQuery(theaterDataQueryOptions());
  const cities = useMemo(
    () => theaterData?.cities ?? [],
    [theaterData?.cities],
  );
  const [selectedShowtimeDate, setSelectedShowtimeDate] = useState<
    string | null
  >(cinemaDate);
  const selectedShowtimeDateForToday =
    selectedShowtimeDate && selectedShowtimeDate >= cinemaDate
      ? selectedShowtimeDate
      : cinemaDate;
  const [openTrailerMovieId, setOpenTrailerMovieId] = useState<string | null>(
    null,
  );
  const previousShowtimeLocationRef = useRef(location);
  const requestedShowtimePrefetchRef = useRef<string | null>(null);
  const handleReleaseCategoryChange = useCallback((
    category: MovieReleaseCategory,
  ) => {
    setReleaseCategory(category);
    setOpenTrailerMovieId(null);
  }, []);
  const dayPanels = useMemo<ShowtimesDayPanel[]>(() => {
    if (nowPlayingMovies.length === 0) {
      return [];
    }

    if (cinema) {
      const selectedMovieIds = new Set(
        nowPlayingMovies.map(({ tmdbId }) => tmdbId),
      );
      const moviesByDate = new Map<
        string,
        Map<string, { movie: Movie; entries: ShowtimeEntry[] }>
      >();
      for (const { movie, screening } of cinema.screenings) {
        if (!selectedMovieIds.has(movie.tmdbId)) continue;
        let movies = moviesByDate.get(screening.dateOfShowing);
        if (!movies) {
          movies = new Map();
          moviesByDate.set(screening.dateOfShowing, movies);
        }
        let dayMovie = movies.get(movie.tmdbId);
        if (!dayMovie) {
          dayMovie = { movie, entries: [] };
          movies.set(movie.tmdbId, dayMovie);
        }
        const entry: ShowtimeEntry = {
          time: screening.showtime.trim().slice(0, 5),
          href: screening.englishHref || null,
          screeningTech: screening.screeningTech,
          screeningType: screening.screeningType,
          dubLanguage: screening.dubLanguage,
        };
        if (
          !dayMovie.entries.some(
            (existing) =>
              existing.time === entry.time &&
              existing.screeningTech === entry.screeningTech &&
              existing.screeningType === entry.screeningType &&
              existing.dubLanguage === entry.dubLanguage,
          )
        ) {
          dayMovie.entries.push(entry);
        }
      }
      const dateRange: string[] = [];
      for (let offset = 0; offset < SHOWTIME_WINDOW_DAY_COUNT; offset += 1) {
        const date = addCalendarDays(cinemaDate, offset);
        if (!date) break;
        dateRange.push(date);
      }
      return dateRange.map((date) => ({
        date,
        movies: nowPlayingMovies.flatMap((movie) => {
          const dayMovie = moviesByDate.get(date)?.get(movie.tmdbId);
          return dayMovie
            ? [
                {
                  movie,
                  theaters: [
                    {
                      theater: cinema.displayName,
                      showtimes: [...dayMovie.entries].sort((left, right) =>
                        left.time.localeCompare(right.time)),
                    },
                  ],
                },
              ]
            : [];
        }),
      }));
    }

    const showtimeDaysByMovieId = new Map(
      nowPlayingMovies.map((movie) => [
        movie.tmdbId,
        selectBroadMovieShowtimeDays(selectedCityShowtimeData, movie.tmdbId),
      ]),
    );
    const referenceDays =
      showtimeDaysByMovieId.get(nowPlayingMovies[0].tmdbId) ?? [];

    return referenceDays.map((day, index) => ({
      date: day.date,
      movies: nowPlayingMovies.flatMap((movie) => {
        const movieDay = showtimeDaysByMovieId.get(movie.tmdbId)?.[index];

        return movieDay && movieDay.theaters.length > 0
          ? [{ movie, theaters: movieDay.theaters }]
          : [];
      }),
    }));
  }, [cinema, cinemaDate, nowPlayingMovies, selectedCityShowtimeData]);
  const resolvedShowtimeDate = getShowtimeTargetDate(
    dayPanels,
    selectedShowtimeDateForToday,
  );
  const selectedDayPanel = useMemo(
    () =>
      dayPanels.find((day) => day.date === resolvedShowtimeDate) ??
      dayPanels[0] ??
      null,
    [dayPanels, resolvedShowtimeDate],
  );
  const excludedCinemaIds = useMemo(
    () => new Set(showtimeExcludedCinemaIds),
    [showtimeExcludedCinemaIds],
  );
  const allLoadedTheaters = useMemo(
    () =>
      dayPanels.flatMap((day) =>
        day.movies.flatMap(({ theaters }) => theaters)),
    [dayPanels],
  );
  const showtimeFilterOptions = useMemo<ShowtimeFilterOptions>(
    () => getShowtimeFilterOptions(allLoadedTheaters),
    [allLoadedTheaters],
  );
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
                cinema
                  ? undefined
                  : {
                      screeningCity: location,
                      excludedCinemaIds: showtimeExcludedCinemaIds,
                    },
              );

              return filteredTheaters.length > 0
                ? [{ movie, theaters: filteredTheaters }]
                : [];
            }),
          }
        : null,
    [
      selectedDayPanel,
      showtimeFilterSelections,
      location,
      showtimeExcludedCinemaIds,
      cinema,
    ],
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
      setScreeningFilters(nextState);
    },
    [
      showtimeFilterOptions,
      showtimeFilterSelections,
      showtimeFilterState,
      setScreeningFilters,
    ],
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
      setScreeningFilters(nextState);
    },
    [
      showtimeFilterOptions,
      showtimeFilterSelections,
      showtimeFilterState,
      setScreeningFilters,
    ],
  );
  const handleCinemaToggle = useCallback(
    (cinemaId: string) => {
      const next = excludedCinemaIds.has(cinemaId)
        ? showtimeExcludedCinemaIds.filter((id) => id !== cinemaId)
        : [...showtimeExcludedCinemaIds, cinemaId];
      setExcludedCinemaIds(next);
    },
    [excludedCinemaIds, showtimeExcludedCinemaIds, setExcludedCinemaIds],
  );
  const handleCinemaGroupToggle = useCallback(() => {
    const cityCinemaIds = getCinemaIdentitiesForCity(location).map(
      ({ id }) => id,
    );
    const allIncluded = cityCinemaIds.every((id) => !excludedCinemaIds.has(id));
    const next = allIncluded
      ? [...new Set([...showtimeExcludedCinemaIds, ...cityCinemaIds])]
      : showtimeExcludedCinemaIds.filter((id) => !cityCinemaIds.includes(id));
    setExcludedCinemaIds(next);
  }, [
    excludedCinemaIds,
    location,
    showtimeExcludedCinemaIds,
    setExcludedCinemaIds,
  ]);
  const handleLocationOverrideChange = useCallback(
    async (nextLocation: AppLocation) => {
      const cityPath = getShowtimesCityPath(nextLocation);
      try {
        const opaquePath = await getOpaquePublicPath(
          cityPath,
          publicRoutePaths,
        );
        setLocation(nextLocation);
        navigate(opaquePath);
        return true;
      } catch {
        return false;
      }
    },
    [navigate, publicRoutePaths, setLocation],
  );
  const handleRestoreDefaults = useCallback(() => {
    restoreDefaults();
    if (!cinema && routeCity) {
      void getOpaquePublicPath("/showtimes", publicRoutePaths)
        .then((path) => navigate(path))
        .catch(() => undefined);
    }
  }, [cinema, navigate, publicRoutePaths, restoreDefaults, routeCity]);
  const effectiveSelectedDayPanel =
    filteredSelectedDayPanel ?? selectedDayPanel;
  const openTrailerMovie = useMemo(
    () =>
      openTrailerMovieId
        ? nowPlayingMovies.find((movie) => movie.tmdbId === openTrailerMovieId)
        : null,
    [nowPlayingMovies, openTrailerMovieId],
  );
  const openTrailerEmbedUrl = getTrailerEmbedUrl(openTrailerMovie?.trailerKey);
  const cityByName = useMemo(
    () => new Map(cities.map((city) => [city.name, city] as const)),
    [cities],
  );
  const cityHasVisibleShowtimesOnDate = useCallback(
    (cityName: string, date: string) => {
      const cityData = showtimeDataByCity.get(cityName);
      return nowPlayingMovies.some((movie) =>
        selectBroadMovieShowtimeDays(cityData, movie.tmdbId).some(
          (day) => day.date === date && day.theaters.length > 0,
        ));
    },
    [nowPlayingMovies, showtimeDataByCity],
  );
  const nearbyCityChoices = useMemo<NearbyCityChoice[]>(() => {
    if (cinema || !selectedDayPanel || cities.length === 0) {
      return [];
    }

    const neighboringCityNames =
      cityByName
        .get(location)
        ?.neighboringCities.filter((cityName) =>
          cityHasVisibleShowtimesOnDate(cityName, selectedDayPanel.date)) ?? [];
    const fallbackCityNames = cities
      .map((city) => city.name)
      .filter(
        (cityName) =>
          cityName !== location &&
          cityHasVisibleShowtimesOnDate(cityName, selectedDayPanel.date),
      );
    const cityNamesToShow =
      neighboringCityNames.length > 0
        ? neighboringCityNames
        : fallbackCityNames;

    return [...new Set(cityNamesToShow)].map((name) => ({
      name,
    }));
  }, [
    cities,
    cityByName,
    cityHasVisibleShowtimesOnDate,
    cinema,
    location,
    selectedDayPanel,
  ]);

  const handleNearbyCityClick = useCallback(
    (cityName: string) => {
      void handleLocationOverrideChange(cityName);
    },
    [handleLocationOverrideChange],
  );

  const handleShowtimePreviewDateChange = useCallback(
    (date: string) => {
      if (cinema) return;
      const previewDayIndex = dayPanels.findIndex((day) => day.date === date);
      const nextDayCount = getNextShowtimePrefetchDayCount(
        dayPanels.length,
        previewDayIndex,
      );

      if (nextDayCount === null) {
        return;
      }

      const requestKey = `${location}:${nextDayCount}`;

      if (requestedShowtimePrefetchRef.current === requestKey) {
        return;
      }

      requestedShowtimePrefetchRef.current = requestKey;
      void loadAdditionalShowtimeDays(location, nextDayCount).catch(() => {
        if (requestedShowtimePrefetchRef.current === requestKey) {
          requestedShowtimePrefetchRef.current = null;
        }
      });
    },
    [cinema, dayPanels, location],
  );

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  useEffect(() => {
    if (cinema || previousShowtimeLocationRef.current === location) {
      return;
    }

    previousShowtimeLocationRef.current = location;
    void loadShowtimesAroundDate(location, selectedShowtimeDateForToday).catch((
      error: unknown,
    ) => {
      console.error("Could not load showtimes for the selected city.", error);
    });
  }, [cinema, location, selectedShowtimeDateForToday]);

  useEffect(() => {
    // The server-rendered week is shorter than the first prefetch chunk.
    if (
      cinema ||
      dayPanels.length === 0 ||
      dayPanels.length >= SHOWTIME_PREFETCH_CHUNK_DAY_COUNT
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
      SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
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
  }, [cinema, dayPanels.length, location]);

  return (
    <section
      className={`all-showtimes-page${cinema ? " cinema-showtimes-page" : ""}`}
      aria-label={cinema ? `${cinema.displayName} showtimes` : "All Showtimes"}
    >
      {!showtimePreferencesReady ? (
        <p
          className="app-inline-note"
          role={showtimePreferencesLoadError ? "alert" : "status"}
        >
          {showtimePreferencesLoadError
            ? "Your showtime preferences could not be loaded."
            : "Loading your showtime preferences…"}
          {showtimePreferencesLoadError ? (
            <button type="button" onClick={retryShowtimePreferences}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
      {cinema ? (
        <header className="cinema-showtimes-context">
          <p className="section-kicker">Cinema · {cinema.city}</p>
          <h1 className="section-title">{cinema.displayName} showtimes</h1>
          {cinema.displayName.toLocaleLowerCase("en").includes("planet") ? (
            <p className="cinema-showtimes-alias">
              Also known as Yes Planet {cinema.city}
            </p>
          ) : null}
          {cinema.address ? <p>{cinema.address}</p> : null}
          <div className="cinema-showtimes-context-links">
            <a href={cinema.mapUrl} target="_blank" rel="noreferrer">
              View location
            </a>
            <PublicRouteLink to={getShowtimesCityPath(location)}>
              More showtimes in {location}
            </PublicRouteLink>
          </div>
        </header>
      ) : null}
      <div className="catalog-page-header all-showtimes-page-header">
        <div>
          <p className="section-kicker">
            {cinema
              ? `Showtimes at ${cinema.displayName}`
              : routeCity
                ? `Movie showtimes in ${routeCity}`
                : "All Showtimes in Israel"}
          </p>
          {cinema ? (
            <h2 className="section-title">
              {MOVIE_RELEASE_CATEGORY_LABELS[displayReleaseCategory]}
            </h2>
          ) : (
            <h1 className="section-title">
              {MOVIE_RELEASE_CATEGORY_LABELS[displayReleaseCategory]}
              {routeCity ? ` in ${routeCity}` : ""}
            </h1>
          )}
        </div>
        {hideReReleases ? null : (
          <ReleaseCategorySwitcher
            category={displayReleaseCategory}
            onChange={handleReleaseCategoryChange}
            routeLabel="All Showtimes"
          />
        )}
      </div>

      {nowPlayingMovies.length > 0 ? (
        <>
          <div
            className="details-showtimes all-showtimes-day-picker-shell"
            aria-label="Showtime day picker"
          >
            {cinema ? (
              <div className="cinema-showtimes-city-label">
                <MapPin size={16} aria-hidden="true" />
                <span>{cinema.city}</span>
              </div>
            ) : (
              <TheaterMapDialog
                className="all-showtimes-page-city city-map-trigger"
                triggerLabel={location}
                locationOverride={location}
                onLocationOverrideChange={handleLocationOverrideChange}
              />
            )}
            <ShowtimeDayPicker
              className="all-showtimes-day-picker-scroll"
              ariaLabel="Choose showtime day"
              dates={dayPanels.map((day) => day.date)}
              selectedDate={resolvedShowtimeDate}
              disabledBeforeDate={cinemaDate}
              trailingPlaceholderCount={
                cinema
                  ? 0
                  : Math.min(
                      dayPanels.length < SHOWTIME_PREFETCH_CHUNK_DAY_COUNT
                        ? SHOWTIME_PREFETCH_CHUNK_DAY_COUNT - dayPanels.length
                        : SHOWTIME_PREFETCH_CHUNK_DAY_COUNT,
                      SHOWTIME_WINDOW_DAY_COUNT - dayPanels.length,
                    )
              }
              onPreviewDateChange={handleShowtimePreviewDateChange}
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
              cinemas={cinema ? [] : getCinemaIdentitiesForCity(location)}
              excludedCinemaIds={cinema ? new Set() : excludedCinemaIds}
              onToggleCinema={cinema ? undefined : handleCinemaToggle}
              onToggleCinemaGroup={cinema ? undefined : handleCinemaGroupToggle}
              onShowEverything={showEverything}
              onRestoreDefaults={handleRestoreDefaults}
            />
          </div>

          <section
            className="details-showtimes all-showtimes-browser"
            aria-label={
              cinema
                ? `All showtimes at ${cinema.displayName}`
                : `All showtimes in ${location}`
            }
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
                        ? cinema
                          ? `No showtimes match current filters at ${cinema.displayName} on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date, cinemaDate)}`
                          : `No ${location} showtimes match current filters on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date, cinemaDate)}`
                        : cinema
                          ? `No showtimes on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date, cinemaDate)} at ${cinema.displayName}`
                          : `No showtimes on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date, cinemaDate)} in ${location}`
                    }
                  >
                    <div className="details-empty-state-panel">
                      <p className="details-empty-state-title">
                        {hasFilteredOutAllSelectedDayMovies
                          ? cinema
                            ? `No showtimes at ${cinema.displayName} match the active filters`
                            : `No ${location} showtimes match the active filters`
                          : cinema
                            ? `No showtimes on this day at ${cinema.displayName}`
                            : `No showtimes on this day in ${location}`}
                      </p>

                      {cinema ? (
                        <PublicRouteLink
                          to={getShowtimesCityPath(location)}
                          className="details-empty-city-button"
                        >
                          Browse more showtimes in {location}
                        </PublicRouteLink>
                      ) : (
                        <div className="details-empty-actions all-showtimes-empty-actions">
                          {hasFilteredOutAllSelectedDayMovies ? (
                            <div className="details-empty-nearby">
                              <button
                                type="button"
                                className="details-empty-city-button"
                                onClick={showEverything}
                              >
                                Show everything
                              </button>
                              <PublicRouteLink
                                to="/user"
                                className="details-empty-city-button"
                              >
                                Change saved preferences
                              </PublicRouteLink>
                            </div>
                          ) : null}
                          <div className="details-empty-nearby all-showtimes-empty-nearby">
                            <p className="details-empty-link-heading">
                              {hasFilteredOutAllSelectedDayMovies
                                ? "Try nearby city showtimes"
                                : "See showtimes in a nearby city"}
                            </p>

                            {nearbyCityChoices.length > 0 ? (
                              <div
                                className="details-empty-city-list"
                                aria-label={`Nearby cities with showtimes on ${getShowtimeDateLabel(effectiveSelectedDayPanel.date, cinemaDate)}`}
                              >
                                {nearbyCityChoices.map((city) => (
                                  <button
                                    key={city.name}
                                    type="button"
                                    className="details-empty-city-button"
                                    onClick={() => {
                                      handleNearbyCityClick(city.name);
                                    }}
                                  >
                                    <MapPin
                                      size={14}
                                      strokeWidth={2.2}
                                      className="details-empty-city-icon"
                                      aria-hidden="true"
                                    />
                                    <span>{city.name}</span>
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
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="all-showtimes-movie-list">
                    {effectiveSelectedDayPanel.movies.map(({
                      movie,
                      theaters,
                    }) => (
                      <ShowtimesMovieRow
                        key={`${effectiveSelectedDayPanel.date}-${movie.tmdbId}`}
                        movie={movie}
                        theaters={theaters}
                        city={location}
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
                data-showtime-date={cinemaDate}
              >
                <p className="details-day-empty">No showtimes listed.</p>
              </article>
            )}
          </section>
        </>
      ) : (
        <section className="details-showtimes all-showtimes-empty-category">
          <p className="details-day-empty" role="status">
            No{" "}
            {MOVIE_RELEASE_CATEGORY_LABELS[
              displayReleaseCategory
            ].toLowerCase()}{" "}
            with showtimes are currently available{" "}
            {cinema ? `at ${cinema.displayName}` : `in ${location}`}.
          </p>
        </section>
      )}

      {!cinema ? (
        <nav
          className="all-showtimes-local-links"
          aria-label="Browse local showtimes"
        >
          <details>
            <summary>Browse showtimes by city in Israel</summary>
            <ul className="all-showtimes-city-links">
              {ALL_LOCATIONS.map((city) => (
                <li key={city}>
                  <PublicRouteLink to={getShowtimesCityPath(city)}>
                    Movie showtimes in {city}
                  </PublicRouteLink>
                </li>
              ))}
            </ul>
          </details>
          {routeCity ? (
            <details>
              <summary>Browse cinemas in {location}</summary>
              <ul className="all-showtimes-city-links">
                {getCinemaIdentitiesForCity(location)
                  .filter((identity) =>
                    identity.locationKeys.some((key) =>
                      theaterData?.theaters.some(
                        (theater) => theater.location.trim() === key,
                      )))
                  .map((identity) => (
                    <li key={identity.id}>
                      <CinemaRouteLink cinemaId={identity.id}>
                        {identity.displayName} showtimes
                      </CinemaRouteLink>
                    </li>
                  ))}
              </ul>
            </details>
          ) : null}
        </nav>
      ) : null}

      <div className="all-showtimes-cinematheque-link">
        <PublicRouteLink
          className="cinematheque-link-button"
          to="/cinematheques"
        >
          Cinematheque showtimes
        </PublicRouteLink>
      </div>

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
