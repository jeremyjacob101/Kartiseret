import { addLetterboxdSourceMutationOptions, letterboxdSourcesQueryOptions, removeLetterboxdSourceMutationOptions, type LetterboxdSource } from "../data/letterboxdSources";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date);
}

function sourceStatus(source: LetterboxdSource): string {
  if (source.lastSyncError) return `Last sync failed: ${source.lastSyncError}`;
  const success = formatDate(source.lastSuccessfulSyncAt);
  if (!success)
    return "First sync pending · current films will be added silently";
  return `Synced ${success} · ${source.matchedFilmCount} films match cinema data`;
}

export function LetterboxdSourceWatchlist({
  userId,
}: {
  userId: string | null;
}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const sourcesQuery = useQuery(letterboxdSourcesQueryOptions(userId));
  const addMutation = useMutation(addLetterboxdSourceMutationOptions(userId));
  const removeMutation = useMutation(
    removeLetterboxdSourceMutationOptions(userId),
  );
  const sources = sourcesQuery.data ?? [];

  if (!userId) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = sourceUrl.trim();
    if (!normalized) return;
    addMutation.mutate(
      { sourceUrl: normalized },
      { onSuccess: () => setSourceUrl("") },
    );
  }

  return (
    <details className="prefs-disclosure prefs-letterboxd-source-setting">
      <summary className="prefs-disclosure-summary">
        <span className="prefs-disclosure-copy">
          <strong>Letterboxd sources</strong>
          <span>
            {sources.length} tracked source{sources.length === 1 ? "" : "s"}
            {" · "}Add public watchlists and lists
          </span>
        </span>
        <ChevronDown
          className="prefs-disclosure-chevron"
          size={18}
          aria-hidden="true"
        />
      </summary>
      <div className="prefs-disclosure-content">
        <p className="prefs-alerts-empty letterboxd-source-note">
          Add a public watchlist or list URL, or a share link for a list visible
          to anyone with the link. Sources that require Letterboxd sign-in are
          not supported. Sources sync daily; their first sync is silent. Your
          movie notification cities, filters, and mode apply to these films.
        </p>
        <form className="letterboxd-source-form" onSubmit={submit}>
          <label htmlFor="letterboxd-source-url">Letterboxd URL</label>
          <div className="letterboxd-source-form-row">
            <input
              id="letterboxd-source-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.currentTarget.value)}
              placeholder="https://letterboxd.com/username/watchlist/"
              maxLength={500}
            />
            <button
              className="prefs-alert-remove"
              type="submit"
              disabled={!sourceUrl.trim() || addMutation.isPending}
            >
              {addMutation.isPending ? "Adding…" : "Track source"}
            </button>
          </div>
        </form>
        {addMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {addMutation.error.message}
          </p>
        ) : null}

        <div className="coming-soon-watch-list-heading">
          <span className="prefs-setting-label">Tracked sources</span>
          <span className="prefs-setting-summary">
            {sources.length} source{sources.length === 1 ? "" : "s"}
          </span>
        </div>
        {sourcesQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Loading your Letterboxd sources…
          </p>
        ) : sourcesQuery.isError ? (
          <div className="prefs-alerts-error" role="alert">
            <p>{sourcesQuery.error.message}</p>
            <button
              className="prefs-alert-remove"
              type="button"
              onClick={() => void sourcesQuery.refetch()}
            >
              Try again
            </button>
          </div>
        ) : sources.length === 0 ? (
          <p className="prefs-alerts-empty">
            You are not tracking any sources yet.
          </p>
        ) : (
          <ul className="prefs-alerts-list">
            {sources.map((source) => (
              <li
                className="prefs-alert-row letterboxd-source-row"
                key={source.id}
              >
                <div className="prefs-alert-copy">
                  <a
                    className="prefs-alert-title"
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.sourceType === "watchlist" ? "Watchlist" : "List"} ·{" "}
                    {source.sourceUrl.replace("https://letterboxd.com/", "")}
                  </a>
                  <span className="prefs-alert-date">
                    {sourceStatus(source)}
                  </span>
                  <span className="prefs-alert-date">
                    {source.filmCount} film{source.filmCount === 1 ? "" : "s"}{" "}
                    in source
                  </span>
                </div>
                <button
                  className="prefs-alert-remove"
                  type="button"
                  aria-label={`Remove Letterboxd source ${source.sourceUrl}`}
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(source.id)}
                >
                  {removeMutation.isPending ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {removeMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {removeMutation.error.message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
