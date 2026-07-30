export const SHOWTIME_TIME_ZONE = "Asia/Jerusalem";
export const SHOWTIME_DAY_CUTOFF_MINUTES = 65;
export const SHOWTIME_GRACE_PERIOD_MINUTES = 15;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ZonedDateTimeParts = {
  date: string;
  hour: number;
  minute: number;
};

function parseIsoDateParts(dateString: string): {
  day: number;
  month: number;
  year: number;
} | null {
  const match = ISO_DATE_PATTERN.exec(dateString);

  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? { day, month, year }
    : null;
}

function formatUtcDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addShowtimeCalendarDays(
  dateString: string,
  dayOffset: number,
): string | null {
  const parts = parseIsoDateParts(dateString);

  if (!parts || !Number.isInteger(dayOffset)) {
    return null;
  }

  return formatUtcDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset)),
  );
}

export function getZonedDateTimeParts(
  timeZone: string,
  instant: Date = new Date(),
): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "",
    10,
  );
  const date = `${year}-${month}-${day}`;

  if (
    !parseIsoDateParts(date) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return {
      date: formatUtcDate(instant),
      hour: instant.getUTCHours(),
      minute: instant.getUTCMinutes(),
    };
  }

  return { date, hour, minute };
}

export function getCinemaDayDate(
  instant: Date = new Date(),
  timeZone = SHOWTIME_TIME_ZONE,
): string {
  const parts = getZonedDateTimeParts(timeZone, instant);

  if (parts.hour * 60 + parts.minute >= SHOWTIME_DAY_CUTOFF_MINUTES) {
    return parts.date;
  }

  return addShowtimeCalendarDays(parts.date, -1) ?? parts.date;
}

export function parseShowtimeMinutes(showtime: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(showtime.trim());

  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1] ?? "", 10);
  const minute = Number.parseInt(match[2] ?? "", 10);

  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? hour * 60 + minute
    : null;
}

export function isPostMidnightCarryoverShowtime(showtime: string): boolean {
  const minutes = parseShowtimeMinutes(showtime);
  return minutes !== null && minutes < SHOWTIME_DAY_CUTOFF_MINUTES;
}

export function getEffectiveShowtimeDate(
  cinemaDayDate: string,
  showtime: string,
): string | null {
  if (
    !parseIsoDateParts(cinemaDayDate) ||
    parseShowtimeMinutes(showtime) === null
  ) {
    return null;
  }

  return isPostMidnightCarryoverShowtime(showtime)
    ? addShowtimeCalendarDays(cinemaDayDate, 1)
    : cinemaDayDate;
}

export function shouldIncludeShowtime(
  cinemaDayDate: string,
  showtime: string,
  instant: Date = new Date(),
  timeZone = SHOWTIME_TIME_ZONE,
): boolean {
  const showtimeMinutes = parseShowtimeMinutes(showtime);
  const effectiveDate = getEffectiveShowtimeDate(cinemaDayDate, showtime);

  if (showtimeMinutes === null || !effectiveDate) {
    return false;
  }

  const now = getZonedDateTimeParts(timeZone, instant);

  if (effectiveDate > now.date) {
    return true;
  }

  if (effectiveDate < now.date) {
    return false;
  }

  return (
    showtimeMinutes + SHOWTIME_GRACE_PERIOD_MINUTES >=
    now.hour * 60 + now.minute
  );
}

export function getShowtimeSortValue(showtime: string): number {
  const minutes = parseShowtimeMinutes(showtime);

  if (minutes === null) {
    return Number.POSITIVE_INFINITY;
  }

  return isPostMidnightCarryoverShowtime(showtime)
    ? minutes + 24 * 60
    : minutes;
}
