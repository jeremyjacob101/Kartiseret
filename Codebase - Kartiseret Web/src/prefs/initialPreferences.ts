import { appLocationSchema, DEFAULT_LOCATION, normalizeLocation } from "./definitions/locations";
import { DEFAULT_RATING_SOURCES } from "./definitions/ratingSources";
import { DEFAULT_SITE_COLOR } from "./definitions/siteColor";

export function buildInitialPreferencesRow(
  userId: string,
  signupLocationMetadata: unknown,
  guestLocation: string | null,
) {
  const signupLocation = appLocationSchema.safeParse(signupLocationMetadata);
  const location = signupLocation.success
    ? signupLocation.data
    : (guestLocation ?? DEFAULT_LOCATION);

  return {
    user_id: userId,
    rating_sources: [...DEFAULT_RATING_SOURCES],
    location: normalizeLocation(location),
    site_color: DEFAULT_SITE_COLOR,
  };
}
