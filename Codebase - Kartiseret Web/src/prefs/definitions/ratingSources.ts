import type { UserPreferenceDefinition } from "./shared";

export const ALL_RATING_SOURCES = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
  "lbRating",
  "tmdbRating",
] as const;

export const DEFAULT_RATING_SOURCES: RatingSource[] = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
];

export type RatingSource = (typeof ALL_RATING_SOURCES)[number];
export const RATING_SOURCES_PREFERENCE_KEY = "ratingSources";
export const RATING_SOURCES_PREFERENCE_COLUMN = {
  name: "rating_sources",
} as const;
export const GUEST_RATING_SOURCES_MESSAGE =
  "You must be logged in to save preferences.";

const ratingSourceSet = new Set<string>(ALL_RATING_SOURCES);

type NormalizeOptions = {
  fallback?: readonly RatingSource[];
  allowEmpty?: boolean;
};

function toNormalizedSources(value: unknown): RatingSource[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const selected = new Set<string>();

  for (const item of value) {
    if (typeof item === "string" && ratingSourceSet.has(item)) {
      selected.add(item);
    }
  }

  return ALL_RATING_SOURCES.filter((source) => selected.has(source));
}

export function normalizeRatingSources(
  value: unknown,
  options: NormalizeOptions = {},
): RatingSource[] {
  const normalized = toNormalizedSources(value);
  const { allowEmpty = false, fallback = DEFAULT_RATING_SOURCES } = options;

  if (normalized.length > 0 || allowEmpty) {
    return normalized;
  }

  return toNormalizedSources(fallback);
}

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
  normalize: (value) =>
    normalizeRatingSources(value, {
      allowEmpty: true,
      fallback: DEFAULT_RATING_SOURCES,
    }),
  guestPersistence: {
    load: () => null,
    unsupportedMessage: GUEST_RATING_SOURCES_MESSAGE,
  },
};
