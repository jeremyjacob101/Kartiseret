import { createClient } from "@supabase/supabase-js";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketAlertControl } from "../src/components/scroller/TicketAlertControl";
import { getJerusalemCinemaDate } from "../src/routing/showtimeLinkCodec";
import { queryClient } from "../src/lib/queryClient";
import { OPEN_AUTH_MENU_EVENT } from "../src/lib/authMenu";
import { ticketAlertQueryKeys } from "../src/data/ticketAlerts";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { sampleMovie } from "./fixtures";

const { getSupabaseBrowserClientMock } = vi.hoisted(() => ({
  getSupabaseBrowserClientMock: vi.fn(),
}));

vi.mock("../src/lib/supabase", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

function createSupabaseFixture() {
  return createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);

        if (url.pathname.endsWith("/finalShowtimes")) {
          return new Response("[]", { status: 200 });
        }

        if (url.pathname.endsWith("/ticket_alert_subscriptions")) {
          if (request.method === "POST") {
            return new Response(
              JSON.stringify({
                tmdb_id: 101,
                created_at: "2026-09-16T12:00:00Z",
                notified_at: null,
                delivery_title: null,
                delivery_date: null,
              }),
              { status: 201 },
            );
          }

          return new Response("null", { status: 200 });
        }

        return new Response("Unexpected fixture request", { status: 500 });
      },
    },
  });
}

function renderControl() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TicketAlertControl movie={sampleMovie} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  queryClient.clear();
  const storageValues = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
      clear: () => storageValues.clear(),
    },
  });
  useUserPreferencesStore.setState({
    user: null,
    loading: false,
    preferences: {
      ...useUserPreferencesStore.getState().preferences,
      location: "Jerusalem",
    },
  });
  getSupabaseBrowserClientMock.mockReturnValue(createSupabaseFixture());
});

afterEach(() => {
  queryClient.clear();
});

describe("TicketAlertControl", () => {
  it("communicates the preference-loading state without firing network queries", () => {
    useUserPreferencesStore.setState({ loading: true });
    renderControl();

    expect(
      screen.getByRole("button", { name: /Checking tickets/ }),
    ).toBeDisabled();
    expect(
      screen.getByText("Checking ticket availability."),
    ).toBeInTheDocument();
  });

  it("prioritizes live ticket availability over alert controls", () => {
    const date = getJerusalemCinemaDate();
    queryClient.setQueryData(ticketAlertQueryKeys.availability("101", date), [
      {
        screening_city: "Jerusalem",
        date_of_showing: date,
        showtime: "23:59",
        cinema: "Cinema City",
        english_href: "https://tickets.example.test/101",
      },
    ]);
    renderControl();

    const link = screen.getByRole("link", { name: "View showtimes" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^\/Ab1/));
    expect(
      screen.getByText("Tickets are available in Jerusalem."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Notify me/ }),
    ).not.toBeInTheDocument();
  });

  it("directs logged-out users to account auth instead of a guest alert form", async () => {
    const user = userEvent.setup();
    const authMenuRequest = vi.fn();
    window.addEventListener(OPEN_AUTH_MENU_EVENT, authMenuRequest);
    renderControl();
    try {
      await user.click(
        await screen.findByRole("button", {
          name: /Create an account to get a ticket alert/,
        }),
      );

      expect(authMenuRequest).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText(
          "Create an account or log in to receive a ticket alert.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Email for this alert"),
      ).not.toBeInTheDocument();
    } finally {
      window.removeEventListener(OPEN_AUTH_MENU_EVENT, authMenuRequest);
    }
  });

  it("renders already-notified account alerts as terminal and disabled", () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    useUserPreferencesStore.setState({
      user: { id: userId } as never,
    });
    const date = getJerusalemCinemaDate();
    queryClient.setQueryData(
      ticketAlertQueryKeys.availability("101", date),
      [],
    );
    queryClient.setQueryData(ticketAlertQueryKeys.subscriptions(userId), [
      {
        tmdbId: "101",
        createdAt: "2026-09-01T12:00:00Z",
        notifiedAt: "2026-09-15T12:00:00Z",
        deliveryTitle: "Sample Movie",
        deliveryDate: date,
      },
    ]);
    renderControl();

    expect(screen.getByRole("button", { name: "Alert sent" })).toBeDisabled();
    expect(
      screen.getByText("Your one-time ticket alert has already been sent."),
    ).toBeInTheDocument();
  });
});
