import { SHOWTIME_FILTER_OPTIONS, type ShowtimeFilterGroup } from "@kartiseret/contracts/showtime-links";
import { updateShowtimeFilterState } from "@kartiseret/contracts/showtime-filters";
import { CINEMA_IDENTITIES } from "@kartiseret/contracts/cinema-identities";
import { formatScreeningTechLabel } from "./showtimes/showtimeTechLabels";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { useShallow } from "zustand/react/shallow";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

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
  const [selectedCinemaCity, setSelectedCinemaCity] = useState(defaultLocation);
  const saveDisabled = !user || loading || syncing;
  const excludedCinemaIds = new Set(preferences.excludedCinemaIds);
  const selectedCinemaGroup =
    cinemaGroups.find(([city]) => city === selectedCinemaCity) ??
    cinemaGroups[0];
  const selectedCinemas = selectedCinemaGroup?.[1] ?? [];
  const selectedCinemaIds = selectedCinemas.map(({ id }) => id);
  const includedCinemaCount =
    CINEMA_IDENTITIES.length - preferences.excludedCinemaIds.length;
  const selectedCityIncludedCount = selectedCinemas.filter(
    ({ id }) => !excludedCinemaIds.has(id),
  ).length;
  const selectedCityAllIncluded =
    selectedCityIncludedCount === selectedCinemas.length;
  const filterGroups = Object.keys(
    SHOWTIME_FILTER_OPTIONS,
  ) as ShowtimeFilterGroup[];
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

  const totalFilterCount = filterGroups.reduce(
    (total, group) => total + SHOWTIME_FILTER_OPTIONS[group].length,
    0,
  );
  const selectedFilterCount = filterGroups.reduce(
    (total, group) => total + selectedValues(group).size,
    0,
  );
  const filterSummary =
    selectedFilterCount === totalFilterCount
      ? "All screening options shown"
      : `${selectedFilterCount} of ${totalFilterCount} screening options shown`;

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
    <section className="prefs-showtime-setting" aria-label="Showtime defaults">
      <div className="prefs-showtime-content">
        {!user ? (
          <p className="prefs-alerts-empty">
            Sign in to save cinema and screening defaults. You can still adjust
            filters temporarily while browsing.
          </p>
        ) : null}
        <details
          className="prefs-disclosure prefs-showtime-disclosure"
          aria-label="Default cinemas"
        >
          <summary className="prefs-disclosure-summary">
            <span className="prefs-disclosure-copy">
              <strong>My cinemas</strong>
              <span>
                {includedCinemaCount} of {CINEMA_IDENTITIES.length} included
              </span>
            </span>
            <ChevronDown
              className="prefs-disclosure-chevron"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="prefs-disclosure-content prefs-showtime-disclosure-content">
            <div className="prefs-showtime-heading">
              <div>
                <span className="prefs-setting-summary">
                  Choose the cinemas included in your showtimes.
                </span>
              </div>
              <button
                type="button"
                className="prefs-showtime-reset"
                disabled={
                  saveDisabled || preferences.excludedCinemaIds.length === 0
                }
                onClick={() =>
                  void savePreferences({
                    ...preferences,
                    excludedCinemaIds: [],
                  })
                }
              >
                Include all
              </button>
            </div>
            {selectedCinemaGroup ? (
              <div className="prefs-showtime-cinema-picker">
                <label htmlFor="prefs-cinema-city">City</label>
                <select
                  id="prefs-cinema-city"
                  value={selectedCinemaGroup[0]}
                  disabled={saveDisabled}
                  onChange={(event) =>
                    setSelectedCinemaCity(event.currentTarget.value)
                  }
                >
                  {cinemaGroups.map(([city]) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
                <div className="prefs-showtime-city-heading">
                  <span className="prefs-setting-summary">
                    {selectedCityIncludedCount} of {selectedCinemas.length}{" "}
                    included
                  </span>
                  <button
                    type="button"
                    className="prefs-showtime-city-toggle"
                    disabled={saveDisabled}
                    onClick={() => toggleCinemaGroup(selectedCinemaIds)}
                  >
                    {selectedCityAllIncluded
                      ? "Exclude all here"
                      : "Include all here"}
                  </button>
                </div>
                <div className="prefs-setting-options">
                  {selectedCinemas.map((cinema) => {
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
              </div>
            ) : null}
          </div>
        </details>

        <details
          className="prefs-disclosure prefs-showtime-disclosure"
          aria-label="Default screening filters"
        >
          <summary className="prefs-disclosure-summary">
            <span className="prefs-disclosure-copy">
              <strong>My screening filters</strong>
              <span>{filterSummary}</span>
            </span>
            <ChevronDown
              className="prefs-disclosure-chevron"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="prefs-disclosure-content prefs-showtime-disclosure-content">
            <div className="prefs-showtime-heading">
              <div>
                <span className="prefs-setting-summary">
                  Choose the formats and languages you prefer to see.
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
              {filterGroups.map((group) => {
                const options = SHOWTIME_FILTER_OPTIONS[group];
                const selected = selectedValues(group);
                const allSelected = options.every((option) =>
                  selected.has(option));
                return (
                  <details className="prefs-showtime-filter-group" key={group}>
                    <summary>
                      <span className="prefs-showtime-filter-name">
                        {FILTER_GROUP_LABELS[group]}
                      </span>
                      <span className="prefs-showtime-filter-count">
                        {allSelected
                          ? "All shown"
                          : `${selected.size} of ${options.length} shown`}
                      </span>
                      <ChevronDown
                        className="prefs-disclosure-chevron"
                        size={17}
                        aria-hidden="true"
                      />
                    </summary>
                    <div className="prefs-showtime-filter-content">
                      <button
                        type="button"
                        disabled={saveDisabled}
                        onClick={() => toggleFilterGroup(group)}
                      >
                        {allSelected ? "Hide all" : "Show all"}
                      </button>
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
                                disabled={saveDisabled}
                                onChange={() => toggleFilter(group, option)}
                              />
                              <span>
                                {group === "screeningTech"
                                  ? formatScreeningTechLabel(option)
                                  : option}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
