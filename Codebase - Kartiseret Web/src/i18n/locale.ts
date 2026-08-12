export const APP_LOCALES = ["en", "he"] as const;

export type AppLocale = (typeof APP_LOCALES)[number];
export type AppDirection = "ltr" | "rtl";

export const DEFAULT_LOCALE: AppLocale = "en";
export const LOCALE_STORAGE_KEY = "kartiseret_locale_v1";
export const LOCALE_CHANGE_EVENT = "kartiseret-locale-change";
export const LOCALE_SIGNUP_METADATA_KEY = "signup_locale";

const appLocaleSet = new Set<string>(APP_LOCALES);

export function normalizeLocale(value: unknown): AppLocale {
  if (typeof value !== "string") {
    return DEFAULT_LOCALE;
  }

  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];

  return appLocaleSet.has(normalized)
    ? (normalized as AppLocale)
    : DEFAULT_LOCALE;
}

export function getLocaleDirection(locale: AppLocale): AppDirection {
  return locale === "he" ? "rtl" : "ltr";
}

export function getDocumentLocale(): AppLocale {
  if (typeof document === "undefined") {
    return DEFAULT_LOCALE;
  }

  return normalizeLocale(document.documentElement.dataset.locale);
}

export function loadStoredLocale(): AppLocale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);

    return storedLocale ? normalizeLocale(storedLocale) : getDocumentLocale();
  } catch {
    return getDocumentLocale();
  }
}

export function persistLocale(locale: AppLocale): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Keep the in-memory preference active when storage is unavailable.
  }

  window.dispatchEvent(
    new CustomEvent<AppLocale>(LOCALE_CHANGE_EVENT, { detail: locale }),
  );
}

export function applyDocumentLocale(locale: AppLocale): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const direction = getLocaleDirection(locale);

  root.lang = locale;
  root.dir = direction;
  root.dataset.locale = locale;
  root.dataset.direction = direction;
  root.style.setProperty("--app-direction", direction);
}
