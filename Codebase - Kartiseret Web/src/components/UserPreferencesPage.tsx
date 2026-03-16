import { useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CityLocationPicker } from "./CityLocationPicker";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { type AppLocation } from "../prefs/definitions/locations";
import {
  getSiteColorLabel,
  type SiteColor,
  type SiteColorOption,
} from "../prefs/definitions/siteColor";

const sourceLabelMap: Record<RatingSource, string> = {
  imdbRating: "IMDb",
  rtAudienceRating: "Rotten Tomatoes Audience",
  rtCriticRating: "Rotten Tomatoes Critics",
  lbRating: "Letterboxd",
  tmdbRating: "TMDB",
};
type UserPreferencesPageProps = {
  onBackHome: () => void;
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

export function UserPreferencesPage({ onBackHome }: UserPreferencesPageProps) {
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
  const visibleSiteColors = useMemo(
    () => getVisibleSiteColors(siteColor, allSiteColors),
    [allSiteColors, siteColor],
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
        <button type="button" className="prefs-page-back" onClick={onBackHome}>
          Back to Home
        </button>
      </div>

      <div className="prefs-page-card" aria-busy={syncing}>
        <section className="prefs-location-card">
          <div className="prefs-location-header">
            <div>
              <p className="prefs-setting-label">Location</p>
              <h2 className="prefs-location-title">{location}</h2>
            </div>
          </div>

          <CityLocationPicker
            className="theater-map-panel--embedded"
            currentLocation={location}
            onPickLocation={handleLocationPick}
            syncing={syncing}
          />
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
