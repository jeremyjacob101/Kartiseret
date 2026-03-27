import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Clock8, Film, MapPin, Settings } from "lucide-react";
import { MovieSearchMenu, type MovieSearchCollection, type MovieSearchResult } from "./MovieSearchMenu";
import { UserMenu } from "./UserMenu";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";

const NAVBAR_INTRO_DURATION_MS = 760;
const MINI_NAVBAR_TRANSITION_MS = 620;

const loadTheaterMapDialog = () => import("./TheaterMapDialog");

const TheaterMapDialog = lazy(async () => {
  const module = await loadTheaterMapDialog();
  return { default: module.TheaterMapDialog };
});

type NavbarPath = "/" | "/movies" | "/showtimes" | "/soons" | "/user";

type NavbarActionsProps = {
  catalogReady: boolean;
  currentPath: NavbarPath;
  searchCollections: readonly MovieSearchCollection[];
  variant?: "inline" | "floating";
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
};

export type NavbarProps = {
  catalogReady: boolean;
  currentPath: NavbarPath;
  searchCollections: readonly MovieSearchCollection[];
  onAllShowtimesNavClick: () => void;
  onHomeClick: () => void;
  onMoviesNavClick: () => void;
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
  onSoonsNavClick: () => void;
};

function LoadingMapButton() {
  const { location } = useUserPreferencesContext();

  return (
    <div className="theater-map-trigger-shell">
      <button
        type="button"
        className="location-menu-trigger theater-map-trigger"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label={`Open city selector. Current city: ${location}`}
        aria-disabled="true"
        disabled
      >
        <MapPin size={20} strokeWidth={2.75} className="app-accent-icon" />
      </button>
    </div>
  );
}

function NavbarActions({
  catalogReady,
  currentPath,
  searchCollections,
  variant = "inline",
  onNavigate,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
}: NavbarActionsProps) {
  const isFloating = variant === "floating";
  const containerClassName = isFloating
    ? "floating-navbar-actions"
    : "navbar-actions";

  return (
    <div className={containerClassName}>
      <div
        className={
          isFloating
            ? "floating-navbar-item floating-navbar-item--search"
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
            ? "floating-navbar-item floating-navbar-item--map"
            : undefined
        }
      >
        <Suspense fallback={<LoadingMapButton />}>
          <TheaterMapDialog />
        </Suspense>
      </div>
      <div
        className={
          isFloating
            ? "floating-navbar-item floating-navbar-item--user"
            : undefined
        }
      >
        <UserMenu currentPath={currentPath} onNavigate={onNavigate} />
      </div>
      <div
        className={
          isFloating
            ? "floating-navbar-item floating-navbar-item--settings"
            : undefined
        }
      >
        <button
          type="button"
          className="settings-button"
          aria-label="Settings"
          onClick={onSettingsClick}
        >
          <Settings size={20} strokeWidth={2.75} className="app-accent-icon" />
        </button>
      </div>
    </div>
  );
}

type MiniNavBarProps = {
  catalogReady: boolean;
  currentPath: NavbarPath;
  isVisible: boolean;
  onHomeClick: () => void;
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
  searchCollections: readonly MovieSearchCollection[];
};

function MiniNavBar({
  catalogReady,
  currentPath,
  isVisible,
  onHomeClick,
  onNavigate,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
  searchCollections,
}: MiniNavBarProps) {
  return (
    <div
      className={`floating-navbar-stack${isVisible ? " is-visible" : ""}`}
      aria-label="Quick actions"
      aria-hidden={!isVisible}
    >
      <NavbarActions
        catalogReady={catalogReady}
        currentPath={currentPath}
        searchCollections={searchCollections}
        variant="floating"
        onNavigate={onNavigate}
        onSearchOpen={onSearchOpen}
        onSelectResult={onSelectResult}
        onSettingsClick={onSettingsClick}
      />
      <div className="floating-navbar-item floating-navbar-item--home">
        <button
          type="button"
          className="floating-home-button"
          aria-label="Go to homepage"
          onClick={onHomeClick}
        >
          <span
            className="brand-mark brand-mark--floating-home"
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

export function Navbar({
  catalogReady,
  currentPath,
  searchCollections,
  onAllShowtimesNavClick,
  onHomeClick,
  onMoviesNavClick,
  onNavigate,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
  onSoonsNavClick,
}: NavbarProps) {
  const [showNavbarIntro, setShowNavbarIntro] = useState(true);
  const [showMiniNavBar, setShowMiniNavBar] = useState(false);
  const [renderMiniNavBar, setRenderMiniNavBar] = useState(false);
  const [miniNavBarVisible, setMiniNavBarVisible] = useState(false);
  const navbarShellRef = useRef<HTMLDivElement | null>(null);
  const miniNavBarStateFrameRef = useRef<number | null>(null);
  const miniNavBarEnterFrameRef = useRef<number | null>(null);
  const miniNavBarExitTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const introTimeout = window.setTimeout(() => {
      setShowNavbarIntro(false);
    }, NAVBAR_INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, []);

  useEffect(() => {
    let frameId: number | null = null;

    const updateMiniNavBar = () => {
      frameId = null;
      const navbarBottom =
        navbarShellRef.current?.getBoundingClientRect().bottom ?? 0;

      setShowMiniNavBar(navbarBottom <= 0);
    };

    const requestMiniNavBarUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateMiniNavBar);
    };

    updateMiniNavBar();

    window.addEventListener("scroll", requestMiniNavBarUpdate, {
      passive: true,
    });
    window.addEventListener("resize", requestMiniNavBarUpdate);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      window.removeEventListener("scroll", requestMiniNavBarUpdate);
      window.removeEventListener("resize", requestMiniNavBarUpdate);
    };
  }, [currentPath]);

  useEffect(() => {
    const clearMiniNavBarTransitions = () => {
      if (miniNavBarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(miniNavBarStateFrameRef.current);
        miniNavBarStateFrameRef.current = null;
      }

      if (miniNavBarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(miniNavBarEnterFrameRef.current);
        miniNavBarEnterFrameRef.current = null;
      }

      if (miniNavBarExitTimeoutRef.current !== null) {
        window.clearTimeout(miniNavBarExitTimeoutRef.current);
        miniNavBarExitTimeoutRef.current = null;
      }
    };

    const scheduleMiniNavBarStateUpdate = (callback: () => void) => {
      if (miniNavBarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(miniNavBarStateFrameRef.current);
      }

      miniNavBarStateFrameRef.current = window.requestAnimationFrame(() => {
        miniNavBarStateFrameRef.current = null;
        callback();
      });
    };

    if (showNavbarIntro) {
      clearMiniNavBarTransitions();
      scheduleMiniNavBarStateUpdate(() => {
        setMiniNavBarVisible(false);
        setRenderMiniNavBar(false);
      });
      return clearMiniNavBarTransitions;
    }

    if (showMiniNavBar) {
      if (miniNavBarExitTimeoutRef.current !== null) {
        window.clearTimeout(miniNavBarExitTimeoutRef.current);
        miniNavBarExitTimeoutRef.current = null;
      }

      if (!renderMiniNavBar) {
        scheduleMiniNavBarStateUpdate(() => {
          setRenderMiniNavBar(true);
          setMiniNavBarVisible(false);
          miniNavBarEnterFrameRef.current = window.requestAnimationFrame(() => {
            miniNavBarEnterFrameRef.current = null;
            setMiniNavBarVisible(true);
          });
        });
        return clearMiniNavBarTransitions;
      }

      scheduleMiniNavBarStateUpdate(() => {
        setMiniNavBarVisible(true);
      });
      return clearMiniNavBarTransitions;
    }

    if (miniNavBarStateFrameRef.current !== null) {
      window.cancelAnimationFrame(miniNavBarStateFrameRef.current);
      miniNavBarStateFrameRef.current = null;
    }

    if (miniNavBarEnterFrameRef.current !== null) {
      window.cancelAnimationFrame(miniNavBarEnterFrameRef.current);
      miniNavBarEnterFrameRef.current = null;
    }

    scheduleMiniNavBarStateUpdate(() => {
      setMiniNavBarVisible(false);
    });

    if (!renderMiniNavBar) {
      return clearMiniNavBarTransitions;
    }

    miniNavBarExitTimeoutRef.current = window.setTimeout(() => {
      miniNavBarExitTimeoutRef.current = null;
      setRenderMiniNavBar(false);
    }, MINI_NAVBAR_TRANSITION_MS);

    return clearMiniNavBarTransitions;
  }, [renderMiniNavBar, showMiniNavBar, showNavbarIntro]);

  useEffect(() => {
    return () => {
      if (miniNavBarStateFrameRef.current !== null) {
        window.cancelAnimationFrame(miniNavBarStateFrameRef.current);
      }

      if (miniNavBarEnterFrameRef.current !== null) {
        window.cancelAnimationFrame(miniNavBarEnterFrameRef.current);
      }

      if (miniNavBarExitTimeoutRef.current !== null) {
        window.clearTimeout(miniNavBarExitTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <div className="navbar-shell" ref={navbarShellRef}>
        <header className={`navbar${showNavbarIntro ? " is-intro" : ""}`}>
          <div className="navbar-intro-mark" aria-hidden="true">
            <span className="brand-mark brand-mark--intro" />
          </div>
          <div className="navbar-content">
            <button
              type="button"
              className="brand brand-button"
              aria-label="Go to top of home page"
              onClick={onHomeClick}
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
                  currentPath === "/movies" ? " topnav-link--active" : ""
                }`}
                onClick={onMoviesNavClick}
              >
                <Film className="topnav-icon" aria-hidden="true" />
                <span className="topnav-label">Now Playing</span>
              </button>
              <button
                type="button"
                className={`topnav-link topnav-button${
                  currentPath === "/soons" ? " topnav-link--active" : ""
                }`}
                onClick={onSoonsNavClick}
              >
                <span
                  className="topnav-icon topnav-icon--soon"
                  aria-hidden="true"
                />
                <span className="topnav-label">Coming Soon</span>
              </button>
              <button
                type="button"
                className={`topnav-link topnav-button${
                  currentPath === "/showtimes" ? " topnav-link--active" : ""
                }`}
                onClick={onAllShowtimesNavClick}
              >
                <Clock8 className="topnav-icon" aria-hidden="true" />
                <span className="topnav-label">All Showtimes</span>
              </button>
            </nav>
            <NavbarActions
              catalogReady={catalogReady}
              currentPath={currentPath}
              searchCollections={searchCollections}
              onNavigate={onNavigate}
              onSearchOpen={onSearchOpen}
              onSelectResult={onSelectResult}
              onSettingsClick={onSettingsClick}
            />
          </div>
        </header>
      </div>

      {renderMiniNavBar ? (
        <MiniNavBar
          catalogReady={catalogReady}
          currentPath={currentPath}
          isVisible={miniNavBarVisible}
          onHomeClick={onHomeClick}
          onNavigate={onNavigate}
          onSearchOpen={onSearchOpen}
          onSelectResult={onSelectResult}
          onSettingsClick={onSettingsClick}
          searchCollections={searchCollections}
        />
      ) : null}
    </>
  );
}
