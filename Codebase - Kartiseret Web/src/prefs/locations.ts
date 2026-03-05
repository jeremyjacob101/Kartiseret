export const ALL_LOCATIONS = ["Haifa", "Jerusalem", "Tel Aviv"] as const;
export type AppLocation = (typeof ALL_LOCATIONS)[number];

export const DEFAULT_LOCATION: AppLocation = "Haifa";

const GUEST_LOCATION_KEY = "guest_location_v1";
const locationSet = new Set<string>(ALL_LOCATIONS);

export function normalizeLocation(
  value: unknown,
  fallback: AppLocation = DEFAULT_LOCATION,
): AppLocation {
  if (typeof value === "string" && locationSet.has(value)) {
    return value as AppLocation;
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
