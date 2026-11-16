import { cloneUncheckedGroups, type ShowtimeFilterState } from "@kartiseret/contracts/showtime-filters";
import { create } from "zustand";

export {
  buildShowtimeFilterSelections,
  filterTheatersBySelections,
  getCanonicalShowtimeMeta,
  getShowtimeFilterOptions,
  normalizeScreeningTech,
  normalizeScreeningType,
  updateShowtimeFilterState,
} from "@kartiseret/contracts/showtime-filters";
export type {
  CanonicalShowtimeMeta,
  ShowtimeFilterOptions,
  ShowtimeFilterSelections,
  ShowtimeFilterState,
} from "@kartiseret/contracts/showtime-filters";

function copyFilterState(
  filterState: ShowtimeFilterState,
): ShowtimeFilterState {
  return {
    version: 3,
    unchecked: cloneUncheckedGroups(filterState.unchecked),
  };
}

type ShowtimeFiltersStoreState = {
  filters: ShowtimeFilterState | null;
  saveFilters: (nextState: ShowtimeFilterState) => void;
};

export const useShowtimeFiltersStore = create<ShowtimeFiltersStoreState>()((
  set,
) => ({
  filters: null,
  saveFilters: (nextState) => {
    const filters = copyFilterState(nextState);
    set({ filters });
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
