import { useEffect, useState, type MouseEventHandler } from "react";
import { Clock8, Film } from "lucide-react";
import { Link, useLocation } from "react-router";
import "./Navbar.css";
import { MovieSearchMenu, type MovieSearchCollection, type MovieSearchResult } from "../MovieSearchMenu";
import { TheaterMapDialog } from "../maps/TheaterMapDialog";
import { UserMenu } from "../UserMenu";

const NAVBAR_INTRO_DURATION_MS = 760;
type NavbarActionsProps = {
  catalogReady: boolean;
  searchLoading: boolean;
  cinemathequeUnavailable: boolean;
  searchCollections: readonly MovieSearchCollection[];
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
};

export type NavbarProps = {
  catalogReady: boolean;
  searchLoading?: boolean;
  cinemathequeUnavailable?: boolean;
  searchCollections: readonly MovieSearchCollection[];
  onHomeClick: () => void;
  onMoviesNavClick: MouseEventHandler<HTMLAnchorElement>;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSoonsNavClick: MouseEventHandler<HTMLAnchorElement>;
};

function NavbarActions({
  catalogReady,
  searchLoading,
  cinemathequeUnavailable,
  searchCollections,
  onSearchOpen,
  onSelectResult,
}: NavbarActionsProps) {
  return (
    <div className="navbar-actions">
      <div>
        <MovieSearchMenu
          collections={searchCollections}
          loading={!catalogReady || searchLoading}
          cinemathequeUnavailable={cinemathequeUnavailable}
          onOpen={onSearchOpen}
          onSelectResult={onSelectResult}
        />
      </div>
      <div>
        <TheaterMapDialog />
      </div>
      <div>
        <UserMenu />
      </div>
    </div>
  );
}

export function Navbar({
  catalogReady,
  searchLoading = false,
  cinemathequeUnavailable = false,
  searchCollections,
  onHomeClick,
  onMoviesNavClick,
  onSearchOpen,
  onSelectResult,
  onSoonsNavClick,
}: NavbarProps) {
  const { pathname: currentPath } = useLocation();
  const [showNavbarIntro, setShowNavbarIntro] = useState(true);

  useEffect(() => {
    const introTimeout = window.setTimeout(() => {
      setShowNavbarIntro(false);
    }, NAVBAR_INTRO_DURATION_MS);

    return () => {
      window.clearTimeout(introTimeout);
    };
  }, []);

  return (
    <div className="navbar-shell">
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
            <Link
              to="/movies"
              className={`topnav-link topnav-button${
                currentPath === "/movies" ? " topnav-link--active" : ""
              }`}
              onClick={onMoviesNavClick}
            >
              <Film className="topnav-icon" aria-hidden="true" />
              <span className="topnav-label">Now Playing</span>
            </Link>
            <Link
              to="/soons"
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
            </Link>
            <Link
              to="/showtimes"
              className={`topnav-link topnav-button${
                currentPath === "/showtimes" ||
                currentPath.startsWith("/showtimes/")
                  ? " topnav-link--active"
                  : ""
              }`}
            >
              <Clock8 className="topnav-icon" aria-hidden="true" />
              <span className="topnav-label">All Showtimes</span>
            </Link>
          </nav>
          <NavbarActions
            catalogReady={catalogReady}
            searchLoading={searchLoading}
            cinemathequeUnavailable={cinemathequeUnavailable}
            searchCollections={searchCollections}
            onSearchOpen={onSearchOpen}
            onSelectResult={onSelectResult}
          />
        </div>
      </header>
    </div>
  );
}
