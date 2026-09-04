import type { SupabaseClient } from "@supabase/supabase-js";
import { getShowtimeSortValue, shouldIncludeShowtime } from "../domain/showtimeDay";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { supabaseUserIdSchema } from "../lib/supabaseSchemas";
import { buildMovieShowtimeSharePath, getJerusalemCinemaDate, isDateInShowtimeLinkWindow } from "../routing/showtimeLinkCodec";
import { movieCodeSchema, parseBoundary, safeParseJson } from "../validation/runtime";
import { accountTicketAlertIdentitySchema, accountTicketAlertInputSchema, cancelledGuestTicketAlertCountSchema, guestTicketAlertInputSchema, guestTicketAlertResponseSchema, guestTicketAlertsStorageSchema, guestTicketAlertTokenSchema, nullableTicketAlertSubscriptionSchema, ticketAlertMovieIdSchema, ticketAlertShowtimePageSchema, ticketAlertStateInputSchema, userTicketAlertSubscriptionRowsSchema, type GuestTicketAlertActionOptions, type StoredGuestTicketAlert, type TicketAlertActionOptions, type TicketAlertShowtime, type TicketAlertStateOptions, type TicketAlertSubscriptionRow, type UserTicketAlertSubscription, type ValidatedTicketAlertStateOptions } from "./ticketAlertSchemas";

export type { UserTicketAlertSubscription } from "./ticketAlertSchemas";

const TICKET_ALERTS_TABLE_NAME = "ticket_alert_subscriptions";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
const SUPABASE_PAGE_SIZE = 1_000;
export const GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-token.v1";
export const GUEST_TICKET_ALERTS_STORAGE_KEY =
  "kartiseret.ticket-alert-guest-subscriptions.v1";

export type GuestTicketAlert = StoredGuestTicketAlert & {
  tmdbId: string;
};

export type TicketAlertAvailability = TicketAlertShowtime & {
  path: string;
};

export type TicketAlertState = {
  availability: TicketAlertAvailability | null;
  guestEmail: string | null;
  guestSubscribed: boolean;
  notified: boolean;
  subscribed: boolean;
};

function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createGuestToken(): string {
  const cryptoApi = globalThis.crypto;

  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    throw new Error("Guest ticket alerts require secure browser randomness.");
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

function readGuestToken(storage: Storage): string | null {
  let rawToken: string | null;

  try {
    rawToken = storage.getItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY);
  } catch {
    throw new Error("Guest ticket alerts require readable browser storage.");
  }

  return rawToken === null
    ? null
    : parseBoundary(
        guestTicketAlertTokenSchema,
        rawToken,
        "stored guest ticket alert token",
      );
}

function getGuestToken(): string {
  const storage = getBrowserStorage();

  if (!storage) {
    throw new Error("Guest ticket alerts require browser storage.");
  }

  const existingToken = readGuestToken(storage);
  if (existingToken) {
    return existingToken;
  }

  const nextToken = createGuestToken();
  try {
    storage.setItem(GUEST_TICKET_ALERT_TOKEN_STORAGE_KEY, nextToken);
  } catch {
    throw new Error("Guest ticket alerts require writable browser storage.");
  }
  return nextToken;
}

function readGuestSubscriptions(): Record<string, StoredGuestTicketAlert> {
  const storage = getBrowserStorage();

  if (!storage) {
    return {};
  }

  try {
    return (
      safeParseJson(
        storage.getItem(GUEST_TICKET_ALERTS_STORAGE_KEY) ?? "{}",
        guestTicketAlertsStorageSchema,
      ) ?? {}
    );
  } catch {
    return {};
  }
}

function writeGuestSubscriptions(
  subscriptions: Record<string, StoredGuestTicketAlert>,
): void {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      GUEST_TICKET_ALERTS_STORAGE_KEY,
      JSON.stringify(subscriptions),
    );
  } catch {
    // Private browsing and quota errors should not break a successful RPC.
  }
}

export function loadGuestTicketAlert(tmdbId: string): GuestTicketAlert | null {
  const normalizedTmdbId = parseBoundary(
    ticketAlertMovieIdSchema,
    tmdbId,
    "guest ticket alert movie ID",
  ).toString();
  const stored = readGuestSubscriptions()[normalizedTmdbId];

  return stored ? { tmdbId: normalizedTmdbId, ...stored } : null;
}

function saveGuestTicketAlert(
  tmdbId: string,
  alert: StoredGuestTicketAlert,
): void {
  const subscriptions = readGuestSubscriptions();
  subscriptions[tmdbId] = alert;
  writeGuestSubscriptions(subscriptions);
}

function removeGuestTicketAlert(tmdbId: string): void {
  const subscriptions = readGuestSubscriptions();
  delete subscriptions[tmdbId];
  writeGuestSubscriptions(subscriptions);
}

type SelectedTicketShowtime = TicketAlertShowtime;

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
  rows: readonly TicketAlertShowtime[],
  preferredCity: string,
  instant: Date = new Date(),
): SelectedTicketShowtime | null {
  let earliestPreferred: SelectedTicketShowtime | null = null;
  let earliestAnywhere: SelectedTicketShowtime | null = null;

  for (const candidate of rows) {
    if (!shouldIncludeShowtime(candidate.date, candidate.time, instant)) {
      continue;
    }

    if (
      !earliestAnywhere ||
      compareSelectedShowtimes(candidate, earliestAnywhere) < 0
    ) {
      earliestAnywhere = candidate;
    }

    if (
      candidate.city === preferredCity &&
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
  const codeResult = movieCodeSchema.safeParse(movieCode);

  if (!codeResult.success) {
    return "/showtimes";
  }

  const plainMoviePath = `/${codeResult.data}`;
  const cinemaToday = getJerusalemCinemaDate(instant);

  if (!isDateInShowtimeLinkWindow(showtime.date, cinemaToday)) {
    return plainMoviePath;
  }

  return (
    buildMovieShowtimeSharePath({
      movieCode: codeResult.data,
      city: showtime.city,
      date: showtime.date,
      filterMask: 0,
    }) ?? plainMoviePath
  );
}

async function loadLinkedShowtimeRows(
  supabase: SupabaseClient,
  tmdbId: number,
  instant: Date,
): Promise<TicketAlertShowtime[]> {
  const allRows: TicketAlertShowtime[] = [];
  const earliestCinemaDate = getJerusalemCinemaDate(instant);
  let fromIndex = 0;

  while (true) {
    const { data, error } = await supabase
      .from(SHOWTIMES_TABLE_NAME)
      .select(
        "id,tmdb_id,screening_city,date_of_showing,showtime,cinema,english_href,hebrew_href",
      )
      .eq("tmdb_id", tmdbId)
      .gte("date_of_showing", earliestCinemaDate)
      .order("date_of_showing", { ascending: true })
      .order("showtime", { ascending: true })
      .order("id", { ascending: true })
      .range(fromIndex, fromIndex + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Could not check ticket availability: ${error.message}`);
    }

    const pageRows = parseBoundary(
      ticketAlertShowtimePageSchema,
      data ?? [],
      "ticket alert showtime page",
    );
    allRows.push(...pageRows.filter((row) => row !== null));

    // Count the original page, including skipped rows, to preserve pagination.
    if (pageRows.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    fromIndex += SUPABASE_PAGE_SIZE;
  }

  return allRows;
}

async function loadSubscription(
  supabase: SupabaseClient,
  userId: string,
  tmdbId: number,
): Promise<TicketAlertSubscriptionRow | null> {
  const { data, error } = await supabase
    .from(TICKET_ALERTS_TABLE_NAME)
    .select("user_id,tmdb_id,created_at,notified_at")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load this ticket alert: ${error.message}`);
  }

  const subscription = parseBoundary(
    nullableTicketAlertSubscriptionSchema,
    data,
    "ticket alert subscription",
  );

  if (
    subscription &&
    (subscription.user_id !== userId || subscription.tmdb_id !== String(tmdbId))
  ) {
    throw new Error(
      "Ticket alert response did not match the requested account and movie.",
    );
  }

  return subscription;
}

export async function loadUserTicketAlertSubscriptions(
  userId: string,
): Promise<UserTicketAlertSubscription[]> {
  const validatedUserId = parseBoundary(
    supabaseUserIdSchema,
    userId,
    "ticket alert account ID",
  );
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from(TICKET_ALERTS_TABLE_NAME)
    .select("tmdb_id,created_at,notified_at,delivery_title,delivery_date")
    .eq("user_id", validatedUserId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Could not load your ticket alerts: ${error.message}`);
  }

  return parseBoundary(
    userTicketAlertSubscriptionRowsSchema,
    data ?? [],
    "account ticket alert rows",
  );
}

async function loadValidatedTicketAlertState({
  movieCode,
  preferredCity,
  tmdbId,
  userId,
}: ValidatedTicketAlertStateOptions): Promise<TicketAlertState> {
  const supabase = getSupabaseBrowserClient();
  const instant = new Date();
  const guestSubscription = userId
    ? null
    : readGuestSubscriptions()[String(tmdbId)];
  const subscriptionPromise = userId
    ? loadSubscription(supabase, userId, tmdbId)
    : Promise.resolve(null);
  const showtimeRowsPromise = loadLinkedShowtimeRows(supabase, tmdbId, instant);
  const [subscription, showtimeRows] = await Promise.all([
    subscriptionPromise,
    showtimeRowsPromise,
  ]);
  const selectedShowtime = selectTicketAlertShowtime(
    showtimeRows,
    preferredCity,
    instant,
  );

  return {
    availability: selectedShowtime
      ? {
          ...selectedShowtime,
          path: buildTicketAlertShowtimePath(
            movieCode,
            selectedShowtime,
            instant,
          ),
        }
      : null,
    guestEmail: guestSubscription?.email ?? null,
    guestSubscribed: Boolean(guestSubscription),
    notified: Boolean(subscription?.notified_at),
    subscribed: Boolean(subscription && !subscription.notified_at),
  };
}

export async function loadTicketAlertState(
  options: TicketAlertStateOptions,
): Promise<TicketAlertState> {
  const input = parseBoundary(
    ticketAlertStateInputSchema,
    options,
    "ticket alert state input",
  );
  return loadValidatedTicketAlertState(input);
}

export async function subscribeToTicketAlert(
  options: TicketAlertActionOptions,
): Promise<TicketAlertState> {
  const input = parseBoundary(
    accountTicketAlertInputSchema,
    options,
    "account ticket alert input",
  );
  const currentState = await loadValidatedTicketAlertState(input);

  if (
    currentState.availability ||
    currentState.subscribed ||
    currentState.notified
  ) {
    return currentState;
  }

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from(TICKET_ALERTS_TABLE_NAME).insert({
    user_id: input.userId,
    tmdb_id: input.tmdbId,
  });

  if (error && error.code !== "23505") {
    throw new Error(`Could not create this ticket alert: ${error.message}`);
  }

  return {
    availability: null,
    guestEmail: null,
    guestSubscribed: false,
    notified: false,
    subscribed: true,
  };
}

export async function cancelTicketAlert(
  userId: string,
  tmdbId: string,
): Promise<void> {
  const input = parseBoundary(
    accountTicketAlertIdentitySchema,
    { userId, tmdbId },
    "ticket alert cancellation input",
  );
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from(TICKET_ALERTS_TABLE_NAME)
    .delete()
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.tmdbId);

  if (error) {
    throw new Error(`Could not cancel this ticket alert: ${error.message}`);
  }
}

export async function subscribeGuestToTicketAlert(
  options: GuestTicketAlertActionOptions,
): Promise<TicketAlertState> {
  const input = parseBoundary(
    guestTicketAlertInputSchema,
    options,
    "guest ticket alert input",
  );
  const currentState = await loadValidatedTicketAlertState({
    ...input,
    userId: null,
  });

  if (currentState.availability) {
    return currentState;
  }

  const guestToken = getGuestToken();
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("create_guest_ticket_alert", {
    p_guest_token: guestToken,
    p_tmdb_id: input.tmdbId,
    p_email: input.email,
    p_preferred_city: input.preferredCity,
  });

  if (error) {
    throw new Error(`Could not create this ticket alert: ${error.message}`);
  }

  const [createdAlert] = parseBoundary(
    guestTicketAlertResponseSchema,
    data,
    "guest ticket alert response",
  );
  if (
    createdAlert.guest_token !== guestToken ||
    createdAlert.tmdb_id !== String(input.tmdbId)
  ) {
    throw new Error(
      "Guest ticket alert response did not match the requested browser and movie.",
    );
  }

  saveGuestTicketAlert(createdAlert.tmdb_id, {
    email: createdAlert.email,
    subscribedAt: createdAlert.created_at,
  });
  return {
    availability: null,
    guestEmail: createdAlert.email,
    guestSubscribed: !createdAlert.notified_at,
    notified: Boolean(createdAlert.notified_at),
    subscribed: false,
  };
}

export async function cancelGuestTicketAlert(tmdbId: string): Promise<void> {
  const normalizedTmdbId = parseBoundary(
    ticketAlertMovieIdSchema,
    tmdbId,
    "guest ticket alert cancellation ID",
  );
  const storage = getBrowserStorage();

  if (!storage) {
    throw new Error("Guest ticket alerts require browser storage to cancel.");
  }

  const guestToken = readGuestToken(storage);

  if (guestToken) {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("cancel_guest_ticket_alert", {
      p_guest_token: guestToken,
      p_tmdb_id: normalizedTmdbId,
    });

    if (error) {
      throw new Error(`Could not cancel this ticket alert: ${error.message}`);
    }

    parseBoundary(
      cancelledGuestTicketAlertCountSchema,
      data,
      "guest ticket alert cancellation response",
    );
  } else if (readGuestSubscriptions()[String(normalizedTmdbId)]) {
    throw new Error(
      "The browser token for this guest ticket alert is missing; cancellation could not be confirmed.",
    );
  }

  removeGuestTicketAlert(String(normalizedTmdbId));
}
