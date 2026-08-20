import { create } from "zustand";
import { cloneUncheckedGroups, type ShowtimeFilterState } from "../../domain/showtimeFilters.js";
import { migrateShowtimeFilterState } from "../../routing/showtimeLinkCodec.js";

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

function copyFilterState(
  filterState: ShowtimeFilterState,
): ShowtimeFilterState {
  return {
    version: 3,
    unchecked: cloneUncheckedGroups(filterState.unchecked),
  };
}

function readFilterStateFromStorage(): ShowtimeFilterState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(SHOWTIME_FILTERS_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    return migrateShowtimeFilterState(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

type ShowtimeFiltersStoreState = {
  filters: ShowtimeFilterState | null;
  saveFilters: (nextState: ShowtimeFilterState) => void;
};

export const useShowtimeFiltersStore = create<ShowtimeFiltersStoreState>()((
  set,
) => ({
  filters: readFilterStateFromStorage(),
  saveFilters: (nextState) => {
    const filters = copyFilterState(nextState);

    set({ filters });

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(
        SHOWTIME_FILTERS_STORAGE_KEY,
        JSON.stringify(filters),
      );
    } catch {
      // The in-memory Zustand state remains authoritative for this session.
    }
  },
}));

export function loadShowtimeFilters(): ShowtimeFilterState | null {
  return useShowtimeFiltersStore.getState().filters;
}

export function saveShowtimeFilters(nextState: ShowtimeFilterState): void {
  useShowtimeFiltersStore.getState().saveFilters(nextState);
}

export function getShowtimeFiltersSnapshot(): ShowtimeFilterState | null {
  return useShowtimeFiltersStore.getState().filters;
}

function handleShowtimeFilterStorage(event: StorageEvent): void {
  if (event.key && event.key !== SHOWTIME_FILTERS_STORAGE_KEY) {
    return;
  }

  useShowtimeFiltersStore.setState({ filters: readFilterStateFromStorage() });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", handleShowtimeFilterStorage);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener("storage", handleShowtimeFilterStorage);
  });
}
