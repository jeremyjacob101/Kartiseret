import type { TicketAlertCriteria, TicketAlertCriteriaOverride } from "@kartiseret/contracts/private-data";
import { SHOWTIME_FILTER_OPTIONS } from "@kartiseret/contracts/showtime-links";
import { useUserPreferencesStore } from "../stores/userPreferencesStore";
import { ALL_LOCATIONS } from "@kartiseret/contracts/preferences";
import { useId, useState } from "react";

type FilterGroup = keyof TicketAlertCriteria["filters"];
type Draft = TicketAlertCriteria | TicketAlertCriteriaOverride;

const FILTER_LABELS: Record<FilterGroup, string> = {
  showType: "Show type",
  screenFormat: "Screen format",
  screeningTech: "Screening technology",
  dubLanguage: "Language",
};

export function TicketAlertCriteriaEditor({
  mode,
  value,
  defaults,
  saving = false,
  onSave,
}: {
  mode: "defaults" | "title";
  value: TicketAlertCriteria | TicketAlertCriteriaOverride;
  defaults: TicketAlertCriteria;
  saving?: boolean;
  onSave: (value: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(value);
  const modeGroup = useId();
  const location = useUserPreferencesStore(
    (state) => state.preferences.location,
  );
  const preferredCity =
    ALL_LOCATIONS.find((city) => city === location) ?? "Jerusalem";

  const isTitle = mode === "title";
  const titleDraft = draft as TicketAlertCriteriaOverride;
  const fullDraft = draft as TicketAlertCriteria;
  const effectiveCities = isTitle
    ? titleDraft.cities === undefined
      ? defaults.cities
      : titleDraft.cities
    : fullDraft.cities;
  const citiesInherited = isTitle && titleDraft.cities === undefined;
  const selectedCities = effectiveCities ?? [preferredCity];
  const effectiveMode =
    draft.notificationMode ?? defaults.notificationMode ?? "first_any_city";

  function setCities(next: TicketAlertCriteria["cities"]) {
    setDraft((current) => ({ ...current, cities: next }));
  }

  function setCityInheritance(inherit: boolean) {
    setDraft((current) => {
      const next = { ...(current as TicketAlertCriteriaOverride) };
      if (inherit) delete next.cities;
      else next.cities = defaults.cities;
      return next;
    });
  }

  function valuesFor(group: FilterGroup): string[] {
    if (!isTitle) return fullDraft.filters[group];
    return titleDraft.filters?.[group] ?? defaults.filters[group];
  }

  function groupInherited(group: FilterGroup): boolean {
    return isTitle && titleDraft.filters?.[group] === undefined;
  }

  function updateFilter(group: FilterGroup, unchecked: string[]) {
    setDraft((current) => {
      if (!isTitle) {
        const next = current as TicketAlertCriteria;
        return { ...next, filters: { ...next.filters, [group]: unchecked } };
      }
      const next = current as TicketAlertCriteriaOverride;
      return {
        ...next,
        filters: { ...next.filters, [group]: unchecked },
      };
    });
  }

  function setFilterInheritance(group: FilterGroup, inherit: boolean) {
    setDraft((current) => {
      const next = current as TicketAlertCriteriaOverride;
      const filters = { ...next.filters };
      if (inherit) delete filters[group];
      else filters[group] = defaults.filters[group];
      return {
        ...next,
        ...(Object.keys(filters).length ? { filters } : { filters: undefined }),
      };
    });
  }

  function setModeInheritance(inherit: boolean) {
    setDraft((current) => {
      const next = { ...current };
      if (inherit)
        delete (next as TicketAlertCriteriaOverride).notificationMode;
      else next.notificationMode = defaults.notificationMode;
      return next;
    });
  }

  function toggleCity(city: (typeof ALL_LOCATIONS)[number], checked: boolean) {
    const selected =
      effectiveCities === null ? [preferredCity] : [...effectiveCities];
    const next = checked
      ? [...new Set([...selected, city])]
      : selected.filter((entry) => entry !== city);
    setCities(next);
  }

  return (
    <div className="ticket-alert-criteria-editor">
      <fieldset className="ticket-alert-criteria-group">
        <legend>When to notify</legend>
        {isTitle ? (
          <label className="ticket-alert-inherit">
            <input
              type="checkbox"
              checked={titleDraft.notificationMode === undefined}
              onChange={(event) =>
                setModeInheritance(event.currentTarget.checked)
              }
            />
            Use account notification mode
          </label>
        ) : null}
        <label>
          <input
            type="radio"
            name={modeGroup}
            checked={effectiveMode === "first_any_city"}
            disabled={
              saving || (isTitle && titleDraft.notificationMode === undefined)
            }
            onChange={() =>
              setDraft((current) => ({
                ...current,
                notificationMode: "first_any_city",
              }))
            }
          />
          First in any selected city — one alert per film
        </label>
        <label>
          <input
            type="radio"
            name={modeGroup}
            checked={effectiveMode === "first_per_city"}
            disabled={
              saving || (isTitle && titleDraft.notificationMode === undefined)
            }
            onChange={() =>
              setDraft((current) => ({
                ...current,
                notificationMode: "first_per_city",
              }))
            }
          />
          First in each selected city — one alert per film per city
        </label>
      </fieldset>
      <fieldset className="ticket-alert-criteria-group">
        <legend>Cities</legend>
        {isTitle ? (
          <label className="ticket-alert-inherit">
            <input
              type="checkbox"
              checked={citiesInherited}
              onChange={(event) =>
                setCityInheritance(event.currentTarget.checked)
              }
            />
            Use account default
          </label>
        ) : null}
        <button
          type="button"
          className="ticket-alert-select-all"
          disabled={citiesInherited || saving || effectiveCities === null}
          onClick={() => setCities(null)}
        >
          Use preferred city ({preferredCity})
        </button>
        <button
          className="ticket-alert-select-all"
          type="button"
          disabled={citiesInherited || saving}
          onClick={() => setCities([...ALL_LOCATIONS])}
        >
          All cities
        </button>
        <div className="ticket-alert-city-options">
          {ALL_LOCATIONS.map((city) => (
            <label key={city}>
              <input
                type="checkbox"
                checked={selectedCities.includes(city)}
                disabled={citiesInherited || saving}
                onChange={(event) =>
                  toggleCity(city, event.currentTarget.checked)
                }
              />
              {city}
            </label>
          ))}
        </div>
      </fieldset>

      {(Object.keys(SHOWTIME_FILTER_OPTIONS) as FilterGroup[]).map((group) => {
        const inherited = groupInherited(group);
        const unchecked = valuesFor(group);
        const options = SHOWTIME_FILTER_OPTIONS[group];
        return (
          <fieldset className="ticket-alert-criteria-group" key={group}>
            <legend>{FILTER_LABELS[group]}</legend>
            {isTitle ? (
              <label className="ticket-alert-inherit">
                <input
                  type="checkbox"
                  checked={inherited}
                  onChange={(event) =>
                    setFilterInheritance(group, event.currentTarget.checked)
                  }
                />
                Use account default
              </label>
            ) : null}
            <button
              className="ticket-alert-select-all"
              type="button"
              disabled={inherited || unchecked.length === 0}
              onClick={() => updateFilter(group, [])}
            >
              All {FILTER_LABELS[group].toLowerCase()} options
            </button>
            <div className="ticket-alert-filter-options">
              {options.map((option) => (
                <label key={option}>
                  <input
                    type="checkbox"
                    checked={!unchecked.includes(option)}
                    disabled={inherited || saving}
                    onChange={(event) =>
                      updateFilter(
                        group,
                        event.currentTarget.checked
                          ? unchecked.filter((entry) => entry !== option)
                          : [...unchecked, option],
                      )
                    }
                  />
                  {option}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}

      <button
        className="ticket-alert-save-criteria"
        type="button"
        disabled={saving}
        onClick={() => onSave(draft)}
      >
        {saving ? "Saving…" : "Save criteria"}
      </button>
    </div>
  );
}
