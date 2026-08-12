import "./AttributionPage.css";
import { useI18n } from "../i18n/I18nContext";
import { localizeTheaterName } from "../i18n/content";

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
    logoSrc: "/logos/theaters/movieland-cinema.ico",
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

const movieDataSources = [
  {
    name: "TMDb",
    href: "https://www.themoviedb.org/",
    logoSrc: "/logos/tmdb.svg",
  },
] as const;

const mapDataSources = [
  {
    name: "CARTO",
    href: "https://carto.com/",
    logoSrc: "/logos/carto.svg",
  },
  {
    name: "OpenStreetMap",
    href: "https://www.openstreetmap.org/",
    logoSrc: "/logos/openStreetMap.svg",
  },
] as const;

export function AttributionPage() {
  const { locale, t } = useI18n();

  return (
    <section className="attribution-page" aria-label={t("attribution.title")}>
      <div className="attribution-page-header">
        <div className="attribution-page-heading">
          <p className="section-kicker">{t("attribution.kicker")}</p>
          <h1 className="section-title">{t("attribution.title")}</h1>
          <p className="attribution-page-intro">{t("attribution.intro")}</p>
        </div>
      </div>

      <div className="attribution-page-sections">
        <section className="attribution-card attribution-card--sources">
          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">
              {t("attribution.movieData")}
            </p>
            <h2 className="attribution-card-title">
              {t("attribution.tmdbTitle")}
            </h2>
            <p className="attribution-card-text">{t("attribution.tmdbCopy")}</p>

            <ul className="attribution-source-list attribution-source-list--plain">
              {movieDataSources.map((source) => (
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
            <p className="attribution-card-kicker">
              {t("attribution.mapData")}
            </p>
            <h2 className="attribution-card-title">
              {t("attribution.mapTitle")}
            </h2>
            <p className="attribution-card-text">{t("attribution.mapCopy")}</p>

            <ul className="attribution-source-list attribution-source-list--plain">
              {mapDataSources.map((source) => (
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
            <p className="attribution-card-kicker">
              {t("attribution.showtimeData")}
            </p>
            <h2 className="attribution-card-title">
              {t("attribution.showtimeTitle")}
            </h2>
            <p className="attribution-card-text">
              {t("attribution.showtimeCopy")}
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
                    <span dir="auto">
                      {localizeTheaterName(source.name, locale)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>

            <p className="attribution-card-text attribution-card-text--compact">
              {t("attribution.additional")}
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
                    <span dir="auto">
                      {localizeTheaterName(source.name, locale)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="attribution-card attribution-card--sources">
          <div className="attribution-card-copy">
            <p className="attribution-card-kicker">
              {t("attribution.ratings")}
            </p>
            <h2 className="attribution-card-title">
              {t("attribution.ratingsTitle")}
            </h2>
            <p className="attribution-card-text">
              {t("attribution.ratingsCopy")}
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

      <section
        className="attribution-disclaimer"
        aria-label={t("attribution.disclaimer")}
      >
        <p className="attribution-disclaimer-kicker">
          {t("attribution.disclaimer")}
        </p>
        <p className="attribution-disclaimer-text">
          {t("attribution.disclaimerCopy")}
        </p>
      </section>
    </section>
  );
}
