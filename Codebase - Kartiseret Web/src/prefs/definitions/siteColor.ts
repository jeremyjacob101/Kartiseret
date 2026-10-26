import { DEFAULT_SITE_COLOR, SITE_COLOR_OPTIONS, SITE_COLOR_PREFERENCE_COLUMN, SITE_COLOR_PREFERENCE_KEY, normalizeSiteColor, siteColorOptionSchema, siteColorSchema } from "@kartiseret/contracts/preferences";
import type { SiteColor, SiteColorOption } from "@kartiseret/contracts/preferences";
import type { UserPreferenceDefinition } from "./shared";

export {
  DEFAULT_SITE_COLOR,
  normalizeSiteColor,
  SITE_COLOR_OPTIONS,
  SITE_COLOR_PREFERENCE_COLUMN,
  SITE_COLOR_PREFERENCE_KEY,
  siteColorOptionSchema,
  siteColorSchema,
};
export type { SiteColor, SiteColorOption };

const CACHED_SITE_COLOR_KEY = "cached_site_color_v1";
const SITE_COLOR_TRANSITIONS_ENABLED_CLASS = "site-color-transitions-enabled";
const SITE_COLOR_INITIALIZED_ATTRIBUTE = "data-site-color-initialized";

export function loadCachedSiteColor(): SiteColor | null {
  try {
    const raw = window.localStorage.getItem(CACHED_SITE_COLOR_KEY);

    if (!raw) {
      return null;
    }

    return normalizeSiteColor(raw, DEFAULT_SITE_COLOR);
  } catch {
    return null;
  }
}

export function saveCachedSiteColor(siteColor: SiteColor): void {
  try {
    window.localStorage.setItem(
      CACHED_SITE_COLOR_KEY,
      normalizeSiteColor(siteColor, DEFAULT_SITE_COLOR),
    );
  } catch {
    // Ignore cache write failures and keep the in-memory preference active.
  }
}

export function clearCachedSiteColor(): void {
  try {
    window.localStorage.removeItem(CACHED_SITE_COLOR_KEY);
  } catch {
    // Ignore cache clear failures and fall back to the in-memory default.
  }
}

function setSiteColorVariables(root: HTMLElement, siteColor: SiteColor): void {
  root.style.setProperty("--main-app-color", siteColor);
}

export function initializeSiteColorTheme(): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (root.getAttribute(SITE_COLOR_INITIALIZED_ATTRIBUTE) === "true") {
    return;
  }

  root.setAttribute(SITE_COLOR_INITIALIZED_ATTRIBUTE, "true");
  setSiteColorVariables(root, loadCachedSiteColor() ?? DEFAULT_SITE_COLOR);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.classList.add(SITE_COLOR_TRANSITIONS_ENABLED_CLASS);
    });
  });
}

export function applySiteColor(siteColor: SiteColor): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  initializeSiteColorTheme();
  setSiteColorVariables(root, siteColor);
}

export function getSiteColorLabel(siteColor: SiteColor): string {
  const matchingOption = SITE_COLOR_OPTIONS.find(
    (option) => option.value === siteColor,
  );

  return matchingOption?.label ?? siteColor.toUpperCase();
}

export const siteColorPreferenceDefinition: UserPreferenceDefinition<
  typeof SITE_COLOR_PREFERENCE_KEY,
  SiteColor,
  SiteColorOption
> = {
  key: SITE_COLOR_PREFERENCE_KEY,
  column: SITE_COLOR_PREFERENCE_COLUMN,
  defaultValue: DEFAULT_SITE_COLOR,
  options: SITE_COLOR_OPTIONS,
  copy: (value) => value,
  parse: (value) => normalizeSiteColor(value, DEFAULT_SITE_COLOR),
  clientCache: {
    load: loadCachedSiteColor,
    save: saveCachedSiteColor,
    clear: clearCachedSiteColor,
  },
};
