import { mutationOptions, queryOptions, skipToken, type QueryClient } from "@tanstack/react-query";
import { getShowtimeSortValue, shouldIncludeShowtime } from "../domain/showtimeDay";
import { normalizeTicketAlertTmdbId } from "../domain/ticketAlerts";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { queryClient } from "../lib/queryClient";
import { buildMovieShowtimeSharePath, getJerusalemCinemaDate, isDateInShowtimeLinkWindow } from "../routing/showtimeLinkCodec";
import { getOrCreateGuestTicketAlertToken, readGuestTicketAlertToken, useGuestTicketAlertsStore } from "../stores/guestTicketAlertsStore";
import { isoDateStringSchema, movieCodeSchema, parseBoundary } from "../validation/runtime";
import { supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { cancelledGuestTicketAlertCountSchema, guestTicketAlertResponseSchema, guestTicketAlertInputSchema, ticketAlertChangeSchema, ticketAlertMovieIdSchema, ticketAlertShowtimePageSchema, ticketAlertShowtimeRowSchema, userTicketAlertSubscriptionRowSchema, type TicketAlertChange, type TicketAlertShowtime, type UserTicketAlertSubscription } from "./ticketAlertSchemas";

export type { UserTicketAlertSubscription } from "./ticketAlertSchemas";

const TICKET_ALERTS_TABLE_NAME = "ticket_alert_subscriptions";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
const SUBSCRIPTION_COLUMNS =
  "user_id,tmdb_id,created_at,notified_at,delivery_title,delivery_date";
const SUPABASE_PAGE_SIZE = 1_000;
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
export type TicketAlertAvailability = TicketAlertShowtime & { path: string };

type TicketAlertChangeResult =

    | { kind: "available" }
    | { kind: "account"; subscription: UserTicketAlertSubscription | null }
    | { kind: "guest"; email: string | null };

type ParsedUserTicketAlertRow = ReturnType<
  typeof userTicketAlertSubscriptionRowSchema.parse
>;

function mapUserTicketAlertSubscriptionRow(
  row: ParsedUserTicketAlertRow,
): UserTicketAlertSubscription {
  return {
    tmdbId: row.tmdb_id,
    createdAt: row.created_at,
    notifiedAt: row.notified_at,
    deliveryTitle: row.delivery_title,
    deliveryDate: row.delivery_date,
  };
}

export const ticketAlertQueryKeys = {
  all: ["ticketAlerts"] as const,
  availabilities: () => ["ticketAlerts", "availability"] as const,
  subscriptions: (userId: string | null) =>
    ["ticketAlerts", "subscriptions", userId] as const,
  availability: (tmdbId: string, cinemaDate: string) =>
    [
      "ticketAlerts",
      "availability",
      {
        tmdbId: normalizeTicketAlertTmdbId(tmdbId),
        cinemaDate: parseBoundary(
          isoDateStringSchema,
          cinemaDate,
          "ticket alert cinema date",
        ),
      },
    ] as const,
  change: (userId: string | null, tmdbId: string) =>
    [
      "ticketAlerts",
      "change",
      userId,
      normalizeTicketAlertTmdbId(tmdbId),
    ] as const,
};

export function getValidTicketHref(
  row:
    | Pick<TicketAlertShowtime, "ticketHref">
    | Pick<TicketAlertShowtimeRow, "english_href" | "hebrew_href">,
): string | null {
  if ("ticketHref" in row) {
    return row.ticketHref || null;
  }

  const result = ticketAlertShowtimeRowSchema.safeParse(row);
  return result.success ? result.data.ticketHref : null;
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
  rows: readonly (TicketAlertShowtime | TicketAlertShowtimeRow)[],
  preferredCity: string,
  instant: Date = new Date(),
): SelectedTicketShowtime | null {
  let earliestPreferred: SelectedTicketShowtime | null = null;
  let earliestAnywhere: SelectedTicketShowtime | null = null;

  for (const candidateRow of rows) {
    const row =
      "city" in candidateRow && "ticketHref" in candidateRow
        ? candidateRow
        : (() => {
            const result = ticketAlertShowtimeRowSchema.safeParse(candidateRow);
            return result.success ? result.data : null;
          })();
    if (!row) continue;
    if (!shouldIncludeShowtime(row.date, row.time, instant)) {
      continue;
    }

    const candidate: SelectedTicketShowtime = {
      city: row.city,
      cinema: row.cinema,
      date: row.date,
      time: row.time,
      ticketHref: row.ticketHref,
    };

    if (
      !earliestAnywhere ||
      compareSelectedShowtimes(candidate, earliestAnywhere) < 0
    ) {
      earliestAnywhere = candidate;
    }

    if (
      row.city === preferredCity &&
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
  const movieCodeResult = movieCodeSchema.safeParse(movieCode);
  if (!movieCodeResult.success) {
    return "/showtimes";
  }

  const plainMoviePath = `/${movieCodeResult.data}`;
  const cinemaToday = getJerusalemCinemaDate(instant);

  if (!isDateInShowtimeLinkWindow(showtime.date, cinemaToday)) {
    return plainMoviePath;
  }

  return (
    buildMovieShowtimeSharePath({
      movieCode: movieCodeResult.data,
      city: showtime.city,
      date: showtime.date,
      filterMask: 0,
    }) ?? plainMoviePath
  );
}

export function selectTicketAlertAvailability(
  rows: readonly (TicketAlertShowtime | TicketAlertShowtimeRow)[],
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
): Promise<TicketAlertShowtime[]> {
  const supabase = getSupabaseBrowserClient();
  const allRows: TicketAlertShowtime[] = [];
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

    const rawRows = data ?? [];
    const rows = parseBoundary(
      ticketAlertShowtimePageSchema,
      rawRows,
      "ticket availability response",
    ).filter((row): row is TicketAlertShowtime => row !== null);
    allRows.push(...rows);
    if (rawRows.length < SUPABASE_PAGE_SIZE) {
      return allRows;
    }
    fromIndex += SUPABASE_PAGE_SIZE;
  }
}

async function fetchUserTicketAlertSubscriptions(
  userId: string,
  signal: AbortSignal,
): Promise<UserTicketAlertSubscription[]> {
  const validatedUserId = parseBoundary(
    supabaseUserIdSchema,
    userId,
    "ticket alert user ID",
  );
  const supabase = getSupabaseBrowserClient();
  const alerts: UserTicketAlertSubscription[] = [];
  let fromIndex = 0;

  while (true) {
    const { data, error } = await supabase
      .from(TICKET_ALERTS_TABLE_NAME)
      .select(SUBSCRIPTION_COLUMNS)
      .eq("user_id", validatedUserId)
      .order("created_at", { ascending: false })
      .order("tmdb_id", { ascending: true })
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1)
      .abortSignal(signal);

    if (error) {
      throw new Error(`Could not load your ticket alerts: ${error.message}`);
    }

    const parsedRows = parseBoundary(
      userTicketAlertSubscriptionRowSchema.array(),
      data ?? [],
      "ticket alert subscription response",
    );
    if (parsedRows.some((row) => row.user_id !== validatedUserId)) {
      throw new Error(
        "Ticket alert response contained another user's subscription.",
      );
    }
    alerts.push(...parsedRows.map(mapUserTicketAlertSubscriptionRow));
    if ((data ?? []).length < SUPABASE_PAGE_SIZE) {
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
  const normalizedCinemaDate = parseBoundary(
    isoDateStringSchema,
    cinemaDate,
    "ticket alert cinema date",
  );
  return queryOptions({
    queryKey: ticketAlertQueryKeys.availability(
      normalizedTmdbId,
      normalizedCinemaDate,
    ),
    queryFn: ({ signal }) =>
      fetchLinkedShowtimeRows(normalizedTmdbId, normalizedCinemaDate, signal),
    staleTime: TICKET_ALERT_STALE_TIME,
    gcTime: TICKET_ALERT_GC_TIME,
  });
}

export function userTicketAlertSubscriptionsQueryOptions(
  userId: string | null,
) {
  const normalizedUserId = userId
    ? parseBoundary(supabaseUserIdSchema, userId, "ticket alert user ID")
    : null;
  return queryOptions({
    queryKey: ticketAlertQueryKeys.subscriptions(normalizedUserId),
    queryFn: normalizedUserId
      ? ({ signal }) =>
          fetchUserTicketAlertSubscriptions(normalizedUserId, signal)
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
  const validatedUserId = parseBoundary(
    supabaseUserIdSchema,
    userId,
    "ticket alert user ID",
  );
  return client.invalidateQueries({
    queryKey: ticketAlertQueryKeys.subscriptions(validatedUserId),
    exact: true,
  });
}

async function changeTicketAlert(
  client: QueryClient,
  userId: string | null,
  tmdbId: string,
  change: TicketAlertChange,
): Promise<TicketAlertChangeResult> {
  const validatedUserId = userId
    ? parseBoundary(supabaseUserIdSchema, userId, "ticket alert user ID")
    : null;
  const parsedChange = parseBoundary(
    ticketAlertChangeSchema,
    change,
    "ticket alert mutation input",
  );
  const numericTmdbId = parseBoundary(
    ticketAlertMovieIdSchema,
    tmdbId,
    "ticket alert movie ID",
  );
  const supabase = getSupabaseBrowserClient();

  if (parsedChange.action === "cancel") {
    if (validatedUserId) {
      const { error } = await supabase
        .from(TICKET_ALERTS_TABLE_NAME)
        .delete()
        .eq("user_id", validatedUserId)
        .eq("tmdb_id", numericTmdbId);
      if (error) {
        throw new Error(`Could not cancel this ticket alert: ${error.message}`);
      }
      return { kind: "account", subscription: null };
    }

    const guestToken = readGuestTicketAlertToken();
    if (guestToken) {
      const { data, error } = await supabase.rpc("cancel_guest_ticket_alert", {
        p_guest_token: guestToken,
        p_tmdb_id: numericTmdbId,
      });
      if (error) {
        throw new Error(`Could not cancel this ticket alert: ${error.message}`);
      }
      parseBoundary(
        cancelledGuestTicketAlertCountSchema,
        data,
        "guest ticket alert cancellation response",
      );
      return { kind: "guest", email: null };
    }

    if (useGuestTicketAlertsStore.getState().receipts[String(numericTmdbId)]) {
      throw new Error(
        "Guest ticket alert credentials are unavailable in this browser.",
      );
    }
    return { kind: "guest", email: null };
  }

  const guestChange = validatedUserId
    ? null
    : parseBoundary(
        guestTicketAlertInputSchema,
        {
          tmdbId,
          preferredCity: parsedChange.preferredCity,
          email: parsedChange.email,
        },
        "guest ticket alert input",
      );
  const email = guestChange?.email ?? parsedChange.email;

  const instant = new Date();
  const [showtimes, alerts] = await Promise.all([
    client.fetchQuery({
      ...ticketAlertAvailabilityQueryOptions(
        tmdbId,
        getJerusalemCinemaDate(instant),
      ),
      staleTime: 0,
    }),
    validatedUserId
      ? client.fetchQuery({
          ...userTicketAlertSubscriptionsQueryOptions(validatedUserId),
          staleTime: 0,
        })
      : Promise.resolve([] as UserTicketAlertSubscription[]),
  ]);

  if (
    selectTicketAlertShowtime(showtimes, parsedChange.preferredCity, instant)
  ) {
    return { kind: "available" };
  }

  if (validatedUserId) {
    const existing = selectUserTicketAlert(alerts, tmdbId);
    if (existing) {
      return { kind: "account", subscription: existing };
    }

    const { data, error } = await supabase
      .from(TICKET_ALERTS_TABLE_NAME)
      .insert({ user_id: validatedUserId, tmdb_id: numericTmdbId })
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error?.code === "23505") {
      const current = await client.fetchQuery({
        ...userTicketAlertSubscriptionsQueryOptions(validatedUserId),
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

    const [insertedRow] = parseBoundary(
      userTicketAlertSubscriptionRowSchema.array(),
      [data],
      "ticket alert subscription insert response",
    );
    if (!insertedRow || insertedRow.user_id !== validatedUserId) {
      throw new Error("Ticket alert insert response did not match this user.");
    }
    return {
      kind: "account",
      subscription: mapUserTicketAlertSubscriptionRow(insertedRow),
    };
  }

  const guestToken = getOrCreateGuestTicketAlertToken();
  const { data, error } = await supabase.rpc("create_guest_ticket_alert", {
    p_guest_token: guestToken,
    p_tmdb_id: numericTmdbId,
    p_email: email,
    p_preferred_city: parsedChange.preferredCity,
  });
  if (error) {
    throw new Error(`Could not create this ticket alert: ${error.message}`);
  }
  const [response] = parseBoundary(
    guestTicketAlertResponseSchema,
    data,
    "guest ticket alert creation response",
  );
  if (!response || response.guest_token !== guestToken) {
    throw new Error("Guest ticket alert response did not match this browser.");
  }
  return { kind: "guest", email: response.email };
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
      const store = useGuestTicketAlertsStore.getState();
      if (result.kind === "guest") {
        if (result.email === null) {
          store.removeReceipt(id);
        } else {
          store.saveReceipt(id, result.email);
        }
      } else if (result.kind === "account" && userId) {
        const validatedUserId = parseBoundary(
          supabaseUserIdSchema,
          userId,
          "ticket alert user ID",
        );
        const queryKey = ticketAlertQueryKeys.subscriptions(validatedUserId);
        await client.cancelQueries({ queryKey, exact: true });
        client.setQueryData<UserTicketAlertSubscription[]>(queryKey, (
          current,
        ) =>
          current
            ? mergeUserTicketAlert(current, id, result.subscription)
            : undefined);
        await invalidateUserTicketAlertQueries(client, validatedUserId);
      }
    },
  });
}
