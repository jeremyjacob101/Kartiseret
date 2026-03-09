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
import { getCssTimeMs } from "../../lib/cssVariables";
import { useRatingSourcesContext } from "../../prefs/ratingSourcesStore";
import { AppTopbar } from "./AppTopbar";
import {
  getPathnameSnapshot,
  navigateToPath,
  subscribeToPathname,
} from "./appRouting";
import { LandingPage } from "./LandingPage";
import { useCatalogState } from "./useCatalogState";
import { useFloatingTopbar } from "./useFloatingTopbar";

type AppMovieJumpRequest = MovieScrollerJumpRequest & {
  mode: MovieSearchResult["mode"];
};

export function AppShell() {
  const { user, loading } = useRatingSourcesContext();
  const pathname = useSyncExternalStore(
    subscribeToPathname,
    getPathnameSnapshot,
  );
  const [showTopbarIntro, setShowTopbarIntro] = useState(true);
  const [movieJumpRequest, setMovieJumpRequest] =
    useState<AppMovieJumpRequest | null>(null);
  const topbarShellRef = useRef<HTMLDivElement | null>(null);
  const topbarIntroDurationMs = useMemo(
    () => getCssTimeMs("--topbar-reveal-duration", 760),
    [],
  );
  const navigate = useCallback((path: string, replace = false) => {
    navigateToPath(path, replace);
  }, []);
  const { catalogError, catalogReady, requestCatalogLoad, searchCollections } =
    useCatalogState(pathname);
  const { floatingTopbarVisible, renderFloatingTopbar } = useFloatingTopbar({
    pathname,
    showTopbarIntro,
    topbarShellRef,
  });

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
