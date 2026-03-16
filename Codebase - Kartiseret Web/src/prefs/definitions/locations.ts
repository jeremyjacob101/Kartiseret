import type { UserPreferenceDefinition } from "./shared";

export const ALL_LOCATIONS = [
  "Ashdod",
  "Ashkelon",
  "Ayalon",
  "Beer Sheva",
  "Carmiel",
  "Chadera",
  "Even Yehuda",
  "Givataim",
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
] as const;

export type CanonicalAppLocation = (typeof ALL_LOCATIONS)[number];

export type AppLocation = string;

export const DEFAULT_LOCATION: AppLocation = "Jerusalem";
export const LOCATION_PREFERENCE_KEY = "location";
export const LOCATION_SIGNUP_METADATA_KEY = "signup_location";
export const LOCATION_PREFERENCE_COLUMN = {
  name: "location",
  optional: true,
  missingColumnMessage:
    "Add a `location` column to public.user_preferences to persist locations.",
} as const;

const GUEST_LOCATION_KEY = "guest_location_v1";
const canonicalLocationByNormalizedValue = new Map(
  ALL_LOCATIONS.map((location) => [normalizeLocationValue(location), location]),
);

function normalizeLocationValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeLocation(
  value: unknown,
  fallback: AppLocation = DEFAULT_LOCATION,
): AppLocation {
  if (typeof value === "string") {
    const normalizedValue = normalizeLocationValue(value);

    if (!normalizedValue) {
      return fallback;
    }

    return (
      canonicalLocationByNormalizedValue.get(normalizedValue) ?? normalizedValue
    );
  }

  return fallback;
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
  window.localStorage.setItem(GUEST_LOCATION_KEY, location);
}

function getSignupLocation(value: unknown): AppLocation | null {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeLocation(value, DEFAULT_LOCATION);
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
  copy: (value) => value,
  normalize: (value) => normalizeLocation(value, DEFAULT_LOCATION),
  guestPersistence: {
    load: loadGuestLocation,
    save: saveGuestLocation,
  },
  getInitialValue: ({ user }) =>
    getSignupLocation(user?.user_metadata?.[LOCATION_SIGNUP_METADATA_KEY]) ??
    DEFAULT_LOCATION,
};
