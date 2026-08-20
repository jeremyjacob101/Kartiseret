import { cloneUncheckedGroups, type ShowtimeFilterState } from "../../domain/showtimeFilters.js";
import { migrateShowtimeFilterState, persistedShowtimeFilterInputSchema } from "../../routing/showtimeLinkCodec.js";
import { parseJsonWithSchema } from "../../validation/runtime.js";

export {
  buildShowtimeFilterSelections,
  filterTheatersBySelections,
  getCanonicalShowtimeMeta,
  getShowtimeFilterOptions,
  normalizeScreeningTech,
  normalizeScreeningType,
  updateShowtimeFilterState,
} from "../../domain/showtimeFilters.js";
export type {
  CanonicalShowtimeMeta,
  ShowtimeFilterOptions,
  ShowtimeFilterSelections,
  ShowtimeFilterState,
} from "../../domain/showtimeFilters.js";

const SHOWTIME_FILTERS_STORAGE_KEY = "showtime_filters_v1";
const SHOWTIME_FILTERS_EVENT_NAME = "showtime-filters-updated";

let cachedFilterState: ShowtimeFilterState | null | undefined;

function readFilterStateFromStorage(): ShowtimeFilterState | null {
  try {
    const raw = window.localStorage.getItem(SHOWTIME_FILTERS_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = parseJsonWithSchema(raw, persistedShowtimeFilterInputSchema);
    return parsed ? migrateShowtimeFilterState(parsed) : null;
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

export function loadShowtimeFilters(): ShowtimeFilterState | null {
  return ensureCachedFilterState();
}

export function saveShowtimeFilters(nextState: ShowtimeFilterState): void {
  cachedFilterState = {
    version: 3,
    unchecked: cloneUncheckedGroups(nextState.unchecked),
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
    const eventState =
      event instanceof CustomEvent
        ? migrateShowtimeFilterState(event.detail)
        : null;
    cachedFilterState = eventState ?? readFilterStateFromStorage();
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
