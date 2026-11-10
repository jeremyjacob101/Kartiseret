import { adminMovieEditMutationOptions, loadComingSoonMovies, loadNowPlayingMovies, loadShowtimes, movieCollectionQueryOptions, reloadComingSoonMovies, reloadNowPlayingMovies, showtimeCityQueryOptions, type Movie } from "./data/movieCatalog";
import { filterMoviesByReleaseCategory, getMovieReleaseCategory, MOVIE_RELEASE_CATEGORY_LABELS, type MovieReleaseCategory } from "./domain/movieRelease";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getCinemathequeDateRange, nationwideCinemathequeQueryOptions } from "./data/cinemathequeCatalog";
import { MovieScroller, type MovieScrollerJumpRequest } from "./components/scroller/MovieScroller";
import { useMovieDisplayPreferences } from "./contexts/MovieDisplayPreferencesContext";
import { preloadCityLocationPicker } from "./components/maps/loadCityLocationPicker";
import { getCurrentRobotsDirectives, setSeoMetadata } from "./routing/seoMetadata";
import { LetterboxdUnsubscribePage } from "./components/LetterboxdUnsubscribePage";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ReleaseCategorySwitcher } from "./components/ReleaseCategorySwitcher";
import type { ApplicationIdentity } from "@kartiseret/contracts/private-data";
import { applyMovieDisplayPreferences } from "./data/movieDisplayPreferences";
import { backdropPreloader } from "./components/scroller/backdropPreloader";
import { useUserPreferencesStore } from "./stores/userPreferencesStore";
import { usePublicationRevision } from "./hooks/usePublicationRevision";
import { type MovieSearchResult } from "./components/MovieSearchMenu";
import { PasswordResetPage } from "./components/PasswordResetPage";
import { movieCodeSchema } from "@kartiseret/contracts/runtime";
import { AttributionPage } from "./components/AttributionPage";
import { useMutation, useQuery } from "@tanstack/react-query";
import { adminStatusQueryOptions } from "./data/adminStatus";
import { BottomBar } from "./components/bars/BottomBar";
import { useDeviceStore } from "./device/useDeviceType";
import { PASSWORD_RESET_PATH } from "./lib/authRoutes";
import { useShallow } from "zustand/react/shallow";
import { Navbar } from "./components/bars/Navbar";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const MOBILE_SCROLLER_CARD_WIDTH = 160;
const MOBILE_SCROLLER_CARD_HEIGHT = 240;
const MOBILE_SCROLLER_GAP = 18;
const MOBILE_SCROLLER_SLOT_MIN_HEIGHT = 300;
const FIXED_APP_PATHS = new Set([
  "/",
  "/movies",
  "/showtimes",
  "/cinematheques",
  "/soons",
  "/user",
  "/attribution",
  PASSWORD_RESET_PATH,
  "/unsubscribe/letterboxd",
]);
const loadCinemaPage = () => import("./components/CinemaPage");
const loadUserPreferencesPage = () =>
  import("./components/UserPreferencesPage");
const loadPosterGridPage = () => import("./components/PosterGridPage");
const loadAllShowtimesPage = () => import("./components/AllShowtimesPage");
const loadCinemathequesPage = () => import("./components/CinemathequesPage");
const loadMoviePage = () => import("./components/MoviePage");

const CinemaPage = lazy(async () => {
  const module = await loadCinemaPage();
  return { default: module.CinemaPage };
});

const UserPreferencesPage = lazy(async () => {
  const module = await loadUserPreferencesPage();
  return { default: module.UserPreferencesPage };
});

const PosterGridPage = lazy(async () => {
  const module = await loadPosterGridPage();
  return { default: module.PosterGridPage };
});

const AllShowtimesPage = lazy(async () => {
  const module = await loadAllShowtimesPage();
  return { default: module.AllShowtimesPage };
});

const CinemathequesPage = lazy(async () => {
  const module = await loadCinemathequesPage();
  return { default: module.CinemathequesPage };
});

const MoviePage = lazy(async () => {
  const module = await loadMoviePage();
  return { default: module.MoviePage };
});

type MovieSearchMode = "nowPlaying" | "comingSoon";
type CatalogPageView = "grid" | "scroller";

type CatalogMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

function subscribeToHydrationState() {
  return () => {};
}

function getClientHydrationState() {
  return true;
}

function getServerHydrationState() {
  return false;
}

function ClientMounted({ children }: { children: ReactNode }) {
  const isMounted = useSyncExternalStore(
    subscribeToHydrationState,
    getClientHydrationState,
    getServerHydrationState,
  );

  return isMounted ? children : null;
}

function isPotentialStandaloneMoviePath(pathname: string): boolean {
  if (FIXED_APP_PATHS.has(pathname)) {
    return false;
  }

  const segment = pathname.startsWith("/") ? pathname.slice(1) : pathname;

  return (
    !segment.includes("/") &&
    movieCodeSchema.safeParse(segment.slice(0, 3)).success
  );
}

type CatalogRouteProps = {
  catalogMovieJumpRequest: CatalogMovieJumpRequest | null;
  cardHeight: number;
  cardWidth: number;
  gap: number;
  jumpMode: MovieSearchMode;
  movies: readonly Movie[];
  onExitDetail: () => void;
  onPosterSelect: (tmdbId: string) => void;
  isAdmin: boolean;
  view: CatalogPageView;
  onAdminSaveEdit: (payload: {
    mode: MovieSearchMode;
    currentTmdbId: string;
    selectedTmdbId: string;
    selectedTitle?: string | null;
    selectedYear?: number | null;
    selectedPosterUrl?: string | null;
    isManualEntry: boolean;
  }) => Promise<void>;
  onRefreshRequested: (mode: MovieSearchMode) => Promise<void>;
  releaseCategory: MovieReleaseCategory;
  onReleaseCategoryChange: (category: MovieReleaseCategory) => void;
  showReleaseCategorySwitcher?: boolean;
  scrollerSlotMinHeight: number;
};

type HomeRouteProps = {
  catalogError: string | null;
  cardHeight: number;
  cardWidth: number;
  comingSoonReady: boolean;
  comingSoonMovies: readonly Movie[];
  gap: number;
  nowPlayingReady: boolean;
  nowPlayingMovies: readonly Movie[];
  nowPlayingReReleaseMovies: readonly Movie[];
  scrollerSlotMinHeight: number;
};

function CatalogErrorNote({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <p className="app-inline-note" role="status">
      {message}
    </p>
  );
}

function NotFoundRoute() {
  useEffect(() => {
    setSeoMetadata({
      title: "Page not found | Kartiseret",
      description: "This Kartiseret page is not available.",
      canonicalPath: window.location.pathname,
      robots: "noindex, nofollow",
    });
  }, []);

  return (
    <section className="page-panel">
      <h1>Page not found</h1>
      <p>This page is not available.</p>
      <a href="/">Return to Kartiseret</a>
    </section>
  );
}

export function CatalogRoute({
  catalogMovieJumpRequest,
  cardHeight,
  cardWidth,
  gap,
  jumpMode,
  movies,
  onExitDetail,
  onPosterSelect,
  isAdmin,
  view,
  onAdminSaveEdit,
  onRefreshRequested,
  releaseCategory,
  onReleaseCategoryChange,
  showReleaseCategorySwitcher = true,
  scrollerSlotMinHeight,
}: CatalogRouteProps) {
  const routeLabel = jumpMode === "nowPlaying" ? "Now Playing" : "Coming Soon";
  const releaseLabel = MOVIE_RELEASE_CATEGORY_LABELS[releaseCategory];
  const catalogContent =
    movies.length === 0 ? (
      <p className="catalog-empty-state" role="status">
        No {releaseLabel.toLowerCase()} are currently available.
      </p>
    ) : view === "grid" ? (
      <Suspense fallback={null}>
        <PosterGridPage
          title={routeLabel + " " + releaseLabel}
          movies={movies}
          onPosterSelect={(movie) => {
            onPosterSelect(movie.tmdbId);
          }}
          isAdmin={isAdmin}
          onAdminSaveEdit={async (payload) => {
            await onAdminSaveEdit({ mode: jumpMode, ...payload });
          }}
          onRefreshRequested={async () => {
            await onRefreshRequested(jumpMode);
          }}
        />
      </Suspense>
    ) : (
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        <ClientMounted>
          <MovieScroller
            mode={jumpMode}
            movieItems={movies}
            jumpRequest={
              catalogMovieJumpRequest?.mode === jumpMode
                ? catalogMovieJumpRequest
                : null
            }
            jumpOpenMode="detail"
            onExitDetail={onExitDetail}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            gap={gap}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
        </ClientMounted>
      </div>
    );

  return (
    <section className="catalog-browser-page" aria-label={routeLabel}>
      <div className="catalog-page-header">
        <div>
          <p className="section-kicker">{routeLabel}</p>
          <h1 className="section-title">{releaseLabel}</h1>
        </div>
        {showReleaseCategorySwitcher ? (
          <ReleaseCategorySwitcher
            category={releaseCategory}
            onChange={onReleaseCategoryChange}
            routeLabel={routeLabel}
          />
        ) : null}
      </div>
      {catalogContent}
    </section>
  );
}

export function HomeRoute({
  catalogError,
  cardHeight,
  cardWidth,
  comingSoonReady,
  comingSoonMovies,
  gap,
  nowPlayingReady,
  nowPlayingMovies,
  nowPlayingReReleaseMovies,
  scrollerSlotMinHeight,
}: HomeRouteProps) {
  return (
    <section className="scroller-panel" aria-label="Movie releases">
      <CatalogErrorNote message={catalogError} />
      <div className="section-heading">
        <p className="section-kicker">Now Playing</p>
        <h1 className="section-title">New Releases</h1>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {nowPlayingReady && nowPlayingMovies.length > 0 ? (
          <ClientMounted>
            <MovieScroller
              mode="nowPlaying"
              movieItems={nowPlayingMovies}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gap={gap}
              maxWidth={SCROLLER_MAX_WIDTH}
            />
          </ClientMounted>
        ) : nowPlayingReady ? (
          <p className="app-inline-note" role="status">
            No new releases are currently available.
          </p>
        ) : null}
      </div>
      <div className="section-heading">
        <p className="section-kicker">To Be Released</p>
        <h2 className="section-title">Coming Soon</h2>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {comingSoonReady && comingSoonMovies.length > 0 ? (
          <ClientMounted>
            <MovieScroller
              mode="comingSoon"
              movieItems={comingSoonMovies}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gap={gap}
              maxWidth={SCROLLER_MAX_WIDTH}
            />
          </ClientMounted>
        ) : comingSoonReady ? (
          <p className="app-inline-note" role="status">
            No new releases are currently available.
          </p>
        ) : null}
      </div>
      <div className="section-heading">
        <p className="section-kicker">Now Playing</p>
        <h2 className="section-title">Re-Releases</h2>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {nowPlayingReady && nowPlayingReReleaseMovies.length > 0 ? (
          <ClientMounted>
            <MovieScroller
              mode="nowPlaying"
              movieItems={nowPlayingReReleaseMovies}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              gap={gap}
              maxWidth={SCROLLER_MAX_WIDTH}
            />
          </ClientMounted>
        ) : nowPlayingReady ? (
          <p className="app-inline-note" role="status">
            No re-releases are currently available.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ShowtimesRoute({
  catalogError,
  showtimesReady,
}: {
  catalogError: string | null;
  showtimesReady: boolean;
}) {
  return (
    <section className="page-panel">
      <CatalogErrorNote message={catalogError} />
      {showtimesReady ? (
        <Suspense fallback={null}>
          <AllShowtimesPage />
        </Suspense>
      ) : null}
    </section>
  );
}

function UserRoute({
  user,
  loading,
}: {
  user: ApplicationIdentity | null;
  loading: boolean;
}) {
  if (!user && loading)
    return (
      <section className="page-panel">
        <p role="status">Loading your account…</p>
      </section>
    );
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="page-panel">
      <Suspense fallback={null}>
        <UserPreferencesPage />
      </Suspense>
    </section>
  );
}

export function App() {
  const location = useLocation();
  if (location.pathname === "/unsubscribe/letterboxd") {
    return <LetterboxdUnsubscribePage />;
  }
  return <MainApplication />;
}

function MainApplication() {
  const publicationRevision = usePublicationRevision();
  const displayPreferences = useMovieDisplayPreferences();
  const routeLocation = useLocation();
  const navigate = useNavigate();
  const isMobile = useDeviceStore((state) => state.isMobile);
  const { user, loading, selectedCity, hideReReleases } =
    useUserPreferencesStore(
      useShallow((state) => ({
        user: state.user,
        loading: state.loading,
        selectedCity: state.preferences.location,
        hideReReleases: state.preferences.hideReReleases,
      })),
    );
  const pathname = routeLocation.pathname;
  const [cinemathequeSearchEnabled, setCinemathequeSearchEnabled] =
    useState(false);
  const { data: isAdmin = false } = useQuery({
    ...adminStatusQueryOptions(user?.id ?? null),
    enabled: Boolean(user),
  });
  const shouldLoadCatalog =
    pathname !== "/user" &&
    pathname !== "/attribution" &&
    pathname !== PASSWORD_RESET_PATH;
  const nowPlayingQuery = useQuery({
    ...movieCollectionQueryOptions("nowPlaying"),
    enabled: shouldLoadCatalog,
  });
  const comingSoonQuery = useQuery({
    ...movieCollectionQueryOptions("comingSoon"),
    enabled: shouldLoadCatalog,
  });
  const cinemathequeSearchQuery = useQuery({
    ...nationwideCinemathequeQueryOptions(
      getCinemathequeDateRange().endDate,
      publicationRevision,
    ),
    enabled: cinemathequeSearchEnabled,
  });
  const showtimeCityQuery = useQuery({
    ...showtimeCityQueryOptions(selectedCity, publicationRevision),
    enabled: pathname === "/showtimes",
  });
  const { mutateAsync: saveAdminMovieEdit } = useMutation(
    adminMovieEditMutationOptions(),
  );
  const nowPlayingMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        nowPlayingQuery.data?.movies ?? [],
        displayPreferences.preferencesById,
      ),
    [displayPreferences.preferencesById, nowPlayingQuery.data?.movies],
  );
  const comingSoonMovies = useMemo(
    () =>
      applyMovieDisplayPreferences(
        comingSoonQuery.data?.movies ?? [],
        displayPreferences.preferencesById,
      ),
    [comingSoonQuery.data?.movies, displayPreferences.preferencesById],
  );
  const nowPlayingNewReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(nowPlayingMovies, "newReleases"),
    [nowPlayingMovies],
  );
  const nowPlayingReReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(nowPlayingMovies, "reReleases"),
    [nowPlayingMovies],
  );
  const comingSoonNewReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(comingSoonMovies, "newReleases"),
    [comingSoonMovies],
  );
  const comingSoonReReleaseMovies = useMemo(
    () => filterMoviesByReleaseCategory(comingSoonMovies, "reReleases"),
    [comingSoonMovies],
  );
  const nowPlayingReady = nowPlayingQuery.data !== undefined;
  const comingSoonReady = comingSoonQuery.data !== undefined;
  const catalogReady = nowPlayingReady && comingSoonReady;
  const movieCodesReady =
    catalogReady &&
    nowPlayingQuery.data?.movieCodesStatus === "ready" &&
    comingSoonQuery.data?.movieCodesStatus === "ready";
  const showtimesReady = showtimeCityQuery.data?.broadReady ?? false;
  const catalogQueryError =
    (nowPlayingQuery.data === undefined ? nowPlayingQuery.error : null) ??
    (comingSoonQuery.data === undefined ? comingSoonQuery.error : null) ??
    (pathname === "/showtimes" && showtimeCityQuery.data === undefined
      ? showtimeCityQuery.error
      : null);
  const catalogError = catalogQueryError
    ? catalogQueryError instanceof Error
      ? catalogQueryError.message
      : "Failed to load movie data."
    : null;
  const [catalogMovieJumpRequest, setCatalogMovieJumpRequest] =
    useState<CatalogMovieJumpRequest | null>(null);
  const [moviesPageView, setMoviesPageView] = useState<CatalogPageView>("grid");
  const [soonsPageView, setSoonsPageView] = useState<CatalogPageView>("grid");
  const [moviesReleaseCategory, setMoviesReleaseCategory] =
    useState<MovieReleaseCategory>("newReleases");
  const [soonsReleaseCategory, setSoonsReleaseCategory] =
    useState<MovieReleaseCategory>("newReleases");
  const moviesDisplayReleaseCategory = hideReReleases
    ? "newReleases"
    : moviesReleaseCategory;
  const soonsDisplayReleaseCategory = hideReReleases
    ? "newReleases"
    : soonsReleaseCategory;
  const moviesPageMovies =
    moviesDisplayReleaseCategory === "reReleases"
      ? nowPlayingReReleaseMovies
      : nowPlayingNewReleaseMovies;
  const soonsPageMovies =
    soonsDisplayReleaseCategory === "reReleases"
      ? comingSoonReReleaseMovies
      : comingSoonNewReleaseMovies;
  const [miniNavPortalTarget, setMiniNavPortalTarget] =
    useState<HTMLDivElement | null>(null);
  const nonCriticalPreloadStartedRef = useRef(false);
  const scrollerCardWidth = isMobile
    ? MOBILE_SCROLLER_CARD_WIDTH
    : SCROLLER_CARD_WIDTH;
  const scrollerCardHeight = isMobile
    ? MOBILE_SCROLLER_CARD_HEIGHT
    : SCROLLER_CARD_HEIGHT;
  const scrollerGap = isMobile ? MOBILE_SCROLLER_GAP : SCROLLER_GAP;
  const scrollerSlotMinHeight = isMobile
    ? MOBILE_SCROLLER_SLOT_MIN_HEIGHT
    : SCROLLER_SLOT_MIN_HEIGHT;

  useLayoutEffect(() => {
    if (pathname === "/") {
      setSeoMetadata({
        title: "Kartiseret — Movie showtimes across Israel",
        description:
          "Find movie showtimes across Israeli cinemas in one place.",
        canonicalPath: "/",
        jsonLd: {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "WebSite",
              name: "Kartiseret",
              url: "https://seret.site/",
            },
            {
              "@type": "Organization",
              name: "Kartiseret",
              url: "https://seret.site/",
              logo: "https://seret.site/logos/kartiseret1.svg",
            },
          ],
        },
      });
      return;
    }
    if (pathname === "/movies" || pathname === "/soons") {
      const isSoon = pathname === "/soons";
      const listingCodeStatus = isSoon
        ? comingSoonQuery.data?.movieCodesStatus
        : nowPlayingQuery.data?.movieCodesStatus;
      const catalogMovies = isSoon
        ? (comingSoonQuery.data?.movies ?? [])
        : (nowPlayingQuery.data?.movies ?? []);
      const hasPublicMovies = catalogMovies.some((movie) => movie.movieCode);
      setSeoMetadata({
        title: isSoon
          ? "Coming soon movies in Israel | Kartiseret"
          : "Movies showing in Israel | Kartiseret",
        description: isSoon
          ? "Browse upcoming movie releases on Kartiseret."
          : "Browse movies showing at cinemas across Israel.",
        canonicalPath: pathname,
        robots:
          listingCodeStatus === "ready"
            ? hasPublicMovies
              ? "index, follow"
              : "noindex, nofollow"
            : getCurrentRobotsDirectives(),
      });
      return;
    }
    if (pathname === "/showtimes") {
      const hasPublicShowtimes = Object.entries(
        showtimeCityQuery.data?.movieShowtimesByTmdbId ?? {},
      ).some(
        ([tmdbId, days]) =>
          (nowPlayingQuery.data?.movies ?? []).some(
            (movie) => movie.tmdbId === tmdbId && movie.movieCode,
          ) && days.some((day) => day.theaters.length > 0),
      );
      setSeoMetadata({
        title: `Movie showtimes in ${selectedCity} | Kartiseret`,
        description: `Browse upcoming movie showtimes in ${selectedCity}.`,
        canonicalPath: "/showtimes",
        robots: showtimesReady
          ? hasPublicShowtimes
            ? "index, follow"
            : "noindex, nofollow"
          : getCurrentRobotsDirectives(),
      });
      return;
    }
    if (
      pathname === "/user" ||
      pathname === "/reset-password" ||
      pathname === "/attribution"
    ) {
      setSeoMetadata({
        title:
          pathname === "/user"
            ? "Account | Kartiseret"
            : pathname === "/reset-password"
              ? "Reset password | Kartiseret"
              : "Attribution | Kartiseret",
        description: "Kartiseret account and site information.",
        canonicalPath: pathname,
        robots: "noindex, nofollow",
      });
    }
  }, [
    comingSoonQuery.data?.movies,
    comingSoonQuery.data?.movieCodesStatus,
    nowPlayingQuery.data?.movies,
    nowPlayingQuery.data?.movieCodesStatus,
    pathname,
    selectedCity,
    showtimeCityQuery.data,
    showtimesReady,
  ]);

  useEffect(() => {
    if (
      pathname !== "/" ||
      !nowPlayingReady ||
      !comingSoonReady ||
      nonCriticalPreloadStartedRef.current
    ) {
      return;
    }

    let cancelPosterWait: (() => void) | undefined;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const preloadNonCriticalExperience = () => {
      cancelPosterWait = backdropPreloader.afterCriticalPosters(() => {
        nonCriticalPreloadStartedRef.current = true;
        preloadCityLocationPicker();
        void Promise.allSettled([
          loadUserPreferencesPage(),
          loadPosterGridPage(),
        ]);
      });
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          preloadNonCriticalExperience();
        },
        { timeout: 900 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        preloadNonCriticalExperience();
      }, 180);
    }

    return () => {
      cancelPosterWait?.();
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
  }, [comingSoonReady, nowPlayingReady, pathname]);

  useEffect(() => {
    if (
      pathname === "/showtimes" ||
      pathname === "/cinematheques" ||
      pathname === "/user" ||
      pathname === "/attribution" ||
      pathname === PASSWORD_RESET_PATH ||
      isPotentialStandaloneMoviePath(pathname) ||
      !nowPlayingReady ||
      !comingSoonReady ||
      showtimesReady
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
    const requestShowtimes = () => {
      void loadShowtimes(selectedCity).catch(() => {});
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          requestShowtimes();
        },
        { timeout: 1500 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        requestShowtimes();
      }, 500);
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
  }, [
    comingSoonReady,
    nowPlayingReady,
    pathname,
    selectedCity,
    showtimesReady,
  ]);

  useEffect(() => {
    if (!showtimesReady || pathname !== "/") {
      return;
    }

    let cancelPosterWait: (() => void) | undefined;
    let timeoutId: number | null = null;
    let idleId: number | null = null;
    const windowWithIdleCallbacks = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
    };
    const runPreload = () => {
      cancelPosterWait = backdropPreloader.afterCriticalPosters(() => {
        void loadAllShowtimesPage();
      });
    };

    if (typeof windowWithIdleCallbacks.requestIdleCallback === "function") {
      idleId = windowWithIdleCallbacks.requestIdleCallback(
        () => {
          runPreload();
        },
        { timeout: 1200 },
      );
    } else {
      timeoutId = window.setTimeout(() => {
        runPreload();
      }, 300);
    }

    return () => {
      cancelPosterWait?.();
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
  }, [pathname, showtimesReady]);

  const handleCatalogLoadRequest = useCallback(() => {
    void Promise.all([loadNowPlayingMovies(), loadComingSoonMovies()]).catch((
      error: unknown,
    ) => {
      console.error("Failed to load movie catalog.", error);
    });
  }, []);

  const handleSearchOpen = useCallback(() => {
    handleCatalogLoadRequest();
    setCinemathequeSearchEnabled(true);
  }, [handleCatalogLoadRequest]);

  const handleAdminSaveEdit = useCallback(
    async (payload: {
      mode: MovieSearchMode;
      currentTmdbId: string;
      selectedTmdbId: string;
      selectedTitle?: string | null;
      selectedYear?: number | null;
      selectedPosterUrl?: string | null;
      isManualEntry: boolean;
    }) => {
      await saveAdminMovieEdit(payload);
    },
    [saveAdminMovieEdit],
  );

  const handleAdminRefreshRequested = useCallback(async (
    mode: MovieSearchMode,
  ) => {
    if (mode === "nowPlaying") {
      await reloadNowPlayingMovies();
      return;
    }

    await reloadComingSoonMovies();
  }, []);

  const handleReleaseCategoryChange = useCallback((
    mode: MovieSearchMode,
    category: MovieReleaseCategory,
  ) => {
    setCatalogMovieJumpRequest(null);

    if (mode === "nowPlaying") {
      setMoviesReleaseCategory(category);
      setMoviesPageView("grid");
      return;
    }

    setSoonsReleaseCategory(category);
    setSoonsPageView("grid");
  }, []);

  const handleSettingsClick = useCallback(() => {
    if (!user || loading) {
      return;
    }

    navigate("/user");
  }, [loading, navigate, user]);

  const resetCatalogPage = useCallback((mode: MovieSearchMode) => {
    if (mode === "nowPlaying") {
      setMoviesPageView("grid");
      setMoviesReleaseCategory("newReleases");
    } else {
      setSoonsPageView("grid");
      setSoonsReleaseCategory("newReleases");
    }

    setCatalogMovieJumpRequest(null);
  }, []);

  const openCatalogMovie = useCallback(
    (mode: MovieSearchMode, tmdbId: string) => {
      handleCatalogLoadRequest();

      setCatalogMovieJumpRequest({
        tmdbId,
        mode,
        nonce: Date.now(),
        behavior: "smooth",
      });

      if (mode === "nowPlaying") {
        setMoviesPageView("scroller");
      } else {
        setSoonsPageView("scroller");
      }
    },
    [handleCatalogLoadRequest],
  );

  const handleMovieSearchSelect = useCallback(
    (result: MovieSearchResult) => {
      if (result.mode === "cinematheque") {
        navigate("/cinematheques");
        return;
      }
      if (result.movieCode) {
        navigate(`/${result.movieCode}`);
        return;
      }

      handleReleaseCategoryChange(
        result.mode,
        getMovieReleaseCategory({ year: result.year }),
      );
      openCatalogMovie(result.mode, result.tmdbId);

      const targetPath = result.mode === "nowPlaying" ? "/movies" : "/soons";

      if (pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [handleReleaseCategoryChange, navigate, openCatalogMovie, pathname],
  );

  const handleMoviesNavClick = useCallback(() => {
    if (pathname === "/movies") {
      resetCatalogPage("nowPlaying");
      return;
    }

    resetCatalogPage("nowPlaying");
    navigate("/movies");
  }, [navigate, pathname, resetCatalogPage]);

  const handleSoonsNavClick = useCallback(() => {
    if (pathname === "/soons") {
      resetCatalogPage("comingSoon");
      return;
    }

    resetCatalogPage("comingSoon");
    navigate("/soons");
  }, [navigate, pathname, resetCatalogPage]);

  const handleAllShowtimesNavClick = useCallback(() => {
    navigate("/showtimes");
  }, [navigate]);

  const handleFloatingHomeClick = useCallback(() => {
    if (pathname !== "/") {
      navigate("/");
    }

    window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? "auto"
        : "smooth";

      window.scrollTo({ top: 0, behavior });
    });
  }, [navigate, pathname]);

  const searchCollections = [
    {
      mode: "nowPlaying" as const,
      label: "Now Playing",
      movies: catalogReady ? nowPlayingMovies : [],
    },
    {
      mode: "comingSoon" as const,
      label: "Coming Soon",
      movies: catalogReady ? comingSoonMovies : [],
    },
    {
      mode: "cinematheque" as const,
      label: "Cinematheque",
      movies: cinemathequeSearchQuery.data?.movies ?? [],
    },
  ];

  return (
    <div className="app-shell">
      <Navbar
        catalogReady={catalogReady}
        searchLoading={
          cinemathequeSearchEnabled && cinemathequeSearchQuery.isFetching
        }
        cinemathequeUnavailable={
          cinemathequeSearchEnabled && cinemathequeSearchQuery.isError
        }
        miniNavPortalTarget={miniNavPortalTarget}
        searchCollections={searchCollections}
        settingsDisabled={!user || loading}
        onAllShowtimesNavClick={handleAllShowtimesNavClick}
        onHomeClick={handleFloatingHomeClick}
        onMoviesNavClick={handleMoviesNavClick}
        onSearchOpen={handleSearchOpen}
        onSelectResult={handleMovieSearchSelect}
        onSettingsClick={handleSettingsClick}
        onSoonsNavClick={handleSoonsNavClick}
      />

      <main
        className={[
          "app-main",
          pathname === "/showtimes" ? "app-main--showtimes" : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <Routes>
          <Route
            path="/"
            element={
              <HomeRoute
                catalogError={catalogError}
                cardHeight={scrollerCardHeight}
                cardWidth={scrollerCardWidth}
                comingSoonReady={comingSoonReady}
                comingSoonMovies={comingSoonNewReleaseMovies}
                gap={scrollerGap}
                nowPlayingReady={nowPlayingReady}
                nowPlayingMovies={nowPlayingNewReleaseMovies}
                nowPlayingReReleaseMovies={nowPlayingReReleaseMovies}
                scrollerSlotMinHeight={scrollerSlotMinHeight}
              />
            }
          />
          <Route
            path="/movies"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {catalogReady &&
                nowPlayingQuery.data?.movieCodesStatus === "ready" ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="nowPlaying"
                    movies={moviesPageMovies}
                    onExitDetail={() => {
                      resetCatalogPage("nowPlaying");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("nowPlaying", tmdbId);
                    }}
                    isAdmin={isAdmin}
                    view={moviesPageView}
                    onAdminSaveEdit={handleAdminSaveEdit}
                    onRefreshRequested={handleAdminRefreshRequested}
                    releaseCategory={moviesDisplayReleaseCategory}
                    onReleaseCategoryChange={(category) => {
                      handleReleaseCategoryChange("nowPlaying", category);
                    }}
                    showReleaseCategorySwitcher={!hideReReleases}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                  />
                ) : catalogReady ? (
                  <p className="app-inline-note" role="status">
                    Movie links are temporarily unavailable.
                  </p>
                ) : null}
              </section>
            }
          />
          <Route
            path="/showtimes"
            element={
              <ShowtimesRoute
                catalogError={catalogError}
                showtimesReady={showtimesReady}
              />
            }
          />
          <Route
            path="/cinematheques"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                <Suspense fallback={null}>
                  <CinemathequesPage />
                </Suspense>
              </section>
            }
          />
          <Route
            path="/soons"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {catalogReady &&
                comingSoonQuery.data?.movieCodesStatus === "ready" ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="comingSoon"
                    movies={soonsPageMovies}
                    onExitDetail={() => {
                      resetCatalogPage("comingSoon");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("comingSoon", tmdbId);
                    }}
                    isAdmin={isAdmin}
                    view={soonsPageView}
                    onAdminSaveEdit={handleAdminSaveEdit}
                    onRefreshRequested={handleAdminRefreshRequested}
                    releaseCategory={soonsDisplayReleaseCategory}
                    onReleaseCategoryChange={(category) => {
                      handleReleaseCategoryChange("comingSoon", category);
                    }}
                    showReleaseCategorySwitcher={!hideReReleases}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                  />
                ) : catalogReady ? (
                  <p className="app-inline-note" role="status">
                    Movie links are temporarily unavailable.
                  </p>
                ) : null}
              </section>
            }
          />
          <Route
            path="/user"
            element={<UserRoute user={user} loading={loading} />}
          />
          <Route
            path={PASSWORD_RESET_PATH}
            element={
              <section className="page-panel">
                <PasswordResetPage />
              </section>
            }
          />
          <Route
            path="/attribution"
            element={
              <section className="page-panel">
                <AttributionPage />
              </section>
            }
          />
          <Route
            path="/c/:cinemaId"
            element={
              <Suspense
                fallback={<section className="page-panel" aria-busy="true" />}
              >
                <CinemaPage />
              </Suspense>
            }
          />
          <Route
            path="/:movieCode"
            element={
              <Suspense fallback={null}>
                <MoviePage
                  catalogError={catalogError}
                  catalogReady={catalogReady}
                  movieCodesReady={movieCodesReady}
                />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFoundRoute />} />
        </Routes>
      </main>

      <div ref={setMiniNavPortalTarget} />
      <BottomBar />
    </div>
  );
}
