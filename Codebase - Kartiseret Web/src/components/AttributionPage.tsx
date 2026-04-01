import "./AttributionPage.css";

type AttributionPageProps = {
  onBackHome: () => void;
};

const theaterChainSources = [
  {
    name: "Yes Planet",
    href: "https://www.planetcinema.co.il/",
    logoSrc: "/logos/theaters/yes-planet.png",
  },
  {
    name: "Cinema City",
    href: "https://www.cinema-city.co.il/",
    logoSrc: "/logos/theaters/cinema-city.png",
  },
  {
    name: "Lev Cinema",
    href: "https://www.lev.co.il/",
    logoSrc: "/logos/theaters/lev-cinema.png",
  },
  {
    name: "Rav Hen",
    href: "https://www.rav-hen.co.il/",
    logoSrc: "/logos/theaters/rav-hen.png",
  },
  {
    name: "Hot Cinema",
    href: "https://www.hotcinema.co.il/",
    logoSrc: "/logos/theaters/hot-cinema.ico",
  },
  {
    name: "MovieLand",
    href: "https://www.movieland.co.il/",
    logoSrc: "/logos/theaters/movieland-favicon.ico",
  },
] as const;

const cinemathequeSources = [
  {
    name: "Holon Cinematheque",
    href: "https://www.cinemaholon.org.il/",
    logoSrc: "/logos/theaters/holon-cinematheque.svg",
  },
  {
    name: "Haifa Cinematheque",
    href: "https://www.haifacin.co.il/#",
    logoSrc: "/logos/theaters/haifa-cinematheque.svg",
  },
  {
    name: "Jaffa Cinema",
    href: "https://www.jaffacinema.com/",
    logoSrc: "/logos/theaters/jaffa-cinema.png",
  },
  {
    name: "Jerusalem Cinematheque",
    href: "https://jer-cin.org.il/he",
    logoSrc: "/logos/theaters/jerusalem-cinematheque.png",
  },
  {
    name: "Herziliya Cinematheque",
    href: "https://www.hcinema.org.il/",
    logoSrc: "/logos/theaters/herzliya-cinematheque.webp",
  },
  {
    name: "Tel Aviv Cinematheque",
    href: "https://www.cinema.co.il/",
    logoSrc: "/logos/theaters/tel-aviv-cinematheque.svg",
  },
  {
    name: "Sam Spiegel Cinema",
    href: "https://www.jsfs.co.il/",
    logoSrc: "/logos/theaters/sam-spiegel.jpg",
  },
] as const;

const ratingSources = [
  {
    name: "IMDb",
    href: "https://www.imdb.com/",
    logoSrc: "/logos/imdb.svg",
  },
  {
    name: "Rotten Tomatoes Audience",
    href: "https://www.rottentomatoes.com/",
    logoSrc: "/logos/rtAudienceGood.svg",
  },
  {
    name: "Rotten Tomatoes Critics",
    href: "https://www.rottentomatoes.com/",
    logoSrc: "/logos/rtCriticGood.svg",
  },
  {
    name: "Letterboxd",
    href: "https://letterboxd.com/",
    logoSrc: "/logos/letterboxd.svg",
  },
  {
    name: "TMDb",
    href: "https://www.themoviedb.org/",
    logoSrc: "/logos/tmdb.svg",
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
              source groups currently reflected in the app include the theater
              chains below:
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
                    <span
                      className="attribution-source-logo-shell"
                      aria-hidden="true"
                    >
                      <img
                        className="attribution-source-logo"
                        src={source.logoSrc}
                        alt=""
                      />
                    </span>
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>

            <p className="attribution-card-text attribution-card-text--compact">
              Additional listings are compiled from publicly available
              information on official cinematheque and cinema websites:
            </p>

            <ul className="attribution-source-list attribution-source-list--plain">
              {cinemathequeSources.map((source) => (
                <li key={source.name} className="attribution-source-item">
                  <a
                    className="attribution-source-link attribution-source-link--plain"
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span
                      className="attribution-source-logo-shell"
                      aria-hidden="true"
                    >
                      <img
                        className="attribution-source-logo"
                        src={source.logoSrc}
                        alt=""
                      />
                    </span>
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="attribution-card attribution-card--sources">
          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">Rating sources</p>
            <h2 className="attribution-card-title">
              Official rating and review websites
            </h2>
            <p className="attribution-card-text">
              Rating information is compiled from publicly available
              information on official rating and review websites. The source
              groups currently reflected in the app include:
            </p>

            <ul className="attribution-source-list">
              {ratingSources.map((source) => (
                <li key={source.name} className="attribution-source-item">
                  <a
                    className="attribution-source-link"
                    href={source.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span
                      className="attribution-source-logo-shell"
                      aria-hidden="true"
                    >
                      <img
                        className="attribution-source-logo"
                        src={source.logoSrc}
                        alt=""
                      />
                    </span>
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </section>
  );
}
