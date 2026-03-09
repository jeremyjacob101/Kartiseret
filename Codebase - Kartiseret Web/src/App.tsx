import {
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Film } from "lucide-react";
import {
  MovieScroller,
  type MovieScrollerJumpRequest,
} from "./components/MovieScroller";
import {
  TopbarActions,
} from "./components/topbar/TopbarActions";
import {
  type MovieSearchResult,
} from "./components/topbar/search/MovieSearchMenu";
import { UserPreferencesPage } from "./components/topbar/settings/UserPreferencesPage";
import {
  comingSoonMovies,
  loadMovieCatalog,
  movies,
} from "./data/movieCatalog";
import { preloadTheaters } from "./data/theaters";
import { getCssTimeMs } from "./lib/cssVariables";
import { RatingSourcesProvider } from "./prefs/RatingSourcesContext";
import { useRatingSourcesContext } from "./prefs/ratingSourcesStore";
import "./components/topbar/topbar.css";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;

type MovieSearchMode = "nowPlaying" | "comingSoon";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

function normalizePathname(pathname: string): "/" | "/user" {
  return pathname === "/user" ? "/user" : "/";
}

function subscribeToPathname(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener("app:navigate", onStoreChange as EventListener);

  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener("app:navigate", onStoreChange as EventListener);
  };
}

function getPathnameSnapshot(): "/" | "/user" {
  return normalizePathname(window.location.pathname);
}

function AppShell() {
  const { user, loading } = useRatingSourcesContext();
  const [catalogReady, setCatalogReady] = useState(() => movies.length > 0);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const pathname = useSyncExternalStore(
    subscribeToPathname,
    getPathnameSnapshot,
  );
  const [showTopbarIntro, setShowTopbarIntro] = useState(true);
  const [showFloatingTopbar, setShowFloatingTopbar] = useState(false);
  const [renderFloatingTopbar, setRenderFloatingTopbar] = useState(false);
  const [floatingTopbarVisible, setFloatingTopbarVisible] = useState(false);
  const [movieJumpRequest, setMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const topbarShellRef = useRef<HTMLDivElement | null>(null);
  const floatingTopbarEnterFrameRef = useRef<number | null>(null);
  const floatingTopbarExitTimeoutRef = useRef<number | null>(null);
  const topbarIntroDurationMs = useMemo(
    () => getCssTimeMs("--topbar-reveal-duration", 760),
    [],
  );
  const floatingTopbarExitDurationMs = useMemo(
    () => getCssTimeMs("--floating-topbar-exit-duration", 620),
    [],
  );

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
    }, topbarIntroDurationMs);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, [topbarIntroDurationMs]);

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
    if (showTopbarIntro) {
      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
        floatingTopbarEnterFrameRef.current = null;
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }
      return;
    }

    if (showFloatingTopbar) {
      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      if (!renderFloatingTopbar) {
        floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
          setRenderFloatingTopbar(true);
          setFloatingTopbarVisible(false);
          floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
            floatingTopbarEnterFrameRef.current = null;
            setFloatingTopbarVisible(true);
          });
        });
        return;
      }

      floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
        floatingTopbarEnterFrameRef.current = null;
        setFloatingTopbarVisible(true);
      });
      return;
    }

    if (floatingTopbarEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      floatingTopbarEnterFrameRef.current = null;
    }

    floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
      floatingTopbarEnterFrameRef.current = null;
      setFloatingTopbarVisible(false);
    });

    if (!renderFloatingTopbar) {
      return;
    }

    floatingTopbarExitTimeoutRef.current = window.setTimeout(() => {
      floatingTopbarExitTimeoutRef.current = null;
      setRenderFloatingTopbar(false);
    }, floatingTopbarExitDurationMs);
  }, [
    floatingTopbarExitDurationMs,
    renderFloatingTopbar,
    showFloatingTopbar,
    showTopbarIntro,
  ]);

  useEffect(() => {
    return () => {
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
      idleId = windowWithIdleCallbacks.requestIdleCallback(() => {
        runPreload();
      }, { timeout: 1200 });
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

  const handleMovieSearchSelect = useCallback(
    (result: MovieSearchResult) => {
      handleCatalogLoadRequest();

      const nextRequest: AppMovieJumpRequest = {
        tmdbId: result.tmdbId,
        mode: result.mode,
        nonce: Date.now(),
        behavior: "smooth",
      };

      setMovieJumpRequest(nextRequest);

      if (pathname !== "/") {
        navigate("/");
      }
    },
    [handleCatalogLoadRequest, navigate, pathname],
  );

  const handleSettingsClick = useCallback(() => {
    if (!user) {
      return;
    }

    navigate("/user");
  }, [navigate, user]);

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
      movies,
    },
    {
      mode: "comingSoon" as const,
      label: "Coming Soon",
      movies: comingSoonMovies,
    },
  ];

  return (
    <div className="app-shell">
      <div className="topbar-shell" ref={topbarShellRef}>
        <header
          className={`topbar${showTopbarIntro ? " is-intro" : ""}`}
        >
          <div className="topbar-intro-mark" aria-hidden="true">
            <span className="brand-mark brand-mark--intro" />
          </div>
          <div className="topbar-content">
            <div className="brand">
              <span className="brand-mark brand-mark--lockup" aria-hidden="true" />
              <span className="brand-text" aria-hidden="true">
                ARTISERET
              </span>
              <span className="visually-hidden">Kartiseret</span>
            </div>
            <nav className="topnav" aria-label="Primary">
              <button
                type="button"
                className={`topnav-link topnav-button${
                  pathname === "/" ? " topnav-link--active" : ""
                }`}
                onClick={() => {
                  navigate("/");
                }}
              >
                <Film
                  className="topnav-icon"
                  size={18}
                  strokeWidth={2.5}
                  color="#212121"
                  aria-hidden="true"
                />
                <span>All Showtimes</span>
              </button>
              {user ? (
                <button
                  type="button"
                  className={`topnav-link topnav-button${
                    pathname === "/user" ? " topnav-link--active" : ""
                  }`}
                  onClick={() => {
                    navigate("/user");
                  }}
                >
                  User Preferences
                </button>
              ) : (
                <span className="topnav-link">
                  <span
                    className="topnav-icon topnav-icon--soon"
                    aria-hidden="true"
                  />
                  <span>Coming Soon</span>
                </span>
              )}
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
              <span className="brand-mark brand-mark--floating-home" aria-hidden="true" />
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
            >
              {catalogReady ? (
                <MovieScroller
                  mode="nowPlaying"
                  jumpRequest={
                    movieJumpRequest?.mode === "nowPlaying"
                      ? movieJumpRequest
                      : null
                  }
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
            >
              {catalogReady ? (
                <MovieScroller
                  mode="comingSoon"
                  jumpRequest={
                    movieJumpRequest?.mode === "comingSoon"
                      ? movieJumpRequest
                      : null
                  }
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
    <RatingSourcesProvider>
      <AppShell />
    </RatingSourcesProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
