import { createClient } from "@supabase/supabase-js";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { addCalendarDays, getJerusalemCinemaDate } from "../routing/showtimeLinkCodec";
import { useGuestTicketAlertsStore } from "../stores/guestTicketAlertsStore";
import { invalidateUserTicketAlertQueries, mergeUserTicketAlert, selectTicketAlertAvailability, selectUserTicketAlert, ticketAlertAvailabilityQueryOptions, ticketAlertMutationOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions, type TicketAlertShowtimeRow, type UserTicketAlertSubscription } from "./ticketAlerts";

vi.mock("../lib/supabase", () => ({ getSupabaseBrowserClient: vi.fn() }));

type StoredSubscription = {
  user_id: string;
  tmdb_id: number;
  created_at: string;
  notified_at: string | null;
};

let client: QueryClient;
let requests: Request[];
let rows: TicketAlertShowtimeRow[];
let subscriptions: StoredSubscription[];
let failWrites: boolean;
let duplicateInsert: boolean;

function storedSubscription(
  userId = "user-a",
  tmdbId = 101,
): StoredSubscription {
  return {
    user_id: userId,
    tmdb_id: tmdbId,
    created_at: "2026-09-01T12:00:00Z",
    notified_at: null,
  };
}

function subscription(tmdbId = "101"): UserTicketAlertSubscription {
  return {
    tmdbId,
    createdAt: "2026-09-01T12:00:00Z",
    notifiedAt: null,
    deliveryTitle: null,
    deliveryDate: null,
  };
}

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  requests = [];
  rows = [];
  subscriptions = [];
  failWrites = false;
  duplicateInsert = false;
  useGuestTicketAlertsStore.setState({ receipts: {} });
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  // Real Supabase request construction; all transport is in-memory. No network.
  const supabase = createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const url = new URL(request.url);
        if (request.method !== "GET" && failWrites) {
          return reply(
            { message: "Fixture write rejected", code: "42501" },
            403,
          );
        }
        if (url.pathname.endsWith("/finalShowtimes")) {
          return reply(rows);
        }
        if (url.pathname.includes("/rpc/")) {
          return reply(null);
        }
        if (!url.pathname.endsWith("/ticket_alert_subscriptions")) {
          throw new Error(
            `Unexpected fixture request: ${request.method} ${url.pathname}`,
          );
        }
        const userId = url.searchParams.get("user_id")?.replace("eq.", "");
        const tmdbId = Number(
          url.searchParams.get("tmdb_id")?.replace("eq.", ""),
        );
        if (request.method === "DELETE") {
          subscriptions = subscriptions.filter(
            (row) => row.user_id !== userId || row.tmdb_id !== tmdbId,
          );
          return reply(null);
        }
        if (request.method === "POST") {
          const body = (await request.json()) as {
            user_id: string;
            tmdb_id: number;
          };
          const row = storedSubscription(body.user_id, body.tmdb_id);
          subscriptions.push(row);
          return duplicateInsert
            ? reply({ code: "23505", message: "duplicate" }, 409)
            : reply(row, 201);
        }
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        return reply(
          subscriptions
            .filter((row) => row.user_id === userId)
            .slice(offset, offset + limit),
        );
      },
    },
  });
  vi.mocked(getSupabaseBrowserClient).mockReturnValue(supabase);
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

describe("ticket alert queries", () => {
  it("normalizes movie keys, isolates identities, and separates cinema dates", () => {
    expect(ticketAlertQueryKeys.availability(" 00101 ", "2026-09-04")).toEqual(
      ticketAlertQueryKeys.availability("101", "2026-09-04"),
    );
    expect(ticketAlertQueryKeys.availability("101", "2026-09-04")).not.toEqual(
      ticketAlertQueryKeys.availability("101", "2026-09-05"),
    );
    expect(ticketAlertQueryKeys.subscriptions("user-a")).not.toEqual(
      ticketAlertQueryKeys.subscriptions("user-b"),
    );
    expect(ticketAlertQueryKeys.subscriptions(null)).not.toEqual(
      ticketAlertQueryKeys.subscriptions("user-a"),
    );
    expect(() => ticketAlertAvailabilityQueryOptions("101oops")).toThrow();
    expect(() => ticketAlertAvailabilityQueryOptions("0")).toThrow();
  });

  it("deduplicates availability reads and reuses raw rows across city selectors", async () => {
    const options = ticketAlertAvailabilityQueryOptions("101", "2026-09-04");
    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    expect(requests).toHaveLength(1);
    const url = new URL(requests[0].url);
    expect(url.searchParams.get("tmdb_id")).toBe("eq.101");
    expect(url.searchParams.get("date_of_showing")).toBe("gte.2026-09-04");
    expect(url.searchParams.has("screening_city")).toBe(false);
  });

  it("paginates the shared account list and uses its cached result for movie lookup", async () => {
    subscriptions = Array.from({ length: 1001 }, (_, index) =>
      storedSubscription("user-a", index + 1));
    const options = userTicketAlertSubscriptionsQueryOptions("user-a");
    const alerts = await client.fetchQuery(options);
    expect(alerts).toHaveLength(1001);
    expect(selectUserTicketAlert(alerts, "00101")).toEqual(subscription());
    await client.fetchQuery(options);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[0].url).searchParams.get("order")).toBe(
      "created_at.desc,tmdb_id.asc",
    );
  });

  it("aborts in-flight reads when their query is cancelled", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(getSupabaseBrowserClient).mockReturnValue(
      createClient("http://127.0.0.1:54321", "local-test-only", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (_input, init) =>
            new Promise((_resolve, reject) => {
              requestSignal = init?.signal as AbortSignal;
              requestSignal.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")));
            }),
        },
      }),
    );
    const options = ticketAlertAvailabilityQueryOptions("101");
    const pending = client.fetchQuery(options);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    await client.cancelQueries({ queryKey: options.queryKey });
    await rejected;
    expect(requestSignal?.aborted).toBe(true);
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  });

  it("selects a preferred city with fallback, discarding expired or unlinked showtimes", () => {
    const instant = new Date("2026-09-04T16:00:00Z");
    const linkedRows: TicketAlertShowtimeRow[] = [
      {
        screening_city: "Haifa",
        date_of_showing: "2026-09-04",
        showtime: "20:00",
        english_href: "https://example.test/haifa",
      },
      {
        screening_city: "Jerusalem",
        date_of_showing: "2026-09-05",
        showtime: "20:00",
        english_href: "https://example.test/jerusalem",
      },
      {
        screening_city: "Jerusalem",
        date_of_showing: "2026-09-04",
        showtime: "10:00",
        english_href: "https://example.test/expired",
      },
      {
        screening_city: "Jerusalem",
        date_of_showing: "2026-09-04",
        showtime: "20:00",
        english_href: "javascript:invalid",
      },
    ];
    expect(
      selectTicketAlertAvailability(linkedRows, "Jerusalem", "Ab1", instant)
        ?.city,
    ).toBe("Jerusalem");
    expect(
      selectTicketAlertAvailability(linkedRows, "Tel Aviv", "Ab1", instant)
        ?.city,
    ).toBe("Haifa");
    expect(
      selectTicketAlertAvailability(linkedRows, "Haifa", undefined, instant)
        ?.path,
    ).toBe("/showtimes");
  });
});

describe("ticket alert mutation ownership", () => {
  it("invalidates only the affected account list", async () => {
    const firstKey = ticketAlertQueryKeys.subscriptions("user-a");
    const secondKey = ticketAlertQueryKeys.subscriptions("user-b");
    const availabilityKey = ticketAlertQueryKeys.availability(
      "101",
      "2026-09-04",
    );
    client.setQueryData(firstKey, [subscription()]);
    client.setQueryData(secondKey, []);
    client.setQueryData(availabilityKey, []);
    await invalidateUserTicketAlertQueries(client, "user-a");
    expect(client.getQueryState(firstKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(availabilityKey)?.isInvalidated).toBe(false);
  });

  it("merges confirmed changes immutably without losing unrelated subscriptions", () => {
    const before = [subscription(), subscription("202")];
    expect(mergeUserTicketAlert(before, "101", null)).toEqual([
      subscription("202"),
    ]);
    const notified = { ...subscription(), notifiedAt: "2026-09-04T12:00:00Z" };
    expect(mergeUserTicketAlert(before, "101", notified)).toEqual([
      notified,
      subscription("202"),
    ]);
    expect(before).toEqual([subscription(), subscription("202")]);
  });

  it("creates and cancels an account alert through the shared cache", async () => {
    const key = ticketAlertQueryKeys.subscriptions("user-a");
    const execute = (action: "subscribe" | "cancel") =>
      client
        .getMutationCache()
        .build(client, ticketAlertMutationOptions("user-a", "101", client))
        .execute(
          action === "subscribe"
            ? { action, preferredCity: "Jerusalem" }
            : { action },
        );
    await execute("subscribe");
    expect(client.getQueryData(key)).toEqual([subscription()]);
    await execute("cancel");
    expect(client.getQueryData(key)).toEqual([]);
    expect(
      requests.filter((request) => request.method === "POST"),
    ).toHaveLength(1);
    expect(
      requests.filter((request) => request.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("does not register an alert if tickets become available during the pre-save check", async () => {
    rows = [
      {
        screening_city: "Haifa",
        date_of_showing: addCalendarDays(getJerusalemCinemaDate(), 1),
        showtime: "20:00",
        english_href: "https://example.test/tickets",
      },
    ];
    const result = await client
      .getMutationCache()
      .build(client, ticketAlertMutationOptions("user-a", "101", client))
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(result.kind).toBe("available");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("preserves sent alerts and handles a concurrent duplicate insert", async () => {
    subscriptions = [
      { ...storedSubscription(), notified_at: "2026-09-02T12:00:00Z" },
    ];
    await client
      .getMutationCache()
      .build(client, ticketAlertMutationOptions("user-a", "101", client))
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    subscriptions = [];
    duplicateInsert = true;
    await client
      .getMutationCache()
      .build(client, ticketAlertMutationOptions("user-a", "202", client))
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(
      selectUserTicketAlert(
        client.getQueryData(ticketAlertQueryKeys.subscriptions("user-a")),
        "202",
      ),
    ).toEqual(subscription("202"));
  });

  it("leaves confirmed cache data unchanged on cancellation failure and never retries writes", async () => {
    const key = ticketAlertQueryKeys.subscriptions("user-a");
    client.setQueryData(key, [subscription()]);
    failWrites = true;
    await expect(
      client
        .getMutationCache()
        .build(client, ticketAlertMutationOptions("user-a", "101", client))
        .execute({ action: "cancel" }),
    ).rejects.toThrow("Fixture write rejected");
    expect(client.getQueryData(key)).toEqual([subscription()]);
    expect(requests).toHaveLength(1);
  });

  it("keeps delayed account results isolated when another account is displayed", async () => {
    const otherKey = ticketAlertQueryKeys.subscriptions("user-b");
    client.setQueryData(otherKey, [subscription("202")]);
    await client
      .getMutationCache()
      .build(client, ticketAlertMutationOptions("user-a", "101", client))
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(client.getQueryData(otherKey)).toEqual([subscription("202")]);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("updates guest receipts only after a successful RPC and preserves them on failure", async () => {
    const execute = (
      action: "subscribe" | "cancel",
      email = "Guest@Example.test",
    ) =>
      client
        .getMutationCache()
        .build(client, ticketAlertMutationOptions(null, "101", client))
        .execute(
          action === "subscribe"
            ? { action, preferredCity: "Jerusalem", email }
            : { action },
        );
    await execute("subscribe");
    expect(useGuestTicketAlertsStore.getState().receipts["101"]?.email).toBe(
      "guest@example.test",
    );
    failWrites = true;
    await expect(execute("subscribe", "new@example.test")).rejects.toThrow();
    await expect(execute("cancel")).rejects.toThrow();
    expect(useGuestTicketAlertsStore.getState().receipts["101"]?.email).toBe(
      "guest@example.test",
    );
    failWrites = false;
    await execute("cancel");
    expect(
      useGuestTicketAlertsStore.getState().receipts["101"],
    ).toBeUndefined();
  });
});
