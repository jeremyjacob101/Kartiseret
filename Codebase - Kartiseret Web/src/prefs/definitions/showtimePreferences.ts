import { copyShowtimePreferences, DEFAULT_SHOWTIME_PREFERENCES, normalizeShowtimePreferences, SHOWTIME_PREFERENCES_COLUMN, SHOWTIME_PREFERENCES_KEY, type ShowtimePreferences } from "@kartiseret/contracts/showtime-preferences";
import type { UserPreferenceDefinition } from "./shared.js";

export {
  copyShowtimePreferences,
  DEFAULT_SHOWTIME_PREFERENCES,
  normalizeShowtimePreferences,
  SHOWTIME_PREFERENCES_COLUMN,
  SHOWTIME_PREFERENCES_KEY,
};
export type { ShowtimePreferences };

export const showtimePreferencesDefinition: UserPreferenceDefinition<
  typeof SHOWTIME_PREFERENCES_KEY,
  ShowtimePreferences
> = {
  key: SHOWTIME_PREFERENCES_KEY,
  column: SHOWTIME_PREFERENCES_COLUMN,
  defaultValue: DEFAULT_SHOWTIME_PREFERENCES,
  copy: copyShowtimePreferences,
  parse: normalizeShowtimePreferences,
  guestPersistence: {
    load: () => null,
    unsupportedMessage: "Sign in to save your showtime preferences.",
  },
};
