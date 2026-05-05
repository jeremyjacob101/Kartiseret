import { type ShowtimeEntry, type TheaterShowtimes } from "../../data/movieCatalog";

const SHOWTIME_FILTERS_STORAGE_KEY = "showtime_filters_v1";
const SHOWTIME_FILTERS_EVENT_NAME = "showtime-filters-updated";
const COLLAPSE_WHITESPACE = /\s+/g;

const FIXED_DUB_LANGUAGES = ["Hebrew", "French"] as const;
const SHOW_TYPE_OPTIONS = [
  "Regular",
  "VIP",
  "VIP Light",
  "Upgrade",
  "Prime",
  "Lounge",
] as const;
const SCREENING_TECH_OPTIONS = [
  "2D",
  "3D",
  "HFR",
  "IMAX",
  "Atmos",
  "ONYX",
  "ScreenX",
  "4DX",
] as const;

type FilterGroup = "showType" | "screeningTech" | "dubLanguage";

type SavedUncheckedGroups = Record<FilterGroup, string[]>;

const DEFAULT_SAVED_UNCHECKED: SavedUncheckedGroups = {
  showType: [],
  screeningTech: [],
  dubLanguage: [],
};

export type ShowtimeFilterState = {
  version: 1;
  unchecked: SavedUncheckedGroups;
};

export type ShowtimeFilterSelections = {
  showType: ReadonlySet<string>;
  screeningTech: ReadonlySet<string>;
  dubLanguage: ReadonlySet<string>;
};

export type CanonicalShowtimeMeta = {
  showTypeTokens: readonly string[];
  screeningTechTokens: readonly string[];
  dubLanguage: string | null;
};

export type ShowtimeFilterOptions = {
  showType: readonly string[];
  screeningTech: readonly string[];
  dubLanguage: readonly string[];
};

let cachedFilterState: ShowtimeFilterState | null | undefined;

function normalizeText(value: string | null | undefined): string {
  return value?.trim().replace(COLLAPSE_WHITESPACE, " ") ?? "";
}

function copyUncheckedGroups(
  unchecked?: Partial<SavedUncheckedGroups>,
): SavedUncheckedGroups {
  return {
    showType: [...(unchecked?.showType ?? [])],
    screeningTech: [...(unchecked?.screeningTech ?? [])],
    dubLanguage: [...(unchecked?.dubLanguage ?? [])],
  };
}

function normalizeUniqueList(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => normalizeText(value)).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

function normalizeFilterState(value: unknown): ShowtimeFilterState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    version?: unknown;
    unchecked?: Partial<Record<FilterGroup, unknown>>;
  };

  if (candidate.version !== 1) {
    return null;
  }

  const uncheckedGroups = candidate.unchecked;

  return {
    version: 1,
    unchecked: {
      showType: Array.isArray(uncheckedGroups?.showType)
        ? normalizeUniqueList(
            uncheckedGroups.showType.filter(
              (entry): entry is string => typeof entry === "string",
            ),
          )
        : [],
      screeningTech: Array.isArray(uncheckedGroups?.screeningTech)
        ? normalizeUniqueList(
            uncheckedGroups.screeningTech.filter(
              (entry): entry is string => typeof entry === "string",
            ),
          )
        : [],
      dubLanguage: Array.isArray(uncheckedGroups?.dubLanguage)
        ? normalizeUniqueList(
            uncheckedGroups.dubLanguage.filter(
              (entry): entry is string => typeof entry === "string",
            ),
          )
        : [],
    },
  };
}

function readFilterStateFromStorage(): ShowtimeFilterState | null {
  try {
    const raw = window.localStorage.getItem(SHOWTIME_FILTERS_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as unknown;
    return normalizeFilterState(parsed);
  } catch {
    return null;
  }
}

function ensureCachedFilterState(): ShowtimeFilterState | null {
  if (cachedFilterState !== undefined) {
    return cachedFilterState;
  }

  if (typeof window === "undefined") {
    cachedFilterState = null;
    return cachedFilterState;
  }

  cachedFilterState = readFilterStateFromStorage();
  return cachedFilterState;
}

export function normalizeScreeningType(raw: string): string {
  const normalizedRaw = normalizeText(raw);
  return normalizedRaw || "Regular";
}

function getShowTypeTokens(raw: string): string[] {
  const normalizedType = normalizeScreeningType(raw);
  const words = normalizedType
    .toUpperCase()
    .split(/[+\s/,-]+/)
    .filter(Boolean);
  const wordSet = new Set(words);
  const tokens = new Set<string>();

  if (wordSet.has("REGULAR")) {
    tokens.add("Regular");
  }

  if (wordSet.has("UPGRADE")) {
    tokens.add("Upgrade");
  }

  if (wordSet.has("PRIME")) {
    tokens.add("Prime");
  }

  if (wordSet.has("LOUNGE")) {
    tokens.add("Lounge");
  }

  if (wordSet.has("VIP")) {
    tokens.add("VIP");
  }

  if (wordSet.has("LIGHT")) {
    tokens.add("VIP Light");
    tokens.add("VIP");
  }

  if (wordSet.has("BUSINESS")) {
    tokens.add("VIP");
  }

  if (tokens.size === 0) {
    tokens.add(normalizedType);
  }

  return [...tokens];
}

export function normalizeScreeningTech(raw: string): string {
  const normalizedRaw = normalizeText(raw);
  return normalizedRaw || "2D";
}

function normalizeScreeningTechToken(raw: string): string {
  const normalizedRaw = normalizeText(raw);

  if (!normalizedRaw) {
    return "";
  }

  const upperValue = normalizedRaw.toUpperCase();

  if (upperValue === "IMAX") {
    return "IMAX";
  }

  if (upperValue === "HFR") {
    return "HFR";
  }

  if (upperValue === "SCREENX") {
    return "ScreenX";
  }

  if (upperValue === "4DX") {
    return "4DX";
  }

  if (upperValue === "ONYX") {
    return "ONYX";
  }

  if (upperValue === "ATMOS") {
    return "Atmos";
  }

  if (upperValue === "DOLBY") {
    return "Atmos";
  }

  if (upperValue === "2D" || upperValue === "3D") {
    return upperValue;
  }

  return normalizedRaw;
}

function getScreeningTechTokens(raw: string): string[] {
  const normalizedTech = normalizeScreeningTech(raw);
  const tokens = normalizedTech
    .split(/[+\s/,-]+/)
    .map((value) => normalizeScreeningTechToken(value))
    .filter(Boolean);

  return [...new Set(tokens)];
}

function normalizeDubLanguage(raw: string | null | undefined): string | null {
  const normalizedRaw = normalizeText(raw);

  if (!normalizedRaw) {
    return null;
  }

  const comparableValue = normalizedRaw.toLowerCase();

  if (comparableValue === "hebrew") {
    return "Hebrew";
  }

  if (comparableValue === "french") {
    return "French";
  }

  return normalizedRaw;
}

export function getCanonicalShowtimeMeta(
  showtime: ShowtimeEntry,
): CanonicalShowtimeMeta {
  return {
    showTypeTokens: getShowTypeTokens(showtime.screeningType),
    screeningTechTokens: getScreeningTechTokens(showtime.screeningTech),
    dubLanguage: normalizeDubLanguage(showtime.dubLanguage),
  };
}

export function getShowtimeFilterOptions(
  theaters: readonly TheaterShowtimes[],
): ShowtimeFilterOptions {
  const showTypeSet = new Set<string>();
  const screeningTechSet = new Set<string>();

  for (const theater of theaters) {
    for (const showtime of theater.showtimes) {
      const canonicalMeta = getCanonicalShowtimeMeta(showtime);
      for (const token of canonicalMeta.showTypeTokens) {
        showTypeSet.add(token);
      }
      for (const token of canonicalMeta.screeningTechTokens) {
        screeningTechSet.add(token);
      }
    }
  }

  for (const option of SHOW_TYPE_OPTIONS) {
    showTypeSet.add(option);
  }

  for (const option of SCREENING_TECH_OPTIONS) {
    screeningTechSet.add(option);
  }

  return {
    showType: [...showTypeSet].sort((left, right) => left.localeCompare(right)),
    screeningTech: [...screeningTechSet].sort((left, right) =>
      left.localeCompare(right)),
    dubLanguage: [...FIXED_DUB_LANGUAGES],
  };
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
    screeningTech: toSelectedSet(
      options.screeningTech,
      unchecked.screeningTech,
    ),
    dubLanguage: toSelectedSet(options.dubLanguage, unchecked.dubLanguage),
  };
}

function isShowtimeAllowed(
  showtime: ShowtimeEntry,
  selections: ShowtimeFilterSelections,
): boolean {
  const canonicalMeta = getCanonicalShowtimeMeta(showtime);

  for (const token of canonicalMeta.showTypeTokens) {
    if (!selections.showType.has(token)) {
      return false;
    }
  }

  for (const token of canonicalMeta.screeningTechTokens) {
    if (!selections.screeningTech.has(token)) {
      return false;
    }
  }

  if (
    canonicalMeta.dubLanguage &&
    FIXED_DUB_LANGUAGES.includes(
      canonicalMeta.dubLanguage as (typeof FIXED_DUB_LANGUAGES)[number],
    ) &&
    !selections.dubLanguage.has(canonicalMeta.dubLanguage)
  ) {
    return false;
  }

  return true;
}

export function filterTheatersBySelections(
  theaters: readonly TheaterShowtimes[],
  selections: ShowtimeFilterSelections,
): TheaterShowtimes[] {
  return theaters.flatMap((theater) => {
    const filteredShowtimes = theater.showtimes.filter((showtime) =>
      isShowtimeAllowed(showtime, selections));

    return filteredShowtimes.length > 0
      ? [
          {
            theater: theater.theater,
            showtimes: filteredShowtimes,
          },
        ]
      : [];
  });
}

export function updateShowtimeFilterState(
  previousState: ShowtimeFilterState | null,
  options: ShowtimeFilterOptions,
  nextSelections: ShowtimeFilterSelections,
): ShowtimeFilterState {
  const previousUnchecked = copyUncheckedGroups(previousState?.unchecked);

  const nextUncheckedForGroup = (
    group: FilterGroup,
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
    version: 1,
    unchecked: {
      showType: nextUncheckedForGroup(
        "showType",
        options.showType,
        nextSelections.showType,
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

export function loadShowtimeFilters(): ShowtimeFilterState | null {
  return ensureCachedFilterState();
}

export function saveShowtimeFilters(nextState: ShowtimeFilterState): void {
  cachedFilterState = {
    version: 1,
    unchecked: copyUncheckedGroups(nextState.unchecked),
  };

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SHOWTIME_FILTERS_STORAGE_KEY,
      JSON.stringify(cachedFilterState),
    );
  } catch {
    // Keep the in-memory state even if localStorage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent<ShowtimeFilterState | null>(SHOWTIME_FILTERS_EVENT_NAME, {
      detail: cachedFilterState,
    }),
  );
}

export function getShowtimeFiltersSnapshot(): ShowtimeFilterState | null {
  return ensureCachedFilterState();
}

export function subscribeToShowtimeFilters(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SHOWTIME_FILTERS_STORAGE_KEY) {
      return;
    }

    cachedFilterState = readFilterStateFromStorage();
    listener();
  };

  const handleCustomUpdate = (event: Event) => {
    const customEvent = event as CustomEvent<ShowtimeFilterState | null>;
    cachedFilterState = customEvent.detail ?? readFilterStateFromStorage();
    listener();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(
    SHOWTIME_FILTERS_EVENT_NAME,
    handleCustomUpdate as EventListener,
  );

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(
      SHOWTIME_FILTERS_EVENT_NAME,
      handleCustomUpdate as EventListener,
    );
  };
}
