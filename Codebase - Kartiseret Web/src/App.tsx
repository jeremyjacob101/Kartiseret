import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "lucide-react";
import { MovieScroller } from "./components/MovieScroller";
import { MovieScroller2 } from "./components/MovieScroller2";
import { MovieScroller3 } from "./components/MovieScroller3";
import { MovieScroller4 } from "./components/MovieScroller4";
import { loadMovieCatalog, movies } from "./data/movieCatalog";
import "./index.css";

const SCROLLER_CARD_WIDTH = 220;
const SCROLLER_CARD_HEIGHT = 330;
const SCROLLER_GAP = 22;
const SCROLLER_MAX_WIDTH = 1100;
const SCROLLER_SLOT_MIN_HEIGHT = 420;

export default function App() {
  const [catalogReady, setCatalogReady] = useState(() => movies.length > 0);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    if (catalogReady) {
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
  }, [catalogReady]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Kartiseret</div>
        <nav className="topnav" aria-label="Primary">
          <span className="topnav-link topnav-link--active">All Showtimes</span>
          <span className="topnav-link">Coming Soon</span>
        </nav>
        <button type="button" className="settings-button" aria-label="Settings">
          <Settings size={18} strokeWidth={1.9} />
        </button>
      </header>

      <main className="app-main">
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
            <h1 className="section-title">Now Playing B</h1>
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
            <h1 className="section-title">Now Playing C</h1>
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
            <h1 className="section-title">Now Playing D</h1>
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
          <div className="section-heading">
            <p className="section-kicker">placeholder</p>
            <h1 className="section-title">placeholder</h1>
          </div>
        </section>
      </main>
    </div>
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
