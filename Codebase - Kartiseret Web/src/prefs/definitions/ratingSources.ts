import { z } from "zod";
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

export const ratingSourceSchema = z.enum(ALL_RATING_SOURCES);
export const ratingSourcesSchema = z.array(ratingSourceSchema);
export type RatingSource = z.infer<typeof ratingSourceSchema>;
export const RATING_SOURCES_PREFERENCE_KEY = "ratingSources";
export const RATING_SOURCES_PREFERENCE_COLUMN = {
  name: "rating_sources",
} as const;
export const GUEST_RATING_SOURCES_MESSAGE =
  "You must be logged in to save preferences.";

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
    const result = ratingSourceSchema.safeParse(item);

    if (result.success) {
      selected.add(result.data);
    }
  }

  return ratingSourcesSchema.parse(
    ALL_RATING_SOURCES.filter((source) => selected.has(source)),
  );
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
  schema: ratingSourcesSchema,
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
