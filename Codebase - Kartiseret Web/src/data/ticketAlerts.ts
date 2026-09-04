import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { getShowtimeSortValue, shouldIncludeShowtime } from "../domain/showtimeDay";
import { isValidTicketAlertEmail, normalizeTicketAlertEmail, normalizeTicketAlertTmdbId } from "../domain/ticketAlerts";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { queryClient } from "../lib/queryClient";
import { buildMovieShowtimeShareUrl, getJerusalemCinemaDate, isDateInShowtimeLinkWindow } from "../routing/showtimeLinkCodec";
import { getOrCreateGuestTicketAlertToken, readGuestTicketAlertToken, useGuestTicketAlertsStore } from "../stores/guestTicketAlertsStore";

const TICKET_ALERTS_TABLE_NAME = "ticket_alert_subscriptions";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
const SUBSCRIPTION_COLUMNS =
  "tmdb_id,created_at,notified_at,delivery_title,delivery_date";
const SUPABASE_PAGE_SIZE = 1_000;
const MOVIE_CODE_PATTERN = /^[0-9A-Za-z]{3}$/;
const TICKET_ALERT_STALE_TIME = 60 * 1000;
const TICKET_ALERT_GC_TIME = 5 * 60 * 1000;

export type TicketAlertShowtimeRow = {
  id?: string | number | null;
  tmdb_id?: string | number | null;
  screening_city?: string | null;
  date_of_showing?: string | null;
  showtime?: string | null;
  cinema?: string | null;
  english_href?: string | null;
  hebrew_href?: string | null;
};

export type TicketAlertAvailability = {
  city: string;
  cinema: string;
  date: string;
  time: string;
  ticketHref: string;
  path: string;
};

export type UserTicketAlertSubscription = {
  tmdbId: string;
  createdAt: string;
  notifiedAt: string | null;
  deliveryTitle: string | null;
  deliveryDate: string | null;
};

type TicketAlertSubscriptionRow = {
  tmdb_id: string | number;
  created_at: string;
  notified_at: string | null;
  delivery_title?: string | null;
  delivery_date?: string | null;
};

type TicketAlertChange =

    | { action: "cancel" }
    | { action: "subscribe"; preferredCity: string; email?: string };

type TicketAlertChangeResult =

    | { kind: "available" }
    | { kind: "account"; subscription: UserTicketAlertSubscription | null }
    | { kind: "guest"; email: string | null };

export const ticketAlertQueryKeys = {
  all: ["ticketAlerts"] as const,
  availabilities: () => ["ticketAlerts", "availability"] as const,
  subscriptions: (userId: string | null) =>
    ["ticketAlerts", "subscriptions", userId] as const,
  availability: (tmdbId: string, cinemaDate: string) =>
    [
      "ticketAlerts",
      "availability",
      { tmdbId: normalizeTicketAlertTmdbId(tmdbId), cinemaDate },
    ] as const,
  change: (userId: string | null, tmdbId: string) =>
    [
      "ticketAlerts",
      "change",
      userId,
      normalizeTicketAlertTmdbId(tmdbId),
    ] as const,
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeShowtime(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(normalizeText(value));

  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getValidTicketHref(
  row: Pick<TicketAlertShowtimeRow, "english_href" | "hebrew_href">,
): string | null {
  for (const value of [row.english_href, row.hebrew_href]) {
    const href = normalizeText(value);

    if (!href) {
      continue;
    }

    try {
      const url = new URL(href);

      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        Boolean(url.hostname)
      ) {
        return href;
      }
    } catch {
      // Ignore source placeholders and malformed links.
    }
  }

  return null;
}

type SelectedTicketShowtime = Omit<TicketAlertAvailability, "path">;

function compareSelectedShowtimes(
  left: SelectedTicketShowtime,
  right: SelectedTicketShowtime,
): number {
  return (
    left.date.localeCompare(right.date) ||
    getShowtimeSortValue(left.time) - getShowtimeSortValue(right.time) ||
    left.city.localeCompare(right.city) ||
    left.cinema.localeCompare(right.cinema) ||
    left.ticketHref.localeCompare(right.ticketHref)
  );
}

export function selectTicketAlertShowtime(
  rows: readonly TicketAlertShowtimeRow[],
  preferredCity: string,
  instant: Date = new Date(),
): SelectedTicketShowtime | null {
  let earliestPreferred: SelectedTicketShowtime | null = null;
  let earliestAnywhere: SelectedTicketShowtime | null = null;

  for (const row of rows) {
    const city = normalizeText(row.screening_city);
    const date = normalizeText(row.date_of_showing);
    const time = normalizeShowtime(row.showtime);
    const ticketHref = getValidTicketHref(row);

    if (
      !city ||
      !date ||
      !time ||
      !ticketHref ||
      !shouldIncludeShowtime(date, time, instant)
    ) {
      continue;
    }

    const candidate: SelectedTicketShowtime = {
      city,
      cinema: normalizeText(row.cinema),
      date,
      time,
      ticketHref,
    };

    if (
      !earliestAnywhere ||
      compareSelectedShowtimes(candidate, earliestAnywhere) < 0
    ) {
      earliestAnywhere = candidate;
    }

    if (
      city === preferredCity &&
      (!earliestPreferred ||
        compareSelectedShowtimes(candidate, earliestPreferred) < 0)
    ) {
      earliestPreferred = candidate;
    }
  }

  return earliestPreferred ?? earliestAnywhere;
}

export function buildTicketAlertShowtimePath(
  movieCode: string | undefined,
  showtime: Pick<SelectedTicketShowtime, "city" | "date">,
  instant: Date = new Date(),
): string {
  if (!movieCode || !MOVIE_CODE_PATTERN.test(movieCode)) {
    return "/showtimes";
  }

  const plainMoviePath = `/${movieCode}`;
  const cinemaToday = getJerusalemCinemaDate(instant);

  if (!isDateInShowtimeLinkWindow(showtime.date, cinemaToday)) {
    return plainMoviePath;
  }

  return (
    buildMovieShowtimeShareUrl(
      {
        movieCode,
        city: showtime.city,
        date: showtime.date,
        filterMask: 0,
      },
      "",
    ) ?? plainMoviePath
  );
}

export function selectTicketAlertAvailability(
  rows: readonly TicketAlertShowtimeRow[],
  preferredCity: string,
  movieCode?: string,
  instant: Date = new Date(),
): TicketAlertAvailability | null {
  const showtime = selectTicketAlertShowtime(rows, preferredCity, instant);
  return showtime
    ? {
        ...showtime,
        path: buildTicketAlertShowtimePath(movieCode, showtime, instant),
      }
    : null;
}

async function fetchLinkedShowtimeRows(
  tmdbId: string,
  cinemaDate: string,
  signal: AbortSignal,
): Promise<TicketAlertShowtimeRow[]> {
  const supabase = getSupabaseBrowserClient();
  const allRows: TicketAlertShowtimeRow[] = [];
  let fromIndex = 0;

  while (true) {
    const { data, error } = await supabase
      .from(SHOWTIMES_TABLE_NAME)
      .select(
        "id,tmdb_id,screening_city,date_of_showing,showtime,cinema,english_href,hebrew_href",
      )
      .eq("tmdb_id", Number(tmdbId))
      .gte("date_of_showing", cinemaDate)
      .order("date_of_showing", { ascending: true })
      .order("showtime", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) {
      throw new Error(`Could not check ticket availability: ${error.message}`);
    }

    const rows = (data ?? []) as TicketAlertShowtimeRow[];
    allRows.push(...rows);
    if (rows.length < SUPABASE_PAGE_SIZE) {
      return allRows;
    }
    fromIndex += SUPABASE_PAGE_SIZE;
  }
}

function normalizeSubscription(
  row: TicketAlertSubscriptionRow,
): UserTicketAlertSubscription {
  return {
    tmdbId: normalizeTicketAlertTmdbId(String(row.tmdb_id)),
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    deliveryTitle: row.delivery_title ?? null,
    deliveryDate: row.delivery_date ?? null,
  };
}

async function fetchUserTicketAlertSubscriptions(
  userId: string,
  signal: AbortSignal,
): Promise<UserTicketAlertSubscription[]> {
  const supabase = getSupabaseBrowserClient();
  const alerts: UserTicketAlertSubscription[] = [];
  let fromIndex = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TICKET_ALERTS_TABLE_NAME)
      .select(SUBSCRIPTION_COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("tmdb_id", { ascending: true })
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) {
      throw new Error(`Could not load your ticket alerts: ${error.message}`);
    }

    const rows = (data ?? []) as TicketAlertSubscriptionRow[];
    alerts.push(...rows.map(normalizeSubscription));
    if (rows.length < SUPABASE_PAGE_SIZE) {
      return alerts;
    }
    fromIndex += SUPABASE_PAGE_SIZE;
  }
}

export function ticketAlertAvailabilityQueryOptions(
  tmdbId: string,
  cinemaDate = getJerusalemCinemaDate(),
) {
  const normalizedTmdbId = normalizeTicketAlertTmdbId(tmdbId);
  return queryOptions({
    queryKey: ticketAlertQueryKeys.availability(normalizedTmdbId, cinemaDate),
    queryFn: ({ signal }) =>
      fetchLinkedShowtimeRows(normalizedTmdbId, cinemaDate, signal),
    staleTime: TICKET_ALERT_STALE_TIME,
    gcTime: TICKET_ALERT_GC_TIME,
  });
}

export function userTicketAlertSubscriptionsQueryOptions(
  userId: string | null,
) {
  return queryOptions({
    queryKey: ticketAlertQueryKeys.subscriptions(userId),
    queryFn: userId
      ? ({ signal }) => fetchUserTicketAlertSubscriptions(userId, signal)
      : skipToken,
    staleTime: TICKET_ALERT_STALE_TIME,
    gcTime: TICKET_ALERT_GC_TIME,
  });
}

export function selectUserTicketAlert(
  alerts: readonly UserTicketAlertSubscription[] | undefined,
  tmdbId: string,
): UserTicketAlertSubscription | null {
  const id = normalizeTicketAlertTmdbId(tmdbId);
  return alerts?.find((alert) => alert.tmdbId === id) ?? null;
}

export function mergeUserTicketAlert(
  alerts: readonly UserTicketAlertSubscription[],
  tmdbId: string,
  subscription: UserTicketAlertSubscription | null,
): UserTicketAlertSubscription[] {
  const id = normalizeTicketAlertTmdbId(tmdbId);
  const next = alerts.filter((alert) => alert.tmdbId !== id);
  if (subscription) {
    next.push(subscription);
  }
  return next.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      Number(left.tmdbId) - Number(right.tmdbId),
  );
}

export function invalidateUserTicketAlertQueries(
  client: QueryClient,
  userId: string,
) {
  return client.invalidateQueries({
    queryKey: ticketAlertQueryKeys.subscriptions(userId),
    exact: true,
  });
}

async function changeTicketAlert(
  client: QueryClient,
  userId: string | null,
  tmdbId: string,
  change: TicketAlertChange,
): Promise<TicketAlertChangeResult> {
  const supabase = getSupabaseBrowserClient();
  const numericTmdbId = Number(tmdbId);

  if (change.action === "cancel") {
    if (userId) {
      const { error } = await supabase
        .from(TICKET_ALERTS_TABLE_NAME)
        .delete()
        .eq("user_id", userId)
        .eq("tmdb_id", numericTmdbId);
      if (error) {
        throw new Error(`Could not cancel this ticket alert: ${error.message}`);
      }
      return { kind: "account", subscription: null };
    }

    const guestToken = readGuestTicketAlertToken();
    if (guestToken) {
      const { error } = await supabase.rpc("cancel_guest_ticket_alert", {
        p_guest_token: guestToken,
        p_tmdb_id: numericTmdbId,
      });
      if (error) {
        throw new Error(`Could not cancel this ticket alert: ${error.message}`);
      }
    }
    return { kind: "guest", email: null };
  }

  const email = normalizeTicketAlertEmail(change.email ?? "");
  if (!userId && !isValidTicketAlertEmail(email)) {
    throw new Error("Enter a valid email address for this alert.");
  }

  // Recheck before writing. These are the same Query-owned reads used by the UI,
  // not a second request/promise cache.
  const instant = new Date();
  const [showtimes, alerts] = await Promise.all([
    client.fetchQuery({
      ...ticketAlertAvailabilityQueryOptions(
        tmdbId,
        getJerusalemCinemaDate(instant),
      ),
      staleTime: 0,
    }),
    userId
      ? client.fetchQuery({
          ...userTicketAlertSubscriptionsQueryOptions(userId),
          staleTime: 0,
        })
      : Promise.resolve([]),
  ]);

  if (selectTicketAlertShowtime(showtimes, change.preferredCity, instant)) {
    return { kind: "available" };
  }

  if (userId) {
    const existing = selectUserTicketAlert(alerts, tmdbId);
    if (existing) {
      return { kind: "account", subscription: existing };
    }

    const { data, error } = await supabase
      .from(TICKET_ALERTS_TABLE_NAME)
      .insert({ user_id: userId, tmdb_id: numericTmdbId })
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error?.code === "23505") {
      const current = await client.fetchQuery({
        ...userTicketAlertSubscriptionsQueryOptions(userId),
        staleTime: 0,
      });
      return {
        kind: "account",
        subscription: selectUserTicketAlert(current, tmdbId),
      };
    }
    if (error) {
      throw new Error(`Could not create this ticket alert: ${error.message}`);
    }
    return {
      kind: "account",
      subscription: normalizeSubscription(data as TicketAlertSubscriptionRow),
    };
  }

  const { error } = await supabase.rpc("create_guest_ticket_alert", {
    p_guest_token: getOrCreateGuestTicketAlertToken(),
    p_tmdb_id: numericTmdbId,
    p_email: email,
    p_preferred_city: change.preferredCity.trim(),
  });
  if (error) {
    throw new Error(`Could not create this ticket alert: ${error.message}`);
  }
  return { kind: "guest", email };
}

export function ticketAlertMutationOptions(
  userId: string | null,
  tmdbId: string,
  client: QueryClient = queryClient,
) {
  const id = normalizeTicketAlertTmdbId(tmdbId);
  const mutationKey = ticketAlertQueryKeys.change(userId, id);
  return mutationOptions({
    mutationKey,
    scope: { id: JSON.stringify(mutationKey) },
    retry: false,
    mutationFn: (change: TicketAlertChange) =>
      changeTicketAlert(client, userId, id, change),
    onSuccess: async (result) => {
      if (result.kind === "guest") {
        const store = useGuestTicketAlertsStore.getState();
        if (result.email === null) {
          store.removeReceipt(id);
        } else {
          store.saveReceipt(id, result.email);
        }
      } else if (result.kind === "account" && userId) {
        const queryKey = ticketAlertQueryKeys.subscriptions(userId);
        await client.cancelQueries({ queryKey, exact: true });
        client.setQueryData<UserTicketAlertSubscription[]>(queryKey, (
          current,
        ) =>
          current
            ? mergeUserTicketAlert(current, id, result.subscription)
            : undefined);
        await invalidateUserTicketAlertQueries(client, userId);
      }
    },
  });
}
