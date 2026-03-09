import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Film, Settings } from "lucide-react";
import {
  MovieScroller,
  type MovieScrollerJumpRequest,
} from "./components/MovieScroller";
import {
  MovieSearchMenu,
  type MovieSearchCollection,
  type MovieSearchResult,
} from "./components/MovieSearchMenu";
import { TheaterMapDialog } from "./components/TheaterMapDialog";
import { UserMenu } from "./components/UserMenu";
import { UserPreferencesPage } from "./components/UserPreferencesPage";
import {
  comingSoonMovies,
  loadMovieCatalog,
  movies,
} from "./data/movieCatalog";
import { preloadTheaters } from "./data/theaters";
import { RatingSourcesProvider } from "./prefs/RatingSourcesContext";
import { useRatingSourcesContext } from "./prefs/ratingSourcesStore";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const TOPBAR_INTRO_DURATION_MS = 760;
const FLOATING_TOPBAR_TRANSITION_MS = 620;

type MovieSearchMode = "nowPlaying" | "comingSoon";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

type TopbarActionsProps = {
  catalogReady: boolean;
  currentPath: "/" | "/user";
  searchCollections: readonly MovieSearchCollection[];
  variant?: "inline" | "floating";
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
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
        className={isFloating ? "floating-topbar-item floating-topbar-item--search" : undefined}
      >
        <MovieSearchMenu
          collections={searchCollections}
          loading={!catalogReady}
          onOpen={onSearchOpen}
          onSelectResult={onSelectResult}
        />
      </div>
      <div
        className={isFloating ? "floating-topbar-item floating-topbar-item--map" : undefined}
      >
        <TheaterMapDialog />
      </div>
      <div
        className={isFloating ? "floating-topbar-item floating-topbar-item--user" : undefined}
      >
        <UserMenu currentPath={currentPath} onNavigate={onNavigate} />
      </div>
      <div
        className={isFloating ? "floating-topbar-item floating-topbar-item--settings" : undefined}
      >
        <button
          type="button"
          className="settings-button"
          aria-label="Settings"
          onClick={onSettingsClick}
        >
          <Settings size={20} strokeWidth={2.75} color="#a66ae3" />
        </button>
      </div>
    </div>
  );
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
    if (showTopbarIntro) {
      if (floatingTopbarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
        floatingTopbarEnterFrameRef.current = null;
      }

      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      setFloatingTopbarVisible(false);
      setRenderFloatingTopbar(false);
      return;
    }

    if (showFloatingTopbar) {
      if (floatingTopbarExitTimeoutRef.current !== null) {
        window.clearTimeout(floatingTopbarExitTimeoutRef.current);
        floatingTopbarExitTimeoutRef.current = null;
      }

      if (!renderFloatingTopbar) {
        setRenderFloatingTopbar(true);
        setFloatingTopbarVisible(false);
        floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(() => {
          floatingTopbarEnterFrameRef.current = null;
          setFloatingTopbarVisible(true);
        });
        return;
      }

      setFloatingTopbarVisible(true);
      return;
    }

    if (floatingTopbarEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(floatingTopbarEnterFrameRef.current);
      floatingTopbarEnterFrameRef.current = null;
    }

    setFloatingTopbarVisible(false);

    if (!renderFloatingTopbar) {
      return;
    }

    floatingTopbarExitTimeoutRef.current = window.setTimeout(() => {
      floatingTopbarExitTimeoutRef.current = null;
      setRenderFloatingTopbar(false);
    }, FLOATING_TOPBAR_TRANSITION_MS);
  }, [renderFloatingTopbar, showFloatingTopbar, showTopbarIntro]);

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
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
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
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
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
