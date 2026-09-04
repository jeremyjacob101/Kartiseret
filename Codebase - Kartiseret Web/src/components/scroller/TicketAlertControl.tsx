import { useState, type FormEvent, type ReactNode } from "react";
import { useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Check, LoaderCircle, Ticket } from "lucide-react";
import { Link } from "react-router";
import { useShallow } from "zustand/react/shallow";
import { selectTicketAlertAvailability, selectUserTicketAlert, ticketAlertAvailabilityQueryOptions, ticketAlertMutationOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions } from "../../data/ticketAlerts";
import { isValidTicketAlertEmail, normalizeTicketAlertEmail, normalizeTicketAlertTmdbId } from "../../domain/ticketAlerts";
import type { Movie } from "../../data/movieCatalog";
import { useUserPreferencesStore } from "../../stores/userPreferencesStore";
import { useGuestTicketAlertsStore } from "../../stores/guestTicketAlertsStore";

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
  const { userId, preferredCity, preferencesLoading } = useUserPreferencesStore(
    useShallow((state) => ({
      userId: state.user?.id ?? null,
      preferredCity: state.preferences.location,
      preferencesLoading: state.loading,
    })),
  );

  return (
    <TicketAlertControlContent
      key={JSON.stringify([
        movie.tmdbId,
        userId,
        preferredCity,
        preferencesLoading,
      ])}
      movie={movie}
      userId={userId}
      preferredCity={preferredCity}
      preferencesLoading={preferencesLoading}
    />
  );
}

function TicketAlertControlContent({
  movie,
  userId,
  preferredCity,
  preferencesLoading,
}: TicketAlertControlProps & {
  userId: string | null;
  preferredCity: string;
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
  const guestReceipt = useGuestTicketAlertsStore((store) =>
    userId ? undefined : store.receipts[tmdbId]);
  const mutation = useMutation(ticketAlertMutationOptions(userId, tmdbId));
  const pending =
    useIsMutating({
      mutationKey: ticketAlertQueryKeys.change(userId, tmdbId),
      exact: true,
    }) > 0;
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEmailDraft, setGuestEmailDraft] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const subscription = selectUserTicketAlert(subscriptionsQuery.data, tmdbId);
  const loadFailed =
    (availabilityQuery.isError && !availabilityQuery.data) ||
    (Boolean(userId) && subscriptionsQuery.isError && !subscriptionsQuery.data);
  const state = {
    availability: selectTicketAlertAvailability(
      availabilityQuery.data ?? [],
      preferredCity,
      movie.movieCode,
    ),
    loading:
      preferencesLoading ||
      availabilityQuery.isPending ||
      (Boolean(userId) && subscriptionsQuery.isPending),
    pending,
    subscribed: Boolean(subscription && !subscription.notifiedAt),
    notified: Boolean(subscription?.notifiedAt),
    guestEmail: guestReceipt?.email ?? null,
    guestSubscribed: Boolean(guestReceipt),
    error:
      formError ??
      mutation.error?.message ??
      availabilityQuery.error?.message ??
      (userId ? subscriptionsQuery.error?.message : null),
  };

  const handleAccountToggle = () => {
    if (!userId || state.loading || pending || state.notified) {
      return;
    }
    mutation.mutate(
      state.subscribed
        ? { action: "cancel" }
        : { action: "subscribe", preferredCity },
    );
  };

  const handleGuestSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.loading || pending) {
      return;
    }

    const email = normalizeTicketAlertEmail(guestEmailDraft);
    if (!isValidTicketAlertEmail(email)) {
      setFormError("Enter a valid email address for this alert.");
      return;
    }

    setFormError(null);
    mutation.mutate(
      { action: "subscribe", preferredCity, email },
      {
        onSuccess: () => {
          setGuestEmailDraft(email);
          setGuestFormOpen(false);
        },
      },
    );
  };

  const handleGuestCancel = () => {
    if (state.loading || pending) {
      return;
    }

    setFormError(null);
    mutation.mutate(
      { action: "cancel" },
      {
        onSuccess: () => {
          setGuestEmailDraft("");
          setGuestFormOpen(false);
        },
      },
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
  } else if (state.availability) {
    control = (
      <Link
        className="ticket-alert-button ticket-alert-button--available"
        to={state.availability.path}
      >
        <Ticket className="ticket-alert-icon" aria-hidden />
        View showtimes
      </Link>
    );
    hint =
      state.availability.city === preferredCity
        ? `Tickets are available in ${preferredCity}.`
        : `Tickets are available in ${state.availability.city}.`;
  } else if (state.notified) {
    control = (
      <button className="ticket-alert-button is-active" type="button" disabled>
        <TicketAlertBellIcon checked />
        Alert sent
      </button>
    );
    hint = "Your one-time ticket alert has already been sent.";
  } else if (!userId) {
    control = (
      <button
        className={`ticket-alert-button${state.guestSubscribed ? " is-active" : ""}`}
        type="button"
        aria-label={
          state.guestSubscribed
            ? `Edit or cancel ticket alert for ${movie.title}`
            : `Notify me when tickets for ${movie.title} go on sale`
        }
        aria-pressed={state.guestSubscribed}
        disabled={state.pending}
        onClick={() => {
          setGuestEmailDraft(state.guestEmail ?? "");
          setGuestFormOpen((open) => !open);
        }}
      >
        {state.pending ? (
          <LoaderCircle className="ticket-alert-icon is-spinning" aria-hidden />
        ) : (
          <TicketAlertBellIcon checked={state.guestSubscribed} />
        )}
        {state.guestSubscribed ? "Email alert on" : "Notify me"}
      </button>
    );
    hint = state.guestSubscribed
      ? "We’ll send one email to the saved address. Click to edit or cancel."
      : "Enter an email to get one alert when tickets appear.";
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
    hint = state.subscribed
      ? "We’ll send one email when tickets appear. Click to cancel."
      : "Get one email when a cinema posts a ticket link.";
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
      {!userId && !state.availability && guestFormOpen ? (
        <form
          className="ticket-alert-form"
          onSubmit={(event) => void handleGuestSubmit(event)}
        >
          <label
            className="ticket-alert-form-label"
            htmlFor={`ticket-alert-email-${movie.tmdbId}`}
          >
            Email for this alert
            <input
              id={`ticket-alert-email-${movie.tmdbId}`}
              className="ticket-alert-form-input"
              type="email"
              autoComplete="email"
              value={guestEmailDraft}
              placeholder="you@example.com"
              required
              disabled={state.pending}
              onChange={(event) => {
                setGuestEmailDraft(event.target.value);
                setFormError(null);
                mutation.reset();
              }}
            />
          </label>
          <div className="ticket-alert-form-actions">
            <button
              className="ticket-alert-form-submit"
              type="submit"
              disabled={state.pending}
            >
              {state.pending
                ? "Saving…"
                : state.guestSubscribed
                  ? "Update email"
                  : "Save alert"}
            </button>
            {state.guestSubscribed ? (
              <button
                className="ticket-alert-form-cancel ticket-alert-form-cancel--danger"
                type="button"
                disabled={state.pending}
                onClick={() => {
                  void handleGuestCancel();
                }}
              >
                Cancel alert
              </button>
            ) : (
              <button
                className="ticket-alert-form-cancel"
                type="button"
                disabled={state.pending}
                onClick={() => {
                  setGuestFormOpen(false);
                  setFormError(null);
                  mutation.reset();
                }}
              >
                Not now
              </button>
            )}
          </div>
        </form>
      ) : null}
      {state.error ? (
        <p className="ticket-alert-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
