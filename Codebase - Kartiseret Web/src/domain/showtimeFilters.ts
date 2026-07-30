import { isCanonicalShowtimeFilterMatch, SHOWTIME_FILTER_OPTIONS, type PersistedShowtimeFilterState, type ShowtimeFilterGroup } from "../routing/showtimeLinkCodec.js";

const COLLAPSE_WHITESPACE = /\s+/g;
const WARNED_UNSUPPORTED_SHOW_TYPES = new Set<string>();
const WARNED_UNSUPPORTED_DUB_LANGUAGES = new Set<string>();

type SavedUncheckedGroups = Record<ShowtimeFilterGroup, string[]>;

const DEFAULT_SAVED_UNCHECKED: SavedUncheckedGroups = {
  showType: [],
  screenFormat: [],
  screeningTech: [],
  dubLanguage: [],
};

export type ShowtimeFilterState = PersistedShowtimeFilterState;

export type ShowtimeFilterSelections = {
  showType: ReadonlySet<string>;
  screenFormat: ReadonlySet<string>;
  screeningTech: ReadonlySet<string>;
  dubLanguage: ReadonlySet<string>;
};

export type CanonicalShowtimeMeta = {
  showTypeTokens: readonly string[];
  screenFormatToken: string;
  screeningTechTokens: readonly string[];
  dubLanguage: string;
};

export type ShowtimeFilterOptions = {
  showType: readonly string[];
  screenFormat: readonly string[];
  screeningTech: readonly string[];
  dubLanguage: readonly string[];
};

export type FilterableShowtime = {
  time: string;
  screeningTech: string;
  screeningType: string;
  dubLanguage: string | null;
};

export type FilterableTheater<Showtime extends FilterableShowtime> = {
  theater: string;
  showtimes: readonly Showtime[];
};

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(COLLAPSE_WHITESPACE, " ") ?? "";
}

export function cloneUncheckedGroups(
  unchecked?: Partial<SavedUncheckedGroups>,
): SavedUncheckedGroups {
  return {
    showType: [...(unchecked?.showType ?? [])],
    screenFormat: [...(unchecked?.screenFormat ?? [])],
    screeningTech: [...(unchecked?.screeningTech ?? [])],
    dubLanguage: [...(unchecked?.dubLanguage ?? [])],
  };
}

function normalizeUniqueList(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => normalizeText(value)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

export function normalizeScreeningType(raw: string): string {
  const normalizedRaw = normalizeText(raw);
  return normalizedRaw || "Regular";
}

function getShowTypeTokens(raw: string): string[] {
  const normalizedType = normalizeScreeningType(raw);
  const comparableType = normalizedType.toLowerCase();

  if (comparableType === "premium") {
    return ["Premium"];
  }

  if (comparableType === "not just cinema") {
    return ["Not Just Cinema"];
  }

  const words = normalizedType
    .toUpperCase()
    .split(/[+\s/,-]+/)
    .filter(Boolean);
  const wordSet = new Set(words);
  const tokens = new Set<string>();

  if (wordSet.has("REGULAR")) tokens.add("Regular");
  if (wordSet.has("UPGRADE")) tokens.add("Upgrade");
  if (wordSet.has("PRIME")) tokens.add("Prime");
  if (wordSet.has("LOUNGE")) tokens.add("Lounge");
  if (wordSet.has("VIP")) tokens.add("VIP");

  if (wordSet.has("LIGHT")) {
    tokens.add("VIP Light");
    tokens.add("VIP");
  }

  if (wordSet.has("BUSINESS")) {
    tokens.add("VIP");
  }

  if (tokens.size === 0) {
    if (!WARNED_UNSUPPORTED_SHOW_TYPES.has(normalizedType)) {
      WARNED_UNSUPPORTED_SHOW_TYPES.add(normalizedType);
      console.warn(
        `Unsupported screening type "${normalizedType}" is not exposed as a showtime filter.`,
      );
    }

    return [];
  }

  return [...tokens];
}

export function normalizeScreeningTech(raw: string): string {
  const normalizedRaw = normalizeText(raw);
  return normalizedRaw || "2D";
}

function normalizeScreeningTechToken(raw: string): string {
  const normalizedRaw = normalizeText(raw);

  if (!normalizedRaw) return "";

  const upperValue = normalizedRaw.toUpperCase();

  if (upperValue === "IMAX") return "IMAX";
  if (upperValue === "HFR") return "HFR";
  if (upperValue === "SCREENX") return "ScreenX";
  if (upperValue === "4DX") return "4DX";
  if (upperValue === "ONYX") return "ONYX";
  if (upperValue === "ATMOS") return "Atmos";
  if (upperValue === "2D" || upperValue === "3D") return upperValue;

  return "";
}

function getScreeningTechParts(raw: string): {
  screenFormatToken: string;
  screeningTechTokens: string[];
} {
  const normalizedTech = normalizeScreeningTech(raw);
  const tokens = normalizedTech
    .split(/[+\s/,-]+/)
    .map((value) => normalizeScreeningTechToken(value))
    .filter(Boolean);
  const screenFormatToken = tokens.includes("3D") ? "3D" : "2D";
  const premiumTokens = tokens.filter(
    (token) => token !== "2D" && token !== "3D" && token !== "Standard",
  );

  return {
    screenFormatToken,
    screeningTechTokens:
      premiumTokens.length > 0 ? [...new Set(premiumTokens)] : ["Standard"],
  };
}

function normalizeDubLanguage(raw: string | null | undefined): string {
  const normalizedRaw = normalizeText(raw);

  if (!normalizedRaw) return "Original";

  const comparableValue = normalizedRaw.toLowerCase();

  if (comparableValue === "hebrew") return "Hebrew";
  if (comparableValue === "french") return "French";
  if (comparableValue === "original") return "Original";

  if (!WARNED_UNSUPPORTED_DUB_LANGUAGES.has(normalizedRaw)) {
    WARNED_UNSUPPORTED_DUB_LANGUAGES.add(normalizedRaw);
    console.warn(
      `Unsupported dub language "${normalizedRaw}" is not exposed as a showtime filter.`,
    );
  }

  return normalizedRaw;
}

export function getCanonicalShowtimeMeta(
  showtime: FilterableShowtime,
): CanonicalShowtimeMeta {
  const screeningTechParts = getScreeningTechParts(showtime.screeningTech);

  return {
    showTypeTokens: getShowTypeTokens(showtime.screeningType),
    screenFormatToken: screeningTechParts.screenFormatToken,
    screeningTechTokens: screeningTechParts.screeningTechTokens,
    dubLanguage: normalizeDubLanguage(showtime.dubLanguage),
  };
}

export function getShowtimeFilterOptions(
  theaters: readonly FilterableTheater<FilterableShowtime>[],
): ShowtimeFilterOptions {
  for (const theater of theaters) {
    for (const showtime of theater.showtimes) {
      getCanonicalShowtimeMeta(showtime);
    }
  }

  return SHOWTIME_FILTER_OPTIONS;
}

export function buildShowtimeFilterSelections(
  options: ShowtimeFilterOptions,
  state: ShowtimeFilterState | null,
): ShowtimeFilterSelections {
  const unchecked = state?.unchecked ?? DEFAULT_SAVED_UNCHECKED;
  const toSelectedSet = (
    groupOptions: readonly string[],
    uncheckedValues: readonly string[],
  ): Set<string> => {
    const uncheckedSet = new Set(uncheckedValues);
    return new Set(groupOptions.filter((option) => !uncheckedSet.has(option)));
  };

  return {
    showType: toSelectedSet(options.showType, unchecked.showType),
    screenFormat: toSelectedSet(options.screenFormat, unchecked.screenFormat),
    screeningTech: toSelectedSet(
      options.screeningTech,
      unchecked.screeningTech,
    ),
    dubLanguage: toSelectedSet(options.dubLanguage, unchecked.dubLanguage),
  };
}

export function filterTheatersBySelections<Showtime extends FilterableShowtime>(
  theaters: readonly FilterableTheater<Showtime>[],
  selections: ShowtimeFilterSelections,
): Array<{ theater: string; showtimes: Showtime[] }> {
  return theaters.flatMap((theater) => {
    const showtimes = theater.showtimes.filter((showtime) =>
      isCanonicalShowtimeFilterMatch(
        getCanonicalShowtimeMeta(showtime),
        selections,
      ));

    return showtimes.length > 0
      ? [{ theater: theater.theater, showtimes }]
      : [];
  });
}

export function updateShowtimeFilterState(
  previousState: ShowtimeFilterState | null,
  options: ShowtimeFilterOptions,
  nextSelections: ShowtimeFilterSelections,
): ShowtimeFilterState {
  const previousUnchecked = cloneUncheckedGroups(previousState?.unchecked);
  const nextUncheckedForGroup = (
    group: ShowtimeFilterGroup,
    groupOptions: readonly string[],
    selectedValues: ReadonlySet<string>,
  ): string[] => {
    const nextUncheckedSet = new Set(previousUnchecked[group]);

    for (const option of groupOptions) {
      nextUncheckedSet.delete(option);

      if (!selectedValues.has(option)) {
        nextUncheckedSet.add(option);
      }
    }

    return normalizeUniqueList([...nextUncheckedSet]);
  };

  return {
    version: 3,
    unchecked: {
      showType: nextUncheckedForGroup(
        "showType",
        options.showType,
        nextSelections.showType,
      ),
      screenFormat: nextUncheckedForGroup(
        "screenFormat",
        options.screenFormat,
        nextSelections.screenFormat,
      ),
      screeningTech: nextUncheckedForGroup(
        "screeningTech",
        options.screeningTech,
        nextSelections.screeningTech,
      ),
      dubLanguage: nextUncheckedForGroup(
        "dubLanguage",
        options.dubLanguage,
        nextSelections.dubLanguage,
      ),
    },
  };
}
