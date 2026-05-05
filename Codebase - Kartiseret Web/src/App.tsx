import { Suspense, StrictMode, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { createRoot } from "react-dom/client";
import { BottomBar } from "./components/bars/BottomBar";
import { AttributionPage } from "./components/AttributionPage";
import { MovieScroller, type MovieScrollerJumpRequest } from "./components/scroller/MovieScroller";
import { Navbar } from "./components/bars/Navbar";
import { type MovieSearchResult } from "./components/MovieSearchMenu";
import { allComingSoonMovies, allNowPlayingMovies, getMovieCatalogStatusSnapshot, loadComingSoonMovies, loadNowPlayingMovies, loadShowtimes, subscribeToMovieCatalog, type Movie } from "./data/movieCatalog";
import { preloadTheaters } from "./data/theaters";
import { DeviceTypeProvider } from "./device/deviceType";
import { useDeviceInfo } from "./device/useDeviceType";
import { UserPreferencesProvider } from "./prefs/UserPreferencesContext";
import { useUserPreferencesContext } from "./prefs/useUserPreferences";
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
const preloadNavbarDependencies = () => import("./components/TheaterMapDialog");
const loadUserPreferencesPage = () =>
  import("./components/UserPreferencesPage");
const loadPosterGridPage = () => import("./components/PosterGridPage");
const loadAllShowtimesPage = () => import("./components/AllShowtimesPage");

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

type MovieSearchMode = "nowPlaying" | "comingSoon";
type CatalogPageView = "grid" | "scroller";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

type CatalogRouteProps = {
  catalogMovieJumpRequest: AppMovieJumpRequest | null;
  cardHeight: number;
  cardWidth: number;
  gap: number;
  jumpMode: MovieSearchMode;
  kicker: string;
  movies: readonly Movie[];
  onExitDetail: () => void;
  onPosterSelect: (tmdbId: string) => void;
  title: string;
  view: CatalogPageView;
  scrollerSlotMinHeight: number;
};

type HomeRouteProps = {
  catalogError: string | null;
  cardHeight: number;
  cardWidth: number;
  comingSoonReady: boolean;
  gap: number;
  nowPlayingReady: boolean;
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

function CatalogRoute({
  catalogMovieJumpRequest,
  cardHeight,
  cardWidth,
  gap,
  jumpMode,
  kicker,
  movies,
  onExitDetail,
  onPosterSelect,
  title,
  view,
  scrollerSlotMinHeight,
}: CatalogRouteProps) {
  return view === "grid" ? (
    <Suspense fallback={null}>
      <PosterGridPage
        kicker={kicker}
        title={title}
        movies={movies}
        onPosterSelect={(movie) => {
          onPosterSelect(movie.tmdbId);
        }}
      />
    </Suspense>
  ) : (
    <section className="catalog-browser-page" aria-label={title}>
      <div className="section-heading catalog-browser-page-heading">
        <div className="catalog-browser-page-heading-copy">
          <p className="section-kicker">{kicker}</p>
          <h1 className="section-title">{title}</h1>
        </div>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
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
      </div>
    </section>
  );
}

function HomeRoute({
  catalogError,
  cardHeight,
  cardWidth,
  comingSoonReady,
  gap,
  nowPlayingReady,
  scrollerSlotMinHeight,
}: HomeRouteProps) {
  return (
    <section className="scroller-panel" aria-label="Now Playing">
      <CatalogErrorNote message={catalogError} />
      <div className="section-heading">
        <p className="section-kicker">Movies</p>
        <h1 className="section-title">Now Playing</h1>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {nowPlayingReady ? (
          <MovieScroller
            mode="nowPlaying"
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            gap={gap}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
        ) : null}
      </div>
      <div className="section-heading">
        <p className="section-kicker">To Be Released</p>
        <h1 className="section-title">Coming Soon</h1>
      </div>
      <div
        className="scroller-slot"
        style={{ minHeight: scrollerSlotMinHeight }}
      >
        {comingSoonReady ? (
          <MovieScroller
            mode="comingSoon"
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            gap={gap}
            maxWidth={SCROLLER_MAX_WIDTH}
          />
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

function UserRoute({ user }: { user: User | null }) {
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
  const navigate = useNavigate();
  const { isMobile } = useDeviceInfo();
  const { user, loading } = useUserPreferencesContext();
  const catalogStatus = useSyncExternalStore(
    subscribeToMovieCatalog,
    getMovieCatalogStatusSnapshot,
  );
  const nowPlayingReady = catalogStatus.nowPlayingReady;
  const comingSoonReady = catalogStatus.comingSoonReady;
  const showtimesReady = catalogStatus.showtimesReady;
  const catalogReady = catalogStatus.catalogReady;
  const pathname = location.pathname;
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogMovieJumpRequest, setCatalogMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const [moviesPageView, setMoviesPageView] = useState<CatalogPageView>("grid");
  const [soonsPageView, setSoonsPageView] = useState<CatalogPageView>("grid");
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

  useEffect(() => {
    if (
      pathname !== "/" ||
      !nowPlayingReady ||
      !comingSoonReady ||
      nonCriticalPreloadStartedRef.current
    ) {
      return;
    }

    nonCriticalPreloadStartedRef.current = true;

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
      void Promise.allSettled([
        loadUserPreferencesPage(),
        loadPosterGridPage(),
      ]);
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
    let isActive = true;

    if (pathname === "/user" || pathname === "/attribution") {
      return;
    }

    const catalogLoadPromise =
      pathname === "/showtimes"
        ? Promise.all([
            loadNowPlayingMovies(),
            loadComingSoonMovies(),
            loadShowtimes(),
          ])
        : Promise.all([loadNowPlayingMovies(), loadComingSoonMovies()]);

    catalogLoadPromise
      .then(() => {
        if (isActive) {
          setCatalogError(null);
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Failed to load movie data from Supabase.";

        console.error("Failed to load movie catalog from Supabase.", error);
        setCatalogError(message);
      });

    return () => {
      isActive = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (
      pathname === "/showtimes" ||
      pathname === "/user" ||
      pathname === "/attribution" ||
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
      void loadShowtimes().catch(() => {});
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
  }, [comingSoonReady, nowPlayingReady, pathname, showtimesReady]);

  useEffect(() => {
    if (!showtimesReady || pathname !== "/") {
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
    const runPreload = () => {
      void preloadNavbarDependencies();
      void loadAllShowtimesPage();
      preloadTheaters();
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
    void Promise.all([loadNowPlayingMovies(), loadComingSoonMovies()])
      .then(() => {
        setCatalogError(null);
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to load movie data from Supabase.";

        console.error("Failed to load movie catalog from Supabase.", error);
        setCatalogError(message);
      });
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
    } else {
      setSoonsPageView("grid");
    }

    setCatalogMovieJumpRequest(null);
  }, []);

  const openCatalogMovie = useCallback(
    (mode: MovieSearchMode, tmdbId: string) => {
      handleCatalogLoadRequest();

      const nextRequest: AppMovieJumpRequest = {
        tmdbId,
        mode,
        nonce: Date.now(),
        behavior: "smooth",
      };

      setCatalogMovieJumpRequest(nextRequest);

      if (mode === "nowPlaying") {
        setMoviesPageView("scroller");
        return;
      }

      setSoonsPageView("scroller");
    },
    [handleCatalogLoadRequest],
  );

  const handleMovieSearchSelect = useCallback(
    (result: MovieSearchResult) => {
      openCatalogMovie(result.mode, result.tmdbId);

      const targetPath = result.mode === "nowPlaying" ? "/movies" : "/soons";

      if (pathname !== targetPath) {
        navigate(targetPath);
      }
    },
    [navigate, openCatalogMovie, pathname],
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
      movies: catalogReady ? allNowPlayingMovies : [],
    },
    {
      mode: "comingSoon" as const,
      label: "Coming Soon",
      movies: catalogReady ? allComingSoonMovies : [],
    },
  ];

  return (
    <div className="app-shell">
      <Navbar
        catalogReady={catalogReady}
        miniNavPortalTarget={miniNavPortalTarget}
        searchCollections={searchCollections}
        onAllShowtimesNavClick={handleAllShowtimesNavClick}
        onHomeClick={handleFloatingHomeClick}
        onMoviesNavClick={handleMoviesNavClick}
        onSearchOpen={handleCatalogLoadRequest}
        onSelectResult={handleMovieSearchSelect}
        onSettingsClick={handleSettingsClick}
        onSoonsNavClick={handleSoonsNavClick}
      />

      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={
              <HomeRoute
                catalogError={catalogError}
                cardHeight={scrollerCardHeight}
                cardWidth={scrollerCardWidth}
                comingSoonReady={comingSoonReady}
                gap={scrollerGap}
                nowPlayingReady={nowPlayingReady}
                scrollerSlotMinHeight={scrollerSlotMinHeight}
              />
            }
          />
          <Route
            path="/movies"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {catalogReady ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="nowPlaying"
                    kicker="Movies"
                    movies={allNowPlayingMovies}
                    onExitDetail={() => {
                      resetCatalogPage("nowPlaying");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("nowPlaying", tmdbId);
                    }}
                    title="Now Playing"
                    view={moviesPageView}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                  />
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
            path="/soons"
            element={
              <section className="page-panel">
                <CatalogErrorNote message={catalogError} />
                {catalogReady ? (
                  <CatalogRoute
                    catalogMovieJumpRequest={catalogMovieJumpRequest}
                    cardHeight={scrollerCardHeight}
                    cardWidth={scrollerCardWidth}
                    gap={scrollerGap}
                    jumpMode="comingSoon"
                    kicker="To Be Released"
                    movies={allComingSoonMovies}
                    onExitDetail={() => {
                      resetCatalogPage("comingSoon");
                    }}
                    onPosterSelect={(tmdbId) => {
                      openCatalogMovie("comingSoon", tmdbId);
                    }}
                    title="Coming Soon"
                    view={soonsPageView}
                    scrollerSlotMinHeight={scrollerSlotMinHeight}
                  />
                ) : null}
              </section>
            }
          />
          <Route path="/user" element={<UserRoute user={user} />} />
          <Route
            path="/attribution"
            element={
              <section className="page-panel">
                <AttributionPage />
              </section>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <div ref={setMiniNavPortalTarget} />
      <BottomBar />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <DeviceTypeProvider>
        <UserPreferencesProvider>
          <App />
        </UserPreferencesProvider>
      </DeviceTypeProvider>
    </BrowserRouter>
  </StrictMode>,
);
