import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CityLocationPicker } from "./CityLocationPicker";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { type AppLocation } from "../prefs/definitions/locations";
import { type SiteColor } from "../prefs/definitions/siteColor";

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

function areSourcesEqual(
  left: readonly RatingSource[],
  right: readonly RatingSource[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

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

export function UserPreferencesPage({ onBackHome }: UserPreferencesPageProps) {
  const {
    user,
    sources,
    location,
    allSources,
    siteColor,
    defaultSiteColor,
    syncing,
    error,
    saveSources,
    setLocationPreference,
    saveSiteColor,
    resetSiteColor,
  } = useUserPreferencesContext();
  const [draftSources, setDraftSources] = useState<RatingSource[]>(sources);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [locationStatusMessage, setLocationStatusMessage] = useState<
    string | null
  >(null);
  const [siteColorStatusMessage, setSiteColorStatusMessage] = useState<
    string | null
  >(null);

  useEffect(() => {
    setDraftSources(sources);
  }, [sources]);

  const hasSourceChanges = useMemo(
    () => !areSourcesEqual(draftSources, sources),
    [draftSources, sources],
  );
  const hasChanges = hasSourceChanges;

  function toggleDraftSource(source: RatingSource) {
    setStatusMessage(null);
    setStatusError(null);

    setDraftSources((current) => {
      const isSelected = current.includes(source);

      return isSelected
        ? current.filter((entry) => entry !== source)
        : [...current, source];
    });
  }

  async function handleSave() {
    setStatusMessage(null);
    setStatusError(null);

    if (hasSourceChanges) {
      const didSaveSources = await saveSources(draftSources);

      if (!didSaveSources) {
        setStatusError("Could not save preferences. Try again.");
        return;
      }
    }

    setStatusMessage("Preferences saved.");
  }

  const handleLocationPick = useCallback(
    async (nextLocation: AppLocation) => {
      setLocationStatusMessage(null);
      const didSave = await setLocationPreference(nextLocation);

      if (!didSave) {
        return;
      }

      setLocationStatusMessage(`City set to ${nextLocation}.`);
    },
    [setLocationPreference],
  );

  const handleSiteColorChange = useCallback(
    async (nextSiteColor: SiteColor) => {
      setSiteColorStatusMessage(null);
      const didSave = await saveSiteColor(nextSiteColor);

      if (!didSave) {
        return;
      }

      setSiteColorStatusMessage(
        `Site color updated to ${nextSiteColor.toUpperCase()}.`,
      );
    },
    [saveSiteColor],
  );

  const handleSiteColorReset = useCallback(async () => {
    setSiteColorStatusMessage(null);
    const didReset = await resetSiteColor();

    if (!didReset) {
      return;
    }

    setSiteColorStatusMessage(
      `Site color reset to ${defaultSiteColor.toUpperCase()}.`,
    );
  }, [defaultSiteColor, resetSiteColor]);

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

      <p className="prefs-page-email">{user?.email}</p>
      <p className="prefs-page-note">
        Manage your saved city, rating sources, and site theme below.
      </p>

      <div className="prefs-page-card">
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
            feedbackMessage={locationStatusMessage ?? error}
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
                    Site Color
                  </span>
                </div>

                <div className="prefs-color-controls">
                  <div
                    className="prefs-color-preview"
                    style={{ backgroundColor: siteColor }}
                    aria-hidden="true"
                  />

                  <label className="prefs-color-picker">
                    <span className="visually-hidden">Choose site color</span>
                    <input
                      type="color"
                      value={siteColor}
                      disabled={syncing || !user}
                      onChange={(event) => {
                        void handleSiteColorChange(event.target.value);
                      }}
                    />
                  </label>

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
                  {getSourcesSummary(draftSources)}
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
                    const checked = draftSources.includes(source);

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
                            toggleDraftSource(source);
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

        <div className="prefs-page-actions">
          <button
            type="button"
            className="prefs-page-save"
            onClick={() => {
              void handleSave();
            }}
            disabled={syncing || !hasChanges}
          >
            {syncing ? "Saving..." : "Save Preferences"}
          </button>
        </div>
      </div>

      {statusMessage ? (
        <p className="prefs-page-feedback">{statusMessage}</p>
      ) : null}
      {siteColorStatusMessage ? (
        <p className="prefs-page-feedback">{siteColorStatusMessage}</p>
      ) : null}
      {statusError ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">
          {statusError}
        </p>
      ) : null}
      {error ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
