import { comingSoonDateUnwatchMutationOptions, comingSoonDateWatchMutationOptions, comingSoonDateWatchesQueryOptions, tmdbTitleSearchQueryOptions, type ComingSoonDateWatch, type TmdbTitleSearchResult } from "../data/comingSoonDateWatches";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

const EMPTY_WATCHES: ComingSoonDateWatch[] = [];
const EMPTY_RESULTS: TmdbTitleSearchResult[] = [];
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function titleLabel(title: TmdbTitleSearchResult): string {
  return title.releaseYear === null
    ? title.title
    : `${title.title} (${title.releaseYear})`;
}

function posterUrl(path: string | null): string | null {
  return path ? `https://image.tmdb.org/t/p/w185${path}` : null;
}

export function ComingSoonDateWatchlist({ userId }: { userId: string | null }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const searchQuery = useQuery(tmdbTitleSearchQueryOptions(normalizedQuery));
  const watchesQuery = useQuery(comingSoonDateWatchesQueryOptions(userId));
  const watchMutation = useMutation(comingSoonDateWatchMutationOptions(userId));
  const unwatchMutation = useMutation(
    comingSoonDateUnwatchMutationOptions(userId),
  );
  const watches = watchesQuery.data ?? EMPTY_WATCHES;
  const watchedById = useMemo(
    () => new Map(watches.map((watch) => [watch.tmdbId, watch])),
    [watches],
  );
  const results = searchQuery.data ?? EMPTY_RESULTS;

  if (!userId) return null;

  return (
    <section className="prefs-setting prefs-coming-soon-watch-setting">
      <div className="prefs-setting-content prefs-setting-content--static">
        <div className="prefs-alerts-header">
          <div className="prefs-setting-copy">
            <span className="prefs-setting-label">
              Coming Soon Date Watches
            </span>
            <span className="prefs-setting-summary">
              Search TMDb to follow titles before they appear in the local
              catalog.
            </span>
          </div>
        </div>

        <label
          className="coming-soon-watch-search-label"
          htmlFor="coming-soon-watch-search"
        >
          Search movie titles
        </label>
        <input
          id="coming-soon-watch-search"
          className="coming-soon-watch-search"
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
            className="coming-soon-watch-results"
            aria-label="TMDb search results"
          >
            {results.map((result) => {
              const existing = watchedById.get(result.tmdbId);
              const poster = posterUrl(result.posterPath);
              return (
                <li className="coming-soon-watch-result" key={result.tmdbId}>
                  <div className="prefs-alert-poster-shell">
                    {poster ? (
                      <img
                        className="prefs-alert-poster"
                        src={poster}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="prefs-alert-poster-fallback">
                        {result.title.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="prefs-alert-copy">
                    <span className="prefs-alert-title">
                      {titleLabel(result)}
                    </span>
                    <span className="prefs-alert-date">
                      {result.comingSoonDate
                        ? `Local Coming Soon date: ${formatDate(result.comingSoonDate)}`
                        : "No local Coming Soon date yet"}
                    </span>
                  </div>
                  {existing ? (
                    <span className="coming-soon-watch-badge">Watching</span>
                  ) : result.comingSoonDate ? (
                    <span className="coming-soon-watch-badge">
                      Date available
                    </span>
                  ) : (
                    <button
                      className="coming-soon-watch-action"
                      type="button"
                      disabled={watchMutation.isPending}
                      onClick={() =>
                        watchMutation.mutate({
                          tmdbId: result.tmdbId,
                          title: result.title,
                          releaseYear: result.releaseYear,
                          posterPath: result.posterPath,
                        })
                      }
                    >
                      {watchMutation.isPending ? "Saving…" : "Watch date"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {watchMutation.data?.kind === "known" ? (
          <p className="prefs-alerts-empty" role="status">
            {watchMutation.data.title} already has a local Coming Soon date:{" "}
            {formatDate(watchMutation.data.comingSoonDate)}.
          </p>
        ) : null}
        {watchMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {watchMutation.error.message}
          </p>
        ) : null}

        <div className="coming-soon-watch-list-heading">
          <span className="prefs-setting-label">Titles you are watching</span>
          <span className="prefs-setting-summary">
            {watches.length} title{watches.length === 1 ? "" : "s"}
          </span>
        </div>
        {watchesQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Loading your title watches…
          </p>
        ) : watchesQuery.isError ? (
          <p className="prefs-alerts-error" role="alert">
            {watchesQuery.error.message}
          </p>
        ) : watches.length === 0 ? (
          <p className="prefs-alerts-empty">
            You are not watching any titles yet.
          </p>
        ) : (
          <ul className="prefs-alerts-list">
            {watches.map((watch) => {
              const poster = posterUrl(watch.posterPath);
              return (
                <li className="prefs-alert-row" key={watch.tmdbId}>
                  <div className="prefs-alert-poster-shell">
                    {poster ? (
                      <img
                        className="prefs-alert-poster"
                        src={poster}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span className="prefs-alert-poster-fallback">
                        {watch.title.slice(0, 1)}
                      </span>
                    )}
                  </div>
                  <div className="prefs-alert-copy">
                    <span className="prefs-alert-title">
                      {watch.title}
                      {watch.releaseYear ? ` (${watch.releaseYear})` : ""}
                    </span>
                    <span className="prefs-alert-date">
                      {watch.comingSoonDate
                        ? `Local Coming Soon date: ${formatDate(watch.comingSoonDate)}${watch.notifiedAt ? " · Alert sent" : " · Alert pending"}`
                        : "Waiting for a local Coming Soon date"}
                    </span>
                  </div>
                  <button
                    className="prefs-alert-remove"
                    type="button"
                    aria-label={`Stop watching ${watch.title}`}
                    disabled={unwatchMutation.isPending}
                    onClick={() => unwatchMutation.mutate(watch.tmdbId)}
                  >
                    {unwatchMutation.isPending ? "Removing…" : "Unwatch"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {unwatchMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {unwatchMutation.error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
