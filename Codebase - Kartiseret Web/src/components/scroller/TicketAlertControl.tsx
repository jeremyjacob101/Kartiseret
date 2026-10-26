import { selectTicketAlertAvailability, selectUserTicketAlert, ticketAlertAvailabilityQueryOptions, ticketAlertMutationOptions, ticketAlertPreferencesQueryOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions } from "../../data/ticketAlerts";
import { DEFAULT_TICKET_ALERT_CRITERIA, resolveTicketAlertCriteria } from "@kartiseret/contracts/private-data";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { usePublicationRevision } from "../../hooks/usePublicationRevision";
import { useUserPreferencesStore } from "../../stores/userPreferencesStore";
import { normalizeTicketAlertTmdbId } from "../../domain/ticketAlerts";
import { Bell, Check, LoaderCircle, Ticket } from "lucide-react";
import { requestAuthMenuOpen } from "../../lib/authMenu";
import type { Movie } from "../../data/movieCatalog";
import { useShallow } from "zustand/react/shallow";
import type { ReactNode } from "react";
import { Link } from "react-router";

type TicketAlertControlProps = {
  movie: Movie;
};

function TicketAlertBellIcon({ checked }: { checked: boolean }) {
  return (
    <span className="ticket-alert-bell" aria-hidden="true">
      <Bell className="ticket-alert-icon" />
      {checked ? <Check className="ticket-alert-bell-check" /> : null}
    </span>
  );
}

export function TicketAlertControl({ movie }: TicketAlertControlProps) {
  usePublicationRevision();
  const { userId, preferencesLoading } = useUserPreferencesStore(
    useShallow((state) => ({
      userId: state.user?.id ?? null,
      preferencesLoading: state.loading,
    })),
  );

  return (
    <TicketAlertControlContent
      key={JSON.stringify([movie.tmdbId, userId, preferencesLoading])}
      movie={movie}
      userId={userId}
      preferencesLoading={preferencesLoading}
    />
  );
}

function TicketAlertControlContent({
  movie,
  userId,
  preferencesLoading,
}: TicketAlertControlProps & {
  userId: string | null;
  preferencesLoading: boolean;
}) {
  const tmdbId = normalizeTicketAlertTmdbId(movie.tmdbId);
  const availabilityQuery = useQuery({
    ...ticketAlertAvailabilityQueryOptions(tmdbId),
    enabled: !preferencesLoading,
  });
  const subscriptionsQuery = useQuery({
    ...userTicketAlertSubscriptionsQueryOptions(userId),
    enabled: Boolean(userId) && !preferencesLoading,
  });
  const preferencesQuery = useQuery({
    ...ticketAlertPreferencesQueryOptions(userId),
    enabled: Boolean(userId) && !preferencesLoading,
  });
  const mutation = useMutation(ticketAlertMutationOptions(userId, tmdbId));
  const pending =
    useIsMutating({
      mutationKey: ticketAlertQueryKeys.change(userId, tmdbId),
      exact: true,
    }) > 0;
  const subscription = selectUserTicketAlert(subscriptionsQuery.data, tmdbId);
  const preferredCity = useUserPreferencesStore(
    (state) => state.preferences.location,
  );
  const criteriaDefaults =
    preferencesQuery.data ?? DEFAULT_TICKET_ALERT_CRITERIA;
  const criteria = resolveTicketAlertCriteria(
    criteriaDefaults,
    subscription?.criteriaOverrides,
    preferredCity,
  );
  const completedCities = subscription?.completedCities ?? [];
  const availableCities = (criteria.cities ?? []).filter((city) =>
    selectTicketAlertAvailability(
      availabilityQuery.data ?? [],
      { ...criteria, cities: [city] },
      movie.movieCode,
    ));
  const hasCitiesLeft =
    criteria.notificationMode === "first_per_city" &&
    (criteria.cities ?? []).some(
      (city) =>
        !(subscription ? completedCities : availableCities).includes(city),
    );
  const complete =
    criteria.notificationMode === "first_per_city"
      ? Boolean(subscription && !hasCitiesLeft)
      : completedCities.length > 0 || Boolean(subscription?.notifiedAt);
  const loadFailed =
    (availabilityQuery.isError && !availabilityQuery.data) ||
    (Boolean(userId) &&
      subscriptionsQuery.isError &&
      !subscriptionsQuery.data) ||
    (Boolean(userId) && preferencesQuery.isError && !preferencesQuery.data);
  const state = {
    availability: selectTicketAlertAvailability(
      availabilityQuery.data ?? [],
      criteria,
      movie.movieCode,
    ),
    loading:
      preferencesLoading ||
      availabilityQuery.isPending ||
      (Boolean(userId) && subscriptionsQuery.isPending) ||
      (Boolean(userId) && preferencesQuery.isPending),
    pending,
    subscribed: Boolean(subscription && !complete),
    notified: complete,
    error:
      mutation.error?.message ??
      availabilityQuery.error?.message ??
      (userId
        ? (subscriptionsQuery.error?.message ?? preferencesQuery.error?.message)
        : null),
  };

  const handleAccountToggle = () => {
    if (!userId || state.loading || pending || state.notified) {
      return;
    }
    mutation.mutate(
      state.subscribed ? { action: "cancel" } : { action: "subscribe" },
    );
  };

  let control: ReactNode;
  let hint: string;

  if (state.loading || preferencesLoading) {
    control = (
      <button className="ticket-alert-button" type="button" disabled>
        <LoaderCircle className="ticket-alert-icon is-spinning" aria-hidden />
        Checking tickets…
      </button>
    );
    hint = "Checking ticket availability.";
  } else if (loadFailed) {
    control = (
      <button
        className="ticket-alert-button"
        type="button"
        onClick={() => {
          void availabilityQuery.refetch();
          if (userId) {
            void subscriptionsQuery.refetch();
          }
        }}
      >
        Retry checking tickets
      </button>
    );
    hint = "Ticket alerts are temporarily unavailable.";
  } else if (state.availability && !hasCitiesLeft) {
    control = (
      <Link
        className="ticket-alert-button ticket-alert-button--available"
        to={state.availability.path}
      >
        <Ticket className="ticket-alert-icon" aria-hidden />
        View showtimes
      </Link>
    );
    hint = `Tickets are available in ${state.availability.city}.`;
  } else if (state.notified) {
    control = (
      <button className="ticket-alert-button is-active" type="button" disabled>
        <TicketAlertBellIcon checked />
        Alert sent
      </button>
    );
    hint = "Your selected ticket availability alerts are complete.";
  } else if (!userId) {
    control = (
      <button
        className="ticket-alert-button"
        type="button"
        aria-label={`Create an account to get a ticket alert for ${movie.title}`}
        onClick={requestAuthMenuOpen}
      >
        <TicketAlertBellIcon checked={false} />
        Notify me
      </button>
    );
    hint = "Create an account or log in to receive a ticket alert.";
  } else {
    control = (
      <button
        className={`ticket-alert-button${state.subscribed ? " is-active" : ""}`}
        type="button"
        aria-label={
          state.subscribed
            ? `Cancel ticket alert for ${movie.title}`
            : `Notify me when tickets for ${movie.title} go on sale`
        }
        aria-pressed={state.subscribed}
        disabled={state.pending}
        onClick={() => {
          void handleAccountToggle();
        }}
      >
        {state.pending ? (
          <LoaderCircle className="ticket-alert-icon is-spinning" aria-hidden />
        ) : (
          <TicketAlertBellIcon checked={state.subscribed} />
        )}
        {state.pending
          ? "Saving…"
          : state.subscribed
            ? "Email alert on"
            : "Notify me"}
      </button>
    );
    hint =
      criteria.notificationMode === "first_per_city"
        ? state.subscribed
          ? "Watching remaining selected cities. Click to cancel."
          : "Get an alert when tickets first appear in each remaining selected city."
        : state.subscribed
          ? "We’ll alert you when tickets first appear in a selected city. Click to cancel."
          : "Get one alert when tickets first appear in your selected cities.";
  }

  return (
    <div
      className="ticket-alert-control"
      data-movie-scroller-swipe-ignore="true"
    >
      {control}
      <p className="ticket-alert-hint" aria-live="polite">
        {hint}
      </p>
      {state.error ? (
        <p className="ticket-alert-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
