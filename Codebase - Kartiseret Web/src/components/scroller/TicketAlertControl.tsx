import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Bell, Check, LoaderCircle, Ticket } from "lucide-react";
import { Link } from "react-router";
import { cancelGuestTicketAlert, cancelTicketAlert, loadTicketAlertState, subscribeGuestToTicketAlert, subscribeToTicketAlert, type TicketAlertState } from "../../data/ticketAlerts";
import type { Movie } from "../../data/movieCatalog";
import { useUserPreferencesContext } from "../../prefs/useUserPreferences";

type TicketAlertControlProps = {
  movie: Movie;
};

type TicketAlertControlState = TicketAlertState & {
  error: string | null;
  loading: boolean;
  pending: boolean;
};

const INITIAL_STATE: TicketAlertControlState = {
  availability: null,
  error: null,
  guestEmail: null,
  guestSubscribed: false,
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

function TicketAlertBellIcon({ checked }: { checked: boolean }) {
  return (
    <span className="ticket-alert-bell" aria-hidden="true">
      <Bell className="ticket-alert-icon" />
      {checked ? <Check className="ticket-alert-bell-check" /> : null}
    </span>
  );
}

export function TicketAlertControl({ movie }: TicketAlertControlProps) {
  const {
    user,
    location: preferredCity,
    loading: preferencesLoading,
  } = useUserPreferencesContext();
  const [state, setState] = useState<TicketAlertControlState>(INITIAL_STATE);
  const [guestFormOpen, setGuestFormOpen] = useState(false);
  const [guestEmailDraft, setGuestEmailDraft] = useState("");
  const requestGenerationRef = useRef(0);
  const userId = user?.id ?? null;

  useEffect(() => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;

    if (preferencesLoading) {
      setState(INITIAL_STATE);
      setGuestFormOpen(false);
      return;
    }

    setState(INITIAL_STATE);
    setGuestFormOpen(false);
    setGuestEmailDraft("");

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
        setGuestEmailDraft(ticketAlertState.guestEmail ?? "");
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

  const handleAccountToggle = async () => {
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

  const handleGuestSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (state.loading || state.pending) {
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
      const ticketAlertState = await subscribeGuestToTicketAlert({
        movieCode: movie.movieCode,
        preferredCity,
        tmdbId: movie.tmdbId,
        email: guestEmailDraft,
      });

      if (requestGenerationRef.current === requestGeneration) {
        setState({
          ...ticketAlertState,
          error: null,
          loading: false,
          pending: false,
        });
        setGuestEmailDraft(ticketAlertState.guestEmail ?? "");
        setGuestFormOpen(false);
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

  const handleGuestCancel = async () => {
    if (state.loading || state.pending) {
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
      await cancelGuestTicketAlert(movie.tmdbId);

      if (requestGenerationRef.current === requestGeneration) {
        setState((currentState) => ({
          ...currentState,
          error: null,
          guestEmail: null,
          guestSubscribed: false,
          pending: false,
        }));
        setGuestEmailDraft("");
        setGuestFormOpen(false);
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
                setState((currentState) => ({ ...currentState, error: null }));
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
                  setState((currentState) => ({
                    ...currentState,
                    error: null,
                  }));
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
