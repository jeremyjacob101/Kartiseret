import { StrictMode, Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { MovieScroller, type MovieScrollerJumpRequest } from "./components/scroller/MovieScroller";
import { Navbar } from "./components/Navbar";
import { type MovieSearchResult } from "./components/MovieSearchMenu";
import { allComingSoonMovies, allNowPlayingMovies, getMovieCatalogStatusSnapshot, loadMovieCatalog, subscribeToMovieCatalog } from "./data/movieCatalog";
import { preloadTheaters } from "./data/theaters";
import { DeviceTypeProvider } from "./device";
import { UserPreferencesProvider } from "./prefs/UserPreferencesContext";
import { useUserPreferencesContext } from "./prefs/useUserPreferences";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const preloadNavbarDependencies = () => import("./components/TheaterMapDialog");
const loadUserPreferencesPage = () =>
  import("./components/UserPreferencesPage");
const loadPosterGridPage = () => import("./components/PosterGridPage");

const UserPreferencesPage = lazy(async () => {
  const module = await loadUserPreferencesPage();
  return { default: module.UserPreferencesPage };
});

const PosterGridPage = lazy(async () => {
  const module = await loadPosterGridPage();
  return { default: module.PosterGridPage };
});

type MovieSearchMode = "nowPlaying" | "comingSoon";
type CatalogPageView = "grid" | "scroller";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

type AppPath = "/" | "/movies" | "/showtimes" | "/soons" | "/user";

function normalizePathname(pathname: string): AppPath {
  if (pathname === "/movies") {
    return "/movies";
  }

  if (pathname === "/showtimes") {
    return "/showtimes";
  }

  if (pathname === "/soons") {
    return "/soons";
  }

  if (pathname === "/user") {
    return "/user";
  }

  return "/";
}

function subscribeToPathname(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("app:navigate", onStoreChange as EventListener);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("app:navigate", onStoreChange as EventListener);
  };
}

function getPathnameSnapshot(): AppPath {
  return normalizePathname(window.location.pathname);
}

function AppShell() {
  const { user, loading } = useUserPreferencesContext();
  const catalogStatus = useSyncExternalStore(
    subscribeToMovieCatalog,
    getMovieCatalogStatusSnapshot,
  );
  const catalogReady = catalogStatus.catalogReady;
  const nowPlayingReady = catalogStatus.nowPlayingReady;
  const comingSoonReady = catalogStatus.comingSoonReady;
  const showtimesReady = catalogStatus.showtimesReady;
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const pathname = useSyncExternalStore(
    subscribeToPathname,
    getPathnameSnapshot,
  );
  const [catalogMovieJumpRequest, setCatalogMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const [moviesPageView, setMoviesPageView] = useState<CatalogPageView>("grid");
  const [soonsPageView, setSoonsPageView] = useState<CatalogPageView>("grid");
  const nonCriticalPreloadStartedRef = useRef(false);

  const navigate = useCallback((path: string, replace = false) => {
    const targetPath = normalizePathname(path);

    if (window.location.pathname !== targetPath) {
      if (replace) {
        window.history.replaceState({}, "", targetPath);
      } else {
        window.history.pushState({}, "", targetPath);
      }

      window.dispatchEvent(new Event("app:navigate"));
    }
  }, []);

  useEffect(() => {
    if (!loading && !user && pathname === "/user") {
      navigate("/", true);
    }
  }, [loading, navigate, pathname, user]);

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

    if (pathname === "/user") {
      return;
    }

    loadMovieCatalog()
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
    void loadMovieCatalog()
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
    if (!user) {
      return;
    }

    navigate("/user");
  }, [navigate, user]);

  const showtimeCatalogMovies = allNowPlayingMovies;

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

  const handleCatalogPosterSelect = useCallback(
    (mode: MovieSearchMode, tmdbId: string) => {
      openCatalogMovie(mode, tmdbId);
    },
    [openCatalogMovie],
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

  const handleAllShowtimesNavClick = useCallback(() => {
    navigate("/showtimes");
  }, [navigate]);

  const handleSoonsNavClick = useCallback(() => {
    if (pathname === "/soons") {
      resetCatalogPage("comingSoon");
      return;
    }

    resetCatalogPage("comingSoon");
    navigate("/soons");
  }, [navigate, pathname, resetCatalogPage]);

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
        currentPath={pathname}
        searchCollections={searchCollections}
        onAllShowtimesNavClick={handleAllShowtimesNavClick}
        onHomeClick={handleFloatingHomeClick}
        onMoviesNavClick={handleMoviesNavClick}
        onNavigate={navigate}
        onSearchOpen={handleCatalogLoadRequest}
        onSelectResult={handleMovieSearchSelect}
        onSettingsClick={handleSettingsClick}
        onSoonsNavClick={handleSoonsNavClick}
      />

      <main className="app-main">
        {pathname === "/user" && user ? (
          <Suspense fallback={null}>
            <UserPreferencesPage
              onBackHome={() => {
                navigate("/");
              }}
            />
          </Suspense>
        ) : pathname === "/movies" ? (
          <section className="page-panel">
            {catalogError ? (
              <p className="app-inline-note" role="status">
                {catalogError}
              </p>
            ) : null}
            {catalogReady ? (
              moviesPageView === "grid" ? (
                <Suspense fallback={null}>
                  <PosterGridPage
                    key="movies-grid"
                    kicker="Movies"
                    title="Movies"
                    movies={showtimeCatalogMovies}
                    onPosterSelect={(movie) => {
                      handleCatalogPosterSelect("nowPlaying", movie.tmdbId);
                    }}
                  />
                </Suspense>
              ) : (
                <section className="catalog-browser-page" aria-label="Movies">
                  <div className="section-heading catalog-browser-page__heading">
                    <div className="catalog-browser-page__heading-copy">
                      <p className="section-kicker">Movies</p>
                      <h1 className="section-title">Now Playing</h1>
                    </div>
                  </div>
                  <div
                    className="scroller-slot"
                    style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
                  >
                    <MovieScroller
                      mode="nowPlaying"
                      movieItems={showtimeCatalogMovies}
                      jumpRequest={
                        catalogMovieJumpRequest?.mode === "nowPlaying"
                          ? catalogMovieJumpRequest
                          : null
                      }
                      jumpOpenMode="detail"
                      onExitDetail={() => {
                        resetCatalogPage("nowPlaying");
                      }}
                      cardWidth={SCROLLER_CARD_WIDTH}
                      cardHeight={SCROLLER_CARD_HEIGHT}
                      gap={SCROLLER_GAP}
                      maxWidth={SCROLLER_MAX_WIDTH}
                    />
                  </div>
                </section>
              )
            ) : null}
          </section>
        ) : pathname === "/showtimes" ? (
          <section className="page-panel">
            <section
              className="showtimes-placeholder"
              aria-label="All Showtimes"
            >
              <div className="section-heading showtimes-placeholder__heading">
                <p className="section-kicker">Showtimes</p>
                <h1 className="section-title">All Showtimes</h1>
              </div>
              <p className="showtimes-placeholder__note">
                Showtime route placeholder. Add the full listings logic here.
              </p>
            </section>
          </section>
        ) : pathname === "/soons" ? (
          <section className="page-panel">
            {catalogError ? (
              <p className="app-inline-note" role="status">
                {catalogError}
              </p>
            ) : null}
            {catalogReady ? (
              soonsPageView === "grid" ? (
                <Suspense fallback={null}>
                  <PosterGridPage
                    key="soons-grid"
                    kicker="Coming soon"
                    title="Coming Soon"
                    movies={allComingSoonMovies}
                    onPosterSelect={(movie) => {
                      handleCatalogPosterSelect("comingSoon", movie.tmdbId);
                    }}
                  />
                </Suspense>
              ) : (
                <section
                  className="catalog-browser-page"
                  aria-label="Coming Soon"
                >
                  <div className="section-heading catalog-browser-page__heading">
                    <div className="catalog-browser-page__heading-copy">
                      <p className="section-kicker">Coming soon</p>
                      <h1 className="section-title">Coming Soon</h1>
                    </div>
                  </div>
                  <div
                    className="scroller-slot"
                    style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
                  >
                    <MovieScroller
                      mode="comingSoon"
                      movieItems={allComingSoonMovies}
                      jumpRequest={
                        catalogMovieJumpRequest?.mode === "comingSoon"
                          ? catalogMovieJumpRequest
                          : null
                      }
                      jumpOpenMode="detail"
                      onExitDetail={() => {
                        resetCatalogPage("comingSoon");
                      }}
                      cardWidth={SCROLLER_CARD_WIDTH}
                      cardHeight={SCROLLER_CARD_HEIGHT}
                      gap={SCROLLER_GAP}
                      maxWidth={SCROLLER_MAX_WIDTH}
                    />
                  </div>
                </section>
              )
            ) : null}
          </section>
        ) : (
          <section className="scroller-panel" aria-label="Now Playing">
            {catalogError ? (
              <p className="app-inline-note" role="status">
                {catalogError}
              </p>
            ) : null}
            <div className="section-heading">
              <p className="section-kicker">Showtimes</p>
              <h1 className="section-title">Now Playing</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {nowPlayingReady ? (
                <MovieScroller
                  mode="nowPlaying"
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Coming soon</p>
              <h1 className="section-title">Coming Soon</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {comingSoonReady ? (
                <MovieScroller
                  mode="comingSoon"
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <DeviceTypeProvider>
      <UserPreferencesProvider>
        <AppShell />
      </UserPreferencesProvider>
    </DeviceTypeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
