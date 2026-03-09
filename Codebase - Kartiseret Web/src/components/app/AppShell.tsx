import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { type MovieScrollerJumpRequest } from "../MovieScroller";
import { type MovieSearchResult } from "../topbar/search/MovieSearchMenu";
import { UserPreferencesPage } from "../topbar/settings/UserPreferencesPage";
import {
  comingSoonMovies,
  loadMovieCatalog,
  movies,
} from "../../data/movieCatalog";
import { preloadTheaters } from "../../data/theaters";
import { getCssTimeMs } from "../../lib/cssVariables";
import { useRatingSourcesContext } from "../../prefs/ratingSourcesStore";
import { AppTopbar } from "./AppTopbar";
import {
  getPathnameSnapshot,
  navigateToPath,
  subscribeToPathname,
} from "./appRouting";
import { LandingPage } from "./LandingPage";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchResult["mode"];
};

export function AppShell() {
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
    navigateToPath(path, replace);
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
        floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(
          () => {
            setRenderFloatingTopbar(true);
            setFloatingTopbarVisible(false);
            floatingTopbarEnterFrameRef.current = window.requestAnimationFrame(
              () => {
                floatingTopbarEnterFrameRef.current = null;
                setFloatingTopbarVisible(true);
              },
            );
          },
        );
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

  const requestCatalogLoad = useCallback(() => {
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
      requestCatalogLoad();

      setMovieJumpRequest({
        tmdbId: result.tmdbId,
        mode: result.mode,
        nonce: Date.now(),
        behavior: "smooth",
      });

      if (pathname !== "/") {
        navigate("/");
      }
    },
    [navigate, pathname, requestCatalogLoad],
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
      <AppTopbar
        catalogReady={catalogReady}
        currentPath={pathname}
        floatingTopbarVisible={floatingTopbarVisible}
        renderFloatingTopbar={renderFloatingTopbar}
        searchCollections={searchCollections}
        showTopbarIntro={showTopbarIntro}
        showUserPreferencesLink={Boolean(user)}
        topbarShellRef={topbarShellRef}
        onFloatingHomeClick={handleFloatingHomeClick}
        onNavigate={navigate}
        onSearchOpen={requestCatalogLoad}
        onSelectResult={handleMovieSearchSelect}
        onSettingsClick={handleSettingsClick}
      />

      <main className="app-main">
        {pathname === "/user" && user ? (
          <UserPreferencesPage
            onBackHome={() => {
              navigate("/");
            }}
          />
        ) : (
          <LandingPage
            catalogError={catalogError}
            catalogReady={catalogReady}
            comingSoonJumpRequest={
              movieJumpRequest?.mode === "comingSoon" ? movieJumpRequest : null
            }
            nowPlayingJumpRequest={
              movieJumpRequest?.mode === "nowPlaying" ? movieJumpRequest : null
            }
          />
        )}
      </main>
    </div>
  );
}
