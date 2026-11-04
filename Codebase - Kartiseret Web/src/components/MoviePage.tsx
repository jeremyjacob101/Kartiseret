import { buildMovieShowtimeShareUrl, CURRENT_CITY_CODE, decodeDateCode, encodeDateCode, encodeMovieRouteCode, filterMaskFromUnchecked, getExplicitCityCode, isDateInShowtimeLinkWindow, parseMovieRouteCode, resolveCityCode, uncheckedFromFilterMask, type MovieRouteMode } from "@kartiseret/contracts/showtime-links";
import { findMovieByCode, isMovieShowtimeDateCovered, isValidMovieCode, mergeMovieShowtimeRangeResult, prefetchMovieShowtimesAfterDate, showtimeCityQueryOptions, showtimeRangeQueryOptions, type ShowtimeRange } from "../data/movieCatalog";
import { getShowtimeFiltersSnapshot, saveShowtimeFilters, type ShowtimeFilterState } from "./showtimes/showtimeFilters";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { applyMovieDisplayPreference } from "../data/movieDisplayPreferences";
import { socialPreviewImageUrl } from "@kartiseret/contracts/social-preview";
import { usePublicationRevision } from "../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { usePublicRenderClock } from "../contexts/PublicRenderClock";
import { MovieDetailsContent } from "./scroller/MovieDetailsContent";
import { safeSeoUrl, setSeoMetadata } from "../routing/seoMetadata";
import { DEFAULT_LOCATION } from "../prefs/definitions/locations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { shareLink } from "../routing/shareLink";
import "./scroller/MovieScroller.css";
import "./MoviePage.css";

const SHARE_FEEDBACK_DURATION_MS = 2_200;

type MoviePageProps = {
  catalogError: string | null;
  catalogReady: boolean;
  movieCodesReady: boolean;
};

type MoviePageStateProps = {
  message: string;
  title: string;
};

type MoviePageQueryState = {
  movieCode: string;
  cityCode: string;
  location: string;
  date: string;
  filterMask: number;
  filterState: ShowtimeFilterState;
  mode: MovieRouteMode;
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

function createDefaultFilterState(): ShowtimeFilterState {
  return {
    version: 3,
    unchecked: {
      showType: [],
      screenFormat: [],
      screeningTech: [],
      dubLanguage: [],
    },
  };
}

function copyFilterState(
  state: ShowtimeFilterState | null,
): ShowtimeFilterState {
  return {
    version: 3,
    unchecked: {
      showType: [...(state?.unchecked.showType ?? [])],
      screenFormat: [...(state?.unchecked.screenFormat ?? [])],
      screeningTech: [...(state?.unchecked.screeningTech ?? [])],
      dubLanguage: [...(state?.unchecked.dubLanguage ?? [])],
    },
  };
}

function createFilterStateFromMask(mask: number): ShowtimeFilterState | null {
  const unchecked = uncheckedFromFilterMask(mask);

  return unchecked
    ? {
        version: 3,
        unchecked: {
          showType: [...unchecked.showType],
          screenFormat: [...unchecked.screenFormat],
          screeningTech: [...unchecked.screeningTech],
          dubLanguage: [...unchecked.dubLanguage],
        },
      }
    : null;
}

function areQueryStatesEqual(
  left: MoviePageQueryState | null,
  right: MoviePageQueryState,
): boolean {
  return Boolean(
    left &&
    left.movieCode === right.movieCode &&
    left.cityCode === right.cityCode &&
    left.location === right.location &&
    left.date === right.date &&
    left.filterMask === right.filterMask &&
    left.mode === right.mode,
  );
}

function useJerusalemToday(): string {
  return usePublicRenderClock().cinemaDate;
}

function createInitialEncodedQueryState(
  routeCode: string,
  today: string,
  preferenceLocation: string,
): MoviePageQueryState | null {
  const parsedRoute = parseMovieRouteCode(routeCode);
  if (!parsedRoute || parsedRoute.kind !== "encoded") return null;
  const date = decodeDateCode(parsedRoute.dateCode, today);
  const location = resolveCityCode(
    parsedRoute.cityCode,
    preferenceLocation || DEFAULT_LOCATION,
  );
  const filterState = createFilterStateFromMask(parsedRoute.filterMask);
  if (!date || !location || !filterState) return null;
  return {
    movieCode: parsedRoute.movieCode,
    cityCode: parsedRoute.cityCode,
    location,
    date,
    filterMask: parsedRoute.filterMask,
    filterState,
    mode: parsedRoute.mode,
  };
}

export function MoviePage({
  catalogError,
  catalogReady,
  movieCodesReady,
}: MoviePageProps) {
  const publicationRevision = usePublicationRevision();
  const queryClient = useQueryClient();
  const displayPreferences = useMovieDisplayPreferences();
  const { movieCode: routeCode = "" } = useParams();
  const navigate = useNavigate();
  const {
    loading: preferencesLoading,
    location: preferenceLocation,
    setLocationPreference,
  } = useUserPreferencesStore(
    useShallow((state) => ({
      loading: state.loading,
      location: state.preferences.location,
      setLocationPreference: state.setLocationPreference,
    })),
  );
  const today = useJerusalemToday();
  const todayRef = useRef(today);
  const candidateMovieCode = routeCode.slice(0, 3);
  const hasValidMovieCode = isValidMovieCode(candidateMovieCode);
  const catalogRouteMatch =
    catalogReady && movieCodesReady && hasValidMovieCode
      ? findMovieByCode(candidateMovieCode, queryClient)
      : null;
  const routePreference = catalogRouteMatch
    ? displayPreferences.preferencesById.get(catalogRouteMatch.movie.tmdbId)
    : undefined;
  const isRemovedByPreference = routePreference?.treatment === "remove";
  const displayedMovie = catalogRouteMatch
    ? applyMovieDisplayPreference(
        catalogRouteMatch.movie,
        displayPreferences.preferencesById,
      )
    : null;
  const routeMatch =
    catalogRouteMatch && displayedMovie
      ? { ...catalogRouteMatch, movie: displayedMovie }
      : null;
  const routeMovie = routeMatch?.movie ?? null;
  const routeCatalogMode = routeMatch?.mode ?? null;
  const [queryState, setQueryState] = useState<MoviePageQueryState | null>(() =>
    createInitialEncodedQueryState(
      routeCode,
      today,
      preferenceLocation || DEFAULT_LOCATION,
    ));
  const activeQueryState =
    routeCatalogMode === "nowPlaying" &&
    queryState?.movieCode === candidateMovieCode
      ? queryState
      : null;
  const activeShowtimeRange = useMemo(
    () =>
      activeQueryState && routeMovie
        ? ({
            city: activeQueryState.location,
            startDate: activeQueryState.date,
            endDate: activeQueryState.date,
            tmdbId: routeMovie.tmdbId,
            publicationRevision,
          } satisfies ShowtimeRange & { tmdbId: string })
        : null,
    [activeQueryState, publicationRevision, routeMovie],
  );
  const { data: activeShowtimeCityData } = useQuery({
    ...showtimeCityQueryOptions(
      activeShowtimeRange?.city ?? preferenceLocation ?? DEFAULT_LOCATION,
      publicationRevision,
    ),
    enabled: false,
  });
  const isActiveShowtimeDateLoaded = activeShowtimeRange
    ? isMovieShowtimeDateCovered(
        activeShowtimeCityData,
        activeShowtimeRange.tmdbId,
        activeShowtimeRange.startDate,
        today,
      )
    : false;
  const exactShowtimeRange =
    activeShowtimeRange ??
    ({
      city: DEFAULT_LOCATION,
      startDate: today,
      endDate: today,
      tmdbId: "__inactive__",
      publicationRevision,
    } satisfies ShowtimeRange & { tmdbId: string });
  const exactShowtimeQuery = useQuery({
    ...showtimeRangeQueryOptions(exactShowtimeRange),
    enabled: Boolean(activeShowtimeRange) && !isActiveShowtimeDateLoaded,
  });
  const queryStateRef = useRef<MoviePageQueryState | null>(queryState);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const shareFeedbackTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  const replaceRouteForState = useCallback(
    (state: MoviePageQueryState) => {
      const dateCode = encodeDateCode(state.date);

      if (!dateCode) {
        return;
      }

      const nextRouteCode = encodeMovieRouteCode({
        movieCode: state.movieCode,
        cityCode: state.cityCode,
        dateCode,
        filterMask: state.filterMask,
        mode: state.mode,
      });

      if (nextRouteCode && nextRouteCode !== routeCode) {
        navigate(`/${nextRouteCode}`, { replace: true });
      }
    },
    [navigate, routeCode],
  );

  const commitQueryState = useCallback(
    (nextState: MoviePageQueryState, updateRoute = true) => {
      queryStateRef.current = nextState;
      setQueryState((currentState) =>
        areQueryStatesEqual(currentState, nextState)
          ? currentState
          : nextState);

      if (updateRoute) {
        replaceRouteForState(nextState);
      }
    },
    [replaceRouteForState],
  );

  useEffect(() => {
    if (
      !catalogReady ||
      !movieCodesReady ||
      catalogError ||
      preferencesLoading
    ) {
      return;
    }

    if (!hasValidMovieCode || !routeMovie || !routeCatalogMode) {
      return;
    }

    const parsedRoute = parseMovieRouteCode(routeCode);

    if (!parsedRoute || parsedRoute.movieCode !== candidateMovieCode) {
      navigate(`/${candidateMovieCode}`, { replace: true });
      return;
    }

    if (routeCatalogMode === "comingSoon") {
      queryStateRef.current = null;

      if (parsedRoute.kind !== "plain") {
        navigate(`/${candidateMovieCode}`, { replace: true });
      }

      return;
    }

    const currentToday = todayRef.current;

    if (parsedRoute.kind === "plain") {
      const filterState = copyFilterState(
        getShowtimeFiltersSnapshot() ?? createDefaultFilterState(),
      );
      const nextState: MoviePageQueryState = {
        movieCode: candidateMovieCode,
        cityCode: CURRENT_CITY_CODE,
        location: preferenceLocation || DEFAULT_LOCATION,
        date: currentToday,
        filterMask: filterMaskFromUnchecked(filterState.unchecked),
        filterState,
        mode: "edit",
      };

      commitQueryState(nextState);
      return;
    }

    const decodedDate = decodeDateCode(parsedRoute.dateCode, currentToday);
    const decodedLocation = resolveCityCode(
      parsedRoute.cityCode,
      preferenceLocation || DEFAULT_LOCATION,
    );
    const filterState = createFilterStateFromMask(parsedRoute.filterMask);

    if (!decodedDate || !decodedLocation || !filterState) {
      navigate(`/${candidateMovieCode}`, { replace: true });
      return;
    }

    const nextState: MoviePageQueryState = {
      movieCode: candidateMovieCode,
      cityCode: parsedRoute.cityCode,
      location: decodedLocation,
      date: decodedDate,
      filterMask: parsedRoute.filterMask,
      filterState,
      mode: parsedRoute.mode,
    };

    if (areQueryStatesEqual(queryStateRef.current, nextState)) return;

    commitQueryState(nextState);
  }, [
    candidateMovieCode,
    catalogError,
    catalogReady,
    commitQueryState,
    hasValidMovieCode,
    navigate,
    movieCodesReady,
    preferenceLocation,
    preferencesLoading,
    routeCode,
    routeCatalogMode,
    routeMovie,
  ]);

  useEffect(() => {
    const currentState = queryStateRef.current;

    if (!currentState || currentState.date >= today) {
      return;
    }

    commitQueryState({
      ...currentState,
      date: today,
    });
  }, [commitQueryState, today]);

  useLayoutEffect(() => {
    if (routeMovie?.movieCode) {
      const currentState = queryStateRef.current;
      const location = currentState?.location;
      const isEncodedSelection =
        parseMovieRouteCode(routeCode)?.kind === "encoded";
      const title =
        routeCatalogMode === "comingSoon"
          ? `${routeMovie.title} — Coming soon | Kartiseret`
          : location
            ? `${routeMovie.title} showtimes in ${location} | Kartiseret`
            : `${routeMovie.title} showtimes in Israel | Kartiseret`;
      const safeMovieImageUrl = safeSeoUrl(routeMovie.imageSrc);
      setSeoMetadata({
        title,
        description:
          isEncodedSelection && currentState
            ? `${routeMovie.title} showtimes in ${currentState.location} on ${currentState.date} on Kartiseret.`
            : `${routeMovie.title}${routeMovie.year ? ` (${routeMovie.year})` : ""}. ${routeCatalogMode === "comingSoon" ? "Coming soon information" : "Find movie showtimes at cinemas across Israel"} on Kartiseret.`,
        canonicalPath: `/${candidateMovieCode}`,
        openGraphPath: `/${routeCode}`,
        imageUrl:
          (routeMovie.socialPreviewFingerprint
            ? socialPreviewImageUrl(
                window.location.origin,
                routeMovie.socialPreviewFingerprint,
              )
            : null) ?? safeMovieImageUrl,
        jsonLd: {
          "@context": "https://schema.org",
          "@type": "Movie",
          name: routeMovie.title,
          ...(safeMovieImageUrl ? { image: safeMovieImageUrl } : {}),
          ...(routeMovie.genres.length ? { genre: routeMovie.genres } : {}),
          url: `https://seret.site/${encodeURIComponent(candidateMovieCode)}`,
        },
      });
      return;
    }
    if (catalogReady && movieCodesReady) {
      setSeoMetadata({
        title: "Movie not found | Kartiseret",
        description: "This movie page is not available.",
        canonicalPath: window.location.pathname,
        robots: "noindex, nofollow",
      });
    }
  }, [
    candidateMovieCode,
    catalogReady,
    exactShowtimeQuery.isSuccess,
    isActiveShowtimeDateLoaded,
    movieCodesReady,
    queryState,
    routeCode,
    routeCatalogMode,
    routeMovie,
  ]);

  useEffect(() => {
    if (!activeShowtimeRange || !exactShowtimeQuery.data) {
      return;
    }

    mergeMovieShowtimeRangeResult(activeShowtimeRange, exactShowtimeQuery.data);
    void prefetchMovieShowtimesAfterDate(
      activeShowtimeRange.city,
      activeShowtimeRange.tmdbId,
      activeShowtimeRange.startDate,
    ).catch((error: unknown) => {
      console.error(
        "Failed to prefetch subsequent movie-page showtimes.",
        error,
      );
    });
  }, [activeShowtimeRange, exactShowtimeQuery.data]);

  useEffect(
    () => () => {
      if (shareFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(shareFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  const showShareFeedback = useCallback((message: string) => {
    if (shareFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(shareFeedbackTimeoutRef.current);
    }

    setShareFeedback(message);
    shareFeedbackTimeoutRef.current = window.setTimeout(() => {
      setShareFeedback(null);
      shareFeedbackTimeoutRef.current = null;
    }, SHARE_FEEDBACK_DURATION_MS);
  }, []);

  const handlePreferredShowtimeDateChange = useCallback(
    (date: string) => {
      const currentState = queryStateRef.current;

      if (
        !currentState ||
        !isDateInShowtimeLinkWindow(date, todayRef.current)
      ) {
        return;
      }

      commitQueryState({
        ...currentState,
        date,
      });
    },
    [commitQueryState],
  );

  const handleLocationOverrideChange = useCallback(
    async (location: string) => {
      const currentState = queryStateRef.current;
      const cityCode = getExplicitCityCode(location);

      if (!currentState || !cityCode) {
        return false;
      }

      const nextState: MoviePageQueryState = {
        ...currentState,
        cityCode,
        location,
      };
      commitQueryState(nextState);

      if (currentState.mode !== "edit") {
        return true;
      }

      try {
        return await setLocationPreference(location);
      } catch {
        return false;
      }
    },
    [commitQueryState, setLocationPreference],
  );

  const handleShowtimeFilterStateChange = useCallback(
    (filterState: ShowtimeFilterState) => {
      const currentState = queryStateRef.current;

      if (!currentState) {
        return;
      }

      const copiedFilterState = copyFilterState(filterState);
      const nextState: MoviePageQueryState = {
        ...currentState,
        filterMask: filterMaskFromUnchecked(copiedFilterState.unchecked),
        filterState: copiedFilterState,
      };
      commitQueryState(nextState);

      if (currentState.mode === "edit") {
        saveShowtimeFilters(copiedFilterState);
      }
    },
    [commitQueryState],
  );

  const handleShowtimeDatePreviewChange = (date: string) => {
    const currentState = queryStateRef.current;
    const tmdbId =
      routeCatalogMode === "nowPlaying" ? routeMovie?.tmdbId : null;

    if (!currentState || !tmdbId) {
      return;
    }

    void prefetchMovieShowtimesAfterDate(
      currentState.location,
      tmdbId,
      date,
    ).catch((error: unknown) => {
      console.error(
        "Failed to prefetch subsequent movie-page showtimes.",
        error,
      );
    });
  };

  const handleShareShowtimes = async () => {
    const currentState = queryStateRef.current;

    if (!currentState || !routeMovie) {
      return;
    }

    const url = buildMovieShowtimeShareUrl({
      movieCode: currentState.movieCode,
      city: currentState.location,
      date: currentState.date,
      filterMask: currentState.filterMask,
    });

    if (!url) {
      showShareFeedback("Unable to share this selection");
      return;
    }

    const result = await shareLink({
      title: `${routeMovie.title} showtimes`,
      text: `${routeMovie.title} showtimes on Kartiseret`,
      url,
    });

    if (result === "shared") {
      showShareFeedback("Shared");
    } else if (result === "copied") {
      showShareFeedback("Link copied");
    } else if (result === "failed") {
      showShareFeedback("Could not copy link");
    }
  };

  if (catalogError) {
    return <MoviePageState title="Movie unavailable" message={catalogError} />;
  }

  if (!catalogReady || !movieCodesReady) {
    return (
      <MoviePageState
        title="Loading movie"
        message="Getting the latest movie details…"
      />
    );
  }

  if (isRemovedByPreference) {
    return (
      <MoviePageState
        title="Movie unavailable"
        message="This movie is hidden by your display preferences."
      />
    );
  }

  if (!routeMatch) {
    return (
      <MoviePageState
        title="Movie not found"
        message="This movie is not currently listed."
      />
    );
  }

  const { movie, mode } = routeMatch;
  const titleId = `movie-page-title-${movie.movieCode ?? movie.tmdbId}`;
  const activeShowtimeError =
    activeShowtimeRange && !isActiveShowtimeDateLoaded
      ? exactShowtimeQuery.error
      : null;

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
              srcSet={movie.backdropSrcSet}
              sizes={movie.backdropSrcSet ? "100vw" : undefined}
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
            preferredShowtimeDate={activeQueryState?.date ?? null}
            onPreferredShowtimeDateChange={
              mode === "nowPlaying"
                ? handlePreferredShowtimeDateChange
                : undefined
            }
            targetShowtimeQueries
            exactDateShowtimeQueries={mode === "nowPlaying"}
            onExactShowtimeDatePreviewChange={
              mode === "nowPlaying"
                ? handleShowtimeDatePreviewChange
                : undefined
            }
            locationOverride={activeQueryState?.location}
            onLocationOverrideChange={
              mode === "nowPlaying" && activeQueryState
                ? handleLocationOverrideChange
                : undefined
            }
            showtimeFilterStateOverride={activeQueryState?.filterState}
            onShowtimeFilterStateOverrideChange={
              mode === "nowPlaying" && activeQueryState
                ? handleShowtimeFilterStateChange
                : undefined
            }
            showtimeDateLoading={
              Boolean(activeShowtimeRange) &&
              !isActiveShowtimeDateLoaded &&
              exactShowtimeQuery.isFetching
            }
            showtimeDateError={
              activeShowtimeError instanceof Error
                ? activeShowtimeError.message
                : activeShowtimeError
                  ? "Could not load showtimes for this date."
                  : null
            }
            showtimeDateWindowStart={today}
            onShareShowtimes={
              mode === "nowPlaying" && activeQueryState
                ? handleShareShowtimes
                : undefined
            }
            shareFeedback={shareFeedback}
            posterClassName="details-poster is-visible"
          />
        </div>
      </article>
    </section>
  );
}
