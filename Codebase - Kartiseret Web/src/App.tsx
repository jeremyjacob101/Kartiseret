import { StrictMode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Clock8, Film, Settings } from "lucide-react";
import { MovieScroller, type MovieScrollerJumpRequest } from "./components/scroller/MovieScroller";
import { MovieSearchMenu, type MovieSearchCollection, type MovieSearchResult } from "./components/MovieSearchMenu";
import { TheaterMapDialog } from "./components/TheaterMapDialog";
import { UserMenu } from "./components/UserMenu";
import { UserPreferencesPage } from "./components/UserPreferencesPage";
import { PosterGridPage } from "./components/PosterGridPage";
import { allNowPlayingMovies, comingSoonMovies, loadMovieCatalog } from "./data/movieCatalog";
import { preloadTheaters } from "./data/theaters";
import { UserPreferencesProvider } from "./prefs/UserPreferencesContext";
import { useUserPreferencesContext } from "./prefs/useUserPreferences";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const TOPBAR_INTRO_DURATION_MS = 760;
const FLOATING_TOPBAR_TRANSITION_MS = 620;

type MovieSearchMode = "nowPlaying" | "comingSoon";
type CatalogPageView = "grid" | "scroller";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

type AppPath = "/" | "/movies" | "/showtimes" | "/soons" | "/user";

type TopbarActionsProps = {
  catalogReady: boolean;
  currentPath: AppPath;
  searchCollections: readonly MovieSearchCollection[];
  variant?: "inline" | "floating";
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
};

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

function TopbarActions({
  catalogReady,
  currentPath,
  searchCollections,
  variant = "inline",
  onNavigate,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
}: TopbarActionsProps) {
  const isFloating = variant === "floating";
  const containerClassName = isFloating
    ? "floating-topbar-actions"
    : "topbar-actions";

  return (
    <div className={containerClassName}>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--search"
            : undefined
        }
      >
        <MovieSearchMenu
          collections={searchCollections}
          loading={!catalogReady}
          onOpen={onSearchOpen}
          onSelectResult={onSelectResult}
        />
      </div>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--map"
            : undefined
        }
      >
        <TheaterMapDialog />
      </div>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--user"
            : undefined
        }
      >
        <UserMenu currentPath={currentPath} onNavigate={onNavigate} />
      </div>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--settings"
            : undefined
        }
      >
        <button
          type="button"
          className="settings-button"
          aria-label="Settings"
          onClick={onSettingsClick}
        >
          <Settings
            size={20}
            strokeWidth={2.75}
            className="app-accent-icon"
          />
        </button>
      </div>
    </div>
  );
}

function AppShell() {
  const { user, loading } = useUserPreferencesContext();
  const [catalogReady, setCatalogReady] = useState(
    () => allNowPlayingMovies.length > 0 && comingSoonMovies.length > 0,
  );
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const pathname = useSyncExternalStore(
    subscribeToPathname,
    getPathnameSnapshot,
  );
  const [showTopbarIntro, setShowTopbarIntro] = useState(true);
  const [showFloatingTopbar, setShowFloatingTopbar] = useState(false);
  const [renderFloatingTopbar, setRenderFloatingTopbar] = useState(false);
  const [floatingTopbarVisible, setFloatingTopbarVisible] = useState(false);
  const [catalogMovieJumpRequest, setCatalogMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const [moviesPageView, setMoviesPageView] = useState<CatalogPageView>("grid");
  const [soonsPageView, setSoonsPageView] = useState<CatalogPageView>("grid");
  const topbarShellRef = useRef<HTMLDivElement | null>(null);
  const floatingTopbarStateFrameRef = useRef<number | null>(null);
  const floatingTopbarEnterFrameRef = useRef<number | null>(null);
  const floatingTopbarExitTimeoutRef = useRef<number | null>(null);

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
    const introTimeout = window.setTimeout(() => {
      setShowTopbarIntro(false);
    }, TOPBAR_INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, []);

  useEffect(() => {
    if (!loading && !user && pathname === "/user") {
      navigate("/", true);
    }
  }, [loading, navigate, pathname, user]);

  useEffect(() => {
    let isActive = true;

    if (catalogReady || pathname === "/user") {
      return;
    }

    loadMovieCatalog()
      .then(() => {
        if (isActive) {
          setCatalogReady(true);
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
  }, [catalogReady, pathname]);

  useEffect(() => {
    let frameId: number | null = null;

    const updateFloatingTopbar = () => {
      frameId = null;
      const topbarBottom =
        topbarShellRef.current?.getBoundingClientRect().bottom ?? 0;

      setShowFloatingTopbar(topbarBottom <= 0);
    };

    const requestFloatingTopbarUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateFloatingTopbar);
    };

    updateFloatingTopbar();

    window.addEventListener("scroll", requestFloatingTopbarUpdate, {
      passive: true,
    });
    window.addEventListener("resize", requestFloatingTopbarUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", requestFloatingTopbarUpdate);
      window.removeEventListener("resize", requestFloatingTopbarUpdate);
    };
  }, [pathname]);

  useEffect(() => {
    const clearFloatingTopbarTransitions = () => {
      if (floatingTopbarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarStateFrameRef.current);
        floatingTopbarStateFrameRef.current = null;
      }

      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
        floatingTopbarEnterFrameRef.current = null;
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }
    };

    const scheduleFloatingTopbarStateUpdate = (callback: () => void) => {
      if (floatingTopbarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarStateFrameRef.current);
      }

      floatingTopbarStateFrameRef.current = window.requestAnimationFrame(() => {
        floatingTopbarStateFrameRef.current = null;
        callback();
      });
    };

    if (showTopbarIntro) {
      clearFloatingTopbarTransitions();
      scheduleFloatingTopbarStateUpdate(() => {
        setFloatingTopbarVisible(false);
        setRenderFloatingTopbar(false);
      });
      return clearFloatingTopbarTransitions;
    }

    if (showFloatingTopbar) {
      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      if (!renderFloatingTopbar) {
        scheduleFloatingTopbarStateUpdate(() => {
          setRenderFloatingTopbar(true);
          setFloatingTopbarVisible(false);
          floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(
            () => {
              floatingTopbarEnterFrameRef.current = null;
              setFloatingTopbarVisible(true);
            },
          );
        });
        return clearFloatingTopbarTransitions;
      }

      scheduleFloatingTopbarStateUpdate(() => {
        setFloatingTopbarVisible(true);
      });
      return clearFloatingTopbarTransitions;
    }

    if (floatingTopbarStateFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingTopbarStateFrameRef.current);
      floatingTopbarStateFrameRef.current = null;
    }

    if (floatingTopbarEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      floatingTopbarEnterFrameRef.current = null;
    }

    scheduleFloatingTopbarStateUpdate(() => {
      setFloatingTopbarVisible(false);
    });

    if (!renderFloatingTopbar) {
      return clearFloatingTopbarTransitions;
    }

    floatingTopbarExitTimeoutRef.current = window.setTimeout(() => {
      floatingTopbarExitTimeoutRef.current = null;
      setRenderFloatingTopbar(false);
    }, FLOATING_TOPBAR_TRANSITION_MS);

    return clearFloatingTopbarTransitions;
  }, [renderFloatingTopbar, showFloatingTopbar, showTopbarIntro]);

  useEffect(() => {
    return () => {
      if (floatingTopbarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarStateFrameRef.current);
      }

      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!catalogReady || pathname !== "/") {
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
  }, [catalogReady, pathname]);

  const handleCatalogLoadRequest = useCallback(() => {
    if (catalogReady) {
      return;
    }

    void loadMovieCatalog()
      .then(() => {
        setCatalogReady(true);
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
  }, [catalogReady]);

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
      movies: catalogReady ? comingSoonMovies : [],
    },
  ];

  return (
    <div className="app-shell">
      <div className="topbar-shell" ref={topbarShellRef}>
        <header className={`topbar${showTopbarIntro ? " is-intro" : ""}`}>
          <div className="topbar-intro-mark" aria-hidden="true">
            <span className="brand-mark brand-mark--intro" />
          </div>
          <div className="topbar-content">
            <button
              type="button"
              className="brand brand-button"
              aria-label="Go to top of home page"
              onClick={handleFloatingHomeClick}
            >
              <span
                className="brand-mark brand-mark--lockup"
                aria-hidden="true"
              />
              <span className="brand-text" aria-hidden="true">
                ARTISERET
              </span>
              <span className="visually-hidden">Kartiseret</span>
            </button>
            <nav className="topnav" aria-label="Primary">
              <button
                type="button"
                className={`topnav-link topnav-button${
                  pathname === "/movies" ? " topnav-link--active" : ""
                }`}
                onClick={handleMoviesNavClick}
              >
                <Film className="topnav-icon" aria-hidden="true" />
                <span>Movies</span>
              </button>
              <button
                type="button"
                className={`topnav-link topnav-button${
                  pathname === "/soons" ? " topnav-link--active" : ""
                }`}
                onClick={handleSoonsNavClick}
              >
                <span
                  className="topnav-icon topnav-icon--soon"
                  aria-hidden="true"
                />
                <span>Coming Soon</span>
              </button>
              <button
                type="button"
                className={`topnav-link topnav-button${
                  pathname === "/showtimes" ? " topnav-link--active" : ""
                }`}
                onClick={handleAllShowtimesNavClick}
              >
                <Clock8 className="topnav-icon" aria-hidden="true" />
                <span>All Showtimes</span>
              </button>
            </nav>
            <TopbarActions
              catalogReady={catalogReady}
              currentPath={pathname}
              searchCollections={searchCollections}
              onNavigate={navigate}
              onSearchOpen={handleCatalogLoadRequest}
              onSelectResult={handleMovieSearchSelect}
              onSettingsClick={handleSettingsClick}
            />
          </div>
        </header>
      </div>

      {renderFloatingTopbar ? (
        <div
          className={`floating-topbar-stack${
            floatingTopbarVisible ? " is-visible" : ""
          }`}
          aria-label="Quick actions"
          aria-hidden={!floatingTopbarVisible}
        >
          <TopbarActions
            catalogReady={catalogReady}
            currentPath={pathname}
            searchCollections={searchCollections}
            variant="floating"
            onNavigate={navigate}
            onSearchOpen={handleCatalogLoadRequest}
            onSelectResult={handleMovieSearchSelect}
            onSettingsClick={handleSettingsClick}
          />
          <div className="floating-topbar-item floating-topbar-item--home">
            <button
              type="button"
              className="floating-home-button"
              aria-label="Go to homepage"
              onClick={handleFloatingHomeClick}
            >
              <span
                className="brand-mark brand-mark--floating-home"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      ) : null}

      <main className="app-main">
        {pathname === "/user" && user ? (
          <UserPreferencesPage
            onBackHome={() => {
              navigate("/");
            }}
          />
        ) : pathname === "/movies" ? (
          <section className="page-panel">
            {catalogError ? (
              <p className="app-inline-note" role="status">
                {catalogError}
              </p>
            ) : null}
            {catalogReady ? (
              moviesPageView === "grid" ? (
                <PosterGridPage
                  kicker="Movies"
                  title="Movies"
                  movies={showtimeCatalogMovies}
                  onPosterSelect={(movie) => {
                    handleCatalogPosterSelect("nowPlaying", movie.tmdbId);
                  }}
                />
              ) : (
                <section className="catalog-browser-page" aria-label="Movies">
                  <div className="section-heading catalog-browser-page__heading">
                    <div className="catalog-browser-page__heading-copy">
                      <p className="section-kicker">Movies</p>
                      <h1 className="section-title">Movies</h1>
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
                <PosterGridPage
                  kicker="Coming soon"
                  title="Coming Soon"
                  movies={comingSoonMovies}
                  onPosterSelect={(movie) => {
                    handleCatalogPosterSelect("comingSoon", movie.tmdbId);
                  }}
                />
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
                      movieItems={comingSoonMovies}
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
              {catalogReady ? (
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
              {catalogReady ? (
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
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">Placeholder</p>
              <h1 className="section-title">Placeholder</h1>
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
    <UserPreferencesProvider>
      <AppShell />
    </UserPreferencesProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
