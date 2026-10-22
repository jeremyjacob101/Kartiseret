import { ticketAlertCriteriaMutationOptions, ticketAlertMutationOptions, ticketAlertPreferencesMutationOptions, ticketAlertPreferencesQueryOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions, type UserTicketAlertSubscription } from "../data/ticketAlerts";
import { DEFAULT_TICKET_ALERT_CRITERIA, type TicketAlertCriteria, type TicketAlertCriteriaOverride } from "@kartiseret/contracts/private-data";
import { movieCollectionQueryOptions, selectMovies, type Movie } from "../data/movieCatalog";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { TicketAlertCriteriaEditor } from "./TicketAlertCriteriaEditor";
import { ComingSoonDateWatchlist } from "./ComingSoonDateWatchlist";
import { Link } from "react-router";
import { useMemo } from "react";

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
  defaults,
}: {
  userId: string;
  alert: UserTicketAlertSubscription;
  movie?: Movie;
  defaults: TicketAlertCriteria;
}) {
  const mutation = useMutation(
    ticketAlertMutationOptions(userId, alert.tmdbId),
  );
  const pending =
    useIsMutating({
      mutationKey: ticketAlertQueryKeys.change(userId, alert.tmdbId),
      exact: true,
    }) > 0;
  const criteriaMutation = useMutation(
    ticketAlertCriteriaMutationOptions(userId, alert.tmdbId),
  );
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
        <details className="ticket-alert-criteria-details">
          <summary>Edit notification criteria</summary>
          <TicketAlertCriteriaEditor
            key={`${alert.tmdbId}-${JSON.stringify(defaults)}-${JSON.stringify(alert.criteriaOverrides)}`}
            mode="title"
            value={alert.criteriaOverrides}
            defaults={defaults}
            saving={criteriaMutation.isPending}
            onSave={(value) =>
              criteriaMutation.mutate(value as TicketAlertCriteriaOverride)
            }
          />
        </details>
        {criteriaMutation.error ? (
          <p className="prefs-alerts-error" role="alert">
            {criteriaMutation.error.message}
          </p>
        ) : null}
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
  const preferencesQuery = useQuery(ticketAlertPreferencesQueryOptions(userId));
  const preferencesMutation = useMutation(
    ticketAlertPreferencesMutationOptions(userId),
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
  const defaults = preferencesQuery.data ?? DEFAULT_TICKET_ALERT_CRITERIA;

  if (!userId) {
    return null;
  }

  return (
    <>
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
          <details className="ticket-alert-defaults-details">
            <summary>Default cities and showtime filters</summary>
            {preferencesQuery.isError ? (
              <p className="prefs-alerts-error" role="alert">
                {preferencesQuery.error.message}
              </p>
            ) : null}
            <TicketAlertCriteriaEditor
              key={JSON.stringify(defaults)}
              mode="defaults"
              value={defaults}
              defaults={defaults}
              saving={
                preferencesMutation.isPending || preferencesQuery.isPending
              }
              onSave={(value) =>
                preferencesMutation.mutate(value as TicketAlertCriteria)
              }
            />
            {preferencesMutation.error ? (
              <p className="prefs-alerts-error" role="alert">
                {preferencesMutation.error.message}
              </p>
            ) : null}
          </details>
          {alertsQuery.isPending ? (
            <p className="prefs-alerts-empty" role="status">
              Loading your alerts…
            </p>
          ) : alertsQuery.isError &&
            !alertsQuery.data ? null : alerts.length === 0 ? (
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
                  defaults={defaults}
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
      <ComingSoonDateWatchlist userId={userId} />
    </>
  );
}
