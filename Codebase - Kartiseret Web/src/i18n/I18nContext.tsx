import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { applyDocumentLocale, getLocaleDirection, loadStoredLocale, LOCALE_CHANGE_EVENT, LOCALE_STORAGE_KEY, normalizeLocale, persistLocale, type AppDirection, type AppLocale } from "./locale";
import { translateMessage, type MessageKey, type MessageValues } from "./messages";

type Translate = (key: MessageKey, values?: MessageValues) => string;

export type I18nContextValue = {
  locale: AppLocale;
  direction: AppDirection;
  isRtl: boolean;
  setLocale: (locale: AppLocale) => void;
  toggleLocale: () => void;
  t: Translate;
};

const fallbackContextValue: I18nContextValue = {
  locale: "en",
  direction: "ltr",
  isRtl: false,
  setLocale: () => {},
  toggleLocale: () => {},
  t: (key, values) => translateMessage("en", key, values),
};

const I18nContext = createContext<I18nContextValue | null>(null);

function updateLocalizedMetadata(locale: AppLocale): void {
  if (typeof document === "undefined") {
    return;
  }

  const description = translateMessage(locale, "meta.description");
  const descriptionMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]',
  );
  const openGraphDescription = document.querySelector<HTMLMetaElement>(
    'meta[property="og:description"]',
  );
  const openGraphLocale = document.querySelector<HTMLMetaElement>(
    'meta[property="og:locale"]',
  );
  const openGraphAlternateLocale = document.querySelector<HTMLMetaElement>(
    'meta[property="og:locale:alternate"]',
  );
  const openGraphSiteName = document.querySelector<HTMLMetaElement>(
    'meta[property="og:site_name"]',
  );
  const twitterDescription = document.querySelector<HTMLMetaElement>(
    'meta[name="twitter:description"]',
  );

  descriptionMeta?.setAttribute("content", description);
  openGraphDescription?.setAttribute("content", description);
  openGraphLocale?.setAttribute("content", locale === "he" ? "he_IL" : "en_US");
  openGraphAlternateLocale?.setAttribute(
    "content",
    locale === "he" ? "en_US" : "he_IL",
  );
  openGraphSiteName?.setAttribute(
    "content",
    translateMessage(locale, "brand.name"),
  );
  twitterDescription?.setAttribute("content", description);
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<AppLocale>(() =>
    loadStoredLocale());

  const setLocale = useCallback((nextLocale: AppLocale) => {
    const normalizedLocale = normalizeLocale(nextLocale);
    setLocaleState(normalizedLocale);
    persistLocale(normalizedLocale);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "en" ? "he" : "en");
  }, [locale, setLocale]);

  useEffect(() => {
    applyDocumentLocale(locale);
    updateLocalizedMetadata(locale);
  }, [locale]);

  useEffect(() => {
    const handleLocaleChange = (event: Event) => {
      const customEvent = event as CustomEvent<AppLocale>;
      setLocaleState(normalizeLocale(customEvent.detail));
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY || !event.newValue) {
        return;
      }

      setLocaleState(normalizeLocale(event.newValue));
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const contextValue = useMemo<I18nContextValue>(() => {
    const direction = getLocaleDirection(locale);

    return {
      locale,
      direction,
      isRtl: direction === "rtl",
      setLocale,
      toggleLocale,
      t: (key, values) => translateMessage(locale, key, values),
    };
  }, [locale, setLocale, toggleLocale]);

  return (
    <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? fallbackContextValue;
}
