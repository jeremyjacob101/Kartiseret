import { z } from "zod";
import { CINEMA_IDENTITIES } from "./cinema-identities.js";
import {
  migrateShowtimeFilterState,
  SHOWTIME_FILTER_OPTIONS,
  type PersistedShowtimeFilterState,
} from "./showtime-links.js";

export type ShowtimePreferences = {
  screeningFilters: PersistedShowtimeFilterState;
  excludedCinemaIds: string[];
};

export const SHOWTIME_PREFERENCES_KEY = "showtimePreferences";
export const SHOWTIME_PREFERENCES_COLUMN = {
  name: "showtime_preferences",
} as const;

export const DEFAULT_SHOWTIME_FILTER_STATE: PersistedShowtimeFilterState = {
  version: 3,
  unchecked: {
    showType: [],
    screenFormat: [],
    screeningTech: [],
    dubLanguage: [],
  },
};

export const DEFAULT_SHOWTIME_PREFERENCES: ShowtimePreferences = {
  screeningFilters: DEFAULT_SHOWTIME_FILTER_STATE,
  excludedCinemaIds: [],
};

const cinemaIds = new Set(CINEMA_IDENTITIES.map(({ id }) => id));
const cinemaIdSchema = z.string().refine((id) => cinemaIds.has(id));

export const persistedShowtimePreferencesSchema = z
  .object({
    screeningFilters: z
      .object({
        version: z.literal(3),
        unchecked: z
          .object({
            showType: z
              .array(z.enum(SHOWTIME_FILTER_OPTIONS.showType))
              .max(SHOWTIME_FILTER_OPTIONS.showType.length),
            screenFormat: z
              .array(z.enum(SHOWTIME_FILTER_OPTIONS.screenFormat))
              .max(SHOWTIME_FILTER_OPTIONS.screenFormat.length),
            screeningTech: z
              .array(z.enum(SHOWTIME_FILTER_OPTIONS.screeningTech))
              .max(SHOWTIME_FILTER_OPTIONS.screeningTech.length),
            dubLanguage: z
              .array(z.enum(SHOWTIME_FILTER_OPTIONS.dubLanguage))
              .max(SHOWTIME_FILTER_OPTIONS.dubLanguage.length),
          })
          .strict(),
      })
      .strict(),
    excludedCinemaIds: z.array(cinemaIdSchema).max(CINEMA_IDENTITIES.length),
  })
  .strict();

function cloneFilterState(
  state: PersistedShowtimeFilterState,
): PersistedShowtimeFilterState {
  return {
    version: 3,
    unchecked: {
      showType: [...state.unchecked.showType],
      screenFormat: [...state.unchecked.screenFormat],
      screeningTech: [...state.unchecked.screeningTech],
      dubLanguage: [...state.unchecked.dubLanguage],
    },
  };
}

export function normalizeShowtimePreferences(
  value: unknown,
): ShowtimePreferences {
  const candidate =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const screeningFilters = migrateShowtimeFilterState(
    candidate.screeningFilters,
  );
  const excludedCinemaIds = Array.isArray(candidate.excludedCinemaIds)
    ? [
        ...new Set(
          candidate.excludedCinemaIds.filter(
            (id): id is string => typeof id === "string" && cinemaIds.has(id),
          ),
        ),
      ].sort((left, right) => left.localeCompare(right))
    : [];

  return {
    screeningFilters: cloneFilterState(
      screeningFilters ?? DEFAULT_SHOWTIME_FILTER_STATE,
    ),
    excludedCinemaIds,
  };
}

export function copyShowtimePreferences(
  value: ShowtimePreferences,
): ShowtimePreferences {
  return {
    screeningFilters: cloneFilterState(value.screeningFilters),
    excludedCinemaIds: [...value.excludedCinemaIds],
  };
}
