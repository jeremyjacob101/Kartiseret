import type { UserPreferenceDefinition } from "./shared";

export type SiteColor = string;
export type SiteColorOption = {
  label: string;
  value: SiteColor;
};

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
const CACHED_SITE_COLOR_KEY = "cached_site_color_v1";
const SITE_COLOR_TRANSITIONS_ENABLED_CLASS = "site-color-transitions-enabled";
const SITE_COLOR_INITIALIZED_ATTRIBUTE = "data-site-color-initialized";

const SIX_DIGIT_HEX_COLOR = /^#([\da-f]{6})$/i;

export function normalizeSiteColor(
  value: unknown,
  fallback: SiteColor = DEFAULT_SITE_COLOR,
): SiteColor {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (SIX_DIGIT_HEX_COLOR.test(normalizedValue)) {
    return normalizedValue;
  }

  return fallback;
}

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

  const normalizedColor = normalizeSiteColor(siteColor, DEFAULT_SITE_COLOR);
  const root = document.documentElement;
  initializeSiteColorTheme();
  setSiteColorVariables(root, normalizedColor);
}

export function getSiteColorLabel(siteColor: SiteColor): string {
  const normalizedColor = normalizeSiteColor(siteColor, DEFAULT_SITE_COLOR);
  const matchingOption = SITE_COLOR_OPTIONS.find(
    (option) => option.value === normalizedColor,
  );

  return matchingOption?.label ?? normalizedColor.toUpperCase();
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
  copy: (value) => normalizeSiteColor(value, DEFAULT_SITE_COLOR),
  normalize: (value) => normalizeSiteColor(value, DEFAULT_SITE_COLOR),
  clientCache: {
    load: loadCachedSiteColor,
    save: saveCachedSiteColor,
    clear: clearCachedSiteColor,
  },
};
