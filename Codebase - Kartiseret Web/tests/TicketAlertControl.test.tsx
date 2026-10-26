import { TicketAlertControl } from "../src/components/scroller/TicketAlertControl";
import { DEFAULT_TICKET_ALERT_CRITERIA } from "@kartiseret/contracts/private-data";
import { getJerusalemCinemaDate } from "@kartiseret/contracts/showtime-links";
import { useUserPreferencesStore } from "../src/stores/userPreferencesStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ticketAlertQueryKeys } from "../src/data/ticketAlerts";
import { QueryClientProvider } from "@tanstack/react-query";
import { OPEN_AUTH_MENU_EVENT } from "../src/lib/authMenu";
import { render, screen } from "@testing-library/react";
import { queryClient } from "../src/lib/queryClient";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { sampleMovie } from "./fixtures";

const { getAuthClientMock } = vi.hoisted(() => ({
  getAuthClientMock: vi.fn(),
}));

vi.mock("../src/lib/authClient", () => ({
  getAuthClient: getAuthClientMock,
}));

function createAuthFixture() {
  return {
    getSession: vi.fn(async () => ({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    })),
  };
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));
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
  getAuthClientMock.mockReturnValue(createAuthFixture());
  vi.stubGlobal("fetch", async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const pathname = new URL(String(input), "https://kartiseret.test").pathname;
    const data = pathname.endsWith("/ticket-alerts/preferences")
      ? { preferences: DEFAULT_TICKET_ALERT_CRITERIA }
      : pathname.includes("/ticket-alerts")
        ? init?.method === "POST"
          ? {
              kind: "account",
              subscription: {
                tmdbId: "101",
                createdAt: "2026-09-16T12:00:00Z",
                notifiedAt: null,
                deliveryTitle: null,
                deliveryDate: null,
                criteriaOverrides: {},
              },
            }
          : { subscriptions: [], nextOffset: null }
        : { showtimes: [] };
    return new Response(JSON.stringify({ data, error: null }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Kartiseret-Publication": "0",
      },
    });
  });
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
        criteriaOverrides: {},
      },
    ]);
    queryClient.setQueryData(
      ticketAlertQueryKeys.preferences(userId),
      DEFAULT_TICKET_ALERT_CRITERIA,
    );
    renderControl();

    expect(screen.getByRole("button", { name: "Alert sent" })).toBeDisabled();
    expect(
      screen.getByText(
        "Your selected ticket availability alerts are complete.",
      ),
    ).toBeInTheDocument();
  });
});
