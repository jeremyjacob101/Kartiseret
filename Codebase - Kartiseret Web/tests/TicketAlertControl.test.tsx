import { createClient } from "@supabase/supabase-js";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketAlertControl } from "../src/components/scroller/TicketAlertControl";
import { getJerusalemCinemaDate } from "../src/routing/showtimeLinkCodec";
import { queryClient } from "../src/lib/queryClient";
import { ticketAlertQueryKeys } from "../src/data/ticketAlerts";
import { useGuestTicketAlertsStore } from "../src/stores/guestTicketAlertsStore";
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

        if (url.pathname.includes("/rpc/")) {
          if (url.pathname.endsWith("/rpc/create_guest_ticket_alert")) {
            const body = JSON.parse(await request.clone().text()) as {
              p_email: string;
              p_guest_token: string;
              p_preferred_city: string;
              p_tmdb_id: number;
            };
            return new Response(
              JSON.stringify([
                {
                  tmdb_id: body.p_tmdb_id,
                  created_at: "2026-09-16T12:00:00Z",
                  notified_at: null,
                  guest_token: body.p_guest_token,
                  email: body.p_email,
                  preferred_city: body.p_preferred_city,
                },
              ]),
              { status: 200 },
            );
          }
          return new Response("null", { status: 200 });
        }

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
  useGuestTicketAlertsStore.setState({ receipts: {} });
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
  useGuestTicketAlertsStore.setState({ receipts: {} });
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

  it("validates guest email input before invoking the mutation", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(await screen.findByRole("button", { name: /Notify me/ }));
    await user.type(
      screen.getByLabelText("Email for this alert"),
      "invalid@domain",
    );
    await user.click(screen.getByRole("button", { name: "Save alert" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid email address for this alert.",
    );
  });

  it("saves and displays a normalized guest receipt after the server confirms", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(await screen.findByRole("button", { name: /Notify me/ }));
    await user.type(
      screen.getByLabelText("Email for this alert"),
      " Guest@Example.com ",
    );
    await user.click(screen.getByRole("button", { name: "Save alert" }));

    await waitFor(() =>
      expect(useGuestTicketAlertsStore.getState().receipts["101"]?.email).toBe(
        "guest@example.com",
      ));
    expect(
      screen.getByRole("button", { name: /Edit or cancel ticket alert/ }),
    ).toHaveTextContent("Email alert on");
    expect(
      screen.queryByLabelText("Email for this alert"),
    ).not.toBeInTheDocument();
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
