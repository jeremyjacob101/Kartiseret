import { DEFAULT_RATING_SOURCES, RATING_SOURCES_PREFERENCE_COLUMN, RATING_SOURCES_PREFERENCE_KEY, ALL_RATING_SOURCES, GUEST_RATING_SOURCES_MESSAGE, normalizeRatingSources, ratingSourceSchema } from "@kartiseret/contracts/preferences";
import type { RatingSource } from "@kartiseret/contracts/preferences";
import type { UserPreferenceDefinition } from "./shared";

export {
  ALL_RATING_SOURCES,
  DEFAULT_RATING_SOURCES,
  GUEST_RATING_SOURCES_MESSAGE,
  normalizeRatingSources,
  ratingSourceSchema,
  RATING_SOURCES_PREFERENCE_COLUMN,
  RATING_SOURCES_PREFERENCE_KEY,
};
export type { RatingSource };

export const ratingSourcesPreferenceDefinition: UserPreferenceDefinition<
  typeof RATING_SOURCES_PREFERENCE_KEY,
  RatingSource[],
  RatingSource
> = {
  key: RATING_SOURCES_PREFERENCE_KEY,
  column: RATING_SOURCES_PREFERENCE_COLUMN,
  defaultValue: DEFAULT_RATING_SOURCES,
  options: ALL_RATING_SOURCES,
  copy: (value) => [...value],
  parse: (value) =>
    normalizeRatingSources(value, {
      allowEmpty: true,
      fallback: DEFAULT_RATING_SOURCES,
    }),
  guestPersistence: {
    load: () => null,
    unsupportedMessage: GUEST_RATING_SOURCES_MESSAGE,
  },
};
