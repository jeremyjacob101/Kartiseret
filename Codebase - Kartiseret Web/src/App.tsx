import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Settings } from "lucide-react";
import { MovieScroller2 } from "./components/MovieScroller2";
import "./index.css";

export default function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">Kartiseret</div>
        <nav className="topnav" aria-label="Primary">
          <span className="topnav-link topnav-link--active">Showtimes</span>
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
            <h1 className="section-title">Now Playing</h1>
          </div>
          <div className="scroller-stack">
            {/* <MovieScroller1
              cardWidth={220}
              cardHeight={330}
              gap={22}
              maxWidth={1100}
              onSelectMovie={handleSelectMovie}
            /> */}
            <MovieScroller2
              cardWidth={220}
              cardHeight={330}
              gap={22}
              maxWidth={1100}
            />
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
