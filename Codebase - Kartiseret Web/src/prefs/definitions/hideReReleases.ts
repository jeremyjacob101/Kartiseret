import { DEFAULT_HIDE_RE_RELEASES, HIDE_RE_RELEASES_PREFERENCE_COLUMN, HIDE_RE_RELEASES_PREFERENCE_KEY, normalizeHideReReleases } from "@kartiseret/contracts/preferences";
import type { UserPreferenceDefinition } from "./shared";

export const hideReReleasesPreferenceDefinition: UserPreferenceDefinition<
  typeof HIDE_RE_RELEASES_PREFERENCE_KEY,
  boolean
> = {
  key: HIDE_RE_RELEASES_PREFERENCE_KEY,
  column: HIDE_RE_RELEASES_PREFERENCE_COLUMN,
  defaultValue: DEFAULT_HIDE_RE_RELEASES,
  copy: (value) => value,
  parse: normalizeHideReReleases,
};
