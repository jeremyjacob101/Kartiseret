import { Film } from "lucide-react";
import { type RefObject } from "react";
import { TopbarActions } from "../topbar/TopbarActions";
import {
  type MovieSearchCollection,
  type MovieSearchResult,
} from "../topbar/search/MovieSearchMenu";
import { type AppPathname } from "./appRouting";

type AppTopbarProps = {
  catalogReady: boolean;
  currentPath: AppPathname;
  floatingTopbarVisible: boolean;
  renderFloatingTopbar: boolean;
  searchCollections: readonly MovieSearchCollection[];
  showTopbarIntro: boolean;
  showUserPreferencesLink: boolean;
  topbarShellRef: RefObject<HTMLDivElement | null>;
  onFloatingHomeClick: () => void;
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
};

export function AppTopbar({
  catalogReady,
  currentPath,
  floatingTopbarVisible,
  renderFloatingTopbar,
  searchCollections,
  showTopbarIntro,
  showUserPreferencesLink,
  topbarShellRef,
  onFloatingHomeClick,
  onNavigate,
  onSearchOpen,
  onSelectResult,
  onSettingsClick,
}: AppTopbarProps) {
  return (
    <>
      <div className="topbar-shell" ref={topbarShellRef}>
        <header className={`topbar${showTopbarIntro ? " is-intro" : ""}`}>
          <div className="topbar-intro-mark" aria-hidden="true">
            <span className="brand-mark brand-mark--intro" />
          </div>
          <div className="topbar-content">
            <div className="brand">
              <span
                className="brand-mark brand-mark--lockup"
                aria-hidden="true"
              />
              <span className="brand-text" aria-hidden="true">
                ARTISERET
              </span>
              <span className="visually-hidden">Kartiseret</span>
            </div>

            <nav className="topnav" aria-label="Primary">
              <button
                type="button"
                className={`topnav-link topnav-button${
                  currentPath === "/" ? " topnav-link--active" : ""
                }`}
                onClick={() => {
                  onNavigate("/");
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

              {showUserPreferencesLink ? (
                <button
                  type="button"
                  className={`topnav-link topnav-button${
                    currentPath === "/user" ? " topnav-link--active" : ""
                  }`}
                  onClick={() => {
                    onNavigate("/user");
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
            currentPath={currentPath}
            searchCollections={searchCollections}
            variant="floating"
            onNavigate={onNavigate}
            onSearchOpen={onSearchOpen}
            onSelectResult={onSelectResult}
            onSettingsClick={onSettingsClick}
          />

          <div className="floating-topbar-item floating-topbar-item--home">
            <button
              type="button"
              className="floating-home-button"
              aria-label="Go to homepage"
              onClick={onFloatingHomeClick}
            >
              <span
                className="brand-mark brand-mark--floating-home"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
