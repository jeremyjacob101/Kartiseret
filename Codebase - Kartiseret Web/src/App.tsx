import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "lucide-react";
import {
  MovieScroller,
  type MovieScrollerJumpRequest,
} from "./components/MovieScroller";
import {
  MovieSearchMenu,
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
  const [movieJumpRequest, setMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);

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
      <div className="topbar-shell">
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
                All Showtimes
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
                <span className="topnav-link">Coming Soon</span>
              )}
            </nav>
            <div className="topbar-actions">
              <MovieSearchMenu
                collections={searchCollections}
                loading={!catalogReady}
                onOpen={handleCatalogLoadRequest}
                onSelectResult={handleMovieSearchSelect}
              />
              <TheaterMapDialog />
              <UserMenu
                currentPath={pathname}
                onNavigate={(path) => {
                  navigate(path);
                }}
              />
              <button
                type="button"
                className="settings-button"
                aria-label="Settings"
              >
                <Settings size={20} strokeWidth={2.75} color="#a66ae3"/>
              </button>
            </div>
          </div>
        </header>
      </div>

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
