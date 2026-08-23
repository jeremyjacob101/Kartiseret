import type { SupabaseClient } from "@supabase/supabase-js";
import { getShowtimeSortValue, shouldIncludeShowtime } from "../domain/showtimeDay";
import { getSupabaseBrowserClient } from "../lib/supabase";
import { buildMovieShowtimeShareUrl, getJerusalemCinemaDate, isDateInShowtimeLinkWindow } from "../routing/showtimeLinkCodec";

const TICKET_ALERTS_TABLE_NAME = "ticket_alert_subscriptions";
const SHOWTIMES_TABLE_NAME = "finalShowtimes";
const SUPABASE_PAGE_SIZE = 1_000;
const MOVIE_CODE_PATTERN = /^[0-9A-Za-z]{3}$/;

type TicketAlertSubscriptionRow = {
  user_id: string;
  tmdb_id: string | number;
  created_at: string;
  notified_at: string | null;
};

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

export type TicketAlertState = {
  availability: TicketAlertAvailability | null;
  notified: boolean;
  subscribed: boolean;
};

type TicketAlertStateOptions = {
  movieCode?: string;
  preferredCity: string;
  tmdbId: string;
  userId: string | null;
};

type TicketAlertActionOptions = Omit<TicketAlertStateOptions, "userId"> & {
  userId: string;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTmdbId(tmdbId: string): number {
  const parsedTmdbId = Number.parseInt(tmdbId, 10);

  if (!Number.isSafeInteger(parsedTmdbId) || parsedTmdbId <= 0) {
    throw new Error("This movie cannot be used for ticket alerts.");
  }

  return parsedTmdbId;
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

async function loadLinkedShowtimeRows(
  supabase: SupabaseClient,
  tmdbId: number,
  instant: Date,
): Promise<TicketAlertShowtimeRow[]> {
  const allRows: TicketAlertShowtimeRow[] = [];
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

    const pageRows = (data ?? []) as TicketAlertShowtimeRow[];
    allRows.push(...pageRows);

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

  return data as TicketAlertSubscriptionRow | null;
}

export async function loadTicketAlertState({
  movieCode,
  preferredCity,
  tmdbId,
  userId,
}: TicketAlertStateOptions): Promise<TicketAlertState> {
  const normalizedTmdbId = normalizeTmdbId(tmdbId);
  const supabase = getSupabaseBrowserClient();
  const instant = new Date();
  const subscriptionPromise = userId
    ? loadSubscription(supabase, userId, normalizedTmdbId)
    : Promise.resolve(null);
  const showtimeRowsPromise = loadLinkedShowtimeRows(
    supabase,
    normalizedTmdbId,
    instant,
  );
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
    notified: Boolean(subscription?.notified_at),
    subscribed: Boolean(subscription && !subscription.notified_at),
  };
}

export async function subscribeToTicketAlert({
  movieCode,
  preferredCity,
  tmdbId,
  userId,
}: TicketAlertActionOptions): Promise<TicketAlertState> {
  const normalizedTmdbId = normalizeTmdbId(tmdbId);
  const currentState = await loadTicketAlertState({
    movieCode,
    preferredCity,
    tmdbId,
    userId,
  });

  if (
    currentState.availability ||
    currentState.subscribed ||
    currentState.notified
  ) {
    return currentState;
  }

  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from(TICKET_ALERTS_TABLE_NAME).insert({
    user_id: userId,
    tmdb_id: normalizedTmdbId,
  });

  if (error && error.code !== "23505") {
    throw new Error(`Could not create this ticket alert: ${error.message}`);
  }

  return {
    availability: null,
    notified: false,
    subscribed: true,
  };
}

export async function cancelTicketAlert(
  userId: string,
  tmdbId: string,
): Promise<void> {
  const normalizedTmdbId = normalizeTmdbId(tmdbId);
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase
    .from(TICKET_ALERTS_TABLE_NAME)
    .delete()
    .eq("user_id", userId)
    .eq("tmdb_id", normalizedTmdbId);

  if (error) {
    throw new Error(`Could not cancel this ticket alert: ${error.message}`);
  }
}
