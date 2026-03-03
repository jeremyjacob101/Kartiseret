import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "lucide-react";
import { MovieScroller } from "./components/MovieScroller";
import { MovieScroller2 } from "./components/MovieScroller2";
import { MovieScroller3 } from "./components/MovieScroller3";
import "./index.css";

export default function App() {
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
          <div className="section-heading">
            <p className="section-kicker">Showtimes</p>
            <h1 className="section-title">Now Playing A</h1>
          </div>
          <div className="scroller-stack">
            <MovieScroller
              cardWidth={220}
              cardHeight={330}
              gap={22}
              maxWidth={1100}
            />
          </div>
          <div className="section-heading">
            <p className="section-kicker">Showtimes</p>
            <h1 className="section-title">Now Playing B</h1>
          </div>
          <MovieScroller2
            cardWidth={220}
            cardHeight={330}
            gap={22}
            maxWidth={1100}
          />
          <div className="section-heading">
            <p className="section-kicker">Showtimes</p>
            <h1 className="section-title">Now Playing C</h1>
          </div>
          <MovieScroller3
            cardWidth={220}
            cardHeight={330}
            gap={22}
            maxWidth={1100}
          />
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
