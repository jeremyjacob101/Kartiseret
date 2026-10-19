import { invalidateUserTicketAlertQueries, mergeUserTicketAlert, selectTicketAlertAvailability, selectUserTicketAlert, ticketAlertAvailabilityQueryOptions, ticketAlertMutationOptions, ticketAlertQueryKeys, userTicketAlertSubscriptionsQueryOptions, type TicketAlertShowtimeRow, type UserTicketAlertSubscription } from "../src/data/ticketAlerts";
import { addCalendarDays, getJerusalemCinemaDate } from "@kartiseret/contracts/showtime-links";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseBrowserClient } from "../src/lib/supabase";
import { createClient } from "@supabase/supabase-js";
import { QueryClient } from "@tanstack/react-query";

vi.mock("../src/lib/supabase", () => ({ getSupabaseBrowserClient: vi.fn() }));

type StoredSubscription = {
  user_id: string;
  tmdb_id: number;
  created_at: string;
  notified_at: string | null;
  delivery_title: string | null;
  delivery_date: string | null;
};

let client: QueryClient;
let requests: Request[];
let apiRequests: Request[];
let rows: TicketAlertShowtimeRow[];
let subscriptions: StoredSubscription[];
let failWrites: boolean;
let duplicateInsert: boolean;

function storedSubscription(
  userId = "00000000-0000-4000-8000-000000000001",
  tmdbId = 101,
): StoredSubscription {
  return {
    user_id: userId,
    tmdb_id: tmdbId,
    created_at: "2026-09-01T12:00:00Z",
    notified_at: null,
    delivery_title: null,
    delivery_date: null,
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
  apiRequests = [];
  rows = [];
  subscriptions = [];
  failWrites = false;
  duplicateInsert = false;
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const supabase = createClient("http://127.0.0.1:54321", "local-test-only", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  vi.spyOn(supabase.auth, "getSession").mockResolvedValue({
    data: {
      session: {
        access_token: "fixture-token",
        user: { id: "00000000-0000-4000-8000-000000000001" },
      } as import("@supabase/supabase-js").Session,
    },
    error: null,
  });
  vi.mocked(getSupabaseBrowserClient).mockReturnValue(supabase);
  const map = (row: StoredSubscription) => ({
    tmdbId: String(row.tmdb_id),
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    deliveryTitle: row.delivery_title,
    deliveryDate: row.delivery_date,
  });
  vi.stubGlobal("fetch", async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const request = new Request(
      new URL(String(input), "https://kartiseret.test"),
      init,
    );
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/ticket-availability") {
      apiRequests.push(request);
      return reply({
        data: {
          showtimes: rows.map((row) => ({
            screeningCity: row.screening_city,
            dateOfShowing: row.date_of_showing,
            cinema: row.cinema,
            showtime: row.showtime,
            englishHref: row.english_href,
            hebrewHref: row.hebrew_href ?? null,
          })),
        },
        error: null,
      });
    }
    requests.push(request);
    if (request.method !== "GET" && failWrites)
      return reply(
        {
          data: null,
          error: { code: "write_denied", message: "Fixture write rejected" },
        },
        403,
      );
    if (request.method === "GET") {
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const page = subscriptions.slice(offset, offset + 1000);
      return reply({
        data: {
          subscriptions: page.map(map),
          nextOffset: page.length === 1000 ? offset + 1000 : null,
        },
        error: null,
      });
    }
    if (request.method === "DELETE") {
      const id = Number(url.pathname.split("/").at(-1));
      subscriptions = subscriptions.filter((row) => row.tmdb_id !== id);
      return reply({
        data: { kind: "account", subscription: null },
        error: null,
      });
    }
    const body = (await request.json()) as {
      tmdbId: string;
      preferredCity: string;
    };
    expect(Object.keys(body).sort()).toEqual(["preferredCity", "tmdbId"]);
    if (selectTicketAlertAvailability(rows, body.preferredCity))
      return reply({ data: { kind: "available" }, error: null });
    let row = subscriptions.find((row) => row.tmdb_id === Number(body.tmdbId));
    if (!row) {
      row = storedSubscription(undefined, Number(body.tmdbId));
      subscriptions.push(row);
    }
    void duplicateInsert;
    return reply({
      data: { kind: "account", subscription: map(row) },
      error: null,
    });
  });
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
    expect(
      ticketAlertQueryKeys.subscriptions(
        "00000000-0000-4000-8000-000000000001",
      ),
    ).not.toEqual(
      ticketAlertQueryKeys.subscriptions(
        "00000000-0000-4000-8000-000000000002",
      ),
    );
    expect(ticketAlertQueryKeys.subscriptions(null)).not.toEqual(
      ticketAlertQueryKeys.subscriptions(
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    expect(() => ticketAlertAvailabilityQueryOptions("101oops")).toThrow();
    expect(() => ticketAlertAvailabilityQueryOptions("0")).toThrow();
  });

  it("deduplicates availability reads and reuses raw rows across city selectors", async () => {
    const options = ticketAlertAvailabilityQueryOptions("101", "2026-09-04");
    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    expect(apiRequests).toHaveLength(1);
    const url = new URL(apiRequests[0]!.url);
    expect(url.pathname).toBe("/api/v1/ticket-availability");
    expect(url.searchParams.get("tmdbId")).toBe("101");
    expect(url.searchParams.has("fromDate")).toBe(true);
    expect(url.searchParams.has("city")).toBe(false);
  });

  it("paginates the shared account list and uses its cached result for movie lookup", async () => {
    subscriptions = Array.from({ length: 1001 }, (_, index) =>
      storedSubscription("00000000-0000-4000-8000-000000000001", index + 1));
    const options = userTicketAlertSubscriptionsQueryOptions(
      "00000000-0000-4000-8000-000000000001",
    );
    const alerts = await client.fetchQuery(options);
    expect(alerts).toHaveLength(1001);
    expect(selectUserTicketAlert(alerts, "00101")).toEqual(subscription());
    await client.fetchQuery(options);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1].url).searchParams.get("offset")).toBe("1000");
    expect(requests[0].headers.get("authorization")).toBe(
      "Bearer fixture-token",
    );
  });

  it("aborts in-flight reads when their query is cancelled", async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")));
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
    const firstKey = ticketAlertQueryKeys.subscriptions(
      "00000000-0000-4000-8000-000000000001",
    );
    const secondKey = ticketAlertQueryKeys.subscriptions(
      "00000000-0000-4000-8000-000000000002",
    );
    const availabilityKey = ticketAlertQueryKeys.availability(
      "101",
      "2026-09-04",
    );
    client.setQueryData(firstKey, [subscription()]);
    client.setQueryData(secondKey, []);
    client.setQueryData(availabilityKey, []);
    await invalidateUserTicketAlertQueries(
      client,
      "00000000-0000-4000-8000-000000000001",
    );
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
    await client.fetchQuery(
      userTicketAlertSubscriptionsQueryOptions(
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    const key = ticketAlertQueryKeys.subscriptions(
      "00000000-0000-4000-8000-000000000001",
    );
    const execute = (action: "subscribe" | "cancel") =>
      client
        .getMutationCache()
        .build(
          client,
          ticketAlertMutationOptions(
            "00000000-0000-4000-8000-000000000001",
            "101",
            client,
          ),
        )
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

  it("requires an account before creating or canceling an alert", async () => {
    const mutation = client
      .getMutationCache()
      .build(client, ticketAlertMutationOptions(null, "101", client));

    await expect(
      mutation.execute({ action: "subscribe", preferredCity: "Jerusalem" }),
    ).rejects.toThrow("Create an account or log in");
    expect(requests).toHaveLength(0);
  });

  it("does not register an alert if tickets become available during the pre-save check", async () => {
    rows = [
      {
        screening_city: "Haifa",
        date_of_showing: addCalendarDays(getJerusalemCinemaDate(), 1),
        showtime: "20:00",
        cinema: "Cinema City Haifa",
        english_href: "https://example.test/tickets",
      },
    ];
    const result = await client
      .getMutationCache()
      .build(
        client,
        ticketAlertMutationOptions(
          "00000000-0000-4000-8000-000000000001",
          "101",
          client,
        ),
      )
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(result.kind).toBe("available");
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
  });

  it("preserves sent alerts and handles a concurrent duplicate insert", async () => {
    client.setQueryData(
      ticketAlertQueryKeys.subscriptions(
        "00000000-0000-4000-8000-000000000001",
      ),
      [],
    );
    subscriptions = [
      { ...storedSubscription(), notified_at: "2026-09-02T12:00:00Z" },
    ];
    await client
      .getMutationCache()
      .build(
        client,
        ticketAlertMutationOptions(
          "00000000-0000-4000-8000-000000000001",
          "101",
          client,
        ),
      )
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    subscriptions = [];
    duplicateInsert = true;
    await client
      .getMutationCache()
      .build(
        client,
        ticketAlertMutationOptions(
          "00000000-0000-4000-8000-000000000001",
          "202",
          client,
        ),
      )
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(
      selectUserTicketAlert(
        client.getQueryData(
          ticketAlertQueryKeys.subscriptions(
            "00000000-0000-4000-8000-000000000001",
          ),
        ),
        "202",
      ),
    ).toEqual(subscription("202"));
  });

  it("leaves confirmed cache data unchanged on cancellation failure and never retries writes", async () => {
    const key = ticketAlertQueryKeys.subscriptions(
      "00000000-0000-4000-8000-000000000001",
    );
    client.setQueryData(key, [subscription()]);
    failWrites = true;
    await expect(
      client
        .getMutationCache()
        .build(
          client,
          ticketAlertMutationOptions(
            "00000000-0000-4000-8000-000000000001",
            "101",
            client,
          ),
        )
        .execute({ action: "cancel" }),
    ).rejects.toThrow("Fixture write rejected");
    expect(client.getQueryData(key)).toEqual([subscription()]);
    expect(requests).toHaveLength(1);
  });

  it("keeps delayed account results isolated when another account is displayed", async () => {
    const otherKey = ticketAlertQueryKeys.subscriptions(
      "00000000-0000-4000-8000-000000000002",
    );
    client.setQueryData(otherKey, [subscription("202")]);
    await client
      .getMutationCache()
      .build(
        client,
        ticketAlertMutationOptions(
          "00000000-0000-4000-8000-000000000001",
          "101",
          client,
        ),
      )
      .execute({ action: "subscribe", preferredCity: "Jerusalem" });
    expect(client.getQueryData(otherKey)).toEqual([subscription("202")]);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});
