import "./AttributionPage.css";

type AttributionPageProps = {
  onBackHome: () => void;
};

const theaterChainSources = [
  {
    name: "Yes Planet",
    href: "https://www.planetcinema.co.il/",
  },
  {
    name: "Cinema City",
    href: "https://www.cinema-city.co.il/",
  },
  {
    name: "Lev Cinema",
    href: "https://www.lev.co.il/",
  },
  {
    name: "Rav Hen",
    href: "https://www.rav-hen.co.il/",
  },
  {
    name: "Hot Cinema",
    href: "https://www.hotcinema.co.il/",
  },
  {
    name: "MovieLand",
    href: "https://www.movieland.co.il/",
  },
] as const;

export function AttributionPage({ onBackHome }: AttributionPageProps) {
  return (
    <section className="attribution-page" aria-label="Attribution">
      <div className="attribution-page-header">
        <div className="attribution-page-heading">
          <p className="section-kicker">Credits</p>
          <h1 className="section-title">Attribution</h1>
          <p className="attribution-page-intro">
            Kartiseret uses third-party movie, map, and showtime data. This
            page credits those sources and links back to the official providers.
          </p>
        </div>

        <button
          type="button"
          className="attribution-page-back"
          onClick={onBackHome}
        >
          Back to Home
        </button>
      </div>

      <div className="attribution-page-sections">
        <section className="attribution-card">
          <div className="attribution-logo-panel" aria-hidden="true">
            <img
              className="attribution-logo attribution-logo--tmdb"
              src="/logos/tmdb.svg"
              alt=""
            />
          </div>

          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">Movie data</p>
            <h2 className="attribution-card-title">TMDb</h2>
            <p className="attribution-card-text">
              This product uses the TMDB API but is not endorsed or certified
              by TMDB.
            </p>
            <a
              className="attribution-card-link"
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noreferrer"
            >
              Visit TMDb
            </a>
          </div>
        </section>

        <section className="attribution-card">
          <div className="attribution-logo-panel" aria-hidden="true">
            <img
              className="attribution-logo attribution-logo--openstreetmap"
              src="/logos/openStreetMap.svg"
              alt=""
            />
          </div>

          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">Map data</p>
            <h2 className="attribution-card-title">CARTO and OpenStreetMap</h2>
            <p className="attribution-card-text">
              The theater map uses CARTO basemaps and OpenStreetMap
              contributor data. The map itself also keeps a compact attribution
              control visible in the theater picker.
            </p>
            <div className="attribution-link-row">
              <a
                className="attribution-card-link"
                href="https://carto.com/"
                target="_blank"
                rel="noreferrer"
              >
                CARTO
              </a>
              <a
                className="attribution-card-link"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                OpenStreetMap contributors
              </a>
            </div>
          </div>
        </section>

        <section className="attribution-card attribution-card--sources">
          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">
              Showtimes and theater sources
            </p>
            <h2 className="attribution-card-title">
              Official Israeli theater websites
            </h2>
            <p className="attribution-card-text">
              Showtime and venue information is compiled from publicly
              available information on official theater and venue websites. The
              source groups currently reflected in the app include:
            </p>

            <ul className="attribution-source-list">
              {theaterChainSources.map((source) => (
                <li key={source.name} className="attribution-source-item">
                  <a
                    className="attribution-source-link"
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.name}
                  </a>
                </li>
              ))}
              <li className="attribution-source-item attribution-source-item--text">
                Participating cinematheque websites, including{" "}
                <a
                  className="attribution-source-link"
                  href="https://www.cinema.co.il/en/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Tel Aviv Cinematheque
                </a>{" "}
                and{" "}
                <a
                  className="attribution-source-link"
                  href="https://jff.org.il/en/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Jerusalem Cinematheque
                </a>
                .
              </li>
            </ul>
          </div>
        </section>
      </div>
    </section>
  );
}
