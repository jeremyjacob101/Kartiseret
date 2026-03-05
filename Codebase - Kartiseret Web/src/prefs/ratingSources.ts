export const ALL_RATING_SOURCES = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
  "lbRating",
  "tmdbRating",
] as const;

export type RatingSource = (typeof ALL_RATING_SOURCES)[number];

export const DEFAULT_RATING_SOURCES: RatingSource[] = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
];

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
