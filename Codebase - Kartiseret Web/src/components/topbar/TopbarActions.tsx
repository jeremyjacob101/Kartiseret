import { Settings } from "lucide-react";
import {
  MovieSearchMenu,
  type MovieSearchCollection,
  type MovieSearchResult,
} from "./search/MovieSearchMenu";
import { TheaterMapDialog } from "./map/TheaterMapDialog";
import { UserMenu } from "./user/UserMenu";

export type TopbarActionsProps = {
  catalogReady: boolean;
  currentPath: "/" | "/user";
  searchCollections: readonly MovieSearchCollection[];
  variant?: "inline" | "floating";
  onNavigate: (path: string) => void;
  onSearchOpen: () => void;
  onSelectResult: (result: MovieSearchResult) => void;
  onSettingsClick: () => void;
};

export function TopbarActions({
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
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--search"
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
            ? "floating-topbar-item floating-topbar-item--map"
            : undefined
        }
      >
        <TheaterMapDialog />
      </div>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--user"
            : undefined
        }
      >
        <UserMenu currentPath={currentPath} onNavigate={onNavigate} />
      </div>
      <div
        className={
          isFloating
            ? "floating-topbar-item floating-topbar-item--settings"
            : undefined
        }
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
