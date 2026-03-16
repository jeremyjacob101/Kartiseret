import type { UserPreferenceDefinition } from "./shared";

export type SiteColor = string;

export const DEFAULT_SITE_COLOR: SiteColor = "#a66ae3";
export const DEFAULT_SITE_COLOR_RGB = "166, 106, 227";
export const SITE_COLOR_PREFERENCE_KEY = "siteColor";
export const SITE_COLOR_PREFERENCE_COLUMN = {
  name: "site_color",
} as const;

const SIX_DIGIT_HEX_COLOR = /^#([\da-f]{6})$/i;

function toRgbChannels(hexColor: SiteColor): string {
  const normalizedColor = normalizeSiteColor(hexColor, DEFAULT_SITE_COLOR);
  const [, channels] = normalizedColor.match(SIX_DIGIT_HEX_COLOR) ?? [];

  if (!channels) {
    return DEFAULT_SITE_COLOR_RGB;
  }

  return [
    Number.parseInt(channels.slice(0, 2), 16),
    Number.parseInt(channels.slice(2, 4), 16),
    Number.parseInt(channels.slice(4, 6), 16),
  ].join(", ");
}

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

export function applySiteColor(siteColor: SiteColor): void {
  if (typeof document === "undefined") {
    return;
  }

  const normalizedColor = normalizeSiteColor(siteColor, DEFAULT_SITE_COLOR);
  const root = document.documentElement;

  root.style.setProperty("--main-app-color", normalizedColor);
  root.style.setProperty(
    "--main-app-color-rgb",
    toRgbChannels(normalizedColor),
  );
}

export const siteColorPreferenceDefinition: UserPreferenceDefinition<
  typeof SITE_COLOR_PREFERENCE_KEY,
  SiteColor
> = {
  key: SITE_COLOR_PREFERENCE_KEY,
  column: SITE_COLOR_PREFERENCE_COLUMN,
  defaultValue: DEFAULT_SITE_COLOR,
  copy: (value) => normalizeSiteColor(value, DEFAULT_SITE_COLOR),
  normalize: (value) => normalizeSiteColor(value, DEFAULT_SITE_COLOR),
};
