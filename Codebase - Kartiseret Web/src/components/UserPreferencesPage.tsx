import { Bell, CalendarDays, ChevronDown, MapPin, Monitor, Search, UserRound } from "lucide-react";
import { usePublicRouteSearchParams } from "../routing/PublicRouteLocation";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getAuthClient } from "../lib/authClient";
import "./UserPreferencesPage.css";
import { getSiteColorLabel, type SiteColor, type SiteColorOption } from "../prefs/definitions/siteColor";
import { UserMovieDisplayPreferences } from "./UserMovieDisplayPreferences";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { loadCityLocationPicker } from "./maps/loadCityLocationPicker";
import { type RatingSource } from "../prefs/definitions/ratingSources";
import { AccountSecuritySettings } from "./AccountSecuritySettings";
import { UserShowtimePreferences } from "./UserShowtimePreferences";
import { type AppLocation } from "../prefs/definitions/locations";
import { DeleteAccountSection } from "./DeleteAccountSection";
import { UserTicketAlerts } from "./UserTicketAlerts";

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

const preferenceCategories = [
  { id: "showtimes", label: "Showtimes", icon: CalendarDays },
  { id: "discovery", label: "Discovery", icon: Search },
  { id: "appearance", label: "Appearance", icon: Monitor },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "account", label: "Account", icon: UserRound },
] as const;

type PreferenceCategory = (typeof preferenceCategories)[number]["id"];

const categoryDescriptions: Record<PreferenceCategory, string> = {
  showtimes: "Set the cities, cinemas and formats you'll see first.",
  discovery: "Choose how ratings and titles appear while you browse.",
  appearance: "Make the site feel more like yours.",
  notifications: "Manage the films and lists you want to keep an eye on.",
  account: "Manage how you sign in and your account details.",
};

function getSourcesSummary(sources: readonly RatingSource[]): string {
  if (sources.length === 0) {
    return "No sources selected";
  }

  const labels = sources.map((source) => sourceLabelMap[source]);

  if (labels.length <= 2) {
    return labels.join(", ");
  }

  return `${labels[0]}, ${labels[1]} +${labels.length - 2} more`;
}

function getVisibleSiteColors(
  siteColor: SiteColor,
  options: readonly SiteColorOption[],
): readonly SiteColorOption[] {
  if (options.some((option) => option.value === siteColor)) {
    return options;
  }

  return [
    {
      label: `Current ${siteColor.toUpperCase()}`,
      value: siteColor,
    },
    ...options,
  ];
}

function EmbeddedCityLocationPickerLoading() {
  return (
    <div
      className="theater-map-panel theater-map-panel--embedded prefs-location-map-loading"
      role="status"
    >
      Loading city map...
    </div>
  );
}

function DisclosureChevron() {
  return (
    <ChevronDown
      className="prefs-disclosure-chevron"
      size={18}
      aria-hidden="true"
    />
  );
}

export function UserPreferencesPage() {
  const {
    user,
    sources,
    location,
    hideReReleases,
    allSources,
    allSiteColors,
    siteColor,
    defaultSiteColor,
    syncing,
    error,
    saveSources,
    saveHideReReleases,
    setLocationPreference,
    saveSiteColor,
    resetSiteColor,
  } = useUserPreferencesStore(
    useShallow((state) => ({
      user: state.user,
      sources: state.preferences.ratingSources,
      location: state.preferences.location,
      hideReReleases: state.preferences.hideReReleases,
      allSources: state.allSources,
      allSiteColors: state.allSiteColors,
      siteColor: state.preferences.siteColor,
      defaultSiteColor: state.defaultSiteColor,
      syncing: state.syncing,
      error: state.error,
      saveSources: state.saveSources,
      saveHideReReleases: state.saveHideReReleases,
      setLocationPreference: state.setLocationPreference,
      saveSiteColor: state.saveSiteColor,
      resetSiteColor: state.resetSiteColor,
    })),
  );
  const [searchParams, setSearchParams] = usePublicRouteSearchParams();
  const activeCategory =
    preferenceCategories.find(({ id }) => id === searchParams.get("tab"))?.id ??
    "showtimes";
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error } = await getAuthClient().signOut();
      if (error)
        setSignOutError(
          error.message || "Could not sign out. Please try again.",
        );
    } catch {
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }
  const [isCityPickerOpen, setIsCityPickerOpen] = useState(false);
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const visibleSiteColors = useMemo(
    () => getVisibleSiteColors(siteColor, allSiteColors),
    [allSiteColors, siteColor],
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

  const handleHideReReleasesChange = useCallback(
    async (hide: boolean) => {
      await saveHideReReleases(hide);
    },
    [saveHideReReleases],
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

  const categoryHeading =
    preferenceCategories.find(({ id }) => id === activeCategory)?.label ??
    "Showtimes";

  return (
    <section className="prefs-page" aria-label="User preferences">
      <div className="prefs-page-header">
        <div>
          <p className="section-kicker">User</p>
          <h1 className="section-title">User Preferences</h1>
        </div>
      </div>

      <div className="prefs-page-workspace" aria-busy={syncing}>
        <nav className="prefs-category-nav" aria-label="Preference categories">
          {preferenceCategories.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`prefs-category-button${activeCategory === id ? " is-active" : ""}`}
              type="button"
              aria-pressed={activeCategory === id}
              onClick={() => {
                setSearchParams(
                  (params) => {
                    const next = new URLSearchParams(params);
                    if (id === "showtimes") next.delete("tab");
                    else next.set("tab", id);
                    return next;
                  },
                  { replace: true, preventScrollReset: true },
                );
              }}
            >
              <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="prefs-page-card">
          <header className="prefs-category-header">
            <h2 aria-live="polite">{categoryHeading}</h2>
            <p>{categoryDescriptions[activeCategory]}</p>
          </header>

          <div className="prefs-category-content">
            {activeCategory === "showtimes" ? (
              <div className="prefs-settings-stack">
                <section
                  className="prefs-location-setting"
                  aria-label="Default city"
                >
                  <div className="prefs-location-summary">
                    <MapPin size={23} strokeWidth={1.8} aria-hidden="true" />
                    <div className="prefs-location-copy">
                      <span className="prefs-setting-label">Default city</span>
                      <strong className="prefs-location-title">
                        {location}
                      </strong>
                    </div>
                    <button
                      className="prefs-location-action"
                      type="button"
                      aria-expanded={isCityPickerOpen}
                      aria-controls="prefs-city-picker"
                      disabled={syncing}
                      onClick={() => setIsCityPickerOpen((open) => !open)}
                    >
                      <span>
                        {isCityPickerOpen ? "Close map" : "Change city"}
                      </span>
                      <DisclosureChevron />
                    </button>
                  </div>
                  {isCityPickerOpen ? (
                    <div className="prefs-location-map" id="prefs-city-picker">
                      <Suspense
                        fallback={<EmbeddedCityLocationPickerLoading />}
                      >
                        <CityLocationPicker
                          className="theater-map-panel--embedded"
                          currentLocation={location}
                          onPickLocation={handleLocationPick}
                          syncing={syncing}
                        />
                      </Suspense>
                    </div>
                  ) : null}
                </section>

                <UserShowtimePreferences key={location} />
              </div>
            ) : null}

            {activeCategory === "discovery" ? (
              <div className="prefs-settings-stack">
                <section className="prefs-disclosure prefs-sources-setting">
                  <button
                    type="button"
                    className="prefs-disclosure-summary"
                    aria-expanded={isSourcesOpen}
                    aria-controls="prefs-rating-sources"
                    onClick={() => setIsSourcesOpen((open) => !open)}
                  >
                    <span className="prefs-disclosure-copy">
                      <strong>Rating sources</strong>
                      <span>{getSourcesSummary(sources)}</span>
                    </span>
                    <DisclosureChevron />
                  </button>
                  {isSourcesOpen ? (
                    <div
                      className="prefs-disclosure-content"
                      id="prefs-rating-sources"
                    >
                      <div className="prefs-setting-options">
                        {allSources.map((source) => {
                          const checked = sources.includes(source);

                          return (
                            <label
                              key={source}
                              className={`prefs-setting-option${checked ? " is-selected" : ""}`}
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

                <section
                  className="prefs-release-setting"
                  aria-label="Release categories"
                >
                  <label className="prefs-switch-row">
                    <span className="prefs-switch-copy">
                      <strong>Hide Re-Releases</strong>
                      <span>
                        Remove Re-Releases from Now Playing, Coming Soon and All
                        Showtimes.
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={hideReReleases}
                      disabled={syncing || !user}
                      onChange={(event) => {
                        void handleHideReReleasesChange(
                          event.currentTarget.checked,
                        );
                      }}
                    />
                    <span className="prefs-switch-visual" aria-hidden="true" />
                  </label>
                </section>

                {user ? <UserMovieDisplayPreferences userId={user.id} /> : null}
              </div>
            ) : null}

            {activeCategory === "appearance" ? (
              <section
                className="prefs-color-setting"
                aria-labelledby="prefs-color-heading"
              >
                <div className="prefs-color-copy">
                  <h3 id="prefs-color-heading">Site color</h3>
                  <p className="prefs-setting-summary">
                    {getSiteColorLabel(siteColor)} accent
                  </p>
                </div>

                <div className="prefs-color-controls">
                  <div
                    className="prefs-color-swatches"
                    role="group"
                    aria-label="Site colors"
                  >
                    {visibleSiteColors.map((colorOption) => {
                      const isSelected = colorOption.value === siteColor;

                      return (
                        <button
                          key={colorOption.value}
                          type="button"
                          className={`prefs-color-swatch${isSelected ? " is-selected" : ""}`}
                          style={{ backgroundColor: colorOption.value }}
                          aria-label={`Use ${colorOption.label} site color`}
                          aria-pressed={isSelected}
                          title={colorOption.label}
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
                    Reset
                  </button>
                </div>
              </section>
            ) : null}

            {activeCategory === "notifications" ? (
              <UserTicketAlerts
                key={user?.id ?? "guest"}
                userId={user?.id ?? null}
              />
            ) : null}

            {activeCategory === "account" ? (
              <div className="prefs-settings-stack prefs-account-stack">
                {user ? (
                  <>
                    <div>
                      <button
                        type="button"
                        className="prefs-color-reset"
                        disabled={signingOut}
                        onClick={() => void handleSignOut()}
                      >
                        {signingOut ? "Signing out…" : "Sign out"}
                      </button>
                      {signOutError ? <p role="alert">{signOutError}</p> : null}
                    </div>
                    <details className="prefs-disclosure prefs-account-details">
                      <summary className="prefs-disclosure-summary">
                        <span className="prefs-disclosure-copy">
                          <strong>Sign-in &amp; security</strong>
                          <span>
                            {user.email ?? "Manage your sign-in methods"}
                          </span>
                        </span>
                        <DisclosureChevron />
                      </summary>
                      <div className="prefs-account-content">
                        <AccountSecuritySettings email={user.email} />
                      </div>
                    </details>

                    <details className="prefs-disclosure prefs-danger-disclosure">
                      <summary className="prefs-disclosure-summary">
                        <span className="prefs-disclosure-copy">
                          <strong>Delete account</strong>
                          <span>
                            Permanently remove your Kartiseret account
                          </span>
                        </span>
                        <DisclosureChevron />
                      </summary>
                      <div className="prefs-danger-content">
                        <DeleteAccountSection />
                      </div>
                    </details>
                  </>
                ) : null}
              </div>
            ) : null}

            {syncing ? (
              <p className="prefs-autosave" role="status" aria-live="polite">
                Saving changes…
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <p
          className="prefs-page-feedback prefs-page-feedback--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
