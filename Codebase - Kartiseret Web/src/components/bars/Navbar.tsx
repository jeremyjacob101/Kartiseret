import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Clock8, Film, MapPin, Settings } from "lucide-react";
import { useLocation } from "react-router";
import "./Navbar.css";
import { MiniNavBar } from "./MiniNavBar";
import { MovieSearchMenu, type MovieSearchCollection, type MovieSearchResult } from "../MovieSearchMenu";
import { UserMenu } from "../UserMenu";
import { useDeviceInfo } from "../../device/useDeviceType";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";

const NAVBAR_INTRO_DURATION_MS = 760;
const MINI_NAVBAR_TRANSITION_MS = 620;
const MOBILE_FLOATING_NAVBAR_BOTTOM_PX = 10;
const DEFAULT_FLOATING_NAVBAR_BOTTOM_PX = 24;
const FLOATING_NAVBAR_FOOTER_GAP_PX = 10;
const MOBILE_MINI_NAVBAR_SCROLL_THRESHOLD_PX = 6;

const loadTheaterMapDialog = () => import("../TheaterMapDialog");

const TheaterMapDialog = lazy(async () => {
  const module = await loadTheaterMapDialog();
  return { default: module.TheaterMapDialog };
});

function getWindowScrollY(): number {
  return Math.max(0, window.scrollY || window.pageYOffset || 0);
}

type NavbarActionsProps = {
  catalogReady: boolean;
  searchCollections: readonly MovieSearchCollection[];
  variant?: "inline" | "floating";
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
};

export type NavbarProps = {
  catalogReady: boolean;
  searchCollections: readonly MovieSearchCollection[];
  onAllShowtimesNavClick: () => void;
  onHomeClick: () => void;
  onMoviesNavClick: () => void;
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
  searchCollections,
  variant = "inline",
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
          panelDirection={isFloating ? "up" : "down"}
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
        <UserMenu panelDirection={isFloating ? "up" : "down"} />
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

export function Navbar({
  catalogReady,
  searchCollections,
  onAllShowtimesNavClick,
  onHomeClick,
  onMoviesNavClick,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
  onSoonsNavClick,
}: NavbarProps) {
  const location = useLocation();
  const { isMobile } = useDeviceInfo();
  const [showNavbarIntro, setShowNavbarIntro] = useState(true);
  const [showMiniNavBar, setShowMiniNavBar] = useState(false);
  const [renderMiniNavBar, setRenderMiniNavBar] = useState(false);
  const [miniNavBarVisible, setMiniNavBarVisible] = useState(false);
  const [miniNavBarBottomOffset, setMiniNavBarBottomOffset] = useState<
    number | null
  >(null);
  const [miniNavBarOverBottomBar, setMiniNavBarOverBottomBar] = useState(false);
  const navbarShellRef = useRef<HTMLDivElement | null>(null);
  const floatingNavStackRef = useRef<HTMLDivElement | null>(null);
  const miniNavBarStateFrameRef = useRef<number | null>(null);
  const miniNavBarEnterFrameRef = useRef<number | null>(null);
  const miniNavBarExitTimeoutRef = useRef<number | null>(null);
  const showMiniNavBarRef = useRef(showMiniNavBar);
  const mobileLastScrollYRef = useRef(0);
  const mobileScrollDeltaRef = useRef(0);
  const currentPath = location.pathname;

  useEffect(() => {
    const introTimeout = window.setTimeout(() => {
      setShowNavbarIntro(false);
    }, NAVBAR_INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, []);

  useEffect(() => {
    showMiniNavBarRef.current = showMiniNavBar;
  }, [showMiniNavBar]);

  useEffect(() => {
    if (!isMobile) {
      mobileScrollDeltaRef.current = 0;
      mobileLastScrollYRef.current = 0;
      return;
    }

    mobileLastScrollYRef.current = getWindowScrollY();
    mobileScrollDeltaRef.current = 0;
    showMiniNavBarRef.current = true;
    const frameId = window.requestAnimationFrame(() => {
      setShowMiniNavBar(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentPath, isMobile]);

  useEffect(() => {
    let frameId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    const resetMiniNavBarBottomBarState = () => {
      setMiniNavBarOverBottomBar(false);
      setMiniNavBarBottomOffset(null);
    };

    const getDefaultFloatingNavbarBottomPx = () =>
      isMobile
        ? MOBILE_FLOATING_NAVBAR_BOTTOM_PX
        : DEFAULT_FLOATING_NAVBAR_BOTTOM_PX;

    const updateMiniNavBar = () => {
      frameId = null;
      const navbarBottom =
        navbarShellRef.current?.getBoundingClientRect().bottom ?? 0;
      let shouldShowMiniNavBar = showMiniNavBarRef.current;

      if (isMobile) {
        const currentScrollY = getWindowScrollY();
        const scrollDelta = currentScrollY - mobileLastScrollYRef.current;

        if (scrollDelta !== 0) {
          const scrollDirection = Math.sign(scrollDelta);
          const accumulatedDirection = Math.sign(mobileScrollDeltaRef.current);

          mobileScrollDeltaRef.current =
            mobileScrollDeltaRef.current === 0 ||
            scrollDirection === accumulatedDirection
              ? mobileScrollDeltaRef.current + scrollDelta
              : scrollDelta;

          if (
            mobileScrollDeltaRef.current >=
            MOBILE_MINI_NAVBAR_SCROLL_THRESHOLD_PX
          ) {
            shouldShowMiniNavBar = false;
            mobileScrollDeltaRef.current = 0;
          } else if (
            mobileScrollDeltaRef.current <=
            -MOBILE_MINI_NAVBAR_SCROLL_THRESHOLD_PX
          ) {
            shouldShowMiniNavBar = true;
            mobileScrollDeltaRef.current = 0;
          }
        }

        mobileLastScrollYRef.current = currentScrollY;
      } else {
        shouldShowMiniNavBar = navbarBottom <= 0;
      }

      if (showMiniNavBarRef.current !== shouldShowMiniNavBar) {
        showMiniNavBarRef.current = shouldShowMiniNavBar;
        setShowMiniNavBar(shouldShowMiniNavBar);
      }

      if (showNavbarIntro || !shouldShowMiniNavBar || !renderMiniNavBar) {
        resetMiniNavBarBottomBarState();
        return;
      }

      const footerBar = document.querySelector(".bottom-bar");
      const floatingStack = floatingNavStackRef.current;

      if (!(footerBar instanceof HTMLElement) || floatingStack === null) {
        resetMiniNavBarBottomBarState();
        return;
      }

      const footerRect = footerBar.getBoundingClientRect();
      const floatingStackRect = floatingStack.getBoundingClientRect();
      const floatingStackHeight = floatingStackRect.height;
      const defaultBottomPx = getDefaultFloatingNavbarBottomPx();
      const defaultBottomEdge = window.innerHeight - defaultBottomPx;
      const defaultTopEdge = defaultBottomEdge - floatingStackHeight;
      const isOverBottomBar =
        footerRect.top < defaultBottomEdge &&
        footerRect.bottom > defaultTopEdge;

      if (!isOverBottomBar) {
        resetMiniNavBarBottomBarState();
        return;
      }

      const footerTopDistanceFromViewportBottom =
        window.innerHeight - footerRect.top;
      const centeredBottom =
        window.innerHeight -
        footerRect.top -
        footerRect.height / 2 -
        floatingStackHeight / 2;
      const liftedBottom = Math.round(
        footerTopDistanceFromViewportBottom + FLOATING_NAVBAR_FOOTER_GAP_PX,
      );
      const targetBottom = isMobile ? liftedBottom : Math.round(centeredBottom);

      setMiniNavBarOverBottomBar(true);
      setMiniNavBarBottomOffset(Math.max(defaultBottomPx, targetBottom));
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

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        requestMiniNavBarUpdate();
      });

      const footerBar = document.querySelector(".bottom-bar");

      if (footerBar instanceof HTMLElement) {
        resizeObserver.observe(footerBar);
      }

      if (floatingNavStackRef.current !== null) {
        resizeObserver.observe(floatingNavStackRef.current);
      }
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      resizeObserver?.disconnect();

      window.removeEventListener("scroll", requestMiniNavBarUpdate);
      window.removeEventListener("resize", requestMiniNavBarUpdate);
    };
  }, [currentPath, isMobile, renderMiniNavBar, showNavbarIntro]);

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
            {isMobile ? null : (
              <NavbarActions
                catalogReady={catalogReady}
                searchCollections={searchCollections}
                onSearchOpen={onSearchOpen}
                onSelectResult={onSelectResult}
                onSettingsClick={onSettingsClick}
              />
            )}
          </div>
        </header>
      </div>

      {renderMiniNavBar ? (
        <MiniNavBar
          actions={
            <NavbarActions
              catalogReady={catalogReady}
              searchCollections={searchCollections}
              variant="floating"
              onSearchOpen={onSearchOpen}
              onSelectResult={onSelectResult}
              onSettingsClick={onSettingsClick}
            />
          }
          bottomOffset={miniNavBarBottomOffset}
          isOverBottomBar={miniNavBarOverBottomBar && !isMobile}
          isVisible={miniNavBarVisible}
          onHomeClick={onHomeClick}
          stackRef={floatingNavStackRef}
        />
      ) : null}
    </>
  );
}
