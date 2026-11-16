import { SHOWTIME_FILTER_OPTIONS, type ShowtimeFilterGroup } from "@kartiseret/contracts/showtime-links";
import { updateShowtimeFilterState } from "@kartiseret/contracts/showtime-filters";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";

const FILTER_GROUP_LABELS: Record<ShowtimeFilterGroup, string> = {
  showType: "Screening type",
  screenFormat: "Screen format",
  screeningTech: "Technology",
  dubLanguage: "Dubbing",
};

export function UserShowtimePreferences() {
  const {
    user,
    loading,
    syncing,
    preferences,
    defaultLocation,
    savePreferences,
  } = useUserPreferencesStore(
    useShallow((state) => ({
      user: state.user,
      loading: state.loading,
      syncing: state.syncing,
      preferences: state.preferences.showtimePreferences,
      defaultLocation: state.preferences.location,
      savePreferences: state.saveShowtimePreferences,
    })),
  );
  const cinemaGroups = useMemo(() => {
    const grouped = new Map<string, (typeof CINEMA_IDENTITIES)[number][]>();
    for (const cinema of CINEMA_IDENTITIES) {
      const group = grouped.get(cinema.city) ?? [];
      group.push(cinema);
      grouped.set(cinema.city, group);
    }
    return [...grouped.entries()].sort(([left], [right]) => {
      if (left === defaultLocation) return -1;
      if (right === defaultLocation) return 1;
      return left.localeCompare(right);
    });
  }, [defaultLocation]);
  const saveDisabled = !user || loading || syncing;
  const excludedCinemaIds = new Set(preferences.excludedCinemaIds);

  const toggleCinema = (cinemaId: string) => {
    const next = excludedCinemaIds.has(cinemaId)
      ? preferences.excludedCinemaIds.filter((id) => id !== cinemaId)
      : [...preferences.excludedCinemaIds, cinemaId];
    void savePreferences({ ...preferences, excludedCinemaIds: next });
  };

  const toggleCinemaGroup = (cinemaIds: readonly string[]) => {
    const allIncluded = cinemaIds.every((id) => !excludedCinemaIds.has(id));
    const next = allIncluded
      ? [...new Set([...preferences.excludedCinemaIds, ...cinemaIds])]
      : preferences.excludedCinemaIds.filter((id) => !cinemaIds.includes(id));
    void savePreferences({ ...preferences, excludedCinemaIds: next });
  };

  const selectedValues = (group: ShowtimeFilterGroup) =>
    new Set(
      SHOWTIME_FILTER_OPTIONS[group].filter(
        (option) =>
          !preferences.screeningFilters.unchecked[group].includes(option),
      ),
    );

  const toggleFilter = (group: ShowtimeFilterGroup, value: string) => {
    const selected = selectedValues(group);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    const nextSelections: Record<ShowtimeFilterGroup, Set<string>> = {
      showType: selectedValues("showType"),
      screenFormat: selectedValues("screenFormat"),
      screeningTech: selectedValues("screeningTech"),
      dubLanguage: selectedValues("dubLanguage"),
    };
    nextSelections[group] = selected;
    const screeningFilters = updateShowtimeFilterState(
      preferences.screeningFilters,
      SHOWTIME_FILTER_OPTIONS,
      nextSelections,
    );
    void savePreferences({ ...preferences, screeningFilters });
  };

  const toggleFilterGroup = (group: ShowtimeFilterGroup) => {
    const selected = selectedValues(group);
    const allSelected = SHOWTIME_FILTER_OPTIONS[group].every((value) =>
      selected.has(value));
    const nextSelections: Record<ShowtimeFilterGroup, Set<string>> = {
      showType: selectedValues("showType"),
      screenFormat: selectedValues("screenFormat"),
      screeningTech: selectedValues("screeningTech"),
      dubLanguage: selectedValues("dubLanguage"),
    };
    nextSelections[group] = allSelected
      ? new Set<string>()
      : new Set<string>(SHOWTIME_FILTER_OPTIONS[group]);
    const screeningFilters = updateShowtimeFilterState(
      preferences.screeningFilters,
      SHOWTIME_FILTER_OPTIONS,
      nextSelections,
    );
    void savePreferences({ ...preferences, screeningFilters });
  };

  const resetAll = () => {
    void savePreferences({
      screeningFilters: {
        version: 3,
        unchecked: {
          showType: [],
          screenFormat: [],
          screeningTech: [],
          dubLanguage: [],
        },
      },
      excludedCinemaIds: [],
    });
  };

  return (
    <section className="prefs-setting prefs-showtime-setting">
      <div className="prefs-setting-content prefs-setting-content--static">
        <div className="prefs-setting-copy">
          <span className="prefs-setting-label">Showtime defaults</span>
          <span className="prefs-setting-summary">
            Saved to your account and applied when you open showtimes.
          </span>
        </div>
        {!user ? (
          <p className="prefs-alerts-empty">
            Sign in to save cinema and screening defaults. You can still adjust
            filters temporarily while browsing.
          </p>
        ) : null}
        <section aria-label="Default cinemas">
          <div className="prefs-showtime-heading">
            <div>
              <span className="prefs-setting-label">My cinemas</span>
              <span className="prefs-setting-summary">
                {CINEMA_IDENTITIES.length -
                  preferences.excludedCinemaIds.length}{" "}
                of {CINEMA_IDENTITIES.length} included
              </span>
            </div>
            <button
              type="button"
              className="prefs-showtime-reset"
              disabled={
                saveDisabled || preferences.excludedCinemaIds.length === 0
              }
              onClick={() =>
                void savePreferences({ ...preferences, excludedCinemaIds: [] })
              }
            >
              Include all
            </button>
          </div>
          <div className="prefs-showtime-cinema-groups">
            {cinemaGroups.map(([city, cinemas], index) => {
              const cinemaIds = cinemas.map(({ id }) => id);
              const allIncluded = cinemaIds.every(
                (id) => !excludedCinemaIds.has(id),
              );
              return (
                <details
                  className="prefs-showtime-city"
                  key={city}
                  open={index === 0}
                >
                  <summary>{city}</summary>
                  <button
                    type="button"
                    className="prefs-showtime-city-toggle"
                    disabled={saveDisabled}
                    onClick={() => toggleCinemaGroup(cinemaIds)}
                  >
                    {allIncluded ? "Exclude all" : "Include all"}
                  </button>
                  <div className="prefs-setting-options">
                    {cinemas.map((cinema) => {
                      const checked = !excludedCinemaIds.has(cinema.id);
                      return (
                        <label
                          key={cinema.id}
                          className={`prefs-setting-option${checked ? " is-selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={saveDisabled}
                            onChange={() => toggleCinema(cinema.id)}
                          />
                          <span>{cinema.displayName}</span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </section>

        <section aria-label="Default screening filters">
          <div className="prefs-showtime-heading">
            <div>
              <span className="prefs-setting-label">My screening filters</span>
              <span className="prefs-setting-summary">
                Uncheck formats you usually want to hide.
              </span>
            </div>
            <button
              type="button"
              className="prefs-showtime-reset"
              disabled={saveDisabled}
              onClick={resetAll}
            >
              Reset defaults
            </button>
          </div>
          <div className="prefs-showtime-filter-groups">
            {(
              Object.keys(SHOWTIME_FILTER_OPTIONS) as ShowtimeFilterGroup[]
            ).map((group) => {
              const options = SHOWTIME_FILTER_OPTIONS[group];
              const selected = selectedValues(group);
              const allSelected = options.every((option) =>
                selected.has(option));
              return (
                <fieldset key={group} disabled={saveDisabled}>
                  <legend>
                    {FILTER_GROUP_LABELS[group]}
                    <button
                      type="button"
                      disabled={saveDisabled}
                      onClick={() => toggleFilterGroup(group)}
                    >
                      {allSelected ? "Hide all" : "Show all"}
                    </button>
                  </legend>
                  <div className="prefs-setting-options">
                    {options.map((option) => {
                      const checked = selected.has(option);
                      return (
                        <label
                          key={option}
                          className={`prefs-setting-option${checked ? " is-selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFilter(group, option)}
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
