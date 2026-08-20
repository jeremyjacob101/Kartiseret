import { z } from "zod";
import type { UserPreferenceDefinition } from "./shared.js";

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

const GUEST_LOCATION_KEY = "guest_location_v1";
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

export function loadGuestLocation(): AppLocation | null {
  try {
    const raw = window.localStorage.getItem(GUEST_LOCATION_KEY);

    if (!raw) {
      return null;
    }

    return normalizeLocation(raw, DEFAULT_LOCATION);
  } catch {
    return null;
  }
}

export function saveGuestLocation(location: AppLocation): void {
  try {
    const normalizedLocation = appLocationSchema.parse(location);
    window.localStorage.setItem(GUEST_LOCATION_KEY, normalizedLocation);
  } catch {
    // Keep the in-memory preference when storage is unavailable or invalid.
  }
}

export const locationPreferenceDefinition: UserPreferenceDefinition<
  typeof LOCATION_PREFERENCE_KEY,
  AppLocation,
  CanonicalAppLocation
> = {
  key: LOCATION_PREFERENCE_KEY,
  column: LOCATION_PREFERENCE_COLUMN,
  defaultValue: DEFAULT_LOCATION,
  options: ALL_LOCATIONS,
  schema: appLocationSchema,
  copy: (value) => value,
  normalize: (value) => normalizeLocation(value, DEFAULT_LOCATION),
  guestPersistence: {
    load: loadGuestLocation,
    save: saveGuestLocation,
  },
};
