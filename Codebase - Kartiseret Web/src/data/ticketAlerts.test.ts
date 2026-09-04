import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { encodeDateCode, parseMovieRouteCode } from "../routing/showtimeLinkCodec";
import { buildTicketAlertShowtimePath, cancelGuestTicketAlert, cancelTicketAlert, GUEST_TICKET_ALERTS_STORAGE_KEY, GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, loadGuestTicketAlert, loadTicketAlertState, loadUserTicketAlertSubscriptions, selectTicketAlertShowtime, subscribeGuestToTicketAlert, subscribeToTicketAlert } from "./ticketAlerts";

// Importing this service must never initialize or call a real Supabase client.
vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: vi.fn() }));

const userId = "11111111-1111-4111-8111-111111111111";
const guestToken = "abcdefab-1234-4123-8123-abcdefabcdef";
const timestamp = "2026-09-01T09:00:00.123456+00:00";
const guestInput = {
  tmdbId: "42",
  movieCode: "A7z",
  preferredCity: "Jerusalem",
  email: " Viewer@Example.TEST ",
};
const accountInput = {
  tmdbId: "42",
  movieCode: "A7z",
  preferredCity: "Jerusalem",
  userId,
};
const storedAlert = { email: "viewer@example.test", subscribedAt: timestamp };
const subscription = {
  user_id: userId,
  tmdb_id: 42,
  created_at: timestamp,
  notified_at: null,
};
const guestResponse = {
  ...subscription,
  guest_token: guestToken,
  email: "viewer@example.test",
  preferred_city: "Jerusalem",
};
const showtimeRow = {
  screening_city: "Jerusalem",
  date_of_showing: "2026-09-04",
  showtime: "20:30:00",
  cinema: "Cinema City",
  english_href: "https://tickets.example.test/42",
  hebrew_href: null,
};

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type QueryStep = { table: string; data: unknown; error?: QueryResult["error"] };

function mockClient(...steps: QueryStep[]) {
  const queries = steps.map((step) => {
    const result = Promise.resolve({
      data: step.data,
      error: step.error ?? null,
    });
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      then: result.then.bind(result),
    };
  });
  let index = 0;
  const client = {
    from: vi.fn((table: string) => {
      expect(steps[index]?.table, "Unexpected database query").toBe(table);
      return queries[index++];
    }),
    rpc: vi
      .fn<
        (name: string, args: Record<string, unknown>) => Promise<QueryResult>
      >()
      .mockRejectedValue(new Error("Unexpected RPC")),
  };
  vi.mocked(getSupabaseBrowserClient).mockReturnValue(
    client as unknown as ReturnType<typeof getSupabaseBrowserClient>,
  );
  return { ...client, queries };
}

let storage: Storage;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T09:00:00Z"));
  const values = new Map<string, string>();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => values.clear()),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    get length() {
      return values.size;
    },
  };
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => guestToken) });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(new Error("Network is forbidden in fixture tests")),
  );
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ticket alert ingress and account operations", () => {
  it("rejects invalid inputs before obtaining a client or making any query", async () => {
    await expect(
      loadTicketAlertState({ ...accountInput, tmdbId: "42oops" }),
    ).rejects.toThrow("boundary data");
    await expect(
      subscribeToTicketAlert({ ...accountInput, userId: "not-a-uuid" }),
    ).rejects.toThrow("boundary data");
    await expect(
      subscribeGuestToTicketAlert({ ...guestInput, email: "invalid" }),
    ).rejects.toThrow("valid email address");
    await expect(cancelTicketAlert(userId, "9007199254740992")).rejects.toThrow(
      "boundary data",
    );
    await expect(cancelGuestTicketAlert("42oops")).rejects.toThrow(
      "boundary data",
    );
    await expect(loadUserTicketAlertSubscriptions("invalid")).rejects.toThrow(
      "boundary data",
    );
    expect(getSupabaseBrowserClient).not.toHaveBeenCalled();
  });

  it("validates and maps account list rows and preserves nullable columns", async () => {
    const client = mockClient({
      table: "ticket_alert_subscriptions",
      data: [{ ...subscription, delivery_title: null, delivery_date: null }],
    });
    await expect(loadUserTicketAlertSubscriptions(userId)).resolves.toEqual([
      {
        tmdbId: "42",
        createdAt: timestamp,
        notifiedAt: null,
        deliveryTitle: null,
        deliveryDate: null,
      },
    ]);
    expect(client.queries[0].eq).toHaveBeenCalledWith("user_id", userId);
  });

  it("rejects malformed account rows instead of silently inventing missing values", async () => {
    mockClient({ table: "ticket_alert_subscriptions", data: [subscription] });
    await expect(loadUserTicketAlertSubscriptions(userId)).rejects.toThrow(
      "account ticket alert rows",
    );
  });

  it("rejects a subscription response for a different account or movie", async () => {
    for (const row of [
      { ...subscription, tmdb_id: 99 },
      { ...subscription, user_id: guestToken },
    ]) {
      mockClient(
        { table: "ticket_alert_subscriptions", data: row },
        { table: "finalShowtimes", data: [] },
      );
      await expect(loadTicketAlertState(accountInput)).rejects.toThrow(
        "did not match the requested account and movie",
      );
    }
  });

  it("does not insert if account subscription data is malformed", async () => {
    const client = mockClient(
      {
        table: "ticket_alert_subscriptions",
        data: { ...subscription, created_at: null },
      },
      { table: "finalShowtimes", data: [] },
    );
    await expect(subscribeToTicketAlert(accountInput)).rejects.toThrow(
      "ticket alert subscription",
    );
    expect(client.from).toHaveBeenCalledTimes(2);
    expect(
      client.queries.every((query) => query.insert.mock.calls.length === 0),
    ).toBe(true);
  });

  it("preserves the account insert contract and tolerates an existing subscription race", async () => {
    const client = mockClient(
      { table: "ticket_alert_subscriptions", data: null },
      { table: "finalShowtimes", data: [] },
      {
        table: "ticket_alert_subscriptions",
        data: null,
        error: { code: "23505", message: "duplicate" },
      },
    );
    await expect(
      subscribeToTicketAlert({ ...accountInput, tmdbId: " 42 " }),
    ).resolves.toMatchObject({ subscribed: true });
    expect(client.queries[2].insert).toHaveBeenCalledWith({
      user_id: userId,
      tmdb_id: 42,
    });
  });

  it("keeps account cancellation scoped to the validated account and movie", async () => {
    const client = mockClient({
      table: "ticket_alert_subscriptions",
      data: null,
    });
    await cancelTicketAlert(userId, " 42 ");
    expect(client.queries[0].delete).toHaveBeenCalledOnce();
    expect(client.queries[0].eq.mock.calls).toEqual([
      ["user_id", userId],
      ["tmdb_id", 42],
    ]);
  });
});

describe("ticket availability and routes", () => {
  it("continues pagination after a full page of unusable rows", async () => {
    const client = mockClient(
      {
        table: "finalShowtimes",
        data: Array.from({ length: 1000 }, () => ({
          ...showtimeRow,
          english_href: null,
        })),
      },
      { table: "finalShowtimes", data: [showtimeRow] },
    );
    const state = await loadTicketAlertState({ ...accountInput, userId: null });
    expect(client.queries[0].range).toHaveBeenCalledWith(0, 999);
    expect(client.queries[1].range).toHaveBeenCalledWith(1000, 1999);
    expect(state.availability).toMatchObject({
      city: "Jerusalem",
      date: "2026-09-04",
      time: "20:30",
      ticketHref: showtimeRow.english_href,
    });
    expect(
      parseMovieRouteCode(state.availability?.path.slice(1) ?? ""),
    ).toMatchObject({
      kind: "encoded",
      movieCode: "A7z",
      cityCode: "i",
      dateCode: encodeDateCode("2026-09-04"),
    });
  });

  it("rejects a malformed showtime envelope and makes no guest subscription RPC", async () => {
    const client = mockClient({ table: "finalShowtimes", data: { rows: [] } });
    await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow(
      "ticket alert showtime page",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns available tickets without creating a guest token or subscription", async () => {
    const client = mockClient({ table: "finalShowtimes", data: [showtimeRow] });
    await expect(
      subscribeGuestToTicketAlert(guestInput),
    ).resolves.toMatchObject({
      availability: { city: "Jerusalem" },
      guestSubscribed: false,
    });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(storage.getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("selects trusted showtimes by preferred city, time, and cinema-day rules", () => {
    const base = {
      city: "Tel Aviv",
      date: "2026-09-04",
      time: "19:00",
      cinema: "Cinema City",
      ticketHref: showtimeRow.english_href,
    };
    const rows = [
      base,
      { ...base, city: "Jerusalem", time: "20:00" },
      { ...base, city: "Jerusalem", time: "09:00" },
    ];
    expect(selectTicketAlertShowtime(rows, "Jerusalem")?.time).toBe("20:00");
    expect(selectTicketAlertShowtime(rows, "Haifa")?.time).toBe("19:00");
    expect(
      selectTicketAlertShowtime([{ ...base, time: "00:30" }], "Tel Aviv")?.time,
    ).toBe("00:30");
  });

  it("falls back safely when a movie code, city, or date cannot be encoded", () => {
    expect(
      buildTicketAlertShowtimePath(undefined, {
        city: "Jerusalem",
        date: "2026-09-04",
      }),
    ).toBe("/showtimes");
    expect(
      buildTicketAlertShowtimePath("A7z", {
        city: "Jerusalem",
        date: "2027-09-04",
      }),
    ).toBe("/A7z");
    expect(
      buildTicketAlertShowtimePath("A7z", {
        city: "Unknown city",
        date: "2026-09-04",
      }),
    ).toBe("/A7z");
  });
});

describe("guest ticket alert mutations and browser storage", () => {
  it("saves only validated server values after successful creation", async () => {
    const client = mockClient({ table: "finalShowtimes", data: [] });
    client.rpc.mockResolvedValue({ data: [guestResponse], error: null });
    await expect(
      subscribeGuestToTicketAlert(guestInput),
    ).resolves.toMatchObject({
      guestEmail: "viewer@example.test",
      guestSubscribed: true,
      subscribed: false,
      notified: false,
    });
    expect(client.rpc).toHaveBeenCalledWith("create_guest_ticket_alert", {
      p_guest_token: guestToken,
      p_tmdb_id: 42,
      p_email: "viewer@example.test",
      p_preferred_city: "Jerusalem",
    });
    expect(loadGuestTicketAlert("42")).toEqual({
      tmdbId: "42",
      ...storedAlert,
    });
    expect(storage.getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)).toBe(
      guestToken,
    );
  });

  it("preserves a valid existing bearer token instead of replacing it", async () => {
    storage.setItem(
      GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY,
      ` ${guestToken.toUpperCase()} `,
    );
    const client = mockClient({ table: "finalShowtimes", data: [] });
    client.rpc.mockResolvedValue({ data: [guestResponse], error: null });
    await subscribeGuestToTicketAlert(guestInput);
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledWith(
      "create_guest_ticket_alert",
      expect.objectContaining({ p_guest_token: guestToken }),
    );
  });

  it.each([
    null,
    [],
    [{ ...guestResponse, created_at: "yesterday" }],
    [{ ...guestResponse, tmdb_id: 99 }],
    [{ ...guestResponse, guest_token: userId }],
  ])(
    "does not cache malformed or mismatched guest creation responses: %j",
    async (response) => {
      const client = mockClient({ table: "finalShowtimes", data: [] });
      client.rpc.mockResolvedValue({ data: response, error: null });
      await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow();
      expect(storage.getItem(GUEST_TICKET_ALERTS_STORAGE_KEY)).toBeNull();
    },
  );

  it("retains local subscription state if cancellation cannot be confirmed", async () => {
    storage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, guestToken);
    storage.setItem(
      GUEST_TICKET_ALERTS_STORAGE_KEY,
      JSON.stringify({ "42": storedAlert }),
    );
    const client = mockClient();
    client.rpc.mockResolvedValue({ data: null, error: null });
    await expect(cancelGuestTicketAlert("42")).rejects.toThrow(
      "cancellation response",
    );
    expect(loadGuestTicketAlert("42")).not.toBeNull();
    client.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect(cancelGuestTicketAlert("42")).rejects.toThrow("offline");
    expect(loadGuestTicketAlert("42")).not.toBeNull();
  });

  it.each([0, 1])(
    "removes only the requested local entry after a valid cancellation result (%s)",
    async (count) => {
      storage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, guestToken);
      storage.setItem(
        GUEST_TICKET_ALERTS_STORAGE_KEY,
        JSON.stringify({ "42": storedAlert, "43": storedAlert }),
      );
      const client = mockClient();
      client.rpc.mockResolvedValue({ data: count, error: null });
      await cancelGuestTicketAlert("42");
      expect(client.rpc).toHaveBeenCalledWith("cancel_guest_ticket_alert", {
        p_guest_token: guestToken,
        p_tmdb_id: 42,
      });
      expect(loadGuestTicketAlert("42")).toBeNull();
      expect(loadGuestTicketAlert("43")).not.toBeNull();
      expect(storage.getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)).toBe(
        guestToken,
      );
    },
  );

  it("does not silently replace a malformed token or discard an uncancellable subscription", async () => {
    storage.setItem(
      GUEST_TICKET_ALERTS_STORAGE_KEY,
      JSON.stringify({ "42": storedAlert }),
    );
    const client = mockClient({ table: "finalShowtimes", data: [] });
    await expect(cancelGuestTicketAlert("42")).rejects.toThrow(
      "token for this guest ticket alert is missing",
    );
    storage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, "invalid");
    await expect(cancelGuestTicketAlert("42")).rejects.toThrow(
      "stored guest ticket alert token",
    );
    await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow(
      "stored guest ticket alert token",
    );
    expect(client.rpc).not.toHaveBeenCalled();
    expect(loadGuestTicketAlert("42")).not.toBeNull();
    expect(storage.getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY)).toBe(
      "invalid",
    );
  });

  it("requires readable and writable token storage before issuing a creation RPC", async () => {
    const client = mockClient(
      { table: "finalShowtimes", data: [] },
      { table: "finalShowtimes", data: [] },
    );
    const getItem = vi.spyOn(storage, "getItem");
    getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow(
      "readable browser storage",
    );
    getItem.mockReturnValue(null);
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow(
      "writable browser storage",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("rejects missing storage or insecure randomness before a guest mutation", async () => {
    const client = mockClient({ table: "finalShowtimes", data: [] });
    vi.stubGlobal("crypto", undefined);
    await expect(subscribeGuestToTicketAlert(guestInput)).rejects.toThrow(
      "secure browser randomness",
    );
    vi.stubGlobal("window", undefined);
    await expect(cancelGuestTicketAlert("42")).rejects.toThrow(
      "browser storage",
    );
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("does not fail a completed RPC when optional subscription-cache storage is full", async () => {
    storage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, guestToken);
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const client = mockClient({ table: "finalShowtimes", data: [] });
    client.rpc.mockResolvedValue({ data: [guestResponse], error: null });
    await expect(
      subscribeGuestToTicketAlert(guestInput),
    ).resolves.toMatchObject({ guestSubscribed: true });
  });

  it("treats invalid JSON and unavailable optional cache storage as empty", () => {
    storage.setItem(GUEST_TICKET_ALERTS_STORAGE_KEY, "invalid JSON");
    expect(loadGuestTicketAlert("42")).toBeNull();
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadGuestTicketAlert("42")).toBeNull();
  });
});
