import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";
import { type RatingSource } from "../prefs/ratingSources";
import { type AppLocation } from "../prefs/locations";

const sourceLabelMap: Record<RatingSource, string> = {
  imdbRating: "IMDb",
  rtAudienceRating: "Rotten Tomatoes Audience",
  rtCriticRating: "Rotten Tomatoes Critics",
  lbRating: "Letterboxd",
  tmdbRating: "TMDB",
};
const locationLabelMap: Record<AppLocation, string> = {
  Haifa: "Haifa",
  Jerusalem: "Jerusalem",
  "Tel Aviv": "Tel Aviv",
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
    allLocations,
    syncing,
    error,
    saveSources,
    setLocationPreference,
  } = useRatingSourcesContext();
  const [draftSources, setDraftSources] = useState<RatingSource[]>(sources);
  const [draftLocation, setDraftLocation] = useState(location);
  const [isLocationOpen, setIsLocationOpen] = useState(true);
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    setDraftSources(sources);
  }, [sources]);

  useEffect(() => {
    setDraftLocation(location);
  }, [location]);

  const hasSourceChanges = useMemo(
    () => !areSourcesEqual(draftSources, sources),
    [draftSources, sources],
  );
  const hasLocationChanges = draftLocation !== location;
  const hasChanges = hasSourceChanges || hasLocationChanges;

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

    if (hasLocationChanges) {
      const didSaveLocation = await setLocationPreference(draftLocation);

      if (!didSaveLocation) {
        setStatusError("Could not save location. Try again.");
        return;
      }
    }

    setStatusMessage("Preferences saved.");
  }

  return (
    <section className="prefs-page" aria-label="User preferences">
      <div className="prefs-page-header">
        <div>
          <p className="section-kicker">User</p>
          <h1 className="section-title">Rating Source Preferences</h1>
        </div>
        <button type="button" className="prefs-page-back" onClick={onBackHome}>
          Back to Home
        </button>
      </div>

      <p className="prefs-page-email">{user?.email}</p>
      <p className="prefs-page-note">
        Manage settings with a unified dropdown-style layout.
      </p>

      <div className="prefs-page-card">
        <div className="prefs-page-settings">
          <section className="prefs-setting">
            <button
              type="button"
              className="prefs-setting-toggle"
              aria-expanded={isLocationOpen}
              onClick={() => {
                setIsLocationOpen((open) => !open);
              }}
            >
              <span className="prefs-setting-copy">
                <span className="prefs-setting-label">Location</span>
                <span className="prefs-setting-summary">
                  {locationLabelMap[draftLocation]}
                </span>
              </span>
              <ChevronDown
                size={16}
                strokeWidth={2.2}
                className={`prefs-setting-chevron${isLocationOpen ? " is-open" : ""}`}
              />
            </button>

            {isLocationOpen ? (
              <div className="prefs-setting-content">
                <div className="prefs-setting-options">
                  {allLocations.map((entry) => (
                    <label
                      key={entry}
                      className={`prefs-setting-option${
                        draftLocation === entry ? " is-selected" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="prefs-location"
                        checked={draftLocation === entry}
                        disabled={syncing}
                        onChange={() => {
                          setDraftLocation(entry);
                          setStatusMessage(null);
                          setStatusError(null);
                        }}
                      />
                      <span>{locationLabelMap[entry]}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
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

      {statusMessage ? <p className="prefs-page-feedback">{statusMessage}</p> : null}
      {statusError ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">{statusError}</p>
      ) : null}
      {error ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">{error}</p>
      ) : null}
    </section>
  );
}
