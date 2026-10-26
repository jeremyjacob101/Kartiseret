import { DEFAULT_LOCATION, LOCATION_PREFERENCE_COLUMN, LOCATION_PREFERENCE_KEY, ALL_LOCATIONS, appLocationSchema, canonicalAppLocationSchema, normalizeLocation } from "@kartiseret/contracts/preferences";
import type { AppLocation, CanonicalAppLocation } from "@kartiseret/contracts/preferences";
import type { UserPreferenceDefinition } from "./shared.js";

export {
  ALL_LOCATIONS,
  appLocationSchema,
  canonicalAppLocationSchema,
  DEFAULT_LOCATION,
  LOCATION_PREFERENCE_COLUMN,
  LOCATION_PREFERENCE_KEY,
  normalizeLocation,
};
export type { AppLocation, CanonicalAppLocation };

const GUEST_LOCATION_KEY = "guest_location_v1";

export function loadGuestLocation(): AppLocation | null {
  if (typeof window === "undefined") {
    return null;
  }

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

export function loadInitialPreferenceLocation(
  signupLocationMetadata: unknown,
): AppLocation {
  const result = appLocationSchema.safeParse(signupLocationMetadata);
  return result.success
    ? result.data
    : (loadGuestLocation() ?? DEFAULT_LOCATION);
}

export function saveGuestLocation(location: AppLocation): void {
  try {
    const result = appLocationSchema.safeParse(location);

    if (result.success) {
      window.localStorage.setItem(GUEST_LOCATION_KEY, result.data);
    }
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
  copy: (value) => value,
  parse: (value) => normalizeLocation(value, DEFAULT_LOCATION),
  guestPersistence: {
    load: loadGuestLocation,
    save: saveGuestLocation,
  },
};
