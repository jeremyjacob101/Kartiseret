import { addMovieDisplayPreferenceMutationOptions, movieDisplayPreferencesQueryOptions, removeMovieDisplayPreferenceMutationOptions, updateMovieDisplayPreferenceMutationOptions, type MovieDisplayPreference } from "../data/movieDisplayPreferences";
import { tmdbTitleSearchQueryOptions } from "../data/comingSoonDateWatches";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

const EMPTY_PREFERENCES: MovieDisplayPreference[] = [];

function titleWithYear(title: string, year: number | null): string {
  return year === null ? title : `${title} (${year})`;
}

function treatmentLabel(
  treatment: MovieDisplayPreference["treatment"],
): string {
  return treatment === "standard" ? "Kartiseret poster" : "Removed from site";
}

export function UserMovieDisplayPreferences({ userId }: { userId: string }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const searchQuery = useQuery(tmdbTitleSearchQueryOptions(normalizedQuery));
  const preferencesQuery = useQuery(
    movieDisplayPreferencesQueryOptions(userId),
  );
  const addMutation = useMutation(
    addMovieDisplayPreferenceMutationOptions(userId),
  );
  const updateMutation = useMutation(
    updateMovieDisplayPreferenceMutationOptions(userId),
  );
  const removeMutation = useMutation(
    removeMovieDisplayPreferenceMutationOptions(userId),
  );
  const preferences = preferencesQuery.data ?? EMPTY_PREFERENCES;
  const preferencesById = useMemo(
    () =>
      new Map(preferences.map((preference) => [preference.tmdbId, preference])),
    [preferences],
  );
  const results = searchQuery.data ?? [];
  const saving =
    addMutation.isPending ||
    updateMutation.isPending ||
    removeMutation.isPending;

  const addPreference = (
    result: (typeof results)[number],
    treatment: MovieDisplayPreference["treatment"],
  ) => {
    addMutation.mutate({
      tmdbId: result.tmdbId,
      title: result.title,
      releaseYear: result.releaseYear,
      treatment,
      hideBackdrop: true,
    });
  };

  return (
    <section className="prefs-setting prefs-movie-display-setting">
      <div className="prefs-setting-content prefs-setting-content--static">
        <div className="prefs-alerts-header">
          <div className="prefs-setting-copy">
            <span className="prefs-setting-label">Movie Display</span>
            <span className="prefs-setting-summary">
              Choose a Kartiseret title poster or hide a movie from your site
              views.
            </span>
          </div>
        </div>

        <label
          className="movie-display-search-label"
          htmlFor="movie-display-search"
        >
          Search movie titles
        </label>
        <input
          id="movie-display-search"
          className="movie-display-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search TMDb"
        />

        {normalizedQuery.length < 2 ? (
          <p className="prefs-alerts-empty">
            Enter at least two characters to search.
          </p>
        ) : searchQuery.isFetching ? (
          <p className="prefs-alerts-empty" role="status">
            Searching TMDb…
          </p>
        ) : searchQuery.isError ? (
          <p className="prefs-alerts-error" role="alert">
            {searchQuery.error.message}
          </p>
        ) : results.length === 0 ? (
          <p className="prefs-alerts-empty">
            No TMDb titles matched that search.
          </p>
        ) : (
          <ul
            className="movie-display-results"
            aria-label="TMDb search results"
          >
            {results.map((result) => {
              const existing = preferencesById.get(result.tmdbId);
              const label = titleWithYear(result.title, result.releaseYear);
              return (
                <li className="movie-display-result" key={result.tmdbId}>
                  <span className="movie-display-result-title">{label}</span>
                  {existing ? (
                    <span className="movie-display-existing">
                      {treatmentLabel(existing.treatment)}
                    </span>
                  ) : (
                    <div className="movie-display-actions">
                      <button
                        className="movie-display-action"
                        type="button"
                        disabled={saving}
                        onClick={() => addPreference(result, "standard")}
                      >
                        Use Kartiseret poster
                      </button>
                      <button
                        className="movie-display-action movie-display-action--remove"
                        type="button"
                        disabled={saving}
                        onClick={() => addPreference(result, "remove")}
                      >
                        Hide movie
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {addMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {addMutation.error.message}
          </p>
        ) : null}

        <div className="movie-display-list-heading">
          <span className="prefs-setting-label">
            Your movie display choices
          </span>
          <span className="prefs-setting-summary">
            {preferences.length} title{preferences.length === 1 ? "" : "s"}
          </span>
        </div>
        {preferencesQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Loading your movie preferences…
          </p>
        ) : preferencesQuery.isError ? (
          <p className="prefs-alerts-error" role="alert">
            {preferencesQuery.error.message}
          </p>
        ) : preferences.length === 0 ? (
          <p className="prefs-alerts-empty">
            You have not set any movie display choices.
          </p>
        ) : (
          <ul className="movie-display-preference-list">
            {preferences.map((preference) => (
              <li className="movie-display-preference" key={preference.tmdbId}>
                <div className="movie-display-preference-main">
                  <span className="movie-display-result-title">
                    {titleWithYear(preference.title, preference.releaseYear)}
                  </span>
                  <div
                    className="movie-display-treatment-controls"
                    role="group"
                    aria-label={`Display treatment for ${preference.title}`}
                  >
                    <button
                      className="movie-display-action"
                      type="button"
                      aria-pressed={preference.treatment === "standard"}
                      disabled={saving}
                      onClick={() =>
                        updateMutation.mutate({
                          tmdbId: preference.tmdbId,
                          patch: { treatment: "standard" },
                        })
                      }
                    >
                      Kartiseret poster
                    </button>
                    <button
                      className="movie-display-action movie-display-action--remove"
                      type="button"
                      aria-pressed={preference.treatment === "remove"}
                      disabled={saving}
                      onClick={() =>
                        updateMutation.mutate({
                          tmdbId: preference.tmdbId,
                          patch: { treatment: "remove" },
                        })
                      }
                    >
                      Hide movie
                    </button>
                  </div>
                  <label className="movie-display-backdrop-toggle">
                    <input
                      type="checkbox"
                      checked={preference.hideBackdrop}
                      disabled={saving || preference.treatment === "remove"}
                      onChange={(event) =>
                        updateMutation.mutate({
                          tmdbId: preference.tmdbId,
                          patch: { hideBackdrop: event.currentTarget.checked },
                        })
                      }
                    />
                    <span>Hide backdrop on movie details</span>
                  </label>
                </div>
                <button
                  className="prefs-alert-remove movie-display-unset"
                  type="button"
                  aria-label={`Remove display preference for ${preference.title}`}
                  disabled={saving}
                  onClick={() => removeMutation.mutate(preference.tmdbId)}
                >
                  {removeMutation.isPending ? "Removing…" : "Remove preference"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {updateMutation.error || removeMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {(updateMutation.error ?? removeMutation.error)?.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
