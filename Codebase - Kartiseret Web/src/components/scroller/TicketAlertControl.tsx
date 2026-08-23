import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, BellOff, CheckCircle2, LoaderCircle, Ticket } from "lucide-react";
import { Link } from "react-router";
import { cancelTicketAlert, loadTicketAlertState, subscribeToTicketAlert, type TicketAlertAvailability } from "../../data/ticketAlerts";
import type { Movie } from "../../data/movieCatalog";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";

type TicketAlertControlProps = {
  movie: Movie;
};

type TicketAlertControlState = {
  availability: TicketAlertAvailability | null;
  error: string | null;
  loading: boolean;
  notified: boolean;
  pending: boolean;
  subscribed: boolean;
};

const INITIAL_STATE: TicketAlertControlState = {
  availability: null,
  error: null,
  loading: true,
  notified: false,
  pending: false,
  subscribed: false,
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not update this ticket alert.";
}

export function TicketAlertControl({ movie }: TicketAlertControlProps) {
  const {
    user,
    location: preferredCity,
    loading: preferencesLoading,
  } = useUserPreferencesContext();
  const [state, setState] = useState<TicketAlertControlState>(INITIAL_STATE);
  const requestGenerationRef = useRef(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    if (preferencesLoading) {
      setState(INITIAL_STATE);
      return;
    }

    setState(INITIAL_STATE);

    void loadTicketAlertState({
      movieCode: movie.movieCode,
      preferredCity,
      tmdbId: movie.tmdbId,
      userId,
    })
      .then((ticketAlertState) => {
        if (requestGenerationRef.current !== requestGeneration) {
          return;
        }

        setState({
          ...ticketAlertState,
          error: null,
          loading: false,
          pending: false,
        });
      })
      .catch((error: unknown) => {
        if (requestGenerationRef.current !== requestGeneration) {
          return;
        }

        setState({
          ...INITIAL_STATE,
          error: getErrorMessage(error),
          loading: false,
        });
      });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [
    movie.movieCode,
    movie.tmdbId,
    preferredCity,
    preferencesLoading,
    userId,
  ]);

  const handleToggle = async () => {
    if (!userId || state.loading || state.pending || state.notified) {
      return;
    }

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    setState((currentState) => ({
      ...currentState,
      error: null,
      pending: true,
    }));

    try {
      if (state.subscribed) {
        await cancelTicketAlert(userId, movie.tmdbId);

        if (requestGenerationRef.current === requestGeneration) {
          setState((currentState) => ({
            ...currentState,
            pending: false,
            subscribed: false,
          }));
        }
        return;
      }

      const ticketAlertState = await subscribeToTicketAlert({
        movieCode: movie.movieCode,
        preferredCity,
        tmdbId: movie.tmdbId,
        userId,
      });

      if (requestGenerationRef.current === requestGeneration) {
        setState({
          ...ticketAlertState,
          error: null,
          loading: false,
          pending: false,
        });
      }
    } catch (error: unknown) {
      if (requestGenerationRef.current === requestGeneration) {
        setState((currentState) => ({
          ...currentState,
          error: getErrorMessage(error),
          pending: false,
        }));
      }
    }
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
  } else if (!userId) {
    control = (
      <button className="ticket-alert-button" type="button" disabled>
        <Bell className="ticket-alert-icon" aria-hidden />
        Notify me
      </button>
    );
    hint = "Log in to get one email when tickets go on sale.";
  } else if (state.notified) {
    control = (
      <button className="ticket-alert-button is-active" type="button" disabled>
        <CheckCircle2 className="ticket-alert-icon" aria-hidden />
        Alert sent
      </button>
    );
    hint = "Your one-time ticket alert has already been sent.";
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
          void handleToggle();
        }}
      >
        {state.pending ? (
          <LoaderCircle className="ticket-alert-icon is-spinning" aria-hidden />
        ) : state.subscribed ? (
          <BellOff className="ticket-alert-icon" aria-hidden />
        ) : (
          <Bell className="ticket-alert-icon" aria-hidden />
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
      {state.error ? (
        <p className="ticket-alert-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
