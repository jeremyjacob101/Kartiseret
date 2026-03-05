import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "lucide-react";
import { LocationMenu } from "./components/LocationMenu";
import { MovieScroller } from "./components/MovieScroller";
import { MovieScroller2 } from "./components/MovieScroller2";
import { MovieScroller3 } from "./components/MovieScroller3";
import { MovieScroller4 } from "./components/MovieScroller4";
import { MovieScroller5 } from "./components/MovieScroller5";
import { MovieScroller6 } from "./components/MovieScroller6";
import { UserMenu } from "./components/UserMenu";
import { UserPreferencesPage } from "./components/UserPreferencesPage";
import { loadMovieCatalog, movies } from "./data/movieCatalog";
import { RatingSourcesProvider } from "./prefs/RatingSourcesContext";
import { useRatingSourcesContext } from "./prefs/ratingSourcesStore";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;

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
  const pathname = useSyncExternalStore(subscribeToPathname, getPathnameSnapshot);

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

  return (
    <div className="app-shell">
      <header className="topbar">
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
          <LocationMenu />
          <UserMenu
            currentPath={pathname}
            onNavigate={(path) => {
              navigate(path);
            }}
          />
          <button type="button" className="settings-button" aria-label="Settings">
            <Settings size={18} strokeWidth={1.9} />
          </button>
        </div>
      </header>

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
              <h1 className="section-title">Now Playing A</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <div className="scroller-stack">
                  <MovieScroller
                    cardWidth={SCROLLER_CARD_WIDTH}
                    cardHeight={SCROLLER_CARD_HEIGHT}
                    gap={SCROLLER_GAP}
                    maxWidth={SCROLLER_MAX_WIDTH}
                  />
                </div>
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Showtimes</p>
              <h1 className="section-title">Now Playing B1</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <MovieScroller2
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Showtimes</p>
              <h1 className="section-title">Now Playing B2</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <MovieScroller3
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Showtimes</p>
              <h1 className="section-title">Now Playing B3</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <MovieScroller4
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Showtimes</p>
              <h1 className="section-title">Now Playing C</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <MovieScroller5
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">Coming soon</p>
              <h1 className="section-title">Coming Soon A</h1>
            </div>
            <div
              className="scroller-slot"
              style={{ minHeight: SCROLLER_SLOT_MIN_HEIGHT }}
            >
              {catalogReady ? (
                <MovieScroller6
                  cardWidth={SCROLLER_CARD_WIDTH}
                  cardHeight={SCROLLER_CARD_HEIGHT}
                  gap={SCROLLER_GAP}
                  maxWidth={SCROLLER_MAX_WIDTH}
                />
              ) : null}
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
            </div>
            <div className="section-heading">
              <p className="section-kicker">placeholder</p>
              <h1 className="section-title">placeholder</h1>
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
