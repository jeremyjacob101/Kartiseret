import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router";
import "./UserPreferencesPage.css";
import { loadCityLocationPicker } from "./maps/loadCityLocationPicker";
import { allComingSoonMovies, allNowPlayingMovies, subscribeToMovieCatalog, type Movie } from "../data/movieCatalog";
import { cancelTicketAlert, loadUserTicketAlertSubscriptions, type UserTicketAlertSubscription } from "../data/ticketAlerts";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { type AppLocation } from "../prefs/definitions/locations";
import { getSiteColorLabel, type SiteColor, type SiteColorOption } from "../prefs/definitions/siteColor";

const CityLocationPicker = lazy(async () => {
  const module = await loadCityLocationPicker();

  return { default: module.CityLocationPicker };
});

const sourceLabelMap: Record<RatingSource, string> = {
  imdbRating: "IMDb",
  rtAudienceRating: "Rotten Tomatoes Audience",
  rtCriticRating: "Rotten Tomatoes Critics",
  lbRating: "Letterboxd",
  tmdbRating: "TMDB",
};
function getSourcesSummary(sources: readonly RatingSource[]): string {
  if (sources.length === 0) {
    return "No sources selected";
  }

  const labels = sources.map((source) => sourceLabelMap[source]);

  if (labels.length <= 2) {
    return labels.join(", ");
  }

  return `${labels[0]}, ${labels[1]} +${labels.length - 2} more`;
}

function getVisibleSiteColors(
  siteColor: SiteColor,
  options: readonly SiteColorOption[],
): readonly SiteColorOption[] {
  if (options.some((option) => option.value === siteColor)) {
    return options;
  }

  return [
    {
      label: `Current ${siteColor.toUpperCase()}`,
      value: siteColor,
    },
    ...options,
  ];
}

const alertDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function findAlertMovie(tmdbId: string): Movie | null {
  return (
    allComingSoonMovies.find((movie) => movie.tmdbId === tmdbId) ??
    allNowPlayingMovies.find((movie) => movie.tmdbId === tmdbId) ??
    null
  );
}

function formatAlertDate(value: string | null | undefined): string {
  if (!value) {
    return "Release date pending";
  }

  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : alertDateFormatter.format(parsed);
}

function EmbeddedCityLocationPickerLoading() {
  return (
    <div
      className="theater-map-panel theater-map-panel--embedded prefs-location-map-loading"
      role="status"
    >
      Loading city map...
    </div>
  );
}

export function UserPreferencesPage() {
  const {
    user,
    sources,
    location,
    allSources,
    allSiteColors,
    siteColor,
    defaultSiteColor,
    syncing,
    error,
    saveSources,
    setLocationPreference,
    saveSiteColor,
    resetSiteColor,
  } = useUserPreferencesContext();
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [ticketAlerts, setTicketAlerts] = useState<
    UserTicketAlertSubscription[]
  >([]);
  const [ticketAlertsLoading, setTicketAlertsLoading] = useState(true);
  const [ticketAlertsError, setTicketAlertsError] = useState<string | null>(
    null,
  );
  const [removingAlertId, setRemovingAlertId] = useState<string | null>(null);
  const [, setCatalogRevision] = useState(0);
  const userId = user?.id ?? null;
  const visibleSiteColors = useMemo(
    () => getVisibleSiteColors(siteColor, allSiteColors),
    [allSiteColors, siteColor],
  );

  useEffect(() => {
    return subscribeToMovieCatalog(() => {
      setCatalogRevision((revision) => revision + 1);
    });
  }, []);

  useEffect(() => {
    let isCurrent = true;

    if (!userId) {
      return () => {
        isCurrent = false;
      };
    }

    void loadUserTicketAlertSubscriptions(userId)
      .then((alerts) => {
        if (isCurrent) {
          setTicketAlerts(alerts);
          setTicketAlertsLoading(false);
        }
      })
      .catch((loadError: unknown) => {
        if (isCurrent) {
          setTicketAlertsError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your coming soon alerts.",
          );
          setTicketAlertsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [userId]);

  const handleRemoveAlert = useCallback(
    async (tmdbId: string) => {
      if (!userId || removingAlertId) {
        return;
      }

      setRemovingAlertId(tmdbId);
      setTicketAlertsError(null);
      try {
        await cancelTicketAlert(userId, tmdbId);
        setTicketAlerts((alerts) =>
          alerts.filter((alert) => alert.tmdbId !== tmdbId));
      } catch (removeError: unknown) {
        setTicketAlertsError(
          removeError instanceof Error
            ? removeError.message
            : "Could not cancel this coming soon alert.",
        );
      } finally {
        setRemovingAlertId(null);
      }
    },
    [removingAlertId, userId],
  );

  const handleSourceToggle = useCallback(
    async (source: RatingSource) => {
      const nextSources = sources.includes(source)
        ? sources.filter((entry) => entry !== source)
        : [...sources, source];

      await saveSources(nextSources);
    },
    [saveSources, sources],
  );

  const handleLocationPick = useCallback(
    async (nextLocation: AppLocation) => {
      await setLocationPreference(nextLocation);
    },
    [setLocationPreference],
  );

  const handleSiteColorChange = useCallback(
    async (nextSiteColor: SiteColor) => {
      await saveSiteColor(nextSiteColor);
    },
    [saveSiteColor],
  );

  const handleSiteColorReset = useCallback(async () => {
    await resetSiteColor();
  }, [resetSiteColor]);

  return (
    <section className="prefs-page" aria-label="User preferences">
      <div className="prefs-page-header">
        <div>
          <p className="section-kicker">User</p>
          <h1 className="section-title">User Preferences</h1>
        </div>
        <Link className="prefs-page-back" to="/">
          Back to Home
        </Link>
      </div>

      <div className="prefs-page-card" aria-busy={syncing}>
        <section className="prefs-location-card">
          <div className="prefs-location-header">
            <div>
              <p className="prefs-setting-label">Location</p>
              <h2 className="prefs-location-title">{location}</h2>
            </div>
          </div>

          <Suspense fallback={<EmbeddedCityLocationPickerLoading />}>
            <CityLocationPicker
              className="theater-map-panel--embedded"
              currentLocation={location}
              onPickLocation={handleLocationPick}
              syncing={syncing}
            />
          </Suspense>
        </section>

        <div className="prefs-page-settings">
          <section className="prefs-setting prefs-setting--static">
            <div className="prefs-setting-content prefs-setting-content--static">
              <div className="prefs-color-setting">
                <div className="prefs-color-copy">
                  <span className="prefs-setting-label">Color</span>
                  <span className="prefs-setting-summary">
                    Site Color {getSiteColorLabel(siteColor)}
                  </span>
                </div>

                <div className="prefs-color-controls">
                  <div
                    className="prefs-color-swatches"
                    role="list"
                    aria-label="Site colors"
                  >
                    {visibleSiteColors.map((colorOption) => {
                      const isSelected = colorOption.value === siteColor;

                      return (
                        <button
                          key={colorOption.value}
                          type="button"
                          className={`prefs-color-swatch${isSelected ? " is-selected" : ""}`}
                          style={{ backgroundColor: colorOption.value }}
                          aria-label={`Use ${colorOption.label} site color`}
                          aria-pressed={isSelected}
                          title={colorOption.label}
                          disabled={syncing || !user}
                          onClick={() => {
                            void handleSiteColorChange(colorOption.value);
                          }}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="prefs-color-reset"
                    disabled={
                      syncing || !user || siteColor === defaultSiteColor
                    }
                    onClick={() => {
                      void handleSiteColorReset();
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="prefs-setting">
            <button
              type="button"
              className="prefs-setting-toggle"
              aria-expanded={isSourcesOpen}
              onClick={() => {
                setIsSourcesOpen((open) => !open);
              }}
            >
              <span className="prefs-setting-copy">
                <span className="prefs-setting-label">Rating Sources</span>
                <span className="prefs-setting-summary">
                  {getSourcesSummary(sources)}
                </span>
              </span>
              <ChevronDown
                size={16}
                strokeWidth={2.2}
                className={`prefs-setting-chevron${isSourcesOpen ? " is-open" : ""}`}
              />
            </button>

            {isSourcesOpen ? (
              <div className="prefs-setting-content">
                <div className="prefs-setting-options">
                  {allSources.map((source) => {
                    const checked = sources.includes(source);

                    return (
                      <label
                        key={source}
                        className={`prefs-setting-option${
                          checked ? " is-selected" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={syncing}
                          onChange={() => {
                            void handleSourceToggle(source);
                          }}
                        />
                        <span>{sourceLabelMap[source]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>

          <section className="prefs-setting prefs-alerts-setting">
            <div className="prefs-setting-content prefs-setting-content--static">
              <div className="prefs-alerts-header">
                <div className="prefs-setting-copy">
                  <span className="prefs-setting-label">
                    Coming Soon Alerts
                  </span>
                  <span className="prefs-setting-summary">
                    {ticketAlerts.length === 0
                      ? "No movies being watched"
                      : `${ticketAlerts.length} movie${ticketAlerts.length === 1 ? "" : "s"} being watched`}
                  </span>
                </div>
              </div>

              {ticketAlertsLoading ? (
                <p className="prefs-alerts-empty" role="status">
                  Loading your alerts…
                </p>
              ) : ticketAlerts.length === 0 ? (
                <p className="prefs-alerts-empty">
                  Click Notify me on a coming soon movie to see it here.
                </p>
              ) : (
                <ul className="prefs-alerts-list">
                  {ticketAlerts.map((alert) => {
                    const movie = findAlertMovie(alert.tmdbId);
                    const title =
                      movie?.title ??
                      alert.deliveryTitle ??
                      "Coming soon movie";
                    const releaseDate =
                      movie?.releaseDate ?? alert.deliveryDate ?? null;

                    return (
                      <li className="prefs-alert-row" key={alert.tmdbId}>
                        <div className="prefs-alert-poster-shell">
                          {movie?.imageSrc ? (
                            <img
                              className="prefs-alert-poster"
                              src={movie.imageSrc}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <span className="prefs-alert-poster-fallback">
                              {title.slice(0, 1)}
                            </span>
                          )}
                        </div>
                        <div className="prefs-alert-copy">
                          {movie?.movieCode ? (
                            <Link
                              className="prefs-alert-title"
                              to={`/${movie.movieCode}`}
                              aria-label={`Edit alert for ${title}`}
                            >
                              {title}
                            </Link>
                          ) : (
                            <span className="prefs-alert-title">{title}</span>
                          )}
                          <span className="prefs-alert-date">
                            {formatAlertDate(releaseDate)}
                            {alert.notifiedAt ? " · Alert sent" : " · Watching"}
                          </span>
                        </div>
                        <button
                          className="prefs-alert-remove"
                          type="button"
                          disabled={removingAlertId === alert.tmdbId}
                          onClick={() => {
                            void handleRemoveAlert(alert.tmdbId);
                          }}
                        >
                          {removingAlertId === alert.tmdbId
                            ? "Removing…"
                            : "Undo"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {ticketAlertsError ? (
                <p className="prefs-alerts-error" role="alert">
                  {ticketAlertsError}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      {error ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
