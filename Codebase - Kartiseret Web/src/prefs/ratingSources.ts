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

const LOCAL_STORAGE_KEY = "rating_sources_v1";
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

export function loadLocalRatingSources(): RatingSource[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    const defaultSources = [...DEFAULT_RATING_SOURCES];

    if (!raw) {
      window.localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify(defaultSources),
      );
      return defaultSources;
    }

    const normalized = normalizeRatingSources(JSON.parse(raw));
    const normalizedRaw = JSON.stringify(normalized);

    if (raw !== normalizedRaw) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, normalizedRaw);
    }

    return normalized;
  } catch {
    const defaultSources = [...DEFAULT_RATING_SOURCES];
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(defaultSources));
    return defaultSources;
  }
}

export function saveLocalRatingSources(
  sources: readonly RatingSource[],
  options: NormalizeOptions = {},
): void {
  const normalized = normalizeRatingSources(sources, options);
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized));
}
