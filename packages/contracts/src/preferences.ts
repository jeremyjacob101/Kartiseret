import { z } from "zod";

export const ALL_LOCATIONS = [
  "Afula",
  "Ashdod",
  "Ashkelon",
  "Ayalon",
  "Beer Sheva",
  "Carmiel",
  "Chadera",
  "Even Yehuda",
  "Givatayim",
  "Glilot",
  "Haifa",
  "Herziliya",
  "Jerusalem",
  "Kfar Saba",
  "Kiryat Bialik",
  "Kiryat Ono",
  "Modiin",
  "Nahariya",
  "Netanya",
  "Omer",
  "Petach Tikvah",
  "Raanana",
  "Ramat Hasharon",
  "Rehovot",
  "Rishon Letzion",
  "Tel Aviv",
  "Zichron Yaakov",
  "Holon",
] as const;

export const canonicalAppLocationSchema = z.enum(ALL_LOCATIONS);
export type CanonicalAppLocation = z.infer<typeof canonicalAppLocationSchema>;

export const DEFAULT_LOCATION: AppLocation = "Jerusalem";
export const LOCATION_PREFERENCE_KEY = "location";
export const LOCATION_SIGNUP_METADATA_KEY = "signup_location";
export const LOCATION_PREFERENCE_COLUMN = {
  name: "location",
} as const;

const canonicalLocationByNormalizedValue = new Map(
  ALL_LOCATIONS.map((location) => [normalizeLocationValue(location), location]),
);

function normalizeLocationValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const appLocationSchema = z
  .string()
  .transform(normalizeLocationValue)
  .pipe(z.string().min(1));
export type AppLocation = z.infer<typeof appLocationSchema>;

export function normalizeLocation(
  value: unknown,
  fallback: AppLocation = DEFAULT_LOCATION,
): AppLocation {
  const result = appLocationSchema.safeParse(value);

  if (!result.success) {
    return fallback;
  }

  return canonicalLocationByNormalizedValue.get(result.data) ?? result.data;
}

export const ALL_RATING_SOURCES = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
  "lbRating",
  "tmdbRating",
] as const;

export const ratingSourceSchema = z.enum(ALL_RATING_SOURCES);
export type RatingSource = z.infer<typeof ratingSourceSchema>;

export const DEFAULT_RATING_SOURCES: RatingSource[] = [
  "imdbRating",
  "rtAudienceRating",
  "rtCriticRating",
];

export const RATING_SOURCES_PREFERENCE_KEY = "ratingSources";
export const RATING_SOURCES_PREFERENCE_COLUMN = {
  name: "rating_sources",
} as const;
export const GUEST_RATING_SOURCES_MESSAGE =
  "You must be logged in to save preferences.";

export type NormalizeRatingSourcesOptions = {
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

  return ALL_RATING_SOURCES.filter((source) => selected.has(source));
}

export function normalizeRatingSources(
  value: unknown,
  options: NormalizeRatingSourcesOptions = {},
): RatingSource[] {
  const normalized = toNormalizedSources(value);
  const { allowEmpty = false, fallback = DEFAULT_RATING_SOURCES } = options;

  if (normalized.length > 0 || allowEmpty) {
    return normalized;
  }

  return toNormalizedSources(fallback);
}

export const siteColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[\da-f]{6}$/);
export const siteColorOptionSchema = z.object({
  label: z.string().min(1),
  value: siteColorSchema,
});
export type SiteColor = z.infer<typeof siteColorSchema>;
export type SiteColorOption = z.infer<typeof siteColorOptionSchema>;

export const DEFAULT_SITE_COLOR: SiteColor = "#a66ae3";
export const SITE_COLOR_PREFERENCE_KEY = "siteColor";
export const SITE_COLOR_PREFERENCE_COLUMN = {
  name: "site_color",
} as const;
export const SITE_COLOR_OPTIONS = [
  { label: "Pink", value: "#e269ba" },
  { label: "Red", value: "#ed4c57" },
  { label: "Orange", value: "#d97f3a" },
  { label: "Yellow", value: "#bebe2d" },
  { label: "Green", value: "#63ae3d" },
  { label: "Teal", value: "#3caa8e" },
  { label: "Blue", value: "#69b0e2" },
  { label: "Indigo", value: "#4375d9" },
  { label: "Purple", value: DEFAULT_SITE_COLOR },
] as const satisfies readonly SiteColorOption[];

export function normalizeSiteColor(
  value: unknown,
  fallback: SiteColor = DEFAULT_SITE_COLOR,
): SiteColor {
  const result = siteColorSchema.safeParse(value);
  return result.success ? result.data : fallback;
}
