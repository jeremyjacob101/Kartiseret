import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Link } from "react-router";
import "./UserPreferencesPage.css";
import { loadCityLocationPicker } from "./maps/loadCityLocationPicker";
import { useUserPreferencesContext } from "../prefs/useUserPreferences";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { type AppLocation } from "../prefs/definitions/locations";
import { getSiteColorLabel, type SiteColor, type SiteColorOption } from "../prefs/definitions/siteColor";
import { useI18n } from "../i18n/I18nContext";
import { localizeCityName } from "../i18n/content";
import { LanguageToggle } from "./LanguageToggle";
import type { MessageKey } from "../i18n/messages";

const CityLocationPicker = lazy(async () => {
  const module = await loadCityLocationPicker();

  return { default: module.CityLocationPicker };
});

const sourceLabelMap: Record<RatingSource, string> = {
  imdbRating: "IMDb",
  rtAudienceRating: "Rotten Tomatoes Audience",
  rtCriticRating: "Rotten Tomatoes Critics",
  lbRating: "Letterboxd",
  tmdbRating: "TMDB",
};
const colorLabelKeys: Readonly<Record<string, MessageKey>> = {
  Pink: "color.pink",
  Red: "color.red",
  Orange: "color.orange",
  Yellow: "color.yellow",
  Green: "color.green",
  Teal: "color.teal",
  Blue: "color.blue",
  Indigo: "color.indigo",
  Purple: "color.purple",
};

function getSourcesSummary(
  sources: readonly RatingSource[],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (sources.length === 0) {
    return t("preferences.noSources");
  }

  const labels = sources.map((source) => sourceLabelMap[source]);

  if (labels.length <= 2) {
    return labels.join(", ");
  }

  return t("preferences.moreSources", {
    first: labels[0] ?? "",
    second: labels[1] ?? "",
    count: labels.length - 2,
  });
}

function getLocalizedColorLabel(
  label: string,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const messageKey = colorLabelKeys[label];

  return messageKey ? t(messageKey) : label;
}

function getVisibleSiteColors(
  siteColor: SiteColor,
  options: readonly SiteColorOption[],
  t: ReturnType<typeof useI18n>["t"],
): readonly SiteColorOption[] {
  if (options.some((option) => option.value === siteColor)) {
    return options;
  }

  return [
    {
      label: t("preferences.currentColor", {
        color: siteColor.toUpperCase(),
      }),
      value: siteColor,
    },
    ...options,
  ];
}

function EmbeddedCityLocationPickerLoading() {
  const { t } = useI18n();

  return (
    <div
      className="theater-map-panel theater-map-panel--embedded prefs-location-map-loading"
      role="status"
    >
      {t("map.loadingCity")}
    </div>
  );
}

export function UserPreferencesPage() {
  const { locale, t } = useI18n();
  const {
    user,
    sources,
    location,
    allSources,
    allSiteColors,
    siteColor,
    defaultSiteColor,
    syncing,
    error,
    saveSources,
    setLocationPreference,
    saveSiteColor,
    resetSiteColor,
  } = useUserPreferencesContext();
  const [isSourcesOpen, setIsSourcesOpen] = useState(true);
  const visibleSiteColors = useMemo(
    () => getVisibleSiteColors(siteColor, allSiteColors, t),
    [allSiteColors, siteColor, t],
  );

  const handleSourceToggle = useCallback(
    async (source: RatingSource) => {
      const nextSources = sources.includes(source)
        ? sources.filter((entry) => entry !== source)
        : [...sources, source];

      await saveSources(nextSources);
    },
    [saveSources, sources],
  );

  const handleLocationPick = useCallback(
    async (nextLocation: AppLocation) => {
      await setLocationPreference(nextLocation);
    },
    [setLocationPreference],
  );

  const handleSiteColorChange = useCallback(
    async (nextSiteColor: SiteColor) => {
      await saveSiteColor(nextSiteColor);
    },
    [saveSiteColor],
  );

  const handleSiteColorReset = useCallback(async () => {
    await resetSiteColor();
  }, [resetSiteColor]);

  return (
    <section className="prefs-page" aria-label={t("preferences.aria")}>
      <div className="prefs-page-header">
        <div>
          <p className="section-kicker">{t("preferences.kicker")}</p>
          <h1 className="section-title">{t("preferences.title")}</h1>
        </div>
        <Link className="prefs-page-back" to="/">
          {t("account.backHome")}
        </Link>
      </div>

      <div className="prefs-page-card" aria-busy={syncing}>
        <section className="prefs-location-card">
          <div className="prefs-location-header">
            <div>
              <p className="prefs-setting-label">{t("preferences.location")}</p>
              <h2 className="prefs-location-title" dir="auto">
                {localizeCityName(location, locale)}
              </h2>
            </div>
          </div>

          <Suspense fallback={<EmbeddedCityLocationPickerLoading />}>
            <CityLocationPicker
              className="theater-map-panel--embedded"
              currentLocation={location}
              onPickLocation={handleLocationPick}
              syncing={syncing}
            />
          </Suspense>
        </section>

        <div className="prefs-page-settings">
          <section className="prefs-setting prefs-setting--static">
            <div className="prefs-setting-content prefs-setting-content--static">
              <div className="prefs-language-setting">
                <div className="prefs-language-copy">
                  <span className="prefs-setting-label">
                    {t("preferences.language")}
                  </span>
                  <span className="prefs-setting-summary">
                    {t("preferences.languageHelp")}
                  </span>
                </div>
                <LanguageToggle showCurrentLanguage />
              </div>
            </div>
          </section>

          <section className="prefs-setting prefs-setting--static">
            <div className="prefs-setting-content prefs-setting-content--static">
              <div className="prefs-color-setting">
                <div className="prefs-color-copy">
                  <span className="prefs-setting-label">
                    {t("preferences.color")}
                  </span>
                  <span className="prefs-setting-summary">
                    {t("preferences.siteColor", {
                      color: getLocalizedColorLabel(
                        getSiteColorLabel(siteColor),
                        t,
                      ),
                    })}
                  </span>
                </div>

                <div className="prefs-color-controls">
                  <div
                    className="prefs-color-swatches"
                    role="list"
                    aria-label={t("preferences.siteColors")}
                  >
                    {visibleSiteColors.map((colorOption) => {
                      const isSelected = colorOption.value === siteColor;

                      return (
                        <button
                          key={colorOption.value}
                          type="button"
                          className={`prefs-color-swatch${isSelected ? " is-selected" : ""}`}
                          style={{ backgroundColor: colorOption.value }}
                          aria-label={t("preferences.useColor", {
                            color: getLocalizedColorLabel(colorOption.label, t),
                          })}
                          aria-pressed={isSelected}
                          title={getLocalizedColorLabel(colorOption.label, t)}
                          disabled={syncing || !user}
                          onClick={() => {
                            void handleSiteColorChange(colorOption.value);
                          }}
                        />
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="prefs-color-reset"
                    disabled={
                      syncing || !user || siteColor === defaultSiteColor
                    }
                    onClick={() => {
                      void handleSiteColorReset();
                    }}
                  >
                    {t("preferences.reset")}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="prefs-setting">
            <button
              type="button"
              className="prefs-setting-toggle"
              aria-expanded={isSourcesOpen}
              onClick={() => {
                setIsSourcesOpen((open) => !open);
              }}
            >
              <span className="prefs-setting-copy">
                <span className="prefs-setting-label">
                  {t("preferences.ratingSources")}
                </span>
                <span className="prefs-setting-summary">
                  {getSourcesSummary(sources, t)}
                </span>
              </span>
              <ChevronDown
                size={16}
                strokeWidth={2.2}
                className={`prefs-setting-chevron${isSourcesOpen ? " is-open" : ""}`}
              />
            </button>

            {isSourcesOpen ? (
              <div className="prefs-setting-content">
                <div className="prefs-setting-options">
                  {allSources.map((source) => {
                    const checked = sources.includes(source);

                    return (
                      <label
                        key={source}
                        className={`prefs-setting-option${
                          checked ? " is-selected" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={syncing}
                          onChange={() => {
                            void handleSourceToggle(source);
                          }}
                        />
                        <span>{sourceLabelMap[source]}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>
      {error ? (
        <p className="prefs-page-feedback prefs-page-feedback--error">
          {t("preferences.error")}
        </p>
      ) : null}
    </section>
  );
}
