import { useEffect, useMemo, useState } from "react";
import { useRatingSourcesContext } from "../prefs/ratingSourcesStore";
import { type RatingSource } from "../prefs/ratingSources";

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

export function UserPreferencesPage({ onBackHome }: UserPreferencesPageProps) {
  const { user, sources, allSources, syncing, error, saveSources } =
    useRatingSourcesContext();
  const [draftSources, setDraftSources] = useState<RatingSource[]>(sources);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    setDraftSources(sources);
  }, [sources]);

  const hasChanges = useMemo(
    () => !areSourcesEqual(draftSources, sources),
    [draftSources, sources],
  );

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

    const didSave = await saveSources(draftSources);

    if (!didSave) {
      setStatusError("Could not save preferences. Try again.");
      return;
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
        Choose which rating sources appear in movie details.
      </p>

      <div className="prefs-page-card">
        <div className="prefs-page-grid">
          {allSources.map((source) => {
            const checked = draftSources.includes(source);

            return (
              <label key={source} className="prefs-page-option">
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
