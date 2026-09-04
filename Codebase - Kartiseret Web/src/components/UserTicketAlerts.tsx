import { useMemo } from "react";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { movieCollectionQueryOptions, selectMovies, type Movie } from "../data/movieCatalog";
import { ticketAlertMutationOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions, type UserTicketAlertSubscription } from "../data/ticketAlerts";

const EMPTY_MOVIES: Movie[] = [];
const EMPTY_ALERTS: UserTicketAlertSubscription[] = [];
const alertDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatAlertDate(value: string | null | undefined): string {
  if (!value) {
    return "Release date pending";
  }

  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? value
    : alertDateFormatter.format(parsed);
}

function UserTicketAlertItem({
  userId,
  alert,
  movie,
}: {
  userId: string;
  alert: UserTicketAlertSubscription;
  movie?: Movie;
}) {
  const mutation = useMutation(
    ticketAlertMutationOptions(userId, alert.tmdbId),
  );
  const pending =
    useIsMutating({
      mutationKey: ticketAlertQueryKeys.change(userId, alert.tmdbId),
      exact: true,
    }) > 0;
  const title = movie?.title ?? alert.deliveryTitle ?? "Coming soon movie";
  const releaseDate = movie?.releaseDate ?? alert.deliveryDate ?? null;

  return (
    <li className="prefs-alert-row">
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
        {mutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {mutation.error.message}
          </p>
        ) : null}
      </div>
      <button
        className="prefs-alert-remove"
        type="button"
        aria-label={`Cancel ticket alert for ${title}`}
        disabled={pending}
        onClick={() => mutation.mutate({ action: "cancel" })}
      >
        {pending ? "Removing…" : "Undo"}
      </button>
    </li>
  );
}

export function UserTicketAlerts({ userId }: { userId: string | null }) {
  const alertsQuery = useQuery(
    userTicketAlertSubscriptionsQueryOptions(userId),
  );
  const { data: nowPlaying = EMPTY_MOVIES } = useQuery({
    ...movieCollectionQueryOptions("nowPlaying"),
    select: selectMovies,
    enabled: Boolean(userId),
  });
  const { data: comingSoon = EMPTY_MOVIES } = useQuery({
    ...movieCollectionQueryOptions("comingSoon"),
    select: selectMovies,
    enabled: Boolean(userId),
  });
  const moviesById = useMemo(
    () =>
      new Map(
        [...nowPlaying, ...comingSoon].map((movie) => [movie.tmdbId, movie]),
      ),
    [nowPlaying, comingSoon],
  );
  const alerts = alertsQuery.data ?? EMPTY_ALERTS;

  if (!userId) {
    return null;
  }

  return (
    <section className="prefs-setting prefs-alerts-setting">
      <div className="prefs-setting-content prefs-setting-content--static">
        <div className="prefs-alerts-header">
          <div className="prefs-setting-copy">
            <span className="prefs-setting-label">Coming Soon Alerts</span>
            <span className="prefs-setting-summary">
              {alerts.length === 0
                ? "No movies being watched"
                : `${alerts.length} movie${alerts.length === 1 ? "" : "s"} being watched`}
            </span>
          </div>
        </div>
        {alertsQuery.isPending ? (
          <p className="prefs-alerts-empty" role="status">
            Loading your alerts…
          </p>
        ) : alertsQuery.isError && !alertsQuery.data ? null : alerts.length ===
          0 ? (
          <p className="prefs-alerts-empty">
            Click Notify me on a coming soon movie to see it here.
          </p>
        ) : (
          <ul className="prefs-alerts-list">
            {alerts.map((alert) => (
              <UserTicketAlertItem
                key={alert.tmdbId}
                userId={userId}
                alert={alert}
                movie={moviesById.get(alert.tmdbId)}
              />
            ))}
          </ul>
        )}
        {alertsQuery.error ? (
          <div className="prefs-alerts-error" role="alert">
            <p>{alertsQuery.error.message}</p>
            <button
              className="prefs-alert-remove"
              type="button"
              onClick={() => void alertsQuery.refetch()}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
