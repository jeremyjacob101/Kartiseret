import {
  type AnimationEvent,
  type CSSProperties,
  StrictMode,
  useCallback,
  useEffect,
  useRef,
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
import { RatingSourcesProvider } from "./prefs/RatingSourcesContext";
import { useRatingSourcesContext } from "./prefs/ratingSourcesStore";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;
const TOPBAR_INTRO_DURATION_MS = 760;

type TopbarPhase =
  | "top"
  | "packing-to-bottom"
  | "to-bottom"
  | "bottom"
  | "to-top";
type MovieSearchMode = "nowPlaying" | "comingSoon";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchMode;
};

type TopbarMotionState = {
  startTop: number;
  startLeft: number;
  startWidth: number;
  startHeight: number;
  targetTop: number;
  targetLeft: number;
  targetWidth: number;
  targetHeight: number;
};

function getTopbarFloatingInsets() {
  const isCompactViewport = window.innerWidth <= 720;

  return {
    inline: isCompactViewport ? 16 : 28,
    top: isCompactViewport ? 14 : 20,
    bottom: isCompactViewport ? 18 : 24,
  };
}

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
  const [topbarPhase, setTopbarPhase] = useState<TopbarPhase>("top");
  const [showTopbarIntro, setShowTopbarIntro] = useState(true);
  const [topbarSize, setTopbarSize] = useState({ width: 0, height: 0 });
  const [topbarMotion, setTopbarMotion] = useState<TopbarMotionState | null>(
    null,
  );
  const [movieJumpRequest, setMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const topbarShellRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const topbarPhaseRef = useRef<TopbarPhase>("top");
  const reduceMotionRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);

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
    topbarPhaseRef.current = topbarPhase;
  }, [topbarPhase]);

  useEffect(() => {
    reduceMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }, []);

  useEffect(() => {
    const introTimeout = window.setTimeout(() => {
      setShowTopbarIntro(false);
    }, TOPBAR_INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, []);

  const measureTopbarShell = useCallback(() => {
    if (
      topbarPhaseRef.current === "packing-to-bottom" ||
      topbarPhaseRef.current === "to-bottom" ||
      topbarPhaseRef.current === "to-top"
    ) {
      return;
    }

    const shell = topbarShellRef.current;
    const topbar = topbarRef.current;

    if (!shell || !topbar) {
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const nextWidth = Math.round(shellRect.width || topbarRect.width);
    const nextHeight = Math.round(shellRect.height || topbarRect.height);

    setTopbarSize((current) => {
      if (current.width === nextWidth && current.height === nextHeight) {
        return current;
      }

      return {
        width: nextWidth,
        height: nextHeight,
      };
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      measureTopbarShell();
    });
    const shell = topbarShellRef.current;

    if (!shell) {
      window.cancelAnimationFrame(frameId);
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      measureTopbarShell();
    });

    resizeObserver.observe(shell);
    window.addEventListener("resize", measureTopbarShell);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureTopbarShell);
    };
  }, [measureTopbarShell]);

  const startTopbarTransition = useCallback(
    (direction: "to-bottom" | "to-top") => {
      const shell = topbarShellRef.current;
      const topbar = topbarRef.current;

      if (!shell || !topbar) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const { inline, top, bottom } = getTopbarFloatingInsets();
      const topbarRect = topbar.getBoundingClientRect();
      const nextWidth = Math.round(shellRect.width || topbarRect.width);
      const nextHeight = Math.round(shellRect.height || topbarRect.height);
      const bottomBarTop = Math.max(
        top,
        window.innerHeight - bottom - nextHeight,
      );
      const hiddenRightLeft = window.innerWidth + inline;
      const centeredLeft = (window.innerWidth - nextWidth) / 2;

      setTopbarSize((current) => ({
        width: nextWidth || current.width,
        height: nextHeight || current.height,
      }));

      setTopbarMotion({
        startTop: bottomBarTop,
        startLeft: direction === "to-bottom" ? hiddenRightLeft : centeredLeft,
        startWidth: nextWidth,
        startHeight: nextHeight,
        targetTop: bottomBarTop,
        targetLeft: direction === "to-bottom" ? centeredLeft : hiddenRightLeft,
        targetWidth: nextWidth,
        targetHeight: nextHeight,
      });

      setTopbarPhase(direction);
    },
    [],
  );

  const reconcileTopbarPlacement = useCallback(() => {
    const shell = topbarShellRef.current;
    const topbar = topbarRef.current;

    if (!shell || !topbar) {
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const shouldDock = shellRect.bottom <= 0;

    if (reduceMotionRef.current) {
      if (shouldDock && topbarPhaseRef.current === "top") {
        setTopbarPhase("bottom");
      } else if (!shouldDock && topbarPhaseRef.current === "bottom") {
        setTopbarPhase("top");
      }

      return;
    }

    if (topbarPhaseRef.current === "top" && shouldDock) {
      setTopbarPhase("packing-to-bottom");
    } else if (topbarPhaseRef.current === "bottom" && !shouldDock) {
      startTopbarTransition("to-top");
    }
  }, [startTopbarTransition]);

  useEffect(() => {
    const handleScrollOrResize = () => {
      if (scrollFrameRef.current !== null) {
        return;
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        reconcileTopbarPlacement();
      });
    };

    handleScrollOrResize();
    window.addEventListener("scroll", handleScrollOrResize, { passive: true });
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      window.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [reconcileTopbarPlacement]);

  useEffect(() => {
    if (topbarPhase !== "top" && topbarPhase !== "bottom") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      reconcileTopbarPlacement();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [reconcileTopbarPlacement, topbarPhase]);

  const handleTopbarAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (topbarPhase === "packing-to-bottom") {
        startTopbarTransition("to-bottom");
        return;
      }

      if (topbarPhase === "to-bottom") {
        setTopbarPhase("bottom");
        return;
      }

      if (topbarPhase === "to-top") {
        setTopbarPhase("top");
      }
    },
    [startTopbarTransition, topbarPhase],
  );

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

  const floatingInsets = getTopbarFloatingInsets();
  const appShellStyle =
    topbarSize.height > 0
      ? ({ "--topbar-shell-height": `${topbarSize.height}px` } as CSSProperties)
      : undefined;
  const hasFloatingTopbar =
    topbarPhase !== "top" && topbarPhase !== "packing-to-bottom";
  const topbarShellStyle =
    topbarSize.height > 0
      ? ({ minHeight: `${topbarSize.height}px` } as CSSProperties)
      : undefined;
  const topbarStyle = {
    ...(topbarSize.width > 0
      ? { "--topbar-open-width": `${topbarSize.width}px` }
      : {}),
    ...(topbarSize.height > 0
      ? { "--topbar-open-height": `${topbarSize.height}px` }
      : {}),
    "--topbar-bottom-inset": `${floatingInsets.bottom}px`,
    ...(topbarMotion
      ? {
          "--topbar-start-top": `${topbarMotion.startTop}px`,
          "--topbar-start-left": `${topbarMotion.startLeft}px`,
          "--topbar-start-width": `${topbarMotion.startWidth}px`,
          "--topbar-start-height": `${topbarMotion.startHeight}px`,
          "--topbar-target-top": `${topbarMotion.targetTop}px`,
          "--topbar-target-left": `${topbarMotion.targetLeft}px`,
          "--topbar-target-width": `${topbarMotion.targetWidth}px`,
          "--topbar-target-height": `${topbarMotion.targetHeight}px`,
        }
      : {}),
  } as CSSProperties;

  return (
    <div
      className={`app-shell${hasFloatingTopbar ? " has-floating-topbar" : ""}`}
      style={appShellStyle}
    >
      <div
        className="topbar-shell"
        ref={topbarShellRef}
        style={topbarShellStyle}
      >
        <header
          ref={topbarRef}
          className={`topbar${
            showTopbarIntro && topbarPhase === "top" ? " is-intro" : ""
          }`}
          data-phase={topbarPhase}
          style={topbarStyle}
          onAnimationEnd={handleTopbarAnimationEnd}
        >
          <div className="topbar-intro-mark" aria-hidden="true">
            K
          </div>
          <div className="topbar-content">
            <div className="brand">Kartiseret</div>
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
