export const URL_ALPHABET =
  "1iljIt23457fkrsvxyzFJLT0689abcdeghnopquABCDEGHKNOPQRSUVXYZmwMW";
export const DATE_CODE_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const SHOWTIME_LINK_TIME_ZONE = "Asia/Jerusalem";
export const SHOWTIME_LINK_DATE_COUNT = 62;
export const SHOWTIME_FILTER_MASK_WIDTH = 4;
export const SHOWTIME_FILTER_BIT_COUNT = 20;
export const SHOWTIME_FILTER_CAPACITY_BIT_COUNT = 23;
export const CURRENT_CITY_CODE = "1";
export const ALL_FILTERS_SHORTCUT = "j";
export const EDIT_MODE_MARKER = "i";

const MILLISECONDS_PER_DAY = 86_400_000;
const MOVIE_CODE_PATTERN = /^[0-9A-Za-z]{3}$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const URL_ALPHABET_INDEX = new Map(
  [...URL_ALPHABET].map((character, index) => [character, index] as const),
);
const DATE_CODE_ALPHABET_INDEX = new Map(
  [...DATE_CODE_ALPHABET].map(
    (character, index) => [character, index] as const,
  ),
);

export const SHOWTIME_FILTER_OPTIONS = Object.freeze({
  showType: Object.freeze([
    "Regular",
    "VIP",
    "VIP Light",
    "Upgrade",
    "Prime",
    "Lounge",
    "Premium",
    "Not Just Cinema",
  ]),
  screeningTech: Object.freeze([
    "Standard",
    "HFR",
    "IMAX",
    "Atmos",
    "ONYX",
    "ScreenX",
    "4DX",
  ]),
  screenFormat: Object.freeze(["2D", "3D"]),
  dubLanguage: Object.freeze(["Original", "Hebrew", "French"]),
});

export type ShowtimeFilterGroup = keyof typeof SHOWTIME_FILTER_OPTIONS;

export type EncodedUncheckedFilters = Record<
  ShowtimeFilterGroup,
  readonly string[]
>;

export type PersistedShowtimeFilterState = {
  version: 3;
  unchecked: Record<ShowtimeFilterGroup, string[]>;
};

export type CanonicalShowtimeFilterMetadata = {
  showTypeTokens: readonly string[];
  screenFormatToken: string;
  screeningTechTokens: readonly string[];
  dubLanguage: string;
};

export type CanonicalShowtimeFilterSelections = Record<
  ShowtimeFilterGroup,
  ReadonlySet<string>
>;

type FilterBitAssignment = {
  bit: number;
  group: ShowtimeFilterGroup;
  value: string;
};

export const SHOWTIME_FILTER_BIT_ASSIGNMENTS: readonly FilterBitAssignment[] =
  Object.freeze(
    (
      [
        { bit: 0, group: "showType", value: "Not Just Cinema" },
        { bit: 1, group: "showType", value: "Premium" },
        { bit: 2, group: "showType", value: "Lounge" },
        { bit: 3, group: "showType", value: "Prime" },
        { bit: 4, group: "showType", value: "Upgrade" },
        { bit: 5, group: "showType", value: "VIP Light" },
        { bit: 6, group: "showType", value: "VIP" },
        { bit: 7, group: "screeningTech", value: "4DX" },
        { bit: 8, group: "screeningTech", value: "ScreenX" },
        { bit: 9, group: "screeningTech", value: "ONYX" },
        { bit: 10, group: "screeningTech", value: "Atmos" },
        { bit: 11, group: "screeningTech", value: "HFR" },
        { bit: 12, group: "screenFormat", value: "3D" },
        { bit: 13, group: "dubLanguage", value: "French" },
        { bit: 14, group: "dubLanguage", value: "Hebrew" },
        { bit: 15, group: "screeningTech", value: "IMAX" },
        { bit: 16, group: "dubLanguage", value: "Original" },
        { bit: 17, group: "screenFormat", value: "2D" },
        { bit: 18, group: "screeningTech", value: "Standard" },
        { bit: 19, group: "showType", value: "Regular" },
      ] satisfies FilterBitAssignment[]
    ).map((assignment) => Object.freeze(assignment)),
  );

export const CITY_BY_CODE = Object.freeze({
  i: "Jerusalem",
  l: "Tel Aviv",
  j: "Glilot",
  I: "Modiin",
  t: "Herziliya",
  "2": "Afula",
  "3": "Ashdod",
  "4": "Ashkelon",
  "5": "Ayalon",
  "7": "Beer Sheva",
  f: "Carmiel",
  k: "Chadera",
  r: "Even Yehuda",
  s: "Givatayim",
  v: "Haifa",
  x: "Kfar Saba",
  y: "Kiryat Bialik",
  z: "Kiryat Ono",
  F: "Nahariya",
  J: "Netanya",
  L: "Omer",
  T: "Petach Tikvah",
  "0": "Raanana",
  "6": "Ramat Hasharon",
  "8": "Rehovot",
  "9": "Rishon Letzion",
  a: "Zichron Yaakov",
  b: "Holon",
});

export const CITY_CODE_BY_NAME: Readonly<Record<string, string>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(CITY_BY_CODE).map(([code, city]) => [city, code]),
    ),
  );

export type MovieRouteMode = "share" | "edit";

export type ParsedMovieRoute =

    | {
        kind: "plain";
        movieCode: string;
      }
    | {
        kind: "encoded";
        movieCode: string;
        cityCode: string;
        dateCode: string;
        filterMask: number;
        mode: MovieRouteMode;
        usedFilterShortcut: boolean;
      };

export type EncodedMovieRouteState = {
  movieCode: string;
  cityCode: string;
  dateCode: string;
  filterMask: number;
  mode: MovieRouteMode;
};

function normalizeFilterValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUniqueFilterList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map(normalizeFilterValue)
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

export function migrateShowtimeFilterState(
  value: unknown,
): PersistedShowtimeFilterState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    version?: unknown;
    unchecked?: Partial<Record<ShowtimeFilterGroup, unknown>>;
  };

  if (
    candidate.version !== 1 &&
    candidate.version !== 2 &&
    candidate.version !== 3
  ) {
    return null;
  }

  const unchecked = candidate.unchecked;
  const rawScreeningTech = normalizeUniqueFilterList(unchecked?.screeningTech);
  const screenFormat =
    candidate.version === 1
      ? rawScreeningTech.filter((entry) => entry === "2D" || entry === "3D")
      : normalizeUniqueFilterList(unchecked?.screenFormat);

  return {
    version: 3,
    unchecked: {
      showType: normalizeUniqueFilterList(unchecked?.showType),
      screeningTech:
        candidate.version === 1
          ? rawScreeningTech.filter((entry) => entry !== "2D" && entry !== "3D")
          : rawScreeningTech,
      screenFormat,
      dubLanguage: normalizeUniqueFilterList(unchecked?.dubLanguage),
    },
  };
}

export function isCanonicalShowtimeFilterMatch(
  metadata: CanonicalShowtimeFilterMetadata,
  selections: CanonicalShowtimeFilterSelections,
): boolean {
  return (
    metadata.showTypeTokens.length > 0 &&
    metadata.showTypeTokens.some((token) => selections.showType.has(token)) &&
    selections.screenFormat.has(metadata.screenFormatToken) &&
    metadata.screeningTechTokens.length > 0 &&
    metadata.screeningTechTokens.some((token) =>
      selections.screeningTech.has(token)) &&
    selections.dubLanguage.has(metadata.dubLanguage)
  );
}

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
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { day, month, year };
}

function formatUtcCalendarDate(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function addCalendarDays(
  dateString: string,
  dayOffset: number,
): string | null {
  const parts = parseIsoDateParts(dateString);

  if (!parts || !Number.isInteger(dayOffset)) {
    return null;
  }

  return formatUtcCalendarDate(
    new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset)),
  );
}

export type TargetedShowtimePrefetchRange = {
  startDate: string;
  endDate: string;
};

type TargetedShowtimePrefetchRangeOptions = {
  previewDate: string;
  windowStartDate: string;
  windowEndDate: string;
  chunkDayCount: number;
  triggerDayCount: number;
  isDateCovered: (date: string) => boolean;
};

export function getTargetedShowtimePrefetchRange({
  previewDate,
  windowStartDate,
  windowEndDate,
  chunkDayCount,
  triggerDayCount,
  isDateCovered,
}: TargetedShowtimePrefetchRangeOptions): TargetedShowtimePrefetchRange | null {
  if (
    previewDate < windowStartDate ||
    previewDate > windowEndDate ||
    chunkDayCount <= 0 ||
    triggerDayCount <= 0 ||
    triggerDayCount > chunkDayCount ||
    !isDateCovered(previewDate)
  ) {
    return null;
  }

  let firstUncoveredDate = previewDate;
  let coveredDateCount = 0;

  while (
    firstUncoveredDate <= windowEndDate &&
    isDateCovered(firstUncoveredDate)
  ) {
    coveredDateCount += 1;
    const nextDate = addCalendarDays(firstUncoveredDate, 1);

    if (!nextDate) {
      return null;
    }

    firstUncoveredDate = nextDate;
  }

  const prefetchRemainingDayThreshold = chunkDayCount - triggerDayCount + 1;

  if (
    firstUncoveredDate > windowEndDate ||
    coveredDateCount > prefetchRemainingDayThreshold
  ) {
    return null;
  }

  const requestedEndDate = addCalendarDays(
    firstUncoveredDate,
    chunkDayCount - 1,
  );

  return {
    startDate: firstUncoveredDate,
    endDate:
      requestedEndDate && requestedEndDate < windowEndDate
        ? requestedEndDate
        : windowEndDate,
  };
}

export function getCalendarDateInTimeZone(
  timeZone: string,
  instant: Date = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  const dateString = `${year}-${month}-${day}`;

  return parseIsoDateParts(dateString)
    ? dateString
    : formatUtcCalendarDate(instant);
}

export function getJerusalemCalendarDate(instant: Date = new Date()): string {
  return getCalendarDateInTimeZone(SHOWTIME_LINK_TIME_ZONE, instant);
}

export function encodeDateCode(dateString: string): string | null {
  const parts = parseIsoDateParts(dateString);

  if (!parts) {
    return null;
  }

  const epochDay = Math.floor(
    Date.UTC(parts.year, parts.month - 1, parts.day) / MILLISECONDS_PER_DAY,
  );
  const alphabetIndex =
    ((epochDay % DATE_CODE_ALPHABET.length) + DATE_CODE_ALPHABET.length) %
    DATE_CODE_ALPHABET.length;

  return DATE_CODE_ALPHABET[alphabetIndex] ?? null;
}

export function decodeDateCode(code: string, today: string): string | null {
  if (!DATE_CODE_ALPHABET_INDEX.has(code) || !parseIsoDateParts(today)) {
    return null;
  }

  for (let offset = 0; offset < SHOWTIME_LINK_DATE_COUNT; offset += 1) {
    const candidate = addCalendarDays(today, offset);

    if (candidate && encodeDateCode(candidate) === code) {
      return candidate;
    }
  }

  return null;
}

export function isDateInShowtimeLinkWindow(
  dateString: string,
  today: string,
): boolean {
  const lastDate = addCalendarDays(today, SHOWTIME_LINK_DATE_COUNT - 1);

  return Boolean(
    parseIsoDateParts(dateString) &&
    parseIsoDateParts(today) &&
    lastDate &&
    dateString >= today &&
    dateString <= lastDate,
  );
}

export function encodeBase62Fixed(value: number, width: number): string | null {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(width) ||
    width <= 0 ||
    value >= URL_ALPHABET.length ** width
  ) {
    return null;
  }

  let remaining = value;
  const digits = Array.from({ length: width }, () => URL_ALPHABET[0] ?? "");

  for (let index = width - 1; index >= 0; index -= 1) {
    digits[index] = URL_ALPHABET[remaining % URL_ALPHABET.length] ?? "";
    remaining = Math.floor(remaining / URL_ALPHABET.length);
  }

  return digits.join("");
}

export function decodeBase62(value: string): number | null {
  if (!value) {
    return null;
  }

  let decoded = 0;

  for (const character of value) {
    const digit = URL_ALPHABET_INDEX.get(character);

    if (digit === undefined) {
      return null;
    }

    decoded = decoded * URL_ALPHABET.length + digit;
  }

  return Number.isSafeInteger(decoded) ? decoded : null;
}

export function isSupportedFilterMask(mask: number): boolean {
  return (
    Number.isSafeInteger(mask) &&
    mask >= 0 &&
    mask < 2 ** SHOWTIME_FILTER_BIT_COUNT
  );
}

export function encodeFilterMask(mask: number): string | null {
  return isSupportedFilterMask(mask)
    ? encodeBase62Fixed(mask, SHOWTIME_FILTER_MASK_WIDTH)
    : null;
}

export function decodeFilterMask(value: string): number | null {
  if (value.length !== SHOWTIME_FILTER_MASK_WIDTH) {
    return null;
  }

  const mask = decodeBase62(value);
  return mask !== null && isSupportedFilterMask(mask) ? mask : null;
}

export function filterMaskFromUnchecked(
  unchecked: EncodedUncheckedFilters,
): number {
  const uncheckedSets: Record<ShowtimeFilterGroup, ReadonlySet<string>> = {
    showType: new Set(unchecked.showType),
    screeningTech: new Set(unchecked.screeningTech),
    screenFormat: new Set(unchecked.screenFormat),
    dubLanguage: new Set(unchecked.dubLanguage),
  };
  let mask = 0;

  for (const assignment of SHOWTIME_FILTER_BIT_ASSIGNMENTS) {
    if (uncheckedSets[assignment.group].has(assignment.value)) {
      mask += 2 ** assignment.bit;
    }
  }

  return mask;
}

export function uncheckedFromFilterMask(
  mask: number,
): EncodedUncheckedFilters | null {
  if (!isSupportedFilterMask(mask)) {
    return null;
  }

  const unchecked: Record<ShowtimeFilterGroup, string[]> = {
    showType: [],
    screeningTech: [],
    screenFormat: [],
    dubLanguage: [],
  };

  for (const assignment of SHOWTIME_FILTER_BIT_ASSIGNMENTS) {
    if ((mask & (2 ** assignment.bit)) !== 0) {
      unchecked[assignment.group].push(assignment.value);
    }
  }

  return unchecked;
}

export function parseMovieRouteCode(value: string): ParsedMovieRoute | null {
  if (value.length === 3) {
    return MOVIE_CODE_PATTERN.test(value)
      ? { kind: "plain", movieCode: value }
      : null;
  }

  if (![6, 7, 9, 10].includes(value.length)) {
    return null;
  }

  const movieCode = value.slice(0, 3);
  const cityCode = value[3] ?? "";
  const dateCode = value[4] ?? "";

  if (
    !MOVIE_CODE_PATTERN.test(movieCode) ||
    (cityCode !== CURRENT_CITY_CODE && !(cityCode in CITY_BY_CODE)) ||
    !DATE_CODE_ALPHABET_INDEX.has(dateCode)
  ) {
    return null;
  }

  const usesShortcut = value.length === 6 || value.length === 7;
  const mode: MovieRouteMode =
    value.length === 7 || value.length === 10 ? "edit" : "share";

  if (usesShortcut) {
    if (
      value[5] !== ALL_FILTERS_SHORTCUT ||
      (mode === "edit" && value[6] !== EDIT_MODE_MARKER)
    ) {
      return null;
    }

    return {
      kind: "encoded",
      movieCode,
      cityCode,
      dateCode,
      filterMask: 0,
      mode,
      usedFilterShortcut: true,
    };
  }

  if (mode === "edit" && value[9] !== EDIT_MODE_MARKER) {
    return null;
  }

  const filterMask = decodeFilterMask(value.slice(5, 9));

  return filterMask === null
    ? null
    : {
        kind: "encoded",
        movieCode,
        cityCode,
        dateCode,
        filterMask,
        mode,
        usedFilterShortcut: false,
      };
}

export function encodeMovieRouteCode(
  state: EncodedMovieRouteState,
): string | null {
  if (
    !MOVIE_CODE_PATTERN.test(state.movieCode) ||
    (state.cityCode !== CURRENT_CITY_CODE &&
      !(state.cityCode in CITY_BY_CODE)) ||
    !DATE_CODE_ALPHABET_INDEX.has(state.dateCode) ||
    !isSupportedFilterMask(state.filterMask)
  ) {
    return null;
  }

  const filterCode =
    state.filterMask === 0
      ? ALL_FILTERS_SHORTCUT
      : encodeFilterMask(state.filterMask);

  if (!filterCode) {
    return null;
  }

  return [
    state.movieCode,
    state.cityCode,
    state.dateCode,
    filterCode,
    state.mode === "edit" ? EDIT_MODE_MARKER : "",
  ].join("");
}

export function resolveCityCode(
  cityCode: string,
  currentCity: string,
): string | null {
  if (cityCode === CURRENT_CITY_CODE) {
    return currentCity;
  }

  return CITY_BY_CODE[cityCode as keyof typeof CITY_BY_CODE] ?? null;
}

export function getExplicitCityCode(city: string): string | null {
  return CITY_CODE_BY_NAME[city] ?? null;
}
