import { DEFAULT_LOCATION, normalizeLocation } from "./definitions/locations";
import { DEFAULT_RATING_SOURCES } from "./definitions/ratingSources";
import { DEFAULT_SITE_COLOR } from "./definitions/siteColor";

export function buildInitialPreferencesRow(
  userId: string,
  signupLocationMetadata: unknown,
  guestLocation: string | null,
) {
  const location =
    typeof signupLocationMetadata === "string" && signupLocationMetadata.trim()
      ? signupLocationMetadata
      : (guestLocation ?? DEFAULT_LOCATION);

  return {
    user_id: userId,
    rating_sources: [...DEFAULT_RATING_SOURCES],
    location: normalizeLocation(location),
    site_color: DEFAULT_SITE_COLOR,
  };
}
