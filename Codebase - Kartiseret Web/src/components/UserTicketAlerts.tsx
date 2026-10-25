import { ticketAlertCriteriaMutationOptions, ticketAlertMutationOptions, ticketAlertPreferencesMutationOptions, ticketAlertPreferencesQueryOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions, type UserTicketAlertSubscription } from "../data/ticketAlerts";
import { DEFAULT_TICKET_ALERT_CRITERIA, type TicketAlertCriteria, type TicketAlertCriteriaOverride } from "@kartiseret/contracts/private-data";
import { movieCollectionQueryOptions, selectMovies, type Movie } from "../data/movieCatalog";
import { useMovieDisplayPreferences } from "../contexts/MovieDisplayPreferencesContext";
import { resolveTicketAlertCriteria } from "@kartiseret/contracts/private-data";
import { applyMovieDisplayPreferences } from "../data/movieDisplayPreferences";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { TicketAlertCriteriaEditor } from "./TicketAlertCriteriaEditor";
import { LetterboxdSourceWatchlist } from "./LetterboxdSourceWatchlist";
import { ComingSoonDateWatchlist } from "./ComingSoonDateWatchlist";
import { MoviePosterArtwork } from "./MoviePosterArtwork";
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
  const preferredCity = useUserPreferencesStore(
    (state) => state.preferences.location,
  );
  const criteria = resolveTicketAlertCriteria(
    defaults,
    alert.criteriaOverrides,
    preferredCity,
  );
  const completed = alert.completedCities ?? [];
  const remaining = (criteria.cities ?? []).filter(
    (city) => !completed.includes(city),
  );
  const watchStatus =
    criteria.notificationMode === "first_per_city"
      ? remaining.length
        ? `Watching ${remaining.join(", ")}`
        : "Selected cities covered"
      : completed.length || alert.notifiedAt
        ? "Alert completed"
        : "Watching";
  const title = movie?.title ?? alert.deliveryTitle ?? "Coming soon movie";
  const releaseDate = movie?.releaseDate ?? alert.deliveryDate ?? null;

  return (
    <li className="prefs-alert-row">
      <div className="prefs-alert-poster-shell">
        <MoviePosterArtwork
          title={title}
          tmdbId={alert.tmdbId}
          imageSrc={movie?.imageSrc}
          alt=""
          className="prefs-alert-poster"
          fallbackClassName="prefs-alert-poster"
          loading="lazy"
        />
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
          {` · ${watchStatus}`}
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
  const displayPreferences = useMovieDisplayPreferences();
  const alertsQuery = useQuery(
    userTicketAlertSubscriptionsQueryOptions(userId),
  );
  const preferencesQuery = useQuery(ticketAlertPreferencesQueryOptions(userId));
  const preferencesMutation = useMutation(
    ticketAlertPreferencesMutationOptions(userId),
  );
  const { data: rawNowPlaying = EMPTY_MOVIES } = useQuery({
    ...movieCollectionQueryOptions("nowPlaying"),
    select: selectMovies,
    enabled: Boolean(userId),
  });
  const { data: rawComingSoon = EMPTY_MOVIES } = useQuery({
    ...movieCollectionQueryOptions("comingSoon"),
    select: selectMovies,
    enabled: Boolean(userId),
  });
  const moviesById = useMemo(
    () =>
      new Map(
        applyMovieDisplayPreferences(
          [...rawNowPlaying, ...rawComingSoon],
          displayPreferences.preferencesById,
        ).map((movie) => [movie.tmdbId, movie]),
      ),
    [displayPreferences.preferencesById, rawComingSoon, rawNowPlaying],
  );
  const alerts = alertsQuery.data ?? EMPTY_ALERTS;
  const visibleAlerts = alerts.filter(
    (alert) =>
      displayPreferences.preferencesById.get(alert.tmdbId)?.treatment !==
      "remove",
  );
  const defaults = preferencesQuery.data ?? DEFAULT_TICKET_ALERT_CRITERIA;

  if (!userId) {
    return null;
  }

  if (!displayPreferences.ready) {
    return (
      <section className="prefs-setting prefs-alerts-setting">
        <p className="prefs-alerts-empty" role="status">
          Loading your movie display preferences…
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="prefs-setting prefs-alerts-setting">
        <div className="prefs-setting-content prefs-setting-content--static">
          <div className="prefs-alerts-header">
            <div className="prefs-setting-copy">
              <span className="prefs-setting-label">Movie notifications</span>
              <span className="prefs-setting-summary">
                {visibleAlerts.length === 0
                  ? "No movies being watched"
                  : `${visibleAlerts.length} movie${visibleAlerts.length === 1 ? "" : "s"} being watched`}
              </span>
            </div>
          </div>
          <details className="ticket-alert-defaults-details">
            <summary>
              Default cities, notification mode, and showtime filters
            </summary>
            <p>
              These defaults apply to manually watched films and Letterboxd
              sources. Additional sessions and dates do not repeat an
              availability alert.
            </p>
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
            !alertsQuery.data ? null : visibleAlerts.length === 0 ? (
            <p className="prefs-alerts-empty">
              Click Notify me on a coming soon movie to see it here.
            </p>
          ) : (
            <ul className="prefs-alerts-list">
              {visibleAlerts.map((alert) => (
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
      <LetterboxdSourceWatchlist userId={userId} />
    </>
  );
}
