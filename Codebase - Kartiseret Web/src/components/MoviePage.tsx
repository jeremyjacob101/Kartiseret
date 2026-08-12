import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { findMovieByCode, isMovieShowtimeDateLoaded, isValidMovieCode, loadMovieShowtimesForDate, prefetchMovieShowtimesAfterDate } from "../data/movieCatalog";
import { DEFAULT_LOCATION } from "../prefs/definitions/locations";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { shareLink } from "../routing/shareLink";
import { buildMovieShowtimeShareUrl, CURRENT_CITY_CODE, decodeDateCode, encodeDateCode, encodeMovieRouteCode, filterMaskFromUnchecked, getExplicitCityCode, getJerusalemCinemaDate, isDateInShowtimeLinkWindow, parseMovieRouteCode, resolveCityCode, uncheckedFromFilterMask, type MovieRouteMode } from "../routing/showtimeLinkCodec";
import { getShowtimeFiltersSnapshot, saveShowtimeFilters, type ShowtimeFilterState } from "./showtimes/showtimeFilters";
import { MovieDetailsContent } from "./scroller/MovieDetailsContent";
import { useI18n } from "../i18n/I18nContext";
import { localizeMovie } from "../i18n/content";
import "./scroller/MovieScroller.css";
import "./MoviePage.css";

const MIDNIGHT_CHECK_INTERVAL_MS = 30_000;
const SHARE_FEEDBACK_DURATION_MS = 2_200;

type MoviePageProps = {
  catalogError: string | null;
  catalogReady: boolean;
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

type ShowtimeRequestState = {
  key: string;
  loading: boolean;
  error: string | null;
};

const IDLE_SHOWTIME_REQUEST: ShowtimeRequestState = {
  key: "",
  loading: false,
  error: null,
};

function MoviePageState({ message, title }: MoviePageStateProps) {
  const { t } = useI18n();

  return (
    <section className="movie-page movie-page--state">
      <div className="movie-page-state" role="status">
        <h1>{title}</h1>
        <p>{message}</p>
        <div className="movie-page-state-actions">
          <Link to="/movies">{t("nav.nowPlaying")}</Link>
          <Link to="/soons">{t("nav.comingSoon")}</Link>
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
  const [today, setToday] = useState(() => getJerusalemCinemaDate());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextToday = getJerusalemCinemaDate();
      setToday((currentToday) =>
        currentToday === nextToday ? currentToday : nextToday);
    }, MIDNIGHT_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return today;
}

export function MoviePage({ catalogError, catalogReady }: MoviePageProps) {
  const { locale, direction, t } = useI18n();
  const { movieCode: routeCode = "" } = useParams();
  const navigate = useNavigate();
  const {
    loading: preferencesLoading,
    location: preferenceLocation,
    setLocationPreference,
  } = useUserPreferencesContext();
  const today = useJerusalemToday();
  const todayRef = useRef(today);
  const candidateMovieCode = routeCode.slice(0, 3);
  const hasValidMovieCode = isValidMovieCode(candidateMovieCode);
  const routeMatch =
    catalogReady && hasValidMovieCode
      ? findMovieByCode(candidateMovieCode)
      : null;
  const routeMovie = useMemo(
    () => (routeMatch ? localizeMovie(routeMatch.movie, locale) : null),
    [locale, routeMatch],
  );
  const routeCatalogMode = routeMatch?.mode ?? null;
  const movieTitle = routeMovie?.title;
  const [queryState, setQueryState] = useState<MoviePageQueryState | null>(
    null,
  );
  const activeQueryState =
    routeCatalogMode === "nowPlaying" &&
    queryState?.movieCode === candidateMovieCode
      ? queryState
      : null;
  const queryStateRef = useRef<MoviePageQueryState | null>(null);
  const [showtimeRequest, setShowtimeRequest] = useState<ShowtimeRequestState>(
    IDLE_SHOWTIME_REQUEST,
  );
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
    if (!catalogReady || catalogError || preferencesLoading) {
      return;
    }

    if (!hasValidMovieCode || !routeMovie || !routeCatalogMode) {
      navigate("/", { replace: true });
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

    commitQueryState(nextState);
  }, [
    candidateMovieCode,
    catalogError,
    catalogReady,
    commitQueryState,
    hasValidMovieCode,
    navigate,
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

  useEffect(() => {
    const previousTitle = document.title;
    const openGraphTitle = document.querySelector<HTMLMetaElement>(
      'meta[property="og:title"]',
    );
    const twitterTitle = document.querySelector<HTMLMetaElement>(
      'meta[name="twitter:title"]',
    );
    const previousOpenGraphTitle =
      openGraphTitle?.getAttribute("content") ?? null;
    const previousTwitterTitle = twitterTitle?.getAttribute("content") ?? null;

    const title = movieTitle
      ? `${movieTitle} | ${t("brand.name")}`
      : catalogReady
        ? t("catalog.error.notFoundTitle")
        : t("catalog.loadingTitle");
    document.title = title;
    openGraphTitle?.setAttribute("content", title);
    twitterTitle?.setAttribute("content", title);

    return () => {
      document.title = previousTitle;
      if (previousOpenGraphTitle === null) {
        openGraphTitle?.removeAttribute("content");
      } else {
        openGraphTitle?.setAttribute("content", previousOpenGraphTitle);
      }
      if (previousTwitterTitle === null) {
        twitterTitle?.removeAttribute("content");
      } else {
        twitterTitle?.setAttribute("content", previousTwitterTitle);
      }
    };
  }, [catalogReady, movieTitle, t]);

  useEffect(() => {
    const nowPlayingTmdbId =
      routeCatalogMode === "nowPlaying" ? routeMovie?.tmdbId : null;

    if (!nowPlayingTmdbId || !activeQueryState) {
      return;
    }

    const requestKey = [
      activeQueryState.location,
      nowPlayingTmdbId,
      activeQueryState.date,
    ].join(":");
    let isActive = true;

    void loadMovieShowtimesForDate(
      activeQueryState.location,
      nowPlayingTmdbId,
      activeQueryState.date,
    )
      .then(() => {
        if (isActive) {
          setShowtimeRequest({
            key: requestKey,
            loading: false,
            error: null,
          });
          void prefetchMovieShowtimesAfterDate(
            activeQueryState.location,
            nowPlayingTmdbId,
            activeQueryState.date,
          ).catch((error: unknown) => {
            console.error(
              "Failed to prefetch subsequent movie-page showtimes.",
              error,
            );
          });
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        console.error("Failed to load movie-page showtimes.", error);
        setShowtimeRequest({
          key: requestKey,
          loading: false,
          error: t("showtimes.loadDateFailed"),
        });
      });

    return () => {
      isActive = false;
    };
  }, [activeQueryState, routeCatalogMode, routeMovie?.tmdbId, t, today]);

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
      showShareFeedback(t("showtimes.shareUnavailable"));
      return;
    }

    const result = await shareLink({
      title: `${routeMovie.title} · ${t("showtimes.title")}`,
      text: `${routeMovie.title} · ${t("showtimes.title")} · ${t("brand.name")}`,
      url,
    });

    if (result === "shared") {
      showShareFeedback(t("showtimes.shared"));
    } else if (result === "copied") {
      showShareFeedback(t("showtimes.linkCopied"));
    } else if (result === "failed") {
      showShareFeedback(t("showtimes.copyFailed"));
    }
  };

  if (catalogError) {
    return (
      <MoviePageState
        title={t("catalog.movieUnavailable")}
        message={catalogError}
      />
    );
  }

  if (!catalogReady || preferencesLoading) {
    return (
      <MoviePageState
        title={t("catalog.loadingMovie")}
        message={t("catalog.loadingLatest")}
      />
    );
  }

  if (!routeMatch) {
    return (
      <MoviePageState
        title={t("catalog.loadingMovie")}
        message={t("catalog.openingMovie")}
      />
    );
  }

  const { mode } = routeMatch;
  const movie = localizeMovie(routeMatch.movie, locale);
  const titleId = `movie-page-title-${movie.movieCode ?? movie.tmdbId}`;
  const requestKey = activeQueryState
    ? [activeQueryState.location, movie.tmdbId, activeQueryState.date].join(":")
    : "";
  const isActiveShowtimeDateLoaded = activeQueryState
    ? isMovieShowtimeDateLoaded(
        activeQueryState.location,
        movie.tmdbId,
        activeQueryState.date,
      )
    : false;
  const activeShowtimeRequest =
    showtimeRequest.key === requestKey
      ? showtimeRequest
      : {
          key: requestKey,
          loading:
            mode === "nowPlaying" &&
            Boolean(queryState) &&
            !isActiveShowtimeDateLoaded,
          error: null,
        };

  return (
    <section className="movie-page" aria-labelledby={titleId} dir={direction}>
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
            eyebrow={t(
              mode === "nowPlaying"
                ? "catalog.nowPlaying"
                : "catalog.comingSoon",
            )}
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
            showtimeDateLoading={activeShowtimeRequest.loading}
            showtimeDateError={activeShowtimeRequest.error}
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
